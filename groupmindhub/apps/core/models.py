from __future__ import annotations
import math
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import models
from django.utils import timezone


DEFAULT_VOTING_POOL_SIZE = 5
DEFAULT_APPROVAL_THRESHOLD = Decimal('0.40')
DEFAULT_VOTING_DURATION_HOURS = 24


class Project(models.Model):
    class Visibility(models.TextChoices):
        PUBLIC = 'public', 'Public'
        PRIVATE = 'private', 'Private'

    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    visibility = models.CharField(
        max_length=20,
        choices=Visibility.choices,
        default=Visibility.PUBLIC,
    )
    voting_pool_size = models.PositiveIntegerField(default=DEFAULT_VOTING_POOL_SIZE)
    approval_threshold = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        default=DEFAULT_APPROVAL_THRESHOLD,
    )
    voting_duration_hours = models.PositiveIntegerField(default=DEFAULT_VOTING_DURATION_HOURS)

    def __str__(self):
        return self.name

    # --- membership helpers -------------------------------------------------
    def add_member(self, user, role: str = None):
        """Add or update a membership for the given user."""
        if role is None:
            role = ProjectMembership.Role.VIEWER
        membership, _created = self.memberships.update_or_create(
            user=user,
            defaults={'role': role},
        )
        return membership

    def membership_for(self, user):
        if not user or not getattr(user, 'is_authenticated', False):
            return None
        return self.memberships.filter(user=user).first()

    def has_role(self, user, role: str):
        membership = self.membership_for(user)
        if not membership:
            return False
        return membership.has_at_least(role)

    def require_role(self, user, role: str, invite=None):
        membership = self.membership_for(user)
        if membership and membership.has_at_least(role):
            return membership
        if invite and role == ProjectMembership.Role.VIEWER and invite.allows(role):
            return None
        if role == ProjectMembership.Role.VIEWER and self.visibility == self.Visibility.PUBLIC:
            return membership
        raise PermissionDenied("You do not have access to this project.")

    @property
    def required_yes_votes(self) -> int:
        pool = max(1, self.voting_pool_size or DEFAULT_VOTING_POOL_SIZE)
        threshold = self.approval_threshold or DEFAULT_APPROVAL_THRESHOLD
        try:
            threshold_float = float(threshold)
        except (TypeError, ValueError):
            threshold_float = float(DEFAULT_APPROVAL_THRESHOLD)
        return max(1, math.ceil(threshold_float * pool))

    def governance_snapshot(self) -> dict:
        threshold = self.approval_threshold or DEFAULT_APPROVAL_THRESHOLD
        try:
            threshold_float = float(threshold)
        except (TypeError, ValueError):
            threshold_float = float(DEFAULT_APPROVAL_THRESHOLD)
        return {
            'voting_pool_size': self.voting_pool_size,
            'approval_threshold': threshold_float,
            'approval_threshold_percent': round(threshold_float * 100, 2),
            'voting_duration_hours': self.voting_duration_hours,
            'required_yes_votes': self.required_yes_votes,
        }


class Entry(models.Model):
    project = models.ForeignKey(Project, related_name='entries', on_delete=models.CASCADE)
    title = models.CharField(max_length=200)
    content = models.TextField(blank=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=20, default='draft')  # draft|published
    is_fork = models.BooleanField(default=False)
    entry_version_int = models.PositiveIntegerField(default=1)
    votes_cache_int = models.IntegerField(default=0)
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.project.name}: {self.title} (v{self.entry_version_int})"


class Block(models.Model):
    entry = models.ForeignKey(Entry, related_name='blocks', on_delete=models.CASCADE)
    stable_id = models.CharField(max_length=100, db_index=True)
    type = models.CharField(max_length=10, choices=[('h2', 'Heading2'), ('p', 'Paragraph')])
    text = models.TextField()
    parent_stable_id = models.CharField(max_length=100, null=True, blank=True)
    position = models.FloatField(default=0, db_index=True)

    class Meta:
        unique_together = ('entry', 'stable_id')
        ordering = ['position', 'id']

    def __str__(self):
        return f"{self.stable_id}:{self.type}"


