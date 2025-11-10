from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse

from groupmindhub.apps.core.models import (
    Change,
    Entry,
    Project,
    ProjectInvite,
    ProjectMembership,
)


class ProjectAccessTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user('owner', password='pass-1234')
        self.viewer = User.objects.create_user('viewer', password='pass-1234')
        self.project = Project.objects.create(name='Secret Plan', visibility=Project.Visibility.PRIVATE)
        ProjectMembership.objects.create(project=self.project, user=self.owner, role=ProjectMembership.Role.OWNER)
        self.entry = Entry.objects.create(project=self.project, title='Secret Entry', author=self.owner, status='published')
        self.client = Client()
        self.client.force_login(self.viewer)

    def test_project_detail_forbids_non_member(self):
        response = self.client.get(reverse('project_detail', args=[self.project.id]))
        self.assertEqual(response.status_code, 403)

    def test_project_detail_allows_invite_token(self):
        invite = ProjectInvite.objects.create(
            project=self.project,
            email='viewer@example.com',
            role=ProjectMembership.Role.VIEWER,
            inviter=self.owner,
        )
        url = reverse('project_detail', args=[self.project.id]) + f'?invite={invite.get_signed_token()}'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse('entry_detail', args=[self.entry.id]), response['Location'])

    def test_accept_invite_grants_membership(self):
        invite = ProjectInvite.objects.create(
            project=self.project,
            email='viewer@example.com',
            role=ProjectMembership.Role.EDITOR,
            inviter=self.owner,
        )
        url = reverse('project_invite_accept', args=[self.project.id, invite.get_signed_token()])
        response = self.client.post(url)
        self.assertEqual(response.status_code, 302)
        membership = ProjectMembership.objects.get(project=self.project, user=self.viewer)
        self.assertEqual(membership.role, ProjectMembership.Role.EDITOR)

    def test_change_detail_forbidden_without_access(self):
        change = Change.objects.create(
            project=self.project,
            target_entry=self.entry,
            author=self.owner,
            summary='Hidden change',
            ops_json=[],
            affected_blocks=[],
            before_outline='',
            after_outline='',
            target_section_id='root',
            status='published',
            base_entry_version_int=1,
        )
        response = self.client.get(reverse('change_detail', args=[change.id]))
        self.assertEqual(response.status_code, 403)
