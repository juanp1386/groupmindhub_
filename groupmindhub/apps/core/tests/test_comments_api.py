import json
from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from groupmindhub.apps.core.models import (
    Project,
    Entry,
    Section,
    ProjectMembership,
    Comment,
    Change,
)


class CommentApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        User = get_user_model()
        self.owner = User.objects.create_user('owner', password='test-pass-123')
        self.viewer = User.objects.create_user('viewer', password='test-pass-123')
        self.other = User.objects.create_user('other', password='test-pass-123')
        self.project = Project.objects.create(name='Comment Project')
        ProjectMembership.objects.create(project=self.project, user=self.owner, role=ProjectMembership.Role.OWNER)
        ProjectMembership.objects.create(project=self.project, user=self.viewer, role=ProjectMembership.Role.VIEWER)
        self.entry = Entry.objects.create(project=self.project, title='Entry', author=self.owner)
        self.section = Section.objects.create(
            entry=self.entry,
            stable_id='root',
            heading='Root Section',
            body='Body',
            position=1,
        )
        self.client.force_login(self.viewer)

    def test_member_can_create_section_comment(self):
        response = self.client.post(
            f'/api/projects/{self.project.id}/comments',
            data=json.dumps({
                'target_type': 'section',
                'section_id': self.section.stable_id,
                'body': 'Great section!',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertIn('comment', data)
        comment = Comment.objects.get()
        self.assertEqual(comment.section, self.section)
        self.assertEqual(comment.author, self.viewer)
        self.assertEqual(data['comment']['body'], 'Great section!')
        self.assertTrue(data['comment']['can_delete'])

    def test_non_member_cannot_post_comment(self):
        outsider = self.other
        self.client.force_login(outsider)
        response = self.client.post(
            f'/api/projects/{self.project.id}/comments',
            data=json.dumps({
                'target_type': 'section',
                'section_id': self.section.stable_id,
                'body': 'I should not post',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Comment.objects.exists())

    def test_editor_can_delete_comment(self):
        comment = Comment.objects.create(project=self.project, section=self.section, author=self.viewer, body='To delete')
        self.client.force_login(self.owner)
        response = self.client.delete(f'/api/projects/{self.project.id}/comments/{comment.id}')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Comment.objects.filter(id=comment.id).exists())

    def test_viewer_cannot_delete_others_comment(self):
        comment = Comment.objects.create(project=self.project, section=self.section, author=self.owner, body='Protected')
        self.client.force_login(self.viewer)
        response = self.client.delete(f'/api/projects/{self.project.id}/comments/{comment.id}')
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Comment.objects.filter(id=comment.id).exists())

    def test_paginated_comment_list(self):
        for idx in range(3):
            Comment.objects.create(project=self.project, section=self.section, author=self.owner, body=f'Note {idx}')
        response = self.client.get(
            f'/api/projects/{self.project.id}/comments',
            {'target_type': 'section', 'section_id': self.section.stable_id, 'page_size': 2},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data['results']), 2)
        self.assertTrue(data['has_next'])

    def test_change_comment_serialization(self):
        change = Change.objects.create(
            project=self.project,
            target_entry=self.entry,
            author=self.owner,
            summary='Change',
            ops_json=[],
            affected_blocks=[],
            before_outline='',
            after_outline='',
            target_section_id='root',
            status='published',
            base_entry_version_int=1,
        )
        Comment.objects.create(project=self.project, change=change, author=self.owner, body='Discuss change')
        response = self.client.get(
            f'/api/projects/{self.project.id}/comments',
            {'target_type': 'change', 'change_id': change.id},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['results'][0]['target_type'], 'change')
        self.assertEqual(str(data['results'][0]['target_id']), str(change.id))
*** End of File
