from __future__ import annotations
from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect, get_object_or_404
import json
from datetime import timedelta
from django.utils import timezone
from groupmindhub.apps.core.models import (
    Project,
    Entry,
    Change,
    Vote,
    Block,
    Section,
    ProjectStar,
    EntryHistory,
    ProjectMembership,
)
from groupmindhub.apps.core.api import serialize_entry
from django.http import HttpResponse
from pathlib import Path


def index(request):
    """Home page listing projects with stars + activity; creation moved to /projects/new/."""
    from django.db.models import Count
    from django.utils import timezone
    now = timezone.now()
    day_ago = now - timezone.timedelta(days=1)
    week_ago = now - timezone.timedelta(days=7)
    # Prefetch related counts cheaply
    projects = list(Project.objects.all().order_by('-created_at'))
    user_star_ids = set()
    if request.user.is_authenticated:
        user_star_ids = set(ProjectStar.objects.filter(user=request.user, project__in=projects).values_list('project_id', flat=True))
    # Build activity (simple heuristic for now): changes<24h *1 + changes<7d *0.2
    patch_qs = Change.objects.filter(project__in=projects)
    recent_counts = {
        'day': dict(patch_qs.filter(created_at__gte=day_ago).values_list('project_id').annotate(c=Count('id'))),
        'week': dict(patch_qs.filter(created_at__gte=week_ago).values_list('project_id').annotate(c=Count('id'))),
    }
    star_counts = dict(ProjectStar.objects.filter(project__in=projects).values_list('project_id').annotate(c=Count('id')))
    rows = []
    for p in projects:
        day_c = recent_counts['day'].get(p.id, 0)
        week_c = recent_counts['week'].get(p.id, 0)
        activity = day_c + week_c * 0.2
        rows.append({
            'id': p.id,
            'name': p.name,
            'created_at': p.created_at,
            'stars': star_counts.get(p.id, 0),
            'starred': p.id in user_star_ids,
            'activity': activity,
        })
    # Sort by created_at already; activity can be used client-side for filtering later.
    return render(request, 'index.html', { 'projects': rows })


@login_required
def project_new(request):
    """Project creation with section builder (heading + body)."""
    if request.method == 'POST':
        name = request.POST.get('name','').strip()
        desc = request.POST.get('description','').strip()
        sections_json = request.POST.get('sections_json','').strip()
        if name:
            project = Project.objects.create(name=name, description=desc)
            project.add_member(request.user, ProjectMembership.Role.OWNER)
            entry = Entry.objects.create(project=project, title='Trunk', author=request.user, status='published')
            # Parse sections JSON into nested tree
            try:
                parsed = json.loads(sections_json) if sections_json else []
            except Exception:
                parsed = []

            from itertools import count

            def normalize(nodes):
                out = []
                if not isinstance(nodes, list):
                    return out
                for node in nodes:
                    heading = (node.get('heading') if isinstance(node, dict) else '') or ''
                    body = (node.get('body') if isinstance(node, dict) else '') or ''
                    children = normalize(node.get('children') if isinstance(node, dict) else [])
                    if not heading.strip() and not body.strip() and not children:
                        continue
                    out.append({
                        'heading': heading.strip(),
                        'body': body.strip(),
                        'children': children,
                    })
                return out

            sections_tree = normalize(parsed)

            section_counter = count(1)
            block_counter = count(1)

            def stable_id_from_path(path):
                return 's' + '_'.join(str(p) for p in path)

            def default_heading_from_path(path):
                return f"Section {'.'.join(str(p) for p in path)}"

            def build(nodes, parent_section=None, path_prefix=()):
                for idx, node in enumerate(nodes, start=1):
                    path = path_prefix + (idx,)
                    stable_id = stable_id_from_path(path)
                    heading_text = node['heading'] or default_heading_from_path(path)
                    body_text = node['body']
                    section = Section.objects.create(
                        entry=entry,
                        stable_id=stable_id,
                        heading=heading_text,
                        body=body_text,
                        parent=parent_section,
                        position=next(section_counter),
                    )
                    heading_block_id = f'h_{stable_id}'
                    parent_heading = f'h_{parent_section.stable_id}' if parent_section else None
                    Block.objects.create(
                        entry=entry,
                        stable_id=heading_block_id,
                        type='h2',
                        text=heading_text,
                        parent_stable_id=parent_heading,
                        position=next(block_counter),
                    )
                    if body_text:
                        Block.objects.create(
                            entry=entry,
                            stable_id=f'p_{stable_id}',
                            type='p',
                            text=body_text,
                            parent_stable_id=heading_block_id,
                            position=next(block_counter),
                        )
                    build(node['children'], section, path)

            build(sections_tree)

            return redirect('project_detail', project_id=project.id)
    return render(request, 'project_new.html')


from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse

@csrf_exempt
@require_POST
def project_star_toggle(request, project_id: int):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'auth required'}, status=401)
    project = get_object_or_404(Project, id=project_id)
    star, created = ProjectStar.objects.get_or_create(project=project, user=request.user)
    if not created:
        # Toggle off
        star.delete()
        starred = False
    else:
        starred = True
    count = ProjectStar.objects.filter(project=project).count()
    return JsonResponse({'project_id': project.id, 'starred': starred, 'stars': count})


