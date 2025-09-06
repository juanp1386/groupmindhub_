from __future__ import annotations
import json
from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.shortcuts import get_object_or_404
from django.utils import timezone
from .models import Project, Entry, Patch, Vote, Block

def _apply_sim_user(request):
    """Force simulated user if sim_user provided (even if an authenticated user exists)."""
    sim_user = (
        request.GET.get('sim_user')
        or request.POST.get('sim_user')
    )
    if not sim_user and request.body:
        try:
            body = json.loads(request.body or b"{}")
            sim_user = body.get('sim_user')
        except Exception:
            sim_user = None
    if sim_user:
        from django.contrib.auth import get_user_model
        U = get_user_model()
        request.user, _ = U.objects.get_or_create(username=sim_user)
    return request.user
from .logic import outline, auto_merge, apply_merge_core


def serialize_entry(entry: Entry):
    blocks = [
        {
            'id': b.stable_id,
            'type': b.type,
            'text': b.text,
            'parent': b.parent_stable_id,
            'position': b.position,
        }
        for b in entry.blocks.order_by('position', 'id')
    ]
    return {
        'id': entry.id,
        'project_id': entry.project_id,
        'title': entry.title,
        'version': entry.entry_version_int,
        'status': entry.status,
        'blocks': blocks,
    }


def serialize_patch(p: Patch, user=None):
    yes = Vote.objects.filter(target_type='patch', target_id=p.id, value__gt=0).count()
    no = Vote.objects.filter(target_type='patch', target_id=p.id, value__lt=0).count()
    current_vote = 0
    if user and user.is_authenticated:
        v = Vote.objects.filter(user=user, target_type='patch', target_id=p.id).first()
        current_vote = v.value if v else 0
    return {
        'id': p.id,
        'summary': p.summary,
        'status': p.status,
        'ops_json': p.ops_json,
        'affected_blocks': p.affected_blocks,
        'before_outline': p.before_outline,
        'after_outline': p.after_outline,
        'yes': yes,
        'no': no,
        'current_user_vote': current_vote,
    }


@require_http_methods(["GET"])
def api_project_entry(request: HttpRequest, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    entry = project.entries.order_by('-entry_version_int').first()
    if not entry:
        return JsonResponse({'project': project_id, 'entry': None})
    return JsonResponse({'project': project_id, 'entry': serialize_entry(entry)})


@require_http_methods(["GET"])
def api_project_patches_list(request: HttpRequest, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    _apply_sim_user(request)
    patches = [serialize_patch(p, request.user) for p in project.patches.all()]
    return JsonResponse({'project': project_id, 'patches': patches})


@csrf_exempt
@require_http_methods(["POST"])
def api_project_patches_create(request: HttpRequest, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    data = json.loads(request.body or b"{}")
    _apply_sim_user(request)
    entry_id = data.get('entry_id')
    entry = get_object_or_404(Entry, id=entry_id, project=project)
    ops = data.get('ops_json') or []
    affected = data.get('affected_blocks') or []
    # Accept client-provided outlines for diff visualization; fallback to simple outline
    provided_before = data.get('before_outline')
    provided_after = data.get('after_outline')
    if provided_before and provided_after:
        before_outline = provided_before
        after_outline = provided_after
    else:
        before_outline = outline(list(entry.blocks.all()))
        after_outline = outline(list(entry.blocks.all()))
    patch = Patch.objects.create(
        project=project,
        target_entry=entry,
        author=request.user,
        summary=data.get('summary') or 'Patch',
        ops_json=ops,
        affected_blocks=affected,
        anchors=data.get('anchors') or [],
        before_outline=before_outline,
        after_outline=after_outline,
        status='published',
        published_at=timezone.now(),
    )
    # Author auto-upvote (+1)
    Vote.objects.update_or_create(
        user=request.user, target_type='patch', target_id=patch.id, defaults={'value': 1}
    )
    auto_merge()
    return JsonResponse({'patch': serialize_patch(patch, request.user)}, status=201)


@csrf_exempt
@require_http_methods(["POST"])
def api_patch_vote(request: HttpRequest, patch_id: int):
    patch = get_object_or_404(Patch, id=patch_id)
    data = json.loads(request.body or b"{}")
    _apply_sim_user(request)
    val = int(data.get('value', 0))
    if val not in (-1, 0, 1):
        return JsonResponse({'error': 'invalid vote'}, status=400)
    if val == 0:
        Vote.objects.filter(user=request.user, target_type='patch', target_id=patch.id).delete()
    else:
        Vote.objects.update_or_create(
            user=request.user, target_type='patch', target_id=patch.id, defaults={'value': val}
        )
    auto_merge()
    return JsonResponse({'patch': serialize_patch(patch, request.user)})


@csrf_exempt
@require_http_methods(["POST"])
def api_patch_merge(request: HttpRequest, patch_id: int):
    patch = get_object_or_404(Patch, id=patch_id)
    _apply_sim_user(request)
    if patch.status != 'merged':
        apply_merge_core(patch)
    return JsonResponse({'patch': serialize_patch(patch, request.user)})
