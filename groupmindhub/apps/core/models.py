from __future__ import annotations
from django.conf import settings
from django.core.exceptions import PermissionDenied
from django.db import models


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
