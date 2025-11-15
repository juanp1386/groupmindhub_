from django.test import TestCase

from groupmindhub.apps.core.logic import apply_ops
from groupmindhub.apps.core.models import Block, Entry, Project


class ApplyOpsReorderTests(TestCase):
    def setUp(self):
        self.project = Project.objects.create(name='Reorder Project')
        self.entry = Entry.objects.create(project=self.project, title='Outline', status='published')
        Block.objects.create(
            entry=self.entry,
            stable_id='h_a',
            type='h2',
            text='Section A',
            parent_stable_id=None,
            position=1,
        )
        Block.objects.create(
            entry=self.entry,
            stable_id='p_a',
            type='p',
            text='Body A',
            parent_stable_id='h_a',
            position=2,
        )
        Block.objects.create(
            entry=self.entry,
            stable_id='h_b',
            type='h2',
            text='Section B',
            parent_stable_id=None,
            position=3,
        )
        Block.objects.create(
            entry=self.entry,
            stable_id='p_b',
            type='p',
            text='Body B',
            parent_stable_id='h_b',
            position=4,
        )
        Block.objects.create(
            entry=self.entry,
            stable_id='h_c',
            type='h2',
            text='Section C',
            parent_stable_id=None,
            position=5,
        )
        Block.objects.create(
            entry=self.entry,
            stable_id='p_c',
            type='p',
            text='Body C',
            parent_stable_id='h_c',
            position=6,
        )

    def _stable_ids(self):
        return list(
            self.entry.blocks.order_by('position', 'id').values_list('stable_id', flat=True)
        )

    def test_reorder_top_level_section(self):
        ops = [
            {'type': 'MOVE_BLOCK', 'block_id': 'h_c', 'after_id': 'p_a', 'new_parent': None},
            {'type': 'MOVE_BLOCK', 'block_id': 'p_c', 'after_id': 'h_c', 'new_parent': 'h_c'},
        ]
        apply_ops(self.entry, ops)
        self.assertEqual(
            self._stable_ids(),
            ['h_a', 'p_a', 'h_c', 'p_c', 'h_b', 'p_b'],
        )
        block_c = Block.objects.get(stable_id='h_c')
        self.assertIsNone(block_c.parent_stable_id)
        self.assertEqual(Block.objects.get(stable_id='p_c').parent_stable_id, 'h_c')

    def test_reparent_section_under_heading(self):
        ops = [
            {'type': 'MOVE_BLOCK', 'block_id': 'h_b', 'after_id': 'p_a', 'new_parent': 'h_a'},
            {'type': 'MOVE_BLOCK', 'block_id': 'p_b', 'after_id': 'h_b', 'new_parent': 'h_b'},
        ]
        apply_ops(self.entry, ops)
        self.assertEqual(
            self._stable_ids(),
            ['h_a', 'p_a', 'h_b', 'p_b', 'h_c', 'p_c'],
        )
        block_b = Block.objects.get(stable_id='h_b')
        self.assertEqual(block_b.parent_stable_id, 'h_a')
        self.assertEqual(Block.objects.get(stable_id='p_b').parent_stable_id, 'h_b')
