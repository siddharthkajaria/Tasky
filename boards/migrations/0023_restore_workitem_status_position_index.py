from django.db import migrations, models


class Migration(migrations.Migration):
    """0022 dropped the old `status` CharField with a bare RemoveField, and
    only afterward renamed the FK column into place and renamed the index's
    Django-state name to match. Renaming an index doesn't rebuild it: on
    this MySQL backend, dropping a column that's part of a multi-column
    index silently rewrites that index down to whatever columns are left,
    rather than failing — so the composite (board, status, position) index
    silently became a 2-column (board, position) index the moment the old
    `status` column was dropped, even though Django's migration state (and
    WorkItem.Meta.indexes in boards/models.py) still believes it covers all
    3 columns.

    Fix: explicitly drop the now-wrong index and re-add it under the same
    name. Since the model's index declaration hasn't changed, this doesn't
    move Django's state at all — it just makes Django re-issue a real
    CREATE INDEX against the columns as they exist NOW (status_id, the FK
    column, instead of the long-gone status CharField), so the actual
    database index finally matches what the model has claimed all along.
    """

    dependencies = [
        ('boards', '0022_workitem_status_required'),
    ]

    operations = [
        migrations.RemoveIndex(
            model_name='workitem',
            name='boards_work_board_i_c0f40d_idx',
        ),
        migrations.AddIndex(
            model_name='workitem',
            index=models.Index(fields=['board', 'status', 'position'], name='boards_work_board_i_c0f40d_idx'),
        ),
    ]