@login_required
def project_detail(request, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    project.require_role(request.user, ProjectMembership.Role.VIEWER)
    # Redirect straight to the canonical (only) entry.
    entry = project.entries.order_by('id').first()
    if entry:
        return redirect('entry_detail', entry_id=entry.id)
    # Fallback: if somehow missing, create one quickly
    entry = Entry.objects.create(project=project, title='Trunk', status='published')
    return redirect('entry_detail', entry_id=entry.id)


@login_required
def entry_detail(request, entry_id: int):
    """Interactive entry page using the exact prototype UI & client logic.

    NOTE: For parity the change composer + ops live purely client-side as in the original prototype.
    Server persistence of changes/ops can be wired later to existing API endpoints.
    """
    entry = get_object_or_404(Entry.objects.select_related('project'), id=entry_id)
    membership = entry.project.require_role(request.user, ProjectMembership.Role.VIEWER)

    # Build block list from DB (fallback to a default prototype content if empty)
    if entry.blocks.exists():
        blocks = [
            {
                'id': b.stable_id,
                'type': b.type,
                'text': b.text,
                'parent': b.parent_stable_id,
            }
            for b in entry.blocks.order_by('position', 'id')
        ]
    else:
        # Default prototype seed (matches clone.html) – not persisted unless later saved
        blocks = [
            { 'id':'h_purpose', 'type':'h2', 'text':'Purpose', 'parent':None },
            { 'id':'p_purpose', 'type':'p',  'text':'These bylaws guide the operation of the Willow Creek Community Garden and ensure fair access, safety, and shared stewardship.', 'parent':'h_purpose' },
            { 'id':'h_meet', 'type':'h2', 'text':'Meetings', 'parent':None },
            { 'id':'p_meet', 'type':'p',  'text':'The HOA meets monthly on the first Saturday at 10:00 AM at the tool shed. Minutes are posted to the bulletin board within 7 days.', 'parent':'h_meet' },
            { 'id':'h_quorum', 'type':'h2', 'text':'Quorum', 'parent':None },
            { 'id':'p_quorum', 'type':'p',  'text':'Quorum is established when at least 25% of plot holders are present. Votes pass with a simple majority of those present.', 'parent':'h_quorum' },
            { 'id':'h_maint', 'type':'h2', 'text':'Plot Maintenance', 'parent':None },
            { 'id':'p_maint', 'type':'p',  'text':'Gardeners must weed, water, and maintain plots weekly. Neglected plots may be reassigned after two warnings.', 'parent':'h_maint' },
            { 'id':'h_tools', 'type':'h2', 'text':'Tools & Safety', 'parent':None },
            { 'id':'p_tools', 'type':'p',  'text':'Common tools are shared on a first-come basis. Return tools clean. Children must be supervised at all times.', 'parent':'h_tools' }
        ]

    # Prepare JSON for template injection (safe because we control keys)
    if entry.pk:
        entry_json = serialize_entry(entry)
        entry_json['title'] = entry_json.get('title') or 'Trunk'
    else:
        entry_json = {
            'id': entry.id,
            'project_id': entry.project_id,
            'title': entry.title or 'Trunk v1',
            'version': entry.entry_version_int,
            'votes': entry.votes_cache_int,
            'blocks': blocks,
            'sections': [],
        }

    display_name = request.user.get_full_name() or request.user.get_username()
    user_payload = {
        'id': request.user.id,
        'username': request.user.get_username(),
        'display_name': display_name,
        'initial': (display_name or request.user.get_username() or '?')[:1].upper(),
        'role': membership.role if membership else None,
        'role_label': membership.get_role_display() if membership else None,
    }

    return render(request, 'entry_detail.html', {
        'entry': entry,
        'ENTRY_JSON': json.dumps(entry_json),
        'entry_sections_tree': entry_json.get('sections_tree') or [],
        'project_membership': membership,
        'user_payload': user_payload,
    })


def _format_time_remaining(delta):
    if delta is None:
        return 'decision due'
    total_seconds = int(delta.total_seconds())
    if total_seconds <= 0:
        return 'decision due'
    hours, remainder = divmod(total_seconds, 3600)
    minutes, _seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def updates(request):
    """Personal hub showing open votings, proposals needing attention, and followed activity."""
    now = timezone.now()
    selected_projects = request.GET.getlist('project')
    section_query = (request.GET.get('section') or '').strip().lower()
    selected_states = set(request.GET.getlist('state'))
    show_open = not selected_states or 'open' in selected_states
    show_needs = not selected_states or 'needs' in selected_states
    show_activity = not selected_states or 'activity' in selected_states

    project_choices = list(Project.objects.order_by('name').values_list('name', flat=True))

    def matches_filters(project_name: str, section_label: str) -> bool:
        if selected_projects and project_name not in selected_projects:
            return False
        if section_query and section_query not in (section_label or '').lower():
            return False
        return True

    def _section_label_for_change(change: Change) -> str:
        # Prefer resolving the target section heading text from the entry blocks
        try:
            section_id = change.target_section_id or ''
            if section_id:
                heading_id = section_id if str(section_id).startswith('h_') else f'h_{section_id}'
                blk = Block.objects.filter(entry_id=change.target_entry_id, stable_id=heading_id).first()
                if blk:
                    return blk.text
        except Exception:
            pass
        return change.summary or 'Section'

    open_votings = []
    if show_open:
        for change in Change.objects.select_related('project', 'target_entry').filter(status='published').order_by('published_at')[:25]:
            project_name = change.project.name if change.project_id else 'Project'
            section_label = _section_label_for_change(change)
            if not matches_filters(project_name, section_label):
                continue
            closes_at = change.published_at + timedelta(hours=24) if change.published_at else None
            delta = closes_at - now if closes_at else None
            open_votings.append({
                'id': change.id,
                'summary': change.summary or 'Proposal',
                'project': project_name,
                'section': section_label,
                'closes_in': _format_time_remaining(delta),
                'link': f"/entries/{change.target_entry_id}/?focus={change.target_section_id or ''}&proposal={change.id}",
            })

    your_proposals = []
    if show_needs and request.user.is_authenticated:
        personal_qs = Change.objects.select_related('project').filter(author=request.user).order_by('-published_at', '-created_at')[:25]
        for change in personal_qs:
            project_name = change.project.name if change.project_id else 'Project'
            section_label = _section_label_for_change(change)
            if not matches_filters(project_name, section_label):
                continue
            chips = []
            if change.status == 'needs_update':
                chips.append('🔄 Needs refresh')
            if change.status == 'published':
                chips.append('⌛ In voting')
            if change.status == 'draft':
                chips.append('🛌 Draft')
            if getattr(change, 'flags', None):
                chips.append('⚑ Flagged')
            your_proposals.append({
                'id': change.id,
                'summary': change.summary or 'Proposal',
                'project': project_name,
                'section': section_label,
                'chips': chips or ['⚑ Monitor'],
                'link': f"/entries/{change.target_entry_id}/?focus={change.target_section_id or ''}&proposal={change.id}",
            })

    followed_activity = []
    if show_activity:
        history_qs = EntryHistory.objects.select_related('entry__project', 'change').order_by('-created_at')[:25]
        for record in history_qs:
            project_name = record.entry.project.name if record.entry and record.entry.project_id else 'Project'
            change = record.change
            if change:
                label = f"#{change.id} merged into v{record.version_int}"
                section_label = _section_label_for_change(change)
                link = f"/entries/{record.entry_id}/?focus={change.target_section_id or ''}&proposal={change.id}"
            else:
                label = f"Entry v{record.version_int} updated"
                section_label = record.entry.title if record.entry else 'Entry'
                link = f"/entries/{record.entry_id}/"
            if not matches_filters(project_name, section_label):
                continue
            followed_activity.append({
                'project': project_name,
                'section': section_label,
                'summary': label,
                'timestamp': record.created_at,
                'link': link,
            })

    context = {
        'open_votings': open_votings,
        'your_proposals': your_proposals,
        'followed_activity': followed_activity,
        'project_choices': project_choices,
        'selected_projects': selected_projects,
        'section_query': section_query,
        'selected_states': selected_states,
        'show_open': show_open,
        'show_needs': show_needs,
        'show_activity': show_activity,
    }
    return render(request, 'updates.html', context)


def change_detail(request, change_id: int):
    patch = get_object_or_404(Change, id=change_id)
    if request.method == "POST":
        act = request.POST.get("action")
        if act == "publish_change" and patch.status == "draft":
            if not request.user.is_authenticated:
                return redirect("login")
            patch.status = "published"
            patch.published_at = timezone.now()
            from datetime import timedelta
            # Align simple UI timer to 24h window
            patch.closes_at = patch.published_at + timedelta(hours=24)
            patch.save()
            return redirect(request.path)
        if act == "vote":
            if not request.user.is_authenticated:
                return redirect("login")
            val = int(request.POST.get("value"))
            Vote.objects.update_or_create(user=request.user, target_type="change", target_id=patch.id, defaults={"value": val})
            return redirect(request.path)
    return render(request, "change_detail.html", {"change": patch})
def prototype_view(request):
    """Serve the original static prototype for visual/behavior parity check."""
    # Load the existing prototype.html from repo root.
    repo_root = Path(__file__).resolve().parents[3]
    proto_path = repo_root / 'prototype.html'
    if not proto_path.exists():
        return HttpResponse('prototype.html not found', status=404)
    return HttpResponse(proto_path.read_text(encoding='utf-8'))


def app_view(request, project_id: int | None = None):
    """Dynamic app view using modular JS identical to prototype logic, backed by API if available."""
    # If no project id supplied pick first existing.
    if project_id is None:
        first = Project.objects.order_by('id').first()
        project_id = first.id if first else 0
    return render(request, 'app.html', { 'project_id': project_id })


def clone_view(request):
    """Serve exact clone of prototype.html as Django template for perfect parity check."""
    return render(request, 'clone.html')
