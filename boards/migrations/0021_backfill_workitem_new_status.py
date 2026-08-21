from django.db import migrations


def backfill_new_status(apps, schema_editor):
    WorkItem = apps.get_model("boards", "WorkItem")
    WorkItemStatus = apps.get_model("boards", "WorkItemStatus")

    # Every project already has exactly one status per category at this
    # point (Task 1's 0019 backfill guarantees it, and no project can have
    # picked up a second same-category status yet — the API this migration
    # predates hasn't shipped), so matching on (project, category) is
    # unambiguous here even though it would not be once customization exists.
    #
    # Collected into a list up front, not re-queried inside bulk_update:
    # bulk_update() takes the exact Python objects you pass it and writes
    # whatever attributes are currently set on them — it never re-fetches.
    # Building a fresh queryset there instead of reusing `items` would hand
    # bulk_update a set of objects that never had new_status_id set at all.
    items = list(WorkItem.objects.select_related("board").all())
    for item in items:
        status = WorkItemStatus.objects.get(
            project_id=item.board.project_id, category=item.status
        )
        item.new_status_id = status.id
    WorkItem.objects.bulk_update(items, ["new_status_id"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("boards", "0020_workitem_new_status"),
        ("boards", "0019_backfill_work_item_statuses"),
    ]
    operations = [
        migrations.RunPython(backfill_new_status, noop_reverse),
    ]
