import io

import pytest

from boards.models import Board, Component, Label, WorkItem, WorkItemStatus
from boards.services import seed_default_statuses


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


def csv_file(text):
    return io.BytesIO(text.encode("utf-8"))


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client, board):
    response = client.post(f"/api/boards/{board.id}/import/", {"csv": csv_file("title\nX")}, format="multipart")
    assert response.status_code == 403


@pytest.mark.django_db
def test_a_minimal_csv_creates_work_items_with_defaults(auth_client, project, board):
    response = auth_client.post(
        f"/api/boards/{board.id}/import/",
        {"csv": csv_file("title\nFirst item\nSecond item")},
        format="multipart",
    )
    assert response.status_code == 200
    body = response.json()
    assert body["imported"] == 2
    assert body["failed"] == []
    items = WorkItem.objects.filter(board=board).order_by("id")
    assert [i.title for i in items] == ["First item", "Second item"]
    assert all(i.item_type == "task" for i in items)
    assert all(i.priority == 2 for i in items)
    default_status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    assert all(i.status_id == default_status.id for i in items)


@pytest.mark.django_db
def test_every_optional_column_is_honored(auth_client, project, board, user):
    # A project created directly via the ORM (like the `project` fixture)
    # has no statuses until something seeds them — the import endpoint
    # itself would lazily seed a `todo` status on first use, but this test
    # needs an `in_progress` status to already exist before it ever calls
    # the endpoint, so it seeds explicitly, matching the `seed_default_statuses`
    # fixture pattern used across the rest of this test suite (see e.g.
    # boards/tests/test_work_item_api.py).
    seed_default_statuses(project)
    status = WorkItemStatus.objects.filter(project=project, category="in_progress").first()
    Component.objects.create(project=project, name="Backend")
    csv = (
        "title,item_type,description,status,priority,assignee,due_date,labels,components\n"
        f"Fix it,bug,A description,{status.name},high,{user.username},2026-09-01,urgent;needs-design,Backend"
    )
    response = auth_client.post(f"/api/boards/{board.id}/import/", {"csv": csv_file(csv)}, format="multipart")
    assert response.status_code == 200
    assert response.json()["imported"] == 1
    item = WorkItem.objects.get(board=board, title="Fix it")
    assert item.item_type == "bug"
    assert item.description == "A description"
    assert item.status_id == status.id
    assert item.priority == 3
    assert item.assignee_id == user.id
    assert str(item.due_date) == "2026-09-01"
    assert set(item.labels.values_list("name", flat=True)) == {"urgent", "needs-design"}
    assert set(item.components.values_list("name", flat=True)) == {"Backend"}
    assert Label.objects.filter(name="urgent").exists()


@pytest.mark.django_db
def test_a_blank_title_row_fails_without_blocking_the_rest(auth_client, board):
    csv = "title\n\nValid title"
    response = auth_client.post(f"/api/boards/{board.id}/import/", {"csv": csv_file(csv)}, format="multipart")
    assert response.status_code == 200
    body = response.json()
    assert body["imported"] == 1
    assert body["failed"] == [{"row": 2, "title": None, "error": "Title is required."}]
    assert WorkItem.objects.filter(board=board, title="Valid title").exists()


@pytest.mark.django_db
def test_a_subtask_row_is_rejected(auth_client, board):
    csv = "title,item_type\nNeeds a parent,subtask"
    response = auth_client.post(f"/api/boards/{board.id}/import/", {"csv": csv_file(csv)}, format="multipart")
    assert response.status_code == 200
    body = response.json()
    assert body["imported"] == 0
    assert body["failed"][0]["error"] == "Subtasks cannot be imported (need a parent)."


