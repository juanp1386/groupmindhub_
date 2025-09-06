from __future__ import annotations
from django.conf import settings
from django.db import models


class Project(models.Model):
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


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


class Patch(models.Model):
    project = models.ForeignKey(Project, related_name='patches', on_delete=models.CASCADE)
    target_entry = models.ForeignKey(Entry, related_name='patches', on_delete=models.CASCADE)
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
    created_at = models.DateTimeField(auto_now_add=True)
    published_at = models.DateTimeField(null=True, blank=True)
    merged_at = models.DateTimeField(null=True, blank=True)
    closes_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Patch #{self.pk} ({self.status})"


class Vote(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    target_type = models.CharField(max_length=20)  # 'entry' | 'patch'
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
    patch = models.ForeignKey(Patch, null=True, blank=True, related_name='history_records', on_delete=models.SET_NULL)
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
