import datetime

import pytest

from boards.models import Board, WorkItem
from boards.services import seed_default_statuses


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def statuses(project):
    return seed_default_statuses(project)


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client):
    assert client.get("/api/me/tasks/").status_code == 403


@pytest.mark.django_db
def test_only_my_work_items_come_back(auth_client, board, user, other_user):
    WorkItem.objects.create(board=board, title="Mine", assignee=user)
    WorkItem.objects.create(board=board, title="Theirs", assignee=other_user)
    WorkItem.objects.create(board=board, title="Nobody's")

    response = auth_client.get("/api/me/tasks/")

    assert response.status_code == 200
    assert [item["title"] for item in response.json()] == ["Mine"]


@pytest.mark.django_db
def test_my_work_items_span_every_board(auth_client, board, user, project):
    second_board = Board.objects.create(name="Second", created_by=user, project=project)
    WorkItem.objects.create(board=board, title="From board one", assignee=user)
    WorkItem.objects.create(board=second_board, title="From board two", assignee=user)

    response = auth_client.get("/api/me/tasks/")

    assert {item["title"] for item in response.json()} == {
        "From board one",
        "From board two",
    }


@pytest.mark.django_db
def test_soonest_due_first_with_undated_items_last(auth_client, board, user):
    WorkItem.objects.create(board=board, title="No date", assignee=user)
    WorkItem.objects.create(
        board=board, title="Later", assignee=user, due_date=datetime.date(2026, 9, 1)
    )
    WorkItem.objects.create(
        board=board, title="Sooner", assignee=user, due_date=datetime.date(2026, 8, 1)
    )

    response = auth_client.get("/api/me/tasks/")

    assert [item["title"] for item in response.json()] == ["Sooner", "Later", "No date"]


@pytest.mark.django_db
def test_undated_items_break_ties_on_priority(auth_client, board, user):
    WorkItem.objects.create(board=board, title="Low", assignee=user, priority=1)
    WorkItem.objects.create(board=board, title="High", assignee=user, priority=3)

    response = auth_client.get("/api/me/tasks/")

    assert [item["title"] for item in response.json()] == ["High", "Low"]


@pytest.mark.django_db
def test_finished_items_are_excluded(auth_client, board, user, statuses):
    WorkItem.objects.create(board=board, title="Still going", assignee=user, status=statuses["todo"])
    WorkItem.objects.create(board=board, title="Finished", assignee=user, status=statuses["done"])

    response = auth_client.get("/api/me/tasks/")

    assert [item["title"] for item in response.json()] == ["Still going"]