@pytest.mark.django_db
@pytest.mark.parametrize(
    "column,value,expected_error",
    [
        ("status", "Nonexistent Status", 'Status "Nonexistent Status" not found.'),
        ("priority", "urgent", 'Invalid priority "urgent".'),
        ("assignee", "nobody", 'User "nobody" not found.'),
        ("due_date", "09-01-2026", 'Invalid due_date "09-01-2026".'),
        # Shape-valid (matches YYYY-MM-DD) but not a real calendar date —
        # regressed a crash where WorkItem.objects.create() let Django's
        # DateField raise its own uncaught (non-DRF) ValidationError while
        # preparing the INSERT instead of this cleanly failing the row.
        ("due_date", "2026-13-01", 'Invalid due_date "2026-13-01".'),
        ("components", "Nonexistent Component", 'Component "Nonexistent Component" not found.'),
    ],
)
def test_each_optional_columns_bad_value_fails_that_row_only(auth_client, board, column, value, expected_error):
    csv = f"title,{column}\nRow one,{value}\nRow two,"
    response = auth_client.post(f"/api/boards/{board.id}/import/", {"csv": csv_file(csv)}, format="multipart")
    assert response.status_code == 200
    body = response.json()
    assert body["imported"] == 1
    assert body["failed"] == [{"row": 2, "title": "Row one", "error": expected_error}]


@pytest.mark.django_db
def test_a_non_utf8_file_rejects_the_whole_file_cleanly(auth_client, board):
    # A CSV saved by Excel as Windows-1252 (or any non-UTF-8 encoding) must
    # 400 as a whole-file problem, not crash with an uncaught
    # UnicodeDecodeError.
    non_utf8 = "title\nCafé".encode("latin-1")
    response = auth_client.post(
        f"/api/boards/{board.id}/import/", {"csv": io.BytesIO(non_utf8)}, format="multipart"
    )
    assert response.status_code == 400
    assert not WorkItem.objects.filter(board=board).exists()


@pytest.mark.django_db
def test_missing_title_header_rejects_the_whole_file(auth_client, board):
    csv = "description\nNo title column"
    response = auth_client.post(f"/api/boards/{board.id}/import/", {"csv": csv_file(csv)}, format="multipart")
    assert response.status_code == 400
    assert not WorkItem.objects.filter(board=board).exists()


@pytest.mark.django_db
def test_over_500_rows_rejects_the_whole_file(auth_client, board):
    csv = "title\n" + "\n".join(f"Item {i}" for i in range(501))
    response = auth_client.post(f"/api/boards/{board.id}/import/", {"csv": csv_file(csv)}, format="multipart")
    assert response.status_code == 400
    assert not WorkItem.objects.filter(board=board).exists()


@pytest.mark.django_db
def test_a_non_member_is_rejected(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    board = Board.objects.create(name="B", created_by=other_user, project=foreign)

    response = auth_client.post(f"/api/boards/{board.id}/import/", {"csv": csv_file("title\nX")}, format="multipart")
    assert response.status_code == 403


@pytest.mark.django_db
def test_imported_items_get_sequential_keys_same_as_normal_creation(auth_client, project, board):
    response = auth_client.post(
        f"/api/boards/{board.id}/import/", {"csv": csv_file("title\nA\nB\nC")}, format="multipart"
    )
    assert response.status_code == 200
    keys = list(WorkItem.objects.filter(board=board).order_by("id").values_list("key", flat=True))
    assert len(set(keys)) == 3
    assert all(k.startswith(f"{project.key}-") for k in keys)


@pytest.mark.django_db
def test_imported_items_append_to_the_end_of_their_column_not_position_zero(auth_client, project, board):
    # Regression: import_work_items_from_csv's WorkItem.objects.create() must
    # pass position=next_position(...), same as WorkItemViewSet.perform_create
    # does for every other creation path. Without it, every imported row lands
    # at the model field's default position=0 and WorkItem.Meta.ordering =
    # ["position", "id"] sorts freshly-imported rows AHEAD of whatever was
    # already in that column, instead of appending after it.
    seed_default_statuses(project)
    default_status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    pre_existing = WorkItem.objects.create(
        board=board, title="Pre-existing", status=default_status, created_by=None
    )
    assert pre_existing.position == 0

    response = auth_client.post(
        f"/api/boards/{board.id}/import/", {"csv": csv_file("title\nA\nB")}, format="multipart"
    )
    assert response.status_code == 200
    assert response.json()["imported"] == 2

    ordered = list(
        WorkItem.objects.filter(board=board, status=default_status).order_by("position", "id")
    )
    assert [i.title for i in ordered] == ["Pre-existing", "A", "B"]
    assert [i.position for i in ordered] == [0, 1, 2]
