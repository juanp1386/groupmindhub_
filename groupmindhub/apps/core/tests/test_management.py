from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from groupmindhub.apps.core.models import Entry, Project, ProjectMembership


class EnsureMembershipsCommandTests(TestCase):
    def setUp(self):
        self.project = Project.objects.create(name='Managed Project')
        User = get_user_model()
        self.owner = User.objects.create_user('owner', password='pass12345')
        Entry.objects.create(project=self.project, title='Trunk', author=self.owner)

    def test_assigns_owner_when_missing(self):
        self.assertFalse(self.project.memberships.exists())
        call_command('ensure_project_memberships')
        membership = self.project.memberships.get()
        self.assertEqual(membership.user, self.owner)
        self.assertEqual(membership.role, ProjectMembership.Role.OWNER)

    def test_does_not_duplicate_existing_owner(self):
        ProjectMembership.objects.create(project=self.project, user=self.owner, role=ProjectMembership.Role.OWNER)
        call_command('ensure_project_memberships')
        self.assertEqual(self.project.memberships.count(), 1)
