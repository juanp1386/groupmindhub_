import json
from django.test import Client, TestCase
from groupmindhub.apps.core.models import Block, Change, Entry, Project


class ChangeApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.project = Project.objects.create(name='API Project')
        self.entry = Entry.objects.create(project=self.project, title='API Entry')
        Block.objects.create(
            entry=self.entry,
            stable_id='h_root',
            type='h2',
            text='Root',
            parent_stable_id=None,
            position=1,
        )
        Block.objects.create(
            entry=self.entry,
            stable_id='p_root',
            type='p',
            text='Root body',
            parent_stable_id='h_root',
            position=2,
        )

    def test_insert_subsection_allows_new_child_body(self):
        payload = {
            'entry_id': self.entry.id,
            'section_id': 'root',
            'summary': 'Add subsection',
            'ops_json': [
                {
                    'type': 'INSERT_BLOCK',
                    'after_id': 'p_root',
                    'new_block': {
                        'id': 'h_child',
                        'type': 'h2',
                        'text': 'Child',
                        'parent': 'h_root',
                    },
                },
                {
                    'type': 'INSERT_BLOCK',
                    'after_id': 'h_child',
                    'new_block': {
                        'id': 'p_child',
                        'type': 'p',
                        'text': 'Child body',
                        'parent': 'h_child',
                    },
                },
            ],
            'affected_blocks': ['h_child', 'p_child'],
            'anchors': ['after:p_root', 'after:h_child'],
            'sim_user': 'ana',
        }

        response = self.client.post(
            f'/api/projects/{self.project.id}/changes/create',
            data=json.dumps(payload),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 201)
        change = Change.objects.get(project=self.project)
        self.assertEqual(change.summary, 'Add subsection')
        self.assertEqual(len(change.ops_json), 2)
