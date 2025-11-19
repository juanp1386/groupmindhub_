from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse

from groupmindhub.apps.core.models import (
    Entry,
    Project,
    ProjectMembership,
    GovernanceProposal,
)


class GovernanceSettingsViewTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner_a = User.objects.create_user('owner-a', password='pass-1234')
        self.owner_b = User.objects.create_user('owner-b', password='pass-1234')
        self.project = Project.objects.create(name='Settings Project')
        ProjectMembership.objects.create(project=self.project, user=self.owner_a, role=ProjectMembership.Role.OWNER)
        ProjectMembership.objects.create(project=self.project, user=self.owner_b, role=ProjectMembership.Role.OWNER)
        self.entry = Entry.objects.create(project=self.project, title='Entry', author=self.owner_a, status='published')
        self.client = Client()

    def test_governance_change_requires_second_owner(self):
        self.client.force_login(self.owner_a)
        response = self.client.post(
            reverse('project_settings', args=[self.project.id]),
            data={
                'action': 'governance',
                'voting_pool_size': 11,
                'approval_threshold': '0.55',
                'voting_duration_hours': 20,
                'governance_summary': 'Tighten rules',
            },
        )
        self.assertEqual(response.status_code, 302)
        proposal = GovernanceProposal.objects.get(project=self.project)
        self.assertEqual(proposal.status, GovernanceProposal.Status.PENDING)
        self.project.refresh_from_db()
        self.assertNotEqual(self.project.voting_pool_size, 11)
        self.client.force_login(self.owner_b)
        response = self.client.post(
            reverse('project_settings', args=[self.project.id]),
            data={'action': 'governance-approve', 'proposal_id': proposal.id},
        )
        self.assertEqual(response.status_code, 302)
        self.project.refresh_from_db()
        self.assertEqual(self.project.voting_pool_size, 11)
        self.assertEqual(self.project.voting_duration_hours, 20)

    def test_governance_rejection(self):
        self.client.force_login(self.owner_a)
        self.client.post(
            reverse('project_settings', args=[self.project.id]),
            data={
                'action': 'governance',
                'voting_pool_size': 6,
                'approval_threshold': '0.80',
                'voting_duration_hours': 18,
            },
        )
        proposal = GovernanceProposal.objects.get(project=self.project)
        self.client.force_login(self.owner_b)
        self.client.post(
            reverse('project_settings', args=[self.project.id]),
            data={'action': 'governance-reject', 'proposal_id': proposal.id},
        )
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, GovernanceProposal.Status.REJECTED)
        self.project.refresh_from_db()
        self.assertNotEqual(self.project.voting_pool_size, 6)
