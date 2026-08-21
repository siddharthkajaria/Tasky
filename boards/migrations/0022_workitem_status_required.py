import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('boards', '0021_backfill_workitem_new_status'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='workitem',
            name='status',
        ),
        migrations.RenameField(
            model_name='workitem',
            old_name='new_status',
            new_name='status',
        ),
        migrations.RenameIndex(
            model_name='workitem',
            new_name='boards_work_board_i_c0f40d_idx',
            old_name='boards_work_board_i_eecf60_idx',
        ),
        migrations.AlterField(
            model_name='workitem',
            name='status',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='work_items_with_status', to='boards.workitemstatus'),
        ),
    ]
