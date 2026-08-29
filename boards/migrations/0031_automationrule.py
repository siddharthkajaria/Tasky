import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("projects", "0003_project_archiving"),
        ("boards", "0030_attachment"),
    ]

    operations = [
        migrations.CreateModel(
            name="AutomationRule",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120)),
                (
                    "trigger_type",
                    models.CharField(
                        choices=[("work_item_created", "Work item created"), ("status_changed", "Status changed")],
                        max_length=30,
                    ),
                ),
                ("trigger_filter", models.JSONField(blank=True, default=dict)),
                (
                    "action_type",
                    models.CharField(
                        choices=[
                            ("set_assignee", "Set assignee"),
                            ("apply_label", "Apply label"),
                            ("remove_label", "Remove label"),
                            ("change_status", "Change status"),
                        ],
                        max_length=30,
                    ),
                ),
                ("action_config", models.JSONField(blank=True, default=dict)),
                ("position", models.PositiveIntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="automation_rules_created",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="automation_rules",
                        to="projects.project",
                    ),
                ),
            ],
            options={"ordering": ["position", "id"]},
        ),
    ]
