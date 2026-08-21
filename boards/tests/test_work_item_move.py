import pytest

from boards.models import Board, WorkItem
from boards.services import move_work_item, seed_default_statuses
from boards.views import WorkItemViewSet


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def statuses(project):
    return seed_default_statuses(project)


@pytest.fixture
def todo_items(board, statuses):
    return [
        WorkItem.objects.create(board=board, title=title, status=statuses["todo"], position=index)
        for index, title in enumerate(["A", "B", "C"])
    ]


def titles_in(board, status):
    return [
        item.title
        for item in WorkItem.objects.filter(board=board, status=status).order_by(
            "position", "id"
        )
    ]


@pytest.mark.django_db
def test_moving_a_work_item_up_within_its_column(auth_client, board, todo_items, statuses):
    item_c = todo_items[2]
    original_updated_at = item_c.updated_at

    response = auth_client.post(
        f"/api/work-items/{item_c.id}/move/",
        {"status": statuses["todo"].id, "position": 0},
        content_type="application/json",
    )

    assert response.status_code == 200
    assert titles_in(board, statuses["todo"]) == ["C", "A", "B"]

    item_c.refresh_from_db()
    assert item_c.updated_at > original_updated_at


@pytest.mark.django_db
def test_moving_a_work_item_down_within_its_column(auth_client, board, todo_items, statuses):
    item_a = todo_items[0]

    auth_client.post(
        f"/api/work-items/{item_a.id}/move/",
        {"status": statuses["todo"].id, "position": 2},
        content_type="application/json",
    )

    assert titles_in(board, statuses["todo"]) == ["B", "C", "A"]


@pytest.mark.django_db
def test_moving_a_work_item_to_another_column(auth_client, board, todo_items, statuses):
    item_b = todo_items[1]

    response = auth_client.post(
        f"/api/work-items/{item_b.id}/move/",
        {"status": statuses["in_progress"].id, "position": 0},
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json()["status"] == statuses["in_progress"].id
    assert titles_in(board, statuses["todo"]) == ["A", "C"]
    assert titles_in(board, statuses["in_progress"]) == ["B"]

    item_b.refresh_from_db()
    assert item_b.position == 0


@pytest.mark.django_db
def test_the_source_column_closes_its_gap(auth_client, board, todo_items, statuses):
    auth_client.post(
        f"/api/work-items/{todo_items[0].id}/move/",
        {"status": statuses["done"].id, "position": 0},
        content_type="application/json",
    )

    remaining = WorkItem.objects.filter(board=board, status=statuses["todo"]).order_by("position")
    assert [item.position for item in remaining] == [0, 1]


@pytest.mark.django_db
def test_dropping_into_the_middle_of_a_populated_column(auth_client, board, todo_items, statuses):
    WorkItem.objects.create(board=board, title="X", status=statuses["done"], position=0)
    WorkItem.objects.create(board=board, title="Y", status=statuses["done"], position=1)

    auth_client.post(
        f"/api/work-items/{todo_items[0].id}/move/",
        {"status": statuses["done"].id, "position": 1},
        content_type="application/json",
    )

    assert titles_in(board, statuses["done"]) == ["X", "A", "Y"]


@pytest.mark.django_db
def test_an_oversized_position_lands_at_the_end(auth_client, board, todo_items, statuses):
    auth_client.post(
        f"/api/work-items/{todo_items[0].id}/move/",
        {"status": statuses["todo"].id, "position": 999},
        content_type="application/json",
    )

    assert titles_in(board, statuses["todo"]) == ["B", "C", "A"]


@pytest.mark.django_db
def test_positions_stay_contiguous_from_zero(auth_client, board, todo_items, statuses):
    auth_client.post(
        f"/api/work-items/{todo_items[1].id}/move/",
        {"status": statuses["todo"].id, "position": 0},
        content_type="application/json",
    )

    positions = list(
        WorkItem.objects.filter(board=board, status=statuses["todo"])
        .order_by("position")
        .values_list("position", flat=True)
    )
    assert positions == [0, 1, 2]


@pytest.mark.django_db
def test_a_move_never_touches_another_board(auth_client, board, todo_items, user, project, statuses):
    other_board = Board.objects.create(name="Elsewhere", created_by=user, project=project)
    untouched = WorkItem.objects.create(
        board=other_board, title="Untouched", status=statuses["todo"], position=7
    )

    auth_client.post(
        f"/api/work-items/{todo_items[0].id}/move/",
        {"status": statuses["todo"].id, "position": 2},
        content_type="application/json",
    )

    untouched.refresh_from_db()
    assert untouched.position == 7


@pytest.mark.django_db
def test_an_unknown_status_is_rejected(auth_client, board, todo_items, statuses):
    response = auth_client.post(
        f"/api/work-items/{todo_items[0].id}/move/",
        {"status": 999999, "position": 0},
        content_type="application/json",
    )
    assert response.status_code == 400

    unchanged = list(
        WorkItem.objects.filter(board=board, status=statuses["todo"])
        .order_by("position")
        .values_list("title", "position")
    )
    assert unchanged == [("A", 0), ("B", 1), ("C", 2)]


@pytest.mark.django_db
def test_a_negative_position_is_rejected(auth_client, board, todo_items, statuses):
    response = auth_client.post(
        f"/api/work-items/{todo_items[0].id}/move/",
        {"status": statuses["todo"].id, "position": -1},
        content_type="application/json",
    )
    assert response.status_code == 400

    unchanged = list(
        WorkItem.objects.filter(board=board, status=statuses["todo"])
        .order_by("position")
        .values_list("title", "position")
    )
    assert unchanged == [("A", 0), ("B", 1), ("C", 2)]


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client, board, todo_items, statuses):
    response = client.post(
        f"/api/work-items/{todo_items[0].id}/move/",
        {"status": statuses["done"].id, "position": 0},
        content_type="application/json",
    )
    assert response.status_code == 403

    unchanged = list(
        WorkItem.objects.filter(board=board, status=statuses["todo"])
        .order_by("position")
        .values_list("title", "position")
    )
    assert unchanged == [("A", 0), ("B", 1), ("C", 2)]
    assert not WorkItem.objects.filter(board=board, status=statuses["done"]).exists()


