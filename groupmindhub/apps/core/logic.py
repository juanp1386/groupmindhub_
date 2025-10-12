"""Core change / merge logic for backend (MVP simplified).

This mirrors the prototype's applyOps + autoMerge behavior in Python.
"""
from __future__ import annotations
import uuid
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Any
from django.utils import timezone
from .models import Block, Change, Entry, Vote, EntryHistory

# Simulated user pool size (used for merge threshold calculation) mirrors UI prototype (5 users)
SIM_USER_POOL_SIZE = 5


@dataclass
class SectionInfo:
    """Runtime metadata describing a section (heading + descendant blocks)."""

    section_id: str
    heading_block_id: str
    numbering: str
    depth: int
    heading_text: str
    block_ids: frozenset[str]
    parent_section_id: str | None


@dataclass
class SectionIndex:
    by_section_id: Dict[str, SectionInfo]
    by_heading_id: Dict[str, SectionInfo]

    def get_by_section(self, section_id: str) -> SectionInfo | None:
        return self.by_section_id.get(section_id)

    def get_by_heading(self, heading_block_id: str) -> SectionInfo | None:
        return self.by_heading_id.get(heading_block_id)


def _collect_descendants(root_id: str, children: Dict[str | None, List[Block]]) -> Iterable[str]:
    stack = [root_id]
    seen = set()
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        yield current
        for child in children.get(current, []):
            stack.append(child.stable_id)


def build_section_index(entry: Entry, blocks: List[Block] | None = None) -> SectionIndex:
    """Produce numbering + descendant membership for each heading block in an entry."""

    blocks = blocks if blocks is not None else list(entry.blocks.order_by('position', 'id'))
    children: Dict[str | None, List[Block]] = defaultdict(list)
    heading_children: Dict[str | None, List[Block]] = defaultdict(list)
    for block in blocks:
        children[block.parent_stable_id].append(block)
        if block.type == 'h2':
            heading_children[block.parent_stable_id].append(block)

    sections_by_section: Dict[str, SectionInfo] = {}
    sections_by_heading: Dict[str, SectionInfo] = {}

    def assign(parent_id: str | None, prefix: str, depth: int):
        for idx, heading in enumerate(heading_children.get(parent_id, []), start=1):
            numbering = f"{prefix}.{idx}" if prefix else str(idx)
            heading_block_id = heading.stable_id
            section_id = heading_block_id[2:] if heading_block_id.startswith('h_') else heading_block_id
            block_ids = frozenset(_collect_descendants(heading_block_id, children))
            parent_section_id = None
            if parent_id:
                parent = sections_by_heading.get(parent_id)
                parent_section_id = parent.section_id if parent else None
            info = SectionInfo(
                section_id=section_id,
                heading_block_id=heading_block_id,
                numbering=numbering,
                depth=depth,
                heading_text=heading.text,
                block_ids=block_ids,
                parent_section_id=parent_section_id,
            )
            sections_by_section[section_id] = info
            sections_by_heading[heading_block_id] = info
            assign(heading_block_id, numbering, depth + 1)

    assign(None, '', 1)
    return SectionIndex(sections_by_section, sections_by_heading)


def outline(blocks: List[Block]) -> str:
    if not blocks:
        return ""
    index = build_section_index(blocks[0].entry, blocks=blocks)
    lines: List[str] = []
    for block in blocks:
        if block.type == 'h2':
            info = index.get_by_heading(block.stable_id)
            indent = '  ' * (info.depth - 1) if info else ''
            label = f"{info.numbering} " if info else ''
            lines.append(f"{indent}{label}{block.text}")
        else:
            parent_info = index.get_by_heading(block.parent_stable_id) if block.parent_stable_id else None
            indent = '  ' * (parent_info.depth if parent_info else 0)
            lines.append(f"{indent}‣ {block.text}")
    return "\n".join(lines)


