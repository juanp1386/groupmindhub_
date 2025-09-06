from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Project',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('description', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.CreateModel(
            name='Entry',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=200)),
                ('content', models.TextField(blank=True)),
                ('status', models.CharField(default='draft', max_length=20)),
                ('is_fork', models.BooleanField(default=False)),
                ('entry_version_int', models.PositiveIntegerField(default=1)),
                ('votes_cache_int', models.IntegerField(default=0)),
                ('published_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('author', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='entries', to='core.project')),
            ],
        ),
        migrations.CreateModel(
            name='Patch',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('summary', models.CharField(max_length=300)),
                ('ops_json', models.JSONField(blank=True, default=list)),
                ('affected_blocks', models.JSONField(blank=True, default=list)),
                ('anchors', models.JSONField(blank=True, default=list)),
                ('before_outline', models.TextField(blank=True)),
                ('after_outline', models.TextField(blank=True)),
                ('base_entry_version_int', models.PositiveIntegerField(default=1)),
                ('status', models.CharField(default='draft', max_length=20)),
                ('votes_cache_int', models.IntegerField(default=0)),
                ('overlaps', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('published_at', models.DateTimeField(blank=True, null=True)),
                ('merged_at', models.DateTimeField(blank=True, null=True)),
                ('closes_at', models.DateTimeField(blank=True, null=True)),
                ('author', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='patches', to='core.project')),
                ('target_entry', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='patches', to='core.entry')),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='Block',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('stable_id', models.CharField(db_index=True, max_length=100)),
                ('type', models.CharField(choices=[('h2', 'Heading2'), ('p', 'Paragraph')], max_length=10)),
                ('text', models.TextField()),
                ('parent_stable_id', models.CharField(blank=True, max_length=100, null=True)),
                ('position', models.FloatField(db_index=True, default=0)),
                ('entry', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='blocks', to='core.entry')),
            ],
            options={'ordering': ['position', 'id']},
        ),
        migrations.CreateModel(
            name='Vote',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('target_type', models.CharField(max_length=20)),
                ('target_id', models.PositiveIntegerField()),
                ('value', models.SmallIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AlterUniqueTogether(
            name='vote',
            unique_together={('user', 'target_type', 'target_id')},
        ),
        migrations.AlterUniqueTogether(
            name='block',
            unique_together={('entry', 'stable_id')},
        ),
    ]
