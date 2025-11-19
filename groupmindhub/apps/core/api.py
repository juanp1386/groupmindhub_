from __future__ import annotations
import json
from typing import Dict, Any
import uuid
from django.http import JsonResponse, HttpRequest
from django.core.paginator import Paginator
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.shortcuts import get_object_or_404
from django.utils import timezone
from .models import Project, Entry, Change, Vote, Block, ProjectMembership, Comment, Section
from .access import resolve_invite

ROOT_SECTION_ID = '__root__'
DEFAULT_COMMENT_PAGE_SIZE = 20


def serialize_project_governance(project: Project) -> Dict[str, Any]:
    snapshot = project.governance_snapshot()
    snapshot['approval_threshold'] = round(snapshot['approval_threshold'], 2)
    snapshot['approval_threshold_percent'] = round(snapshot['approval_threshold_percent'], 2)
    return snapshot


def _resolve_comment_target(project: Project, target_type: str, identifier):
    if target_type == 'section':
        if identifier in (None, ''):
            return None
        section = Section.objects.filter(entry__project=project, stable_id=str(identifier)).first()
        return section
    if target_type == 'change':
        if not identifier:
            return None
        try:
            change_id = int(identifier)
        except (TypeError, ValueError):
            return None
        return Change.objects.filter(project=project, id=change_id).first()
    return None


def serialize_comment(comment: Comment, user=None, membership: ProjectMembership | None = None):
    author_name = 'Anonymous'
    if comment.author_id and comment.author:
        author_name = comment.author.get_full_name() or comment.author.get_username() or f"User {comment.author_id}"
    target_type = 'change' if comment.change_id else 'section'
    target_id = comment.change_id if comment.change_id else (comment.section.stable_id if comment.section_id else None)
    can_delete = False
    if user and getattr(user, 'is_authenticated', False):
        if comment.author_id == user.id:
            can_delete = True
        elif membership and membership.has_at_least(ProjectMembership.Role.EDITOR):
            can_delete = True
    return {
        'id': comment.id,
        'author_id': comment.author_id,
        'author_name': author_name,
        'body': comment.body,
        'created_at': comment.created_at.isoformat(),
        'updated_at': comment.updated_at.isoformat(),
        'target_type': target_type,
        'target_id': target_id,
        'can_delete': can_delete,
    }


def _membership_or_error(request: HttpRequest, project: Project, role: str):
    membership = project.membership_for(request.user)
    invite = resolve_invite(request, project, persist=True)
    if membership and membership.has_at_least(role):
        return membership, None
    is_safe_method = request.method in {'GET', 'HEAD', 'OPTIONS'}
    if role == ProjectMembership.Role.VIEWER and is_safe_method:
        if project.visibility == Project.Visibility.PUBLIC:
            return membership, None
        if invite and invite.allows(role):
            return membership, None
    if not request.user.is_authenticated:
        return None, JsonResponse({'error': 'auth required'}, status=401)
    return None, JsonResponse({'error': 'forbidden'}, status=403)
from .logic import (
    outline,
    auto_merge,
    apply_merge_core,
    build_section_index,
    SectionIndex,
    is_passing,
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
        'project_governance': serialize_project_governance(entry.project),
    }


def _normalize_section_block_id(section_id: str) -> str:
    if not section_id:
        return ''
    if section_id == ROOT_SECTION_ID:
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
    governance = serialize_project_governance(p.project)
    required_yes = governance['required_yes_votes']
    author_name = None
    if p.author_id:
        author_name = p.author.get_full_name() or p.author.get_username() or str(p.author_id)
    elif p.author_id is None and p.author:
        author_name = p.author.get_username()
    return {
        'id': p.id,
        'summary': p.summary,
        'status': p.status,
        'base_entry_version_int': p.base_entry_version_int,
        'ops_json': p.ops_json,
        'affected_blocks': p.affected_blocks,
        'before_outline': p.before_outline,
        'after_outline': p.after_outline,
        'target_section_id': p.target_section_id,
        'target_section_block_id': section_block_id,
        'target_section_numbering': section_info.numbering if section_info else '',
        'target_section_depth': section_info.depth if section_info else 0,
        'target_section_heading': (
            section_info.heading_text if section_info else (
                'New section proposal' if p.target_section_id == ROOT_SECTION_ID else ''
            )
        ),
        'yes': yes,
        'no': no,
        'current_user_vote': current_vote,
        'required_yes_votes': required_yes,
        'is_passing': is_passing(p),
        'closes_at': p.closes_at.isoformat() if p.closes_at else None,
        'project_governance': governance,
        'author_name': author_name or 'Anonymous',
    }