def apply_ops(entry: Entry, ops: List[Dict[str, Any]]):
    blocks = list(entry.blocks.order_by('position', 'id'))
    by_id = {b.stable_id: b for b in blocks}
    def new_position(after_id):
        if after_id is None:
            # insert at start
            if not blocks:
                return 1.0
            return blocks[0].position - 1.0
        if after_id not in by_id:
            return (blocks[-1].position + 1.0) if blocks else 1.0
        anchor = by_id[after_id]
        # find next block position
        later = [b for b in blocks if b.position > anchor.position]
        next_pos = min([b.position for b in later], default=anchor.position + 2.0)
        return (anchor.position + next_pos) / 2.0

    changed_ids = set()
    for op in ops:
        t = op.get('type')
        if t == 'UPDATE_TEXT':
            bid = op.get('block_id')
            b = by_id.get(bid)
            if b:
                b.text = op.get('new_text', b.text)
                b.save()
                changed_ids.add(bid)
        elif t == 'INSERT_BLOCK':
            after_id = op.get('after_id')
            new_block = op.get('new_block', {})
            block_type = new_block.get('type', 'p')
            stable_id = new_block.get('id')
            if not stable_id:
                prefix = 'h_' if block_type == 'h2' else 'b_'
                stable_id = f"{prefix}{uuid.uuid4().hex[:12]}"
            pos = new_position(after_id)
            b = Block.objects.create(
                entry=entry,
                stable_id=stable_id,
                type=block_type,
                text=new_block.get('text', ''),
                parent_stable_id=new_block.get('parent') or None,
                position=pos,
            )
            blocks.append(b)
            by_id[stable_id] = b
            changed_ids.add(stable_id)
        elif t == 'DELETE_BLOCK':
            bid = op.get('block_id')
            b = by_id.get(bid)
            if b:
                b.delete()
                by_id.pop(bid, None)
                blocks = [x for x in blocks if x.stable_id != bid]
        elif t == 'MOVE_BLOCK':
            bid = op.get('block_id')
            after_id = op.get('after_id')
            b = by_id.get(bid)
            if b:
                new_parent = op.get('new_parent')
                update_fields = ['position']
                if new_parent == '':
                    new_parent = None
                if new_parent is not None and new_parent != b.parent_stable_id:
                    b.parent_stable_id = new_parent
                    update_fields.append('parent_stable_id')
                b.position = new_position(after_id)
                b.save(update_fields=update_fields)
                changed_ids.add(bid)

    # Re-normalize positions to simple integers
    ordered = list(entry.blocks.order_by('position', 'id'))
    for i, b in enumerate(ordered):
        if b.position != i + 1:
            b.position = i + 1
            b.save(update_fields=['position'])
    return changed_ids


def recompute_patch_votes_cache(patch: Change):
    yes = Vote.objects.filter(target_type='change', target_id=patch.id, value__gt=0).count()
    no = Vote.objects.filter(target_type='change', target_id=patch.id, value__lt=0).count()
    patch.votes_cache_int = yes - no
    patch.save(update_fields=['votes_cache_int'])
    return yes, no


def is_passing(patch: Change) -> bool:
    """A patch passes when yes votes reach 40% of the (simulated) total user pool.

    Using a fixed pool size prevents a single initial upvote (author auto‑vote) from
    immediately merging the patch (previous logic used yes/(yes+no)).
    """
    yes = Vote.objects.filter(target_type='change', target_id=patch.id, value__gt=0).count()
    # Require at least ceil(0.4 * SIM_USER_POOL_SIZE) yes votes
    required = max(1, int((0.4 * SIM_USER_POOL_SIZE) + 0.000001))  # avoid float quirks
    return yes >= required


def auto_merge():
    """Merge all passing, non-merged, published changes."""
    candidates = Change.objects.filter(status='published')
    for p in candidates:
        if is_passing(p):
            apply_merge_core(p)


def apply_merge_core(patch: Change):
    if patch.status == 'merged':
        return
    entry = patch.target_entry
    # Snapshot before outline
    before_outline = outline(list(entry.blocks.order_by('position', 'id')))
    apply_ops(entry, patch.ops_json)
    entry.entry_version_int += 1
    entry.save(update_fields=['entry_version_int'])
    after_outline = outline(list(entry.blocks.order_by('position', 'id')))
    patch.status = 'merged'
    patch.merged_at = timezone.now()
    patch.save(update_fields=['status', 'merged_at'])
    EntryHistory.objects.create(
        entry=entry,
        change=patch,
        version_int=entry.entry_version_int,
        outline_before=before_outline,
        outline_after=after_outline,
    )
    # Mark overlapping patches needs_update (simplified: share any affected block id)
    if patch.affected_blocks:
        overlapping = Change.objects.filter(
            target_entry=entry,
            status='published',
        ).exclude(id=patch.id)
        for op in overlapping:
            if set(op.affected_blocks).intersection(patch.affected_blocks):
                op.status = 'needs_update'
                op.save(update_fields=['status'])
