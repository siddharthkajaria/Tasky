import io
from unittest import mock

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection

from boards.models import Board, WorkItem


@pytest.mark.django_db
def test_seed_creates_boards_users_and_work_items():
    call_command("seed_demo")

    assert Board.objects.count() == 2
    assert WorkItem.objects.count() >= 8
    assert get_user_model().objects.filter(is_active=True).count() >= 3


@pytest.mark.django_db
def test_seed_fills_every_column():
    call_command("seed_demo")

    for category in ["todo", "in_progress", "done"]:
        assert WorkItem.objects.filter(status__category=category).exists()


@pytest.mark.django_db
def test_seed_is_safe_to_run_twice():
    call_command("seed_demo")
    call_command("seed_demo")

    assert Board.objects.count() == 2


@pytest.mark.django_db
def test_seeded_positions_are_contiguous_within_each_column():
    call_command("seed_demo")

    for board in Board.objects.all():
        for category in ["todo", "in_progress", "done"]:
            positions = list(
                WorkItem.objects.filter(board=board, status__category=category)
                .order_by("position")
                .values_list("position", flat=True)
            )
            assert positions == list(range(len(positions)))


@pytest.mark.django_db
def test_seed_warns_which_database_it_is_about_to_write_to():
    out = io.StringIO()
    call_command("seed_demo", stdout=out)

    output = out.getvalue()
    assert connection.settings_dict["NAME"] in output
    assert "NEVER" in output
    assert "production" in output.lower()


@pytest.mark.django_db
def test_seed_refuses_a_non_local_database_host():
    """seed_demo creates accounts whose password is committed to this repo, so
    pointing it at anything that is not obviously a throwaway local database
    must fail loudly rather than warn."""
    from django.db import connection

    with mock.patch.dict(
        connection.settings_dict, {"HOST": "tasky.abc123.ap-south-1.rds.amazonaws.com"}
    ):
        with pytest.raises(CommandError, match="does not look like a local development database"):
            call_command("seed_demo")

    assert not get_user_model().objects.filter(username="asha").exists()


@pytest.mark.django_db
def test_seed_force_overrides_the_non_local_guard():
    from django.db import connection

    with mock.patch.dict(
        connection.settings_dict, {"HOST": "tasky.abc123.ap-south-1.rds.amazonaws.com"}
    ):
        call_command("seed_demo", force=True)

    assert get_user_model().objects.filter(username="asha").exists()

