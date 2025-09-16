from __future__ import annotations
from django.contrib.auth.decorators import login_required
from django.contrib.auth import authenticate, login, logout
from django.shortcuts import render, redirect, get_object_or_404
import json
from django.utils import timezone
from groupmindhub.apps.core.models import Project, Entry, Patch, Vote, Block, Section, ProjectStar
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
    # Build activity (simple heuristic for now): recent_patch_weight = patches<24h *1 + patches<7d *0.2
    patch_qs = Patch.objects.filter(project__in=projects)
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


def project_new(request):
    """Project creation with section builder (heading + body)."""
    if request.method == 'POST':
        name = request.POST.get('name','').strip()
        desc = request.POST.get('description','').strip()
        sections_json = request.POST.get('sections_json','').strip()
        sim_user = request.POST.get('sim_user')
        if not request.user.is_authenticated and sim_user:
            from django.contrib.auth import get_user_model
            from django.contrib.auth import login as auth_login
            U = get_user_model()
            user, _ = U.objects.get_or_create(username=sim_user)
            auth_login(request, user)
        if name:
            project = Project.objects.create(name=name, description=desc)
            entry = Entry.objects.create(project=project, title='Trunk', author=request.user, status='published')
            # Parse sections JSON
            try:
                sections = json.loads(sections_json) if sections_json else []
            except Exception:
                sections = []
            pos = 0
            for idx, s in enumerate(sections, start=1):
                heading = (s.get('heading') or '').strip()
                body = (s.get('body') or '').strip()
                if not heading and not body:
                    continue
                stable_id = f's{idx}'
                pos += 1
                Section.objects.create(entry=entry, stable_id=stable_id, heading=heading or f'Section {idx}', body=body, position=pos)
                # Create equivalent Blocks for current entry_detail consumption
                Block.objects.create(entry=entry, stable_id=f'h_{stable_id}', type='h2', text=heading or f'Section {idx}', parent_stable_id=None, position=pos)
                if body:
                    pos += 1
                    Block.objects.create(entry=entry, stable_id=f'p_{stable_id}', type='p', text=body, parent_stable_id=f'h_{stable_id}', position=pos)
            return redirect('project_detail', project_id=project.id)
    return render(request, 'project_new.html')


from django.views.decorators.http import require_POST
from django.http import JsonResponse

@require_POST
def project_star_toggle(request, project_id: int):
    sim_user = request.POST.get('sim_user') or request.GET.get('sim_user')
    if not request.user.is_authenticated and sim_user:
        from django.contrib.auth import get_user_model
        from django.contrib.auth import login as auth_login
        U = get_user_model()
        user, _ = U.objects.get_or_create(username=sim_user)
        auth_login(request, user)
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


def project_detail(request, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    # Redirect straight to the canonical (only) entry.
    entry = project.entries.order_by('id').first()
    if entry:
        return redirect('entry_detail', entry_id=entry.id)
    # Fallback: if somehow missing, create one quickly
    entry = Entry.objects.create(project=project, title='Trunk', status='published')
    return redirect('entry_detail', entry_id=entry.id)


def entry_detail(request, entry_id: int):
    """Interactive entry page using the exact prototype UI & client logic.

    NOTE: For parity the patch composer + ops live purely client-side as in the original prototype.
    Server persistence of patches/ops can be wired later to existing API endpoints.
    """
    entry = get_object_or_404(Entry, id=entry_id)

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
    entry_json = {
        'id': entry.id,
        'project_id': entry.project_id,
        'title': entry.title or 'Trunk v1',
        'version': entry.entry_version_int,
        'votes': entry.votes_cache_int,
        'blocks': blocks,
    }

    return render(request, 'entry_detail.html', {
        'entry': entry,
        'ENTRY_JSON': json.dumps(entry_json),
    })


def patch_detail(request, patch_id: int):
    patch = get_object_or_404(Patch, id=patch_id)
    if request.method == "POST":
        act = request.POST.get("action")
        if act == "publish_patch" and patch.status == "draft":
            if not request.user.is_authenticated:
                return redirect("login")
            patch.status = "published"
            patch.published_at = timezone.now()
            from datetime import timedelta
            patch.closes_at = patch.published_at + timedelta(hours=72)
            patch.save()
            return redirect(request.path)
        if act == "vote":
            if not request.user.is_authenticated:
                return redirect("login")
            val = int(request.POST.get("value"))
            Vote.objects.update_or_create(user=request.user, target_type="patch", target_id=patch.id, defaults={"value": val})
            return redirect(request.path)
    return render(request, "patch_detail.html", {"patch": patch})


def login_view(request):
    next_url = request.GET.get("next") or request.POST.get("next") or "/"
    error = None
    if request.method == "POST":
        username = request.POST.get("username")
        password = request.POST.get("password")
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            return redirect(next_url)
        error = "Invalid credentials"
    return render(request, "login.html", {"next": next_url, "error": error})


def logout_view(request):
    logout(request)
    return redirect("/")


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
