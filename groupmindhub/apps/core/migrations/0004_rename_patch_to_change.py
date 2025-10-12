from django.db import migrations, models


def migrate_vote_target_types(apps, schema_editor):
    Vote = apps.get_model('core', 'Vote')
    # Update any existing votes that target patches to target changes
    Vote.objects.filter(target_type='patch').update(target_type='change')


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0003_projectstar_section"),
    ]

    operations = [
        migrations.RenameModel(
            old_name="Patch",
            new_name="Change",
        ),
        migrations.RenameField(
            model_name="entryhistory",
            old_name="patch",
            new_name="change",
        ),
        migrations.AddField(
            model_name="change",
            name="target_section_id",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.RunPython(migrate_vote_target_types, reverse_code=migrations.RunPython.noop),
    ]

