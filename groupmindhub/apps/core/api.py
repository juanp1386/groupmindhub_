from __future__ import annotations
import json
import math
from typing import Dict, Any
import uuid
from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.shortcuts import get_object_or_404
from django.utils import timezone
from .models import Project, Entry, Change, Vote, Block

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
from .logic import (
    outline,
    auto_merge,
    apply_merge_core,
    build_section_index,
    SectionIndex,
    is_passing,
    SIM_USER_POOL_SIZE,
)


def serialize_entry(entry: Entry):
    section_index = build_section_index(entry)
    heading_map = section_index.by_heading_id
    ordered_blocks = list(entry.blocks.order_by('position', 'id'))
    blocks = []
    for block in ordered_blocks:
        data = {
            'id': block.stable_id,
            'type': block.type,
            'text': block.text,
            'parent': block.parent_stable_id,
            'position': block.position,
        }
        if block.type == 'h2':
            info = heading_map.get(block.stable_id)
            if info:
                data['numbering'] = info.numbering
                data['depth'] = info.depth
        else:
            parent_info = heading_map.get(block.parent_stable_id) if block.parent_stable_id else None
            if parent_info:
                data['depth'] = parent_info.depth
        blocks.append(data)

    sections = []
    heading_nodes: Dict[str, Dict[str, Any]] = {}
    heading_parent: Dict[str, str | None] = {}
    body_blocks: Dict[str, list[Dict[str, str]]] = {}

    for blk in ordered_blocks:
        if blk.type == 'h2':
            section_id = blk.stable_id[2:] if blk.stable_id.startswith('h_') else blk.stable_id
            heading_parent[blk.stable_id] = blk.parent_stable_id
            heading_nodes[blk.stable_id] = {
                'id': section_id,
                'heading': blk.text,
                'heading_block_id': blk.stable_id,
                'body_blocks': [],
                'block_ids': [blk.stable_id],
                'children': [],
                'parent_section_id': None,
            }
        elif blk.type == 'p' and blk.parent_stable_id:
            body_blocks.setdefault(blk.parent_stable_id, []).append({'id': blk.stable_id, 'text': blk.text})

    for heading_id, blocks_list in body_blocks.items():
        if heading_id in heading_nodes:
            heading_nodes[heading_id]['body_blocks'] = blocks_list
            heading_nodes[heading_id]['block_ids'].extend([b['id'] for b in blocks_list])

    roots = []
    for heading_id, node in heading_nodes.items():
        parent_heading = heading_parent.get(heading_id)
        if parent_heading and parent_heading in heading_nodes:
            node['parent_section_id'] = heading_nodes[parent_heading]['id']
            heading_nodes[parent_heading]['children'].append(node)
        else:
            roots.append(node)

    def assign_numbering(nodes, prefix='', depth=1):
        for idx, node in enumerate(nodes, start=1):
            node['numbering'] = f"{prefix}.{idx}" if prefix else str(idx)
            node['depth'] = depth
            assign_numbering(node['children'], node['numbering'], depth + 1)

    assign_numbering(roots)

    def gather_block_ids(node):
        ids = list(node['block_ids'])
        for child in node['children']:
            ids.extend(gather_block_ids(child))
        node['block_ids'] = ids
        return ids

    for root in roots:
        gather_block_ids(root)

    def finalize(node):
        node['body'] = '\n\n'.join(b['text'] for b in node['body_blocks']).strip()
        for child in node['children']:
            finalize(child)

    for root in roots:
        finalize(root)

    def section_to_flat(node):
        return {
            'id': node['id'],
            'heading_block_id': node['heading_block_id'],
            'numbering': node['numbering'],
            'depth': node['depth'],
            'parent_section_id': node['parent_section_id'],
            'heading_text': node['heading'],
            'block_ids': node['block_ids'],
        }

    sections = []

    def append_flat(node):
        sections.append(section_to_flat(node))
        for child in node['children']:
            append_flat(child)

    for root in roots:
        append_flat(root)

    return {
        'id': entry.id,
        'project_id': entry.project_id,
        'title': entry.title,
        'version': entry.entry_version_int,
        'status': entry.status,
        'votes': entry.votes_cache_int,
        'blocks': blocks,
        'sections': sections,
        'sections_tree': roots,
    }


def _normalize_section_block_id(section_id: str) -> str:
    if not section_id:
        return ''
    return section_id if section_id.startswith('h_') else f'h_{section_id}'


