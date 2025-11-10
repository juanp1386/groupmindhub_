from django.core.management.base import BaseCommand
from django.db import transaction

from groupmindhub.apps.core.models import Entry, ProjectMembership


class Command(BaseCommand):
    help = 'Ensure each project has an owner membership based on existing entry authors.'

    def handle(self, *args, **options):
        created = 0
        with transaction.atomic():
            for entry in Entry.objects.select_related('project', 'author').order_by('project_id', 'id'):
                project = entry.project
                if not project:
                    continue
                if project.memberships.filter(role=ProjectMembership.Role.OWNER).exists():
                    continue
                author = entry.author
                if author:
                    membership, was_created = project.memberships.get_or_create(
                        user=author,
                        defaults={'role': ProjectMembership.Role.OWNER},
                    )
                    if was_created:
                        created += 1
                        self.stdout.write(f'Assigned owner role to {author} for project {project.id}')
        self.stdout.write(self.style.SUCCESS(f'Owner memberships created: {created}'))
