"""Core patch / merge logic for backend (MVP simplified).

This mirrors the prototype's applyOps + autoMerge behavior in Python.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Any
from django.utils import timezone
from django.contrib.auth import get_user_model
from .models import Block, Patch, Entry, Vote, EntryHistory

# Simulated user pool size (used for merge threshold calculation) mirrors UI prototype (5 users)
SIM_USER_POOL_SIZE = 5


def outline(blocks: List[Block]) -> str:
    lines = []
    for b in blocks:
        prefix = '##' if b.type == 'h2' else '‣'
        lines.append(f"  {prefix} {b.text}")
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
            stable_id = new_block.get('id') or f"auto_{timezone.now().timestamp()}"
            pos = new_position(after_id)
            b = Block.objects.create(
                entry=entry,
                stable_id=stable_id,
                type=new_block.get('type', 'p'),
                text=new_block.get('text', ''),
                parent_stable_id=new_block.get('parent'),
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
                b.position = new_position(after_id)
                b.save()
                changed_ids.add(bid)

    # Re-normalize positions to simple integers
    ordered = list(entry.blocks.order_by('position', 'id'))
    for i, b in enumerate(ordered):
        if b.position != i + 1:
            b.position = i + 1
            b.save(update_fields=['position'])
    return changed_ids


def recompute_patch_votes_cache(patch: Patch):
    yes = Vote.objects.filter(target_type='patch', target_id=patch.id, value__gt=0).count()
    no = Vote.objects.filter(target_type='patch', target_id=patch.id, value__lt=0).count()
    patch.votes_cache_int = yes - no
    patch.save(update_fields=['votes_cache_int'])
    return yes, no


def is_passing(patch: Patch) -> bool:
    """A patch passes when yes votes reach 40% of the (simulated) total user pool.

    Using a fixed pool size prevents a single initial upvote (author auto‑vote) from
    immediately merging the patch (previous logic used yes/(yes+no)).
    """
    yes = Vote.objects.filter(target_type='patch', target_id=patch.id, value__gt=0).count()
    # Require at least ceil(0.4 * SIM_USER_POOL_SIZE) yes votes
    required = max(1, int((0.4 * SIM_USER_POOL_SIZE) + 0.000001))  # avoid float quirks
    return yes >= required


def auto_merge():
    """Merge all passing, non-merged, published patches."""
    candidates = Patch.objects.filter(status='published')
    for p in candidates:
        if is_passing(p):
            apply_merge_core(p)


def apply_merge_core(patch: Patch):
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
        patch=patch,
        version_int=entry.entry_version_int,
        outline_before=before_outline,
        outline_after=after_outline,
    )
    # Mark overlapping patches needs_update (simplified: share any affected block id)
    if patch.affected_blocks:
        overlapping = Patch.objects.filter(
            target_entry=entry,
            status='published',
        ).exclude(id=patch.id)
        for op in overlapping:
            if set(op.affected_blocks).intersection(patch.affected_blocks):
                op.status = 'needs_update'
                op.save(update_fields=['status'])