def serialize_change(p: Change, user=None, section_index=None):
    yes = Vote.objects.filter(target_type='change', target_id=p.id, value__gt=0).count()
    no = Vote.objects.filter(target_type='change', target_id=p.id, value__lt=0).count()
    current_vote = 0
    if user and user.is_authenticated:
        v = Vote.objects.filter(user=user, target_type='change', target_id=p.id).first()
        current_vote = v.value if v else 0
    section_index = section_index or build_section_index(p.target_entry)
    section_block_id = _normalize_section_block_id(p.target_section_id)
    section_info = section_index.get_by_heading(section_block_id) if section_block_id else None
    required_yes = max(1, math.ceil(0.4 * SIM_USER_POOL_SIZE))
    author_name = None
    if p.author_id:
        author_name = p.author.get_full_name() or p.author.get_username() or str(p.author_id)
    elif p.author_id is None and p.author:
        author_name = p.author.get_username()
    return {
        'id': p.id,
        'summary': p.summary,
        'status': p.status,
        'ops_json': p.ops_json,
        'affected_blocks': p.affected_blocks,
        'before_outline': p.before_outline,
        'after_outline': p.after_outline,
        'target_section_id': p.target_section_id,
        'target_section_block_id': section_block_id,
        'target_section_numbering': section_info.numbering if section_info else '',
        'target_section_depth': section_info.depth if section_info else 0,
        'target_section_heading': section_info.heading_text if section_info else '',
        'yes': yes,
        'no': no,
        'current_user_vote': current_vote,
        'required_yes_votes': required_yes,
        'is_passing': is_passing(p),
        'author_name': author_name or 'Anonymous',
    }


