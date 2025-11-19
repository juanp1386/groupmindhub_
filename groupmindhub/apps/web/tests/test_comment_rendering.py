from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse
from groupmindhub.apps.core.models import (
    Project,
    Entry,
    Section,
    ProjectMembership,
    Comment,
)


class CommentRenderingTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user('user', password='test-pass-123')
        self.project = Project.objects.create(name='Render Project')
        self.entry = Entry.objects.create(project=self.project, title='Entry', author=self.user)
        self.section = Section.objects.create(
            entry=self.entry,
            stable_id='root',
            heading='Root',
            body='Body',
            position=1,
        )
        ProjectMembership.objects.create(project=self.project, user=self.user, role=ProjectMembership.Role.OWNER)
        self.client = Client()
        self.client.force_login(self.user)

    def test_entry_detail_contains_comment_panel(self):
        url = reverse('entry_detail', args=[self.entry.id])
        response = self.client.get(url)
        self.assertContains(response, 'Discussion')
        self.assertContains(response, 'id="commentList"')
        self.assertContains(response, 'id="commentForm"')

    def test_updates_view_shows_recent_comment(self):
        Comment.objects.create(project=self.project, section=self.section, author=self.user, body='Recent feedback note.')
        response = self.client.get(reverse('updates'))
        activity = response.context['followed_activity']
        self.assertTrue(any('💬' in item['summary'] for item in activity))
        self.assertContains(response, 'Recent feedback note.')