@pytest.mark.django_db
def test_move_work_item_raises_when_the_row_was_deleted_after_it_was_fetched(
    board, todo_items, statuses
):
    """Direct service-level test of the Finding-1 race: the view's get_object()
    is unlocked, so by the time move_work_item() takes its row lock, another
    request may already have deleted the item. old_status_id must never be
    trusted from the stale in-memory instance, and the vanished row must not
    be reinserted as a ghost that shifts every real item in the destination
    column."""
    item = todo_items[0]
    WorkItem.objects.filter(pk=item.pk).delete()

    with pytest.raises(WorkItem.DoesNotExist):
        move_work_item(item, statuses["done"].id, 0)


@pytest.mark.django_db
def test_moving_a_work_item_deleted_after_it_was_fetched_returns_404(
    auth_client, board, todo_items, statuses, monkeypatch
):
    """Same race, exercised through the HTTP endpoint. get_object() is patched
    to return a stale WorkItem instance for a row that has since been
    deleted — standing in for a second request winning the race between this
    request's get_object() and its row lock. The endpoint must surface this
    as 404 (not 500), and it must not touch any other item on the board."""
    item = todo_items[0]
    WorkItem.objects.filter(pk=item.pk).delete()
    monkeypatch.setattr(WorkItemViewSet, "get_object", lambda self: item)

    response = auth_client.post(
        f"/api/work-items/{item.id}/move/",
        {"status": statuses["done"].id, "position": 0},
        content_type="application/json",
    )

    assert response.status_code == 404
    remaining = list(
        WorkItem.objects.filter(board=board, status=statuses["todo"])
        .order_by("position")
        .values_list("title", "position")
    )
    assert remaining == [("B", 1), ("C", 2)]