@require_http_methods(["GET"])
def api_project_entry(request: HttpRequest, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    _membership, error = _membership_or_error(request, project, ProjectMembership.Role.VIEWER)
    if error:
        return error
    entry = project.entries.order_by('-entry_version_int').first()
    if not entry:
        return JsonResponse({'project': project_id, 'entry': None})
    return JsonResponse({'project': project_id, 'entry': serialize_entry(entry)})


@require_http_methods(["GET"])
def api_project_changes_list(request: HttpRequest, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    membership, error = _membership_or_error(request, project, ProjectMembership.Role.VIEWER)
    if error:
        return error
    section_indices: Dict[int, SectionIndex] = {}
    serialized = []
    for change in project.changes.select_related('target_entry', 'project').all():
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
    membership, error = _membership_or_error(request, project, ProjectMembership.Role.EDITOR)
    if error:
        return error
    entry_id = data.get('entry_id')
    entry = get_object_or_404(Entry, id=entry_id, project=project)
    ops = data.get('ops_json') or []
    affected = data.get('affected_blocks') or []
    section_id_raw = (data.get('section_id') or '').strip()
    if not section_id_raw:
        return JsonResponse({'error': 'section_id is required for a change'}, status=400)
    section_index = build_section_index(entry)
    existing_block_ids = set(entry.blocks.values_list('stable_id', flat=True))
    allow_root_add = section_id_raw == ROOT_SECTION_ID
    section_block_id = ''
    section_info = None
    if allow_root_add:
        section_id = ROOT_SECTION_ID
        allowed_blocks = set()
        allowed_heading_blocks = set()
    else:
        section_block_id = _normalize_section_block_id(section_id_raw)
        section_info = section_index.get_by_heading(section_block_id)
        if not section_info:
            return JsonResponse({'error': 'section_id does not match any section on the entry'}, status=400)
        section_id = section_info.section_id
        allowed_blocks = set(section_info.block_ids)
        allowed_heading_blocks = set(section_index.by_heading_id.keys()) & allowed_blocks

    def _block_in_scope(block_id):
        if allow_root_add:
            # Only allow references to brand-new blocks for new sections
            return block_id and block_id not in existing_block_ids
        return block_id in allowed_blocks

    def _anchor_in_scope(anchor_id):
        if allow_root_add:
            return anchor_id in existing_block_ids
        return anchor_id in allowed_blocks

    new_heading_ids = set()
    new_block_ids = set()
    has_root_heading_text = False
    for op in ops:
        op_type = op.get('type')
        if allow_root_add:
            if op_type == 'INSERT_BLOCK':
                nb = op.get('new_block') or {}
                parent_id = nb.get('parent') or None
                if parent_id and parent_id not in new_heading_ids:
                    return JsonResponse({'error': 'new blocks must attach under the proposed section'}, status=400)
                if nb.get('type') == 'h2':
                    new_id = nb.get('id')
                    if not new_id:
                        new_id = f"h_{uuid.uuid4().hex[:10]}"
                        nb['id'] = new_id
                        op['new_block'] = nb
                    if not str(new_id).startswith('h_'):
                        return JsonResponse({'error': 'heading ids must start with "h_"'}, status=400)
                    new_heading_ids.add(str(new_id))
                    new_block_ids.add(str(new_id))
                    if (nb.get('text') or '').strip():
                        has_root_heading_text = True
                else:
                    new_id = nb.get('id')
                    if not new_id:
                        new_id = f"p_{uuid.uuid4().hex[:10]}"
                        nb['id'] = new_id
                        op['new_block'] = nb
                    new_block_ids.add(str(new_id))
                after_id = op.get('after_id')
                if after_id and after_id not in existing_block_ids and after_id not in new_block_ids:
                    return JsonResponse({'error': 'insert anchors must reference existing or newly inserted blocks'}, status=400)
                continue
            if op_type == 'UPDATE_TEXT':
                bid = op.get('block_id')
                if bid and bid in new_block_ids:
                    if bid in new_heading_ids and (op.get('new_text') or '').strip():
                        has_root_heading_text = True
                    continue
                return JsonResponse({'error': 'updates for new sections must target newly inserted blocks'}, status=400)
            return JsonResponse({'error': 'new section proposals may only insert or update their own blocks'}, status=400)

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
                if (nb.get('text') or '').strip():
                    has_root_heading_text = True
            else:
                new_id = nb.get('id')
                if not new_id:
                    new_id = f"p_{uuid.uuid4().hex[:10]}"
                    nb['id'] = new_id
                    op['new_block'] = nb
                new_block_ids.add(str(new_id))

    # Ensure affected blocks are scoped to the section
    affected = [bid for bid in affected if _block_in_scope(bid)]
    if allow_root_add and not has_root_heading_text:
        return JsonResponse({'error': 'new section proposals require a heading'}, status=400)
    # Accept client-provided outlines for diff visualization; fallback to simple outline
    provided_before = data.get('before_outline')
    provided_after = data.get('after_outline')
    if provided_before and provided_after:
        before_outline = provided_before
        after_outline = provided_after
    else:
        before_outline = outline(list(entry.blocks.all()))
        after_outline = outline(list(entry.blocks.all()))
    now = timezone.now()
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
        base_entry_version_int=entry.entry_version_int,
        published_at=now,
        closes_at=now + timezone.timedelta(hours=project.voting_duration_hours or 24),
    )
    # Author auto-upvote (+1)
    Vote.objects.update_or_create(
        user=request.user, target_type='change', target_id=patch.id, defaults={'value': 1}
    )
    auto_merge()
    return JsonResponse({'change': serialize_change(patch, request.user, section_index=section_index)}, status=201)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def api_project_comments(request: HttpRequest, project_id: int):
    project = get_object_or_404(Project, id=project_id)
    membership, error = _membership_or_error(request, project, ProjectMembership.Role.VIEWER)
    if error:
        return error
    if request.method == 'GET':
        target_type = (request.GET.get('target_type') or '').strip().lower()
        if target_type not in {'section', 'change'}:
            return JsonResponse({'error': 'target_type must be section or change'}, status=400)
        identifier = (
            request.GET.get('section_id')
            or request.GET.get('change_id')
            or request.GET.get('target_id')
        )
        target = _resolve_comment_target(project, target_type, identifier)
        if not target:
            return JsonResponse({'error': 'target not found'}, status=404)
        queryset = Comment.objects.filter(project=project)
        if target_type == 'section':
            queryset = queryset.filter(section=target)
            identifier = target.stable_id
        else:
            queryset = queryset.filter(change=target)
            identifier = str(target.id)
        queryset = queryset.select_related('author', 'section__entry', 'change').order_by('-created_at', '-id')
        try:
            page_number = int(request.GET.get('page', 1))
        except (TypeError, ValueError):
            page_number = 1
        try:
            page_size = int(request.GET.get('page_size', DEFAULT_COMMENT_PAGE_SIZE))
        except (TypeError, ValueError):
            page_size = DEFAULT_COMMENT_PAGE_SIZE
        page_size = max(1, min(page_size, 100))
        paginator = Paginator(queryset, page_size)
        page = paginator.get_page(page_number)
        results = [serialize_comment(comment, request.user, membership) for comment in page.object_list]
        return JsonResponse(
            {
                'results': results,
                'page': page.number,
                'page_size': page.paginator.per_page,
                'has_next': page.has_next(),
                'total': paginator.count,
                'target_type': target_type,
                'target_id': identifier,
            }
        )

    if not request.user.is_authenticated:
        return JsonResponse({'error': 'auth required'}, status=401)
    if not membership:
        return JsonResponse({'error': 'membership required'}, status=403)
    try:
        data = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return JsonResponse({'error': 'invalid json'}, status=400)
    target_type = (data.get('target_type') or '').strip().lower()
    if target_type not in {'section', 'change'}:
        return JsonResponse({'error': 'target_type must be section or change'}, status=400)
    identifier = data.get('section_id') or data.get('change_id') or data.get('target_id')
    target = _resolve_comment_target(project, target_type, identifier)
    if not target:
        return JsonResponse({'error': 'target not found'}, status=404)
    body = (data.get('body') or '').strip()
    if not body:
        return JsonResponse({'error': 'body is required'}, status=400)
    if target_type == 'section':
        comment = Comment.objects.create(project=project, section=target, author=request.user, body=body)
    else:
        comment = Comment.objects.create(project=project, change=target, author=request.user, body=body)
    serialized = serialize_comment(comment, request.user, membership)
    return JsonResponse({'comment': serialized}, status=201)


@csrf_exempt
@require_http_methods(["DELETE"])
def api_project_comment_delete(request: HttpRequest, project_id: int, comment_id: int):
    project = get_object_or_404(Project, id=project_id)
    membership, error = _membership_or_error(request, project, ProjectMembership.Role.VIEWER)
    if error:
        return error
    comment = get_object_or_404(
        Comment.objects.select_related('author'),
        id=comment_id,
        project=project,
    )
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'auth required'}, status=401)
    if comment.author_id != request.user.id:
        if not membership or not membership.has_at_least(ProjectMembership.Role.EDITOR):
            return JsonResponse({'error': 'forbidden'}, status=403)
    comment.delete()
    return JsonResponse({'deleted': True})


@csrf_exempt
@require_http_methods(["POST"])
def api_change_vote(request: HttpRequest, change_id: int):
    patch = get_object_or_404(Change, id=change_id)
    data = json.loads(request.body or b"{}")
    _membership, error = _membership_or_error(request, patch.project, ProjectMembership.Role.VIEWER)
    if error:
        return error
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
    _membership, error = _membership_or_error(request, patch.project, ProjectMembership.Role.OWNER)
    if error:
        return error
    if patch.status != 'merged':
        if not is_passing(patch):
            required_yes = patch.project.required_yes_votes if patch.project else 1
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