class Change(models.Model):
    project = models.ForeignKey(Project, related_name='changes', on_delete=models.CASCADE)
    target_entry = models.ForeignKey(Entry, related_name='changes', on_delete=models.CASCADE)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    summary = models.CharField(max_length=300)
    ops_json = models.JSONField(default=list, blank=True)
    affected_blocks = models.JSONField(default=list, blank=True)
    anchors = models.JSONField(default=list, blank=True)
    before_outline = models.TextField(blank=True)
    after_outline = models.TextField(blank=True)
    base_entry_version_int = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=20, default='draft')  # draft|published|merged|needs_update
    votes_cache_int = models.IntegerField(default=0)
    overlaps = models.JSONField(default=list, blank=True)
    target_section_id = models.CharField(max_length=100, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    published_at = models.DateTimeField(null=True, blank=True)
    merged_at = models.DateTimeField(null=True, blank=True)
    closes_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Change #{self.pk} ({self.status})"


class Vote(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    target_type = models.CharField(max_length=20)  # 'entry' | 'change'
    target_id = models.PositiveIntegerField()
    value = models.SmallIntegerField(default=0)  # -1 | 0 | +1
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'target_type', 'target_id')

    def __str__(self):
        return f"Vote({self.user_id},{self.target_type}:{self.target_id})={self.value}"


class EntryHistory(models.Model):
    entry = models.ForeignKey(Entry, related_name='history', on_delete=models.CASCADE)
    change = models.ForeignKey('Change', null=True, blank=True, related_name='history_records', on_delete=models.SET_NULL)
    version_int = models.PositiveIntegerField()
    outline_before = models.TextField(blank=True)
    outline_after = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['version_int', 'id']

    def __str__(self):
        return f"History(entry={self.entry_id}, v={self.version_int})"


class Section(models.Model):
    """Atomic editing unit: a heading + body text (multi-paragraph allowed)."""
    entry = models.ForeignKey(Entry, related_name='sections', on_delete=models.CASCADE)
    stable_id = models.CharField(max_length=100, db_index=True)
    heading = models.CharField(max_length=300)
    body = models.TextField(blank=True)
    position = models.FloatField(default=0, db_index=True)
    parent = models.ForeignKey('self', null=True, blank=True, related_name='children', on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('entry', 'stable_id')
        ordering = ['position', 'id']

    def __str__(self):
        return f"Section({self.entry_id}:{self.heading[:30]})"


class ProjectStar(models.Model):
    project = models.ForeignKey(Project, related_name='stars', on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name='project_stars', on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('project', 'user')

    def __str__(self):
        return f"Star(p={self.project_id},u={self.user_id})"


class ProjectMembership(models.Model):
    class Role(models.TextChoices):
        OWNER = 'owner', 'Owner'
        EDITOR = 'editor', 'Editor'
        VIEWER = 'viewer', 'Viewer'

    ROLE_ORDER = {
        Role.VIEWER: 1,
        Role.EDITOR: 2,
        Role.OWNER: 3,
    }

    project = models.ForeignKey(Project, related_name='memberships', on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name='project_memberships', on_delete=models.CASCADE)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.VIEWER)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('project', 'user')
        ordering = ['project_id', 'user_id']

    def __str__(self):
        return f"Membership(p={self.project_id},u={self.user_id},role={self.role})"

    # Helper methods ---------------------------------------------------------
    def has_at_least(self, role: str) -> bool:
        required = self.ROLE_ORDER.get(role, 0)
        current = self.ROLE_ORDER.get(self.role, 0)
        return current >= required

    @property
    def is_owner(self) -> bool:
        return self.role == self.Role.OWNER

    @property
    def is_editor(self) -> bool:
        return self.has_at_least(self.Role.EDITOR)


class ProjectInvite(models.Model):
    project = models.ForeignKey(Project, related_name='invites', on_delete=models.CASCADE)
    email = models.EmailField()
    role = models.CharField(max_length=20, choices=ProjectMembership.Role.choices, default=ProjectMembership.Role.VIEWER)
    token = models.CharField(max_length=100, unique=True, editable=False)
    inviter = models.ForeignKey(settings.AUTH_USER_MODEL, related_name='project_invites_sent', on_delete=models.CASCADE)
    invited_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        related_name='project_invites',
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    declined_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['project_id', 'email']
        constraints = [
            models.UniqueConstraint(
                fields=['project', 'email'],
                condition=models.Q(accepted_at__isnull=True, declined_at__isnull=True),
                name='unique_active_invite_per_project_email',
            )
        ]

    def __str__(self):
        return f"Invite(p={self.project_id},email={self.email},role={self.role})"

    # ------------------------------------------------------------------
    @staticmethod
    def generate_token() -> str:
        import secrets

        return secrets.token_urlsafe(32)

    def allows(self, role: str) -> bool:
        required = ProjectMembership.ROLE_ORDER.get(role, 0)
        invite_role = ProjectMembership.ROLE_ORDER.get(self.role, 0)
        return invite_role >= required

    @property
    def is_active(self) -> bool:
        return not self.accepted_at and not self.declined_at

    def accept(self, user):
        from django.utils import timezone

        membership = self.project.add_member(user, self.role)
        self.accepted_at = timezone.now()
        self.declined_at = None
        self.invited_user = user
        self.save(update_fields=['accepted_at', 'declined_at', 'invited_user'])
        return membership

    def decline(self, user=None):
        from django.utils import timezone

        self.declined_at = timezone.now()
        if user:
            self.invited_user = user
        self.save(update_fields=['declined_at', 'invited_user'])

    def get_signed_token(self):
        from django.core import signing

        signer = signing.TimestampSigner(salt='project-invite')
        return signer.sign(self.token)

    @classmethod
    def from_signed_token(cls, signed_token: str):
        from django.core import signing

        signer = signing.TimestampSigner(salt='project-invite')
        try:
            token = signer.unsign(signed_token)
        except signing.BadSignature:
            return None
        return cls.objects.filter(token=token).first()

    def save(self, *args, **kwargs):
        if self.email:
            self.email = self.email.lower()
        if not self.token:
            self.token = self.generate_token()
        super().save(*args, **kwargs)


class GovernanceProposal(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    project = models.ForeignKey(Project, related_name='governance_proposals', on_delete=models.CASCADE)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='governance_proposals',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    summary = models.CharField(max_length=200, blank=True)
    voting_pool_size = models.PositiveIntegerField()
    approval_threshold = models.DecimalField(max_digits=4, decimal_places=2)
    voting_duration_hours = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def __str__(self):
        return f"GovernanceProposal(project={self.project_id}, status={self.status})"

    def initialize_approvals(self, auto_approve_user=None):
        owners = self.project.memberships.filter(role=ProjectMembership.Role.OWNER)
        approvals = []
        for membership in owners:
            approval, _ = GovernanceApproval.objects.get_or_create(
                proposal=self,
                membership=membership,
            )
            approvals.append((approval, membership))

        auto_user_id = getattr(auto_approve_user, 'id', None)
        if auto_user_id:
            for approval, membership in approvals:
                if membership.user_id == auto_user_id:
                    approval.approve()
        self.refresh_from_db()
        self.update_status_from_approvals()

    def update_status_from_approvals(self):
        approvals = list(self.approvals.all())
        if not approvals:
            self.apply_to_project()
            if self.status != self.Status.APPROVED:
                self.status = self.Status.APPROVED
                self.decided_at = timezone.now()
                self.save(update_fields=['status', 'decided_at'])
            return
        if any(approval.decision == GovernanceApproval.Decision.REJECTED for approval in approvals):
            if self.status != self.Status.REJECTED:
                self.status = self.Status.REJECTED
                self.decided_at = timezone.now()
                self.save(update_fields=['status', 'decided_at'])
            return
        if all(approval.decision == GovernanceApproval.Decision.APPROVED for approval in approvals):
            if self.status != self.Status.APPROVED:
                self.apply_to_project()
                self.status = self.Status.APPROVED
                self.decided_at = timezone.now()
                self.save(update_fields=['status', 'decided_at'])
            return
        if self.status != self.Status.PENDING:
            self.status = self.Status.PENDING
            self.decided_at = None
            self.save(update_fields=['status', 'decided_at'])

    def apply_to_project(self):
        self.project.voting_pool_size = self.voting_pool_size
        self.project.approval_threshold = self.approval_threshold
        self.project.voting_duration_hours = self.voting_duration_hours
        self.project.save(update_fields=['voting_pool_size', 'approval_threshold', 'voting_duration_hours'])


class GovernanceApproval(models.Model):
    class Decision(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    proposal = models.ForeignKey(GovernanceProposal, related_name='approvals', on_delete=models.CASCADE)
    membership = models.ForeignKey(ProjectMembership, related_name='governance_approvals', on_delete=models.CASCADE)
    decision = models.CharField(max_length=20, choices=Decision.choices, default=Decision.PENDING)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('proposal', 'membership')

    def __str__(self):
        return f"GovernanceApproval(proposal={self.proposal_id}, membership={self.membership_id}, decision={self.decision})"

    def approve(self):
        if self.decision == self.Decision.APPROVED:
            return
        self.decision = self.Decision.APPROVED
        self.decided_at = timezone.now()
        self.save(update_fields=['decision', 'decided_at'])
        self.proposal.update_status_from_approvals()

    def reject(self):
        if self.decision == self.Decision.REJECTED:
            return
        self.decision = self.Decision.REJECTED
        self.decided_at = timezone.now()
        self.save(update_fields=['decision', 'decided_at'])
        self.proposal.update_status_from_approvals()


class Comment(models.Model):
    project = models.ForeignKey(Project, related_name='comments', on_delete=models.CASCADE)
    section = models.ForeignKey('Section', related_name='comments', null=True, blank=True, on_delete=models.CASCADE)
    change = models.ForeignKey('Change', related_name='comments', null=True, blank=True, on_delete=models.CASCADE)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='comments',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at', 'id']
        indexes = [
            models.Index(fields=['project', 'created_at']),
            models.Index(fields=['section', 'created_at']),
            models.Index(fields=['change', 'created_at']),
        ]

    def __str__(self):
        target = 'section' if self.section_id else 'change'
        target_id = self.section.stable_id if self.section_id else self.change_id
        return f"Comment({target}={target_id}, author={self.author_id})"

    def clean(self):
        if not self.section_id and not self.change_id:
            raise ValidationError('A comment must target a section or a change.')
        if self.section_id and self.change_id:
            raise ValidationError('A comment may target only one object.')

    def save(self, *args, **kwargs):
        if self.section_id and not self.project_id:
            self.project = self.section.entry.project
        if self.change_id and not self.project_id:
            self.project = self.change.project
        self.full_clean(exclude={'project'})
        super().save(*args, **kwargs)

    @property
    def target_type(self) -> str:
        return 'change' if self.change_id else 'section'

    @property
    def target_identifier(self):
        if self.change_id:
            return self.change_id
        if self.section_id:
            return self.section.stable_id
        return None
