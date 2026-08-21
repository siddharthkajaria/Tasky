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
def test_anonymous_callers_are_rejected(client, board):
    assert client.get(f"/api/boards/{board.id}/work-items/").status_code == 403


@pytest.mark.django_db
def test_listing_a_boards_work_items(auth_client, board, user, project):
    WorkItem.objects.create(board=board, title="First", position=0)
    WorkItem.objects.create(board=board, title="Second", position=1)
    other_board = Board.objects.create(name="Elsewhere", created_by=user, project=project)
    WorkItem.objects.create(board=other_board, title="Not mine")

    response = auth_client.get(f"/api/boards/{board.id}/work-items/")

    assert response.status_code == 200
    assert [item["title"] for item in response.json()] == ["First", "Second"]


@pytest.mark.django_db
def test_creating_a_work_item_sets_creator_and_appends_it(auth_client, board, user, statuses):
    WorkItem.objects.create(board=board, title="Existing", status=statuses["todo"], position=0)

    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "New item"},
        content_type="application/json",
    )

    assert response.status_code == 201
    body = response.json()
    assert body["position"] == 1
    assert body["status_detail"]["category"] == "todo"
    assert body["priority"] == 2
    assert body["priority_label"] == "Medium"
    assert WorkItem.objects.get(title="New item").created_by == user


@pytest.mark.django_db
def test_creating_a_work_item_with_an_assignee_and_a_due_date(auth_client, board, other_user):
    response = auth_client.post(
        "/api/work-items/",
        {
            "board": board.id,
            "title": "Assigned",
            "assignee": other_user.id,
            "due_date": "2026-08-15",
            "priority": 3,
        },
        content_type="application/json",
    )

    assert response.status_code == 201
    body = response.json()
    assert body["assignee_detail"]["username"] == "bob"
    assert body["due_date"] == "2026-08-15"
    assert body["priority_label"] == "High"


@pytest.mark.django_db
def test_editing_a_work_item(auth_client, board):
    item = WorkItem.objects.create(board=board, title="Before")

    response = auth_client.patch(
        f"/api/work-items/{item.id}/",
        {"title": "After", "description": "Now with detail"},
        content_type="application/json",
    )

    assert response.status_code == 200
    item.refresh_from_db()
    assert item.title == "After"
    assert item.description == "Now with detail"


@pytest.mark.django_db
def test_unassigning_a_work_item(auth_client, board, other_user):
    item = WorkItem.objects.create(board=board, title="Assigned", assignee=other_user)

    response = auth_client.patch(
        f"/api/work-items/{item.id}/",
        {"assignee": None},
        content_type="application/json",
    )

    assert response.status_code == 200
    item.refresh_from_db()
    assert item.assignee is None


@pytest.mark.django_db
def test_listing_all_work_items_is_unscoped_by_board(auth_client, board, user, project):
    other_board = Board.objects.create(name="Elsewhere", created_by=user, project=project)
    WorkItem.objects.create(board=board, title="Mine", position=0)
    WorkItem.objects.create(board=other_board, title="Also visible", position=0)

    response = auth_client.get("/api/work-items/")

    assert response.status_code == 200
    assert {item["title"] for item in response.json()} == {"Mine", "Also visible"}


@pytest.mark.django_db
def test_retrieving_a_single_work_item(auth_client, board):
    item = WorkItem.objects.create(board=board, title="One item", position=0)

    response = auth_client.get(f"/api/work-items/{item.id}/")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == item.id
    assert body["title"] == "One item"


@pytest.mark.django_db
def test_deleting_a_work_item(auth_client, board):
    item = WorkItem.objects.create(board=board, title="Doomed")
    assert auth_client.delete(f"/api/work-items/{item.id}/").status_code == 204
    assert not WorkItem.objects.filter(id=item.id).exists()


@pytest.mark.django_db
def test_position_cannot_be_set_directly(auth_client, board):
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "Sneaky", "position": 99},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json()["position"] == 0


@pytest.mark.django_db
def test_title_is_required(auth_client, board):
    response = auth_client.post(
        "/api/work-items/", {"board": board.id}, content_type="application/json"
    )
    assert response.status_code == 400
    assert "title" in response.json()


@pytest.mark.django_db
def test_patching_status_is_rejected(auth_client, board, statuses):
    item = WorkItem.objects.create(board=board, title="Untouched", status=statuses["todo"])

    response = auth_client.patch(
        f"/api/work-items/{item.id}/",
        {"status": statuses["done"].id},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert "status" in response.json()
    item.refresh_from_db()
    assert item.status_id == statuses["todo"].id


@pytest.mark.django_db
def test_patching_with_status_unchanged_still_updates_other_fields(auth_client, board, statuses):
    """A UI that PATCHes back the full set of fields it's holding — status
    included, but unchanged — must not have a genuine edit (title, here)
    rejected just because "status" was present in the body. Only an actual
    status CHANGE is rejected."""
    item = WorkItem.objects.create(board=board, title="Before", status=statuses["todo"])

    response = auth_client.patch(
        f"/api/work-items/{item.id}/",
        {"status": statuses["todo"].id, "title": "After"},
        content_type="application/json",
    )

    assert response.status_code == 200
    item.refresh_from_db()
    assert item.title == "After"
    assert item.status_id == statuses["todo"].id


@pytest.mark.django_db
def test_patching_title_still_works(auth_client, board, statuses):
    item = WorkItem.objects.create(board=board, title="Before", status=statuses["todo"])

    response = auth_client.patch(
        f"/api/work-items/{item.id}/",
        {"title": "After"},
        content_type="application/json",
    )

    assert response.status_code == 200
    item.refresh_from_db()
    assert item.title == "After"
    assert item.status_id == statuses["todo"].id


@pytest.mark.django_db
def test_patching_board_is_rejected(auth_client, board, user, project, statuses):
    other_board = Board.objects.create(name="Elsewhere", created_by=user, project=project)
    item = WorkItem.objects.create(board=board, title="Untouched", status=statuses["todo"])

    response = auth_client.patch(
        f"/api/work-items/{item.id}/",
        {"board": other_board.id},
        content_type="application/json",
    )

    assert response.status_code == 400
    assert "board" in response.json()
    item.refresh_from_db()
    assert item.board_id == board.id


@pytest.mark.django_db
def test_patching_with_board_unchanged_still_updates_other_fields(auth_client, board, statuses):
    """Same protection as status: a PATCH that echoes back the item's
    current, unchanged board alongside a genuine edit (title, here) must
    not be rejected just because "board" was present in the body."""
    item = WorkItem.objects.create(board=board, title="Before", status=statuses["todo"])

    response = auth_client.patch(
        f"/api/work-items/{item.id}/",
        {"board": board.id, "title": "After"},
        content_type="application/json",
    )

    assert response.status_code == 200
    item.refresh_from_db()
    assert item.title == "After"
    assert item.board_id == board.id
