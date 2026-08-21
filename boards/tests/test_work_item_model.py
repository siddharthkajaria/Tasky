import datetime

import pytest

from boards.models import Board, WorkItem
from boards.services import next_position, seed_default_statuses


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def statuses(project):
    return seed_default_statuses(project)


@pytest.mark.django_db
def test_work_item_defaults(board, statuses):
    item = WorkItem.objects.create(board=board, title="Write the spec")

    assert item.status_id == statuses["todo"].id
    assert item.priority == WorkItem.Priority.MEDIUM
    assert item.due_date is None
    assert item.assignee is None
    assert item.description == ""


@pytest.mark.django_db
def test_work_item_stringifies_to_its_title(board):
    assert str(WorkItem.objects.create(board=board, title="Ship it")) == "Ship it"


@pytest.mark.django_db
def test_next_position_starts_at_zero(board, statuses):
    assert next_position(board.id, statuses["todo"].id) == 0


@pytest.mark.django_db
def test_next_position_appends_to_the_end_of_its_column(board, statuses):
    WorkItem.objects.create(board=board, title="A", status=statuses["todo"], position=0)
    WorkItem.objects.create(board=board, title="B", status=statuses["todo"], position=1)

    assert next_position(board.id, statuses["todo"].id) == 2


@pytest.mark.django_db
def test_next_position_counts_each_column_separately(board, statuses):
    WorkItem.objects.create(board=board, title="A", status=statuses["todo"], position=0)
    WorkItem.objects.create(board=board, title="B", status=statuses["todo"], position=1)

    assert next_position(board.id, statuses["done"].id) == 0


@pytest.mark.django_db
def test_work_items_are_ordered_by_position_within_a_column(board, statuses):
    second = WorkItem.objects.create(board=board, title="Second", status=statuses["todo"], position=1)
    first = WorkItem.objects.create(board=board, title="First", status=statuses["todo"], position=0)

    assert list(WorkItem.objects.filter(status=statuses["todo"])) == [first, second]


@pytest.mark.django_db
def test_deleting_a_board_deletes_its_work_items(board):
    WorkItem.objects.create(board=board, title="Doomed")
    board.delete()
    assert WorkItem.objects.count() == 0


@pytest.mark.django_db
def test_unassigning_happens_when_the_assignee_is_deleted(board, other_user):
    item = WorkItem.objects.create(board=board, title="Orphan", assignee=other_user)
    other_user.delete()
    item.refresh_from_db()
    assert item.assignee is None


@pytest.mark.django_db
def test_due_date_can_be_set(board):
    item = WorkItem.objects.create(
        board=board, title="Dated", due_date=datetime.date(2026, 8, 15)
    )
    assert item.due_date == datetime.date(2026, 8, 15)
