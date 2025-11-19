import json
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import timezone
from groupmindhub.apps.core.models import (
    Block,
    Change,
    Entry,
    Project,
    ProjectMembership,
    ProjectInvite,
)


class ChangeApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.project = Project.objects.create(name='API Project')
        User = get_user_model()
        self.user = User.objects.create_user('editor', password='test-pass-123')
        self.viewer = User.objects.create_user('viewer', password='test-pass-123')
        self.entry = Entry.objects.create(project=self.project, title='API Entry', author=self.user)
        ProjectMembership.objects.create(project=self.project, user=self.user, role=ProjectMembership.Role.EDITOR)
        ProjectMembership.objects.create(project=self.project, user=self.viewer, role=ProjectMembership.Role.VIEWER)
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
        self.client.force_login(self.user)

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

    def test_viewer_cannot_create_change(self):
        self.client.force_login(self.viewer)
        payload = {
            'entry_id': self.entry.id,
            'section_id': 'root',
            'summary': 'Should fail',
            'ops_json': [],
            'affected_blocks': [],
            'anchors': [],
        }
        response = self.client.post(
            f'/api/projects/{self.project.id}/changes/create',
            data=json.dumps(payload),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_non_member_cannot_vote(self):
        change = Change.objects.create(
            project=self.project,
            target_entry=self.entry,
            author=self.user,
            summary='Update section',
            ops_json=[],
            affected_blocks=[],
            before_outline='',
            after_outline='',
            target_section_id='root',
            status='published',
            base_entry_version_int=1,
        )
        User = get_user_model()
        outsider = User.objects.create_user('outsider', password='test-pass-123')
        self.client.force_login(outsider)
        response = self.client.post(
            f'/api/changes/{change.id}/votes',
            data=json.dumps({'value': 1}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_private_project_requires_invite(self):
        private = Project.objects.create(name='Private Project', visibility=Project.Visibility.PRIVATE)
        Entry.objects.create(project=private, title='Secret Entry', author=self.user)
        ProjectMembership.objects.create(project=private, user=self.user, role=ProjectMembership.Role.OWNER)
        outsider = get_user_model().objects.create_user('outsider2', password='test-pass-123')
        client = Client()
        client.force_login(outsider)
        response = client.get(f'/api/projects/{private.id}/entry')
        self.assertEqual(response.status_code, 403)
        invite = ProjectInvite.objects.create(
            project=private,
            email='invitee@example.com',
            role=ProjectMembership.Role.VIEWER,
            inviter=self.user,
        )
        signed = invite.get_signed_token()
        response = client.get(f'/api/projects/{private.id}/entry?invite={signed}')
        self.assertEqual(response.status_code, 200)

    def test_required_yes_votes_follow_project_settings(self):
        self.project.voting_pool_size = 10
        self.project.approval_threshold = Decimal('0.60')
        self.project.voting_duration_hours = 36
        self.project.save(update_fields=['voting_pool_size', 'approval_threshold', 'voting_duration_hours'])
        payload = {
            'entry_id': self.entry.id,
            'section_id': 'root',
            'summary': 'Threshold test',
            'ops_json': [],
            'affected_blocks': [],
            'anchors': [],
        }
        response = self.client.post(
            f'/api/projects/{self.project.id}/changes/create',
            data=json.dumps(payload),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        body = json.loads(response.content)
        change_data = body['change']
        self.assertEqual(change_data['required_yes_votes'], 6)
        self.assertEqual(change_data['project_governance']['voting_duration_hours'], 36)
        change = Change.objects.get(project=self.project)
        self.assertIsNotNone(change.closes_at)
        expected_close = change.published_at + timezone.timedelta(hours=36)
        self.assertEqual(change.closes_at, expected_close)