@require_http_methods(["GET"])
def api_project_entry(request: HttpRequest, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    entry = project.entries.order_by('-entry_version_int').first()
    if not entry:
        return JsonResponse({'project': project_id, 'entry': None})
    return JsonResponse({'project': project_id, 'entry': serialize_entry(entry)})


@require_http_methods(["GET"])
def api_project_changes_list(request: HttpRequest, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    _apply_sim_user(request)
    section_indices: Dict[int, SectionIndex] = {}
    serialized = []
    for change in project.changes.select_related('target_entry').all():
        entry = change.target_entry
        if entry:
            section_index = section_indices.setdefault(entry.id, build_section_index(entry))
        else:
            section_index = None
        serialized.append(serialize_change(change, request.user, section_index=section_index))
    return JsonResponse({'project': project_id, 'changes': serialized})


@csrf_exempt
@require_http_methods(["POST"])
def api_project_changes_create(request: HttpRequest, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    data = json.loads(request.body or b"{}")
    _apply_sim_user(request)
    entry_id = data.get('entry_id')
    entry = get_object_or_404(Entry, id=entry_id, project=project)
    ops = data.get('ops_json') or []
    affected = data.get('affected_blocks') or []
    section_id_raw = (data.get('section_id') or '').strip()
    if not section_id_raw:
        return JsonResponse({'error': 'section_id is required for a change'}, status=400)
    section_block_id = _normalize_section_block_id(section_id_raw)
    section_index = build_section_index(entry)
    section_info = section_index.get_by_heading(section_block_id)
    if not section_info:
        return JsonResponse({'error': 'section_id does not match any section on the entry'}, status=400)
    section_id = section_info.section_id
    allowed_blocks = set(section_info.block_ids)
    allowed_heading_blocks = set(section_index.by_heading_id.keys()) & allowed_blocks

    def _block_in_scope(block_id):
        return block_id in allowed_blocks

    def _anchor_in_scope(anchor_id):
        return anchor_id in allowed_blocks

    new_heading_ids = set()
    new_block_ids = set()
    for op in ops:
        op_type = op.get('type')
        if op_type in {'UPDATE_TEXT', 'DELETE_BLOCK'}:
            bid = op.get('block_id')
            if bid and not _block_in_scope(bid):
                return JsonResponse({'error': 'ops must target only the specified section'}, status=400)
        elif op_type == 'MOVE_BLOCK':
            bid = op.get('block_id')
            after_id = op.get('after_id')
            new_parent = op.get('new_parent')
            if new_parent == '':
                new_parent = None
            if bid and not _block_in_scope(bid):
                return JsonResponse({'error': 'ops must target only the specified section'}, status=400)
            if after_id and not (_anchor_in_scope(after_id) or after_id in new_block_ids):
                return JsonResponse({'error': 'move anchors must stay within the section'}, status=400)
            if new_parent is not None and new_parent not in allowed_heading_blocks:
                # Allow keeping the section root at top-level (new_parent None) but nothing else
                if not (bid == section_block_id and new_parent is None):
                    return JsonResponse({'error': 'move operations must keep blocks under the section tree'}, status=400)
        elif op_type == 'INSERT_BLOCK':
            after_id = op.get('after_id')
            if after_id and not (_anchor_in_scope(after_id) or after_id in new_block_ids):
                return JsonResponse({'error': 'insert anchors must stay within the section'}, status=400)
            nb = op.get('new_block') or {}
            parent_id = nb.get('parent') or None
            if parent_id and parent_id not in allowed_heading_blocks and parent_id not in new_heading_ids:
                return JsonResponse({'error': 'inserted blocks must have a parent within the section'}, status=400)
            if nb.get('type') == 'h2':
                new_id = nb.get('id')
                if not new_id:
                    new_id = f"h_{uuid.uuid4().hex[:10]}"
                    nb['id'] = new_id
                    op['new_block'] = nb
                if new_id and not str(new_id).startswith('h_'):
                    return JsonResponse({'error': 'heading ids must start with "h_"'}, status=400)
                new_heading_ids.add(str(new_id))
                new_block_ids.add(str(new_id))
            else:
                new_id = nb.get('id')
                if not new_id:
                    new_id = f"p_{uuid.uuid4().hex[:10]}"
                    nb['id'] = new_id
                    op['new_block'] = nb
                new_block_ids.add(str(new_id))

    # Ensure affected blocks are scoped to the section
    affected = [bid for bid in affected if _block_in_scope(bid)]
    # Accept client-provided outlines for diff visualization; fallback to simple outline
    provided_before = data.get('before_outline')
    provided_after = data.get('after_outline')
    if provided_before and provided_after:
        before_outline = provided_before
        after_outline = provided_after
    else:
        before_outline = outline(list(entry.blocks.all()))
        after_outline = outline(list(entry.blocks.all()))
    patch = Change.objects.create(
        project=project,
        target_entry=entry,
        author=request.user,
        summary=data.get('summary') or 'Change',
        ops_json=ops,
        affected_blocks=affected,
        anchors=data.get('anchors') or [],
        before_outline=before_outline,
        after_outline=after_outline,
        target_section_id=section_id,
        status='published',
        published_at=timezone.now(),
    )
    # Author auto-upvote (+1)
    Vote.objects.update_or_create(
        user=request.user, target_type='change', target_id=patch.id, defaults={'value': 1}
    )
    auto_merge()
    return JsonResponse({'change': serialize_change(patch, request.user, section_index=section_index)}, status=201)


@csrf_exempt
@require_http_methods(["POST"])
def api_change_vote(request: HttpRequest, change_id: int):
    patch = get_object_or_404(Change, id=change_id)
    data = json.loads(request.body or b"{}")
    _apply_sim_user(request)
    val = int(data.get('value', 0))
    if val not in (-1, 0, 1):
        return JsonResponse({'error': 'invalid vote'}, status=400)
    if val == 0:
        Vote.objects.filter(user=request.user, target_type='change', target_id=patch.id).delete()
    else:
        Vote.objects.update_or_create(
            user=request.user, target_type='change', target_id=patch.id, defaults={'value': val}
        )
    auto_merge()
    return JsonResponse({'change': serialize_change(patch, request.user)})


@csrf_exempt
@require_http_methods(["POST"])
def api_change_merge(request: HttpRequest, change_id: int):
    patch = get_object_or_404(Change, id=change_id)
    _apply_sim_user(request)
    if patch.status != 'merged':
        if not is_passing(patch):
            required_yes = max(1, math.ceil(0.4 * SIM_USER_POOL_SIZE))
            return JsonResponse(
                {
                    'error': 'change has not reached the merge threshold',
                    'required_yes_votes': required_yes,
                    'current_yes_votes': Vote.objects.filter(target_type='change', target_id=patch.id, value__gt=0).count(),
                },
                status=400,
            )
        apply_merge_core(patch)
    return JsonResponse({'change': serialize_change(patch, request.user)})
