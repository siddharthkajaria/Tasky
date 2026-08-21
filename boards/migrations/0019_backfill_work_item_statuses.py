from django.db import migrations

DEFAULTS = [("To Do", "todo", 0), ("In Progress", "in_progress", 1), ("Done", "done", 2)]


def seed_existing_projects(apps, schema_editor):
    Project = apps.get_model("projects", "Project")
    WorkItemStatus = apps.get_model("boards", "WorkItemStatus")

    for project in Project.objects.all():
        if WorkItemStatus.objects.filter(project=project).exists():
            continue
        WorkItemStatus.objects.bulk_create(
            WorkItemStatus(project=project, name=name, category=category, position=position)
            for name, category, position in DEFAULTS
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("boards", "0018_work_item_status"),
        ("projects", "0002_project_next_item_number"),
    ]
    operations = [
        migrations.RunPython(seed_existing_projects, noop_reverse),
    ]
