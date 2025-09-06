from __future__ import annotations
from django.contrib.auth.decorators import login_required
from django.contrib.auth import authenticate, login, logout
from django.shortcuts import render, redirect, get_object_or_404
import json
from django.utils import timezone
from groupmindhub.apps.core.models import Project, Entry, Patch, Vote, Block
from django.http import HttpResponse
from pathlib import Path


def index(request):
    if request.method == "POST" and request.POST.get("action") == "create_project":
        name = request.POST.get("name", "").strip()
        desc = request.POST.get("description", "").strip()
        initial_outline = request.POST.get('initial_outline', '').strip()
        sim_user = request.POST.get('sim_user')
        # If not authenticated but sim_user provided, auto-create/login that user
        if not request.user.is_authenticated and sim_user:
            from django.contrib.auth import get_user_model
            from django.contrib.auth import login as auth_login
            U = get_user_model()
            user, _ = U.objects.get_or_create(username=sim_user)
            auth_login(request, user)
        if name:
            project = Project.objects.create(name=name, description=desc)
            # Create single canonical entry immediately
            entry = Entry.objects.create(project=project, title='Trunk', author=request.user, status='published')
            # Parse outline: expect lines starting with ## (heading) or plain paragraph lines; blank line separates sections.
            blocks = []
            pos = 0
            pending_para = []
            def flush_para():
                nonlocal pending_para, pos
                if pending_para:
                    text = ' '.join(pending_para).strip()
                    if text:
                        pos += 1
                        Block.objects.create(entry=entry, stable_id=f"p_{pos}", type='p', text=text, parent_stable_id=current_heading)
                    pending_para = []
            current_heading = None
            for line in initial_outline.splitlines():
                line = line.rstrip()
                if not line:
                    flush_para(); continue
                # Accept lines starting with either '##' or a single '#'
                if line.startswith('##') or (line.startswith('#') and not line.startswith('###')):
                    flush_para()
                    pos += 1
                    text = line.lstrip('#').strip()
                    hid = f"h_{pos}"
                    Block.objects.create(entry=entry, stable_id=hid, type='h2', text=text, parent_stable_id=None, position=pos)
                    current_heading = hid
                else:
                    pending_para.append(line)
            flush_para()
            # Ensure positions assigned for any paragraphs created (they defaulted)
            for b in entry.blocks.filter(position=0):
                pos += 1
                b.position = pos
                b.save(update_fields=['position'])
            return redirect("project_detail", project_id=project.id)
    projects = Project.objects.all().order_by("-created_at")
    return render(request, "index.html", {"projects": projects})


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
