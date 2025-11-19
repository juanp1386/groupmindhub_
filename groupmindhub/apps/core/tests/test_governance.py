from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from groupmindhub.apps.core.models import Project, ProjectMembership, GovernanceProposal


class GovernanceProposalTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner_a = User.objects.create_user('owner-a', password='pass-1234')
        self.owner_b = User.objects.create_user('owner-b', password='pass-1234')
        self.project = Project.objects.create(name='Gov Project')
        ProjectMembership.objects.create(project=self.project, user=self.owner_a, role=ProjectMembership.Role.OWNER)
        ProjectMembership.objects.create(project=self.project, user=self.owner_b, role=ProjectMembership.Role.OWNER)

    def test_proposal_applies_after_all_owner_approvals(self):
        proposal = GovernanceProposal.objects.create(
            project=self.project,
            created_by=self.owner_a,
            voting_pool_size=8,
            approval_threshold=Decimal('0.50'),
            voting_duration_hours=30,
        )
        proposal.initialize_approvals(auto_approve_user=self.owner_a)
        self.assertEqual(proposal.status, GovernanceProposal.Status.PENDING)
        approvals = list(proposal.approvals.order_by('membership__user__username'))
        self.assertEqual(len(approvals), 2)
        self.assertEqual(approvals[0].decision, approvals[0].Decision.APPROVED)
        self.assertEqual(approvals[1].decision, approvals[1].Decision.PENDING)
        approvals[1].approve()
        proposal.refresh_from_db()
        self.project.refresh_from_db()
        self.assertEqual(proposal.status, GovernanceProposal.Status.APPROVED)
        self.assertEqual(self.project.voting_pool_size, 8)
        self.assertEqual(self.project.voting_duration_hours, 30)

    def test_rejection_stops_proposal(self):
        proposal = GovernanceProposal.objects.create(
            project=self.project,
            created_by=self.owner_a,
            voting_pool_size=12,
            approval_threshold=Decimal('0.75'),
            voting_duration_hours=20,
        )
        proposal.initialize_approvals(auto_approve_user=self.owner_a)
        remaining = proposal.approvals.exclude(decision=proposal.approvals.model.Decision.APPROVED).first()
        remaining.reject()
        proposal.refresh_from_db()
        self.project.refresh_from_db()
        self.assertEqual(proposal.status, GovernanceProposal.Status.REJECTED)
        self.assertNotEqual(self.project.voting_pool_size, 12)
