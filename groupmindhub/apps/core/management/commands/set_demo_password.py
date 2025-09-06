from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model


class Command(BaseCommand):
	help = "Create or update a demo user with a known password (default: demo/demo)."

	def add_arguments(self, parser):
		parser.add_argument('--username', default='demo')
		parser.add_argument('--password', default='demo')

	def handle(self, *args, **opts):
		User = get_user_model()
		username = opts['username']
		password = opts['password']
		user, created = User.objects.get_or_create(username=username, defaults={'is_staff': True})
		user.set_password(password)
		user.save()
		self.stdout.write(self.style.SUCCESS(f"Demo user '{username}' ready (created={created})."))

