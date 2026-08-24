# Bulk Operations & Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production Django/DRF backend for Tasky's Bulk Operations & Import feature (sub-project 2c of 13) — best-effort bulk move/update/delete across many work items in one request, and a fixed-column CSV import for a board.

**Architecture:** No new models. Bulk operations are three new collection-level `@action`s on the existing `WorkItemViewSet`, each reusing the same validation the single-item endpoints already enforce (status-belongs-to-project, label get-or-create via `resolve_labels`, component-belongs-to-project) rather than a parallel copy of it. Import is one new `@action` on `BoardViewSet`, building `WorkItem` rows through the same field-by-field validation shape `WorkItemSerializer.create()` already uses, row by row, inside `boards/services.py`.

**Tech Stack:** Django 5.2, DRF 3.16, MySQL, pytest-django. No new dependencies (CSV parsing uses the stdlib `csv` module).

**Spec:** `docs/superpowers/specs/2026-08-24-tasky-bulk-import-design.md` (signed off 2026-08-24; the `design/` prototype it argues from was signed off and built the same day)

## Global Constraints

- **Role vocabulary is `owner` / `admin` / `member`** (lowercase) — unchanged.
- **Unauthenticated request → `403`, never `401`** (existing site-wide convention, unchanged).
- **Best-effort, not all-or-nothing**, for both bulk operations and import. A uniform bad value that would be wrong for every row alike (an unknown `status`/`assignee` id, a `component` from the wrong project, a malformed CSV) rejects the **whole** request with `400` before touching any row. A per-row problem (an id that no longer exists, a bad value in one CSV row) lands that one row/id in the response's `failed` list and the rest of the batch still applies — never a mid-batch abort.
- **Bulk operations never bypass single-item validation.** `bulk-move`'s status must belong to the batch's project exactly like `move_work_item()` already checks; `bulk-update`'s `components_add` must belong to the batch's project exactly like `WorkItemSerializer.validate()` already checks for `components`; `bulk-update`'s `labels_add` resolves through the existing `boards.services.resolve_labels()` (case-insensitive get-or-create), never a second, parallel label-resolution path.
- **`ids` lists cap at 200; CSV import caps at 500 data rows.** Both caps are checked before any row/id is processed — exceeding either is a whole-request `400`, not a truncation.
- **Every id in a bulk request's `ids` must resolve to work items in exactly one project**, and the caller must be a member of that project (`IsProjectMember`, checked via `self.check_object_permissions()` against the resolved `Project` — these are `detail=False` actions, so DRF's automatic dispatch never calls `check_object_permissions` on its own; every existing `detail=False` action in this codebase that needs the object-level check calls it manually, e.g. `ComponentViewSet.initial()`).
- **Import excludes `subtask`** — a Subtask requires a parent and import has no hierarchy-linking pass. A CSV row with `item_type: subtask` is a per-row failure, not a whole-file rejection.
- **Import defaults**: missing `item_type` → `task`; missing `status` → the project's default `todo`-category status (via the existing `resolve_default_status`); missing `priority` → `medium` (`2`).

---

## Task 1: Bulk move, update, delete on `WorkItemViewSet`

**Files:**
- Modify: `boards/views.py`, `boards/urls.py` (none — router-generated, see below)
- Test: `boards/tests/test_bulk_operations.py`

**Interfaces:**
- Consumes: `move_work_item`'s status-validation shape (`boards/services.py`), `resolve_labels(names, user)` (`boards/services.py`, sub-project 4), `WorkItemSerializer.validate()`'s `components`-project-check shape (`boards/serializers.py`).
- Produces: `POST /api/work-items/bulk-move/`, `POST /api/work-items/bulk-update/`, `POST /api/work-items/bulk-delete/`. Task 2 does not depend on this task (import touches `BoardViewSet`, a separate viewset) but should not be dispatched in parallel with it — both touch `boards/views.py`.

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_bulk_operations.py`:

```python
import pytest

from boards.models import Board, Component, Label, WorkItem, WorkItemStatus


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def three_items(board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    return [
        WorkItem.objects.create(board=board, title=f"Item {i}", status=status, created_by=None)
        for i in range(3)
    ]


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client):
    assert client.post("/api/work-items/bulk-move/", {"ids": [1], "status": 1}, content_type="application/json").status_code == 403


@pytest.mark.django_db
def test_bulk_move_moves_every_item_to_the_target_status(auth_client, project, three_items):
    target = WorkItemStatus.objects.filter(project=project, category="done").first()
    ids = [i.id for i in three_items]
    response = auth_client.post(
        "/api/work-items/bulk-move/", {"ids": ids, "status": target.id}, content_type="application/json"
    )
    assert response.status_code == 200
    body = response.json()
    assert sorted(body["succeeded"]) == sorted(ids)
    assert body["failed"] == []
    for item in three_items:
        item.refresh_from_db()
        assert item.status_id == target.id


@pytest.mark.django_db
def test_bulk_move_rejects_a_status_from_another_project(auth_client, project, three_items, user):
    from projects.models import Project, ProjectMembership

    other = Project.objects.create(key="OTHER", name="Elsewhere")
    ProjectMembership.objects.create(project=other, user=user, role="owner")
    foreign_status = WorkItemStatus.objects.create(project=other, name="Doing", category="in_progress", position=0)

    response = auth_client.post(
        "/api/work-items/bulk-move/",
        {"ids": [three_items[0].id], "status": foreign_status.id},
        content_type="application/json",
    )
    assert response.status_code == 400
    three_items[0].refresh_from_db()
    assert three_items[0].status_id != foreign_status.id


@pytest.mark.django_db
def test_an_id_that_no_longer_exists_lands_in_failed_rest_proceeds(auth_client, project, three_items):
    target = WorkItemStatus.objects.filter(project=project, category="done").first()
    ids = [three_items[0].id, three_items[1].id, 999999]
    response = auth_client.post(
        "/api/work-items/bulk-move/", {"ids": ids, "status": target.id}, content_type="application/json"
    )
    assert response.status_code == 200
    body = response.json()
    assert sorted(body["succeeded"]) == sorted(ids[:2])
    assert body["failed"] == [{"id": 999999, "error": "Not found."}]


@pytest.mark.django_db
def test_ids_spanning_two_projects_is_rejected_before_any_write(auth_client, project, three_items, user):
    from projects.models import Project, ProjectMembership

    other = Project.objects.create(key="OTHER", name="Elsewhere")
    ProjectMembership.objects.create(project=other, user=user, role="owner")
    other_board = Board.objects.create(name="Other Board", created_by=user, project=other)
    other_status = WorkItemStatus.objects.filter(project=other, category="todo").first()
    foreign_item = WorkItem.objects.create(board=other_board, title="Foreign", status=other_status, created_by=None)

    target = WorkItemStatus.objects.filter(project=project, category="done").first()
    response = auth_client.post(
        "/api/work-items/bulk-move/",
        {"ids": [three_items[0].id, foreign_item.id], "status": target.id},
        content_type="application/json",
    )
    assert response.status_code == 400
    three_items[0].refresh_from_db()
    assert three_items[0].status_id != target.id


@pytest.mark.django_db
def test_bulk_move_ids_empty_or_over_200_is_rejected(auth_client, project, three_items):
    target = WorkItemStatus.objects.filter(project=project, category="done").first()
    empty = auth_client.post("/api/work-items/bulk-move/", {"ids": [], "status": target.id}, content_type="application/json")
    assert empty.status_code == 400
    too_many = auth_client.post(
        "/api/work-items/bulk-move/", {"ids": list(range(1, 202)), "status": target.id}, content_type="application/json"
    )
    assert too_many.status_code == 400


@pytest.mark.django_db
def test_a_non_member_is_rejected(auth_client, other_user, project, three_items):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    board = Board.objects.create(name="B", created_by=other_user, project=foreign)
    status = WorkItemStatus.objects.filter(project=foreign, category="todo").first()
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)

    response = auth_client.post(
        "/api/work-items/bulk-move/", {"ids": [item.id], "status": status.id}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_bulk_update_sets_assignee_and_priority_on_every_item(auth_client, project, three_items, user):
    ids = [i.id for i in three_items]
    response = auth_client.post(
        "/api/work-items/bulk-update/",
        {"ids": ids, "assignee": user.id, "priority": 3},
        content_type="application/json",
    )
    assert response.status_code == 200
    assert sorted(response.json()["succeeded"]) == sorted(ids)
    for item in three_items:
        item.refresh_from_db()
        assert item.assignee_id == user.id
        assert item.priority == 3


@pytest.mark.django_db
def test_bulk_update_assignee_null_clears_it(auth_client, project, three_items, user):
    three_items[0].assignee = user
    three_items[0].save(update_fields=["assignee"])
    response = auth_client.post(
        "/api/work-items/bulk-update/",
        {"ids": [three_items[0].id], "assignee": None},
        content_type="application/json",
    )
    assert response.status_code == 200
    three_items[0].refresh_from_db()
    assert three_items[0].assignee_id is None


@pytest.mark.django_db
def test_bulk_update_unknown_assignee_rejects_whole_request(auth_client, project, three_items):
    response = auth_client.post(
        "/api/work-items/bulk-update/",
        {"ids": [three_items[0].id], "assignee": 999999},
        content_type="application/json",
    )
    assert response.status_code == 400
    three_items[0].refresh_from_db()
    assert three_items[0].assignee_id is None


@pytest.mark.django_db
def test_bulk_update_labels_add_reuses_existing_and_creates_new(auth_client, project, three_items):
    existing = Label.objects.create(name="urgent", color="#A32218", created_by=None)
    response = auth_client.post(
        "/api/work-items/bulk-update/",
        {"ids": [i.id for i in three_items], "labels_add": ["urgent", "brand-new"]},
        content_type="application/json",
    )
    assert response.status_code == 200
    assert Label.objects.filter(name__iexact="urgent").count() == 1
    for item in three_items:
        item.refresh_from_db()
        names = set(item.labels.values_list("name", flat=True))
        assert names == {"urgent", "brand-new"}
    assert Label.objects.get(name="urgent").id == existing.id


@pytest.mark.django_db
def test_bulk_update_labels_add_is_additive_not_replace(auth_client, project, three_items):
    pre_existing = Label.objects.create(name="keep-me", color="#2E7D5B", created_by=None)
    three_items[0].labels.set([pre_existing])
    response = auth_client.post(
        "/api/work-items/bulk-update/",
        {"ids": [three_items[0].id], "labels_add": ["also-this"]},
        content_type="application/json",
    )
    assert response.status_code == 200
    three_items[0].refresh_from_db()
    names = set(three_items[0].labels.values_list("name", flat=True))
    assert names == {"keep-me", "also-this"}


@pytest.mark.django_db
def test_bulk_update_components_add_rejects_component_from_another_project(auth_client, project, three_items, user):
    from projects.models import Project, ProjectMembership

    other = Project.objects.create(key="OTHER", name="Elsewhere")
    ProjectMembership.objects.create(project=other, user=user, role="owner")
    foreign_component = Component.objects.create(project=other, name="Foreign")

    response = auth_client.post(
        "/api/work-items/bulk-update/",
        {"ids": [three_items[0].id], "components_add": [foreign_component.id]},
        content_type="application/json",
    )
    assert response.status_code == 400
    three_items[0].refresh_from_db()
    assert three_items[0].components.count() == 0


@pytest.mark.django_db
def test_bulk_delete_removes_every_item_and_orphans_children(auth_client, project, board, three_items):
    child = WorkItem.objects.create(
        board=board, title="Child", parent=three_items[0],
        status=three_items[0].status, item_type="subtask", created_by=None,
    )
    response = auth_client.post(
        "/api/work-items/bulk-delete/", {"ids": [three_items[0].id]}, content_type="application/json"
    )
    assert response.status_code == 200
    assert response.json()["deleted"] == [three_items[0].id]
    assert not WorkItem.objects.filter(id=three_items[0].id).exists()
    child.refresh_from_db()
    assert child.parent_id is None
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `docker compose run --rm web pytest boards/tests/test_bulk_operations.py -v`
Expected: FAIL — `404 Not Found` on every request (no `bulk-move`/`bulk-update`/`bulk-delete` routes exist yet).

- [ ] **Step 3: Add the three actions to `WorkItemViewSet`**

In `boards/views.py`, add `from rest_framework.decorators import action` to the existing import (already present), add `resolve_labels` to the `from .services import ...` line, and add these three methods to `WorkItemViewSet` (after `move`):

```python
    def _resolve_batch(self, raw_ids):
        """Returns (existing_items, missing_ids, project) or raises
        ValidationError/PermissionDenied. `existing_items` is a list of
        WorkItem instances found for the given ids; `missing_ids` is
        whatever from `raw_ids` didn't resolve to a real row — these are
        per-id failures, not a whole-request rejection. Every id that DID
        resolve must belong to the same project, checked before returning,
        since that's a uniform-failure case (wrong for the whole request),
        not a per-id one."""
        if not raw_ids or not isinstance(raw_ids, list):
            raise ValidationError({"ids": "Provide a non-empty list of ids."})
        if len(raw_ids) > 200:
            raise ValidationError({"ids": "No more than 200 ids per request."})

        try:
            ids = [int(i) for i in raw_ids]
        except (TypeError, ValueError):
            raise ValidationError({"ids": "Every id must be an integer."})

        existing = list(
            WorkItem.objects.filter(id__in=ids).select_related("board__project")
        )
        if not existing:
            raise ValidationError({"ids": "None of these ids exist."})

        project_ids = {item.board.project_id for item in existing}
        if len(project_ids) > 1:
            raise ValidationError({"ids": "All ids must belong to work items in the same project."})

        project = existing[0].board.project
        self.check_object_permissions(self.request, project)

        found_ids = {item.id for item in existing}
        missing_ids = [i for i in ids if i not in found_ids]
        return existing, missing_ids, project

    @action(detail=False, methods=["post"], url_path="bulk-move")
    def bulk_move(self, request):
        status_id = request.data.get("status")
        items, missing_ids, project = self._resolve_batch(request.data.get("ids"))

        target_status = WorkItemStatus.objects.filter(pk=status_id).first()
        if not target_status or target_status.project_id != project.id:
            raise ValidationError({"status": "Status must belong to this item's project."})

        succeeded = []
        for item in items:
            item.status = target_status
            item.save(update_fields=["status"])
            succeeded.append(item.id)
        failed = [{"id": i, "error": "Not found."} for i in missing_ids]
        return Response({"succeeded": succeeded, "failed": failed})

    @action(detail=False, methods=["post"], url_path="bulk-update")
    def bulk_update(self, request):
        data = request.data
        items, missing_ids, project = self._resolve_batch(data.get("ids"))

        assignee = None
        if "assignee" in data and data["assignee"] is not None:
            from django.contrib.auth import get_user_model

            User = get_user_model()
            assignee = User.objects.filter(pk=data["assignee"]).first()
            if not assignee:
                raise ValidationError({"assignee": "User not found."})

        priority = data.get("priority")
        if priority is not None and int(priority) not in (1, 2, 3):
            raise ValidationError({"priority": "Must be 1, 2, or 3."})

        components_add = []
        if data.get("components_add"):
            components_add = list(Component.objects.filter(id__in=data["components_add"]))
            mismatched = [c for c in components_add if c.project_id != project.id]
            if mismatched:
                raise ValidationError({"components_add": "Components must belong to this item's project."})

        labels_add = data.get("labels_add") or []
        resolved_labels = resolve_labels(labels_add, request.user) if labels_add else []

        succeeded = []
        for item in items:
            update_fields = []
            if "assignee" in data:
                item.assignee = assignee
                update_fields.append("assignee")
            if priority is not None:
                item.priority = int(priority)
                update_fields.append("priority")
            if update_fields:
                item.save(update_fields=update_fields)
            if resolved_labels:
                item.labels.add(*resolved_labels)
            if components_add:
                item.components.add(*components_add)
            succeeded.append(item.id)
        failed = [{"id": i, "error": "Not found."} for i in missing_ids]
        return Response({"succeeded": succeeded, "failed": failed})

    @action(detail=False, methods=["post"], url_path="bulk-delete")
    def bulk_delete(self, request):
        items, missing_ids, project = self._resolve_batch(request.data.get("ids"))
        deleted = []
        for item in items:
            WorkItem.objects.filter(parent=item).update(parent=None)
            deleted_id = item.id
            item.delete()
            deleted.append(deleted_id)
        failed = [{"id": i, "error": "Not found."} for i in missing_ids]
        return Response({"deleted": deleted, "failed": failed})
```

No URL wiring needed beyond what's already there — `router.register("work-items", WorkItemViewSet, basename="work-item")` (existing) auto-generates `/api/work-items/bulk-move/` etc. from the `@action(detail=False, url_path="bulk-move")` decorators, the same way any other `detail=False` action on a registered viewset already does in this codebase.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `docker compose run --rm web pytest boards/tests/test_bulk_operations.py -v`
Expected: 14 passed.

Run: `docker compose run --rm web pytest -v`
Expected: all tests pass (333 total).

- [ ] **Step 5: Commit**

```bash
git add boards/
git commit -m "Add bulk-move, bulk-update, bulk-delete work item endpoints"
```

---

## Task 2: CSV import on `BoardViewSet`

**Files:**
- Modify: `boards/views.py`, `boards/services.py`
- Test: `boards/tests/test_import.py`

**Interfaces:**
- Consumes: `resolve_default_status(project)`, `resolve_labels(names, user)` (`boards/services.py`), the same key-generation/`save()` path every other `WorkItem` creation already goes through.
- Produces: `POST /api/boards/{id}/import/`. `boards.services.import_work_items_from_csv(board, csv_file, user) -> dict` (`{"imported": int, "failed": [...]}`) — the parsing/row-validation logic, kept in `services.py` rather than the view, matching how `custom_fields_write_error`/`resolve_labels` already live there rather than in `views.py`.

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_import.py`:

```python
import io

import pytest

from boards.models import Board, Component, Label, WorkItem, WorkItemStatus


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
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `docker compose run --rm web pytest boards/tests/test_import.py -v`
Expected: FAIL — `404 Not Found` (no `import/` route exists yet).

- [ ] **Step 3: Add `import_work_items_from_csv` to `boards/services.py`**

`WorkItem`, `Label`, `WorkItemStatus`, and `re` are already imported in `boards/services.py`; update the `from .models import ...` line to add `Component`, then add the following (including its two new top-level imports) near the top of the file, after the existing imports:

```python
import csv as csv_module
import io


PRIORITY_NAMES = {"low": 1, "medium": 2, "high": 3}


def import_work_items_from_csv(board, csv_file, user):
    """Row-by-row, best-effort: a bad row is skipped and reported, the
    rest of the file still imports. A uniform problem (missing `title`
    header, more than 500 rows) is a whole-file ValidationError instead,
    raised before any row is touched — see this plan's Global Constraints."""
    raw = csv_file.read()
    text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
    reader = list(csv_module.reader(io.StringIO(text)))
    reader = [row for row in reader if any(cell.strip() for cell in row)]
    if not reader:
        raise ValidationError({"csv": "CSV file is empty."})

    header = [h.strip().lower() for h in reader[0]]
    if "title" not in header:
        raise ValidationError({"csv": 'CSV must include a "title" column.'})
    data_rows = reader[1:]
    if len(data_rows) > 500:
        raise ValidationError({"csv": "CSV has more than 500 rows."})

    imported = 0
    failed = []

    for i, cells in enumerate(data_rows):
        row_num = i + 2  # header is row 1
        row = {h: (cells[idx].strip() if idx < len(cells) else "") for idx, h in enumerate(header)}
        title = row.get("title", "")

        def fail_row(error, title=title):
            failed.append({"row": row_num, "title": title or None, "error": error})

        if not title:
            fail_row("Title is required.")
            continue

        item_type = (row.get("item_type") or "task").lower()
        if item_type == "subtask":
            fail_row("Subtasks cannot be imported (need a parent).")
            continue
        if item_type not in WorkItem.ItemType.values:
            fail_row(f'Invalid item_type "{item_type}".')
            continue

        status = resolve_default_status(board.project)
        if row.get("status"):
            status = WorkItemStatus.objects.filter(
                project=board.project, name__iexact=row["status"]
            ).first()
            if not status:
                fail_row(f'Status "{row["status"]}" not found.')
                continue

        priority = 2
        if row.get("priority"):
            priority = PRIORITY_NAMES.get(row["priority"].lower())
            if not priority:
                fail_row(f'Invalid priority "{row["priority"]}".')
                continue

        assignee = None
        if row.get("assignee"):
            from django.contrib.auth import get_user_model

            User = get_user_model()
            assignee = User.objects.filter(username__iexact=row["assignee"]).first()
            if not assignee:
                fail_row(f'User "{row["assignee"]}" not found.')
                continue

        due_date = None
        if row.get("due_date"):
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", row["due_date"]):
                fail_row(f'Invalid due_date "{row["due_date"]}".')
                continue
            due_date = row["due_date"]

        component_ids = []
        bad_component = None
        if row.get("components"):
            for name in [n.strip() for n in row["components"].split(";") if n.strip()]:
                comp = Component.objects.filter(project=board.project, name__iexact=name).first()
                if not comp:
                    bad_component = name
                    break
                component_ids.append(comp.id)
        if bad_component:
            fail_row(f'Component "{bad_component}" not found.')
            continue

        label_names = [n.strip() for n in row.get("labels", "").split(";") if n.strip()]

        item = WorkItem.objects.create(
            board=board, item_type=item_type, title=title,
            description=row.get("description", ""), status=status, priority=priority,
            due_date=due_date, assignee=assignee, created_by=user,
        )
        if component_ids:
            item.components.set(component_ids)
        if label_names:
            item.labels.set(resolve_labels(label_names, user))
        imported += 1

    return {"imported": imported, "failed": failed}
```

- [ ] **Step 4: Add the view action**

In `boards/views.py`, add `from rest_framework.parsers import MultiPartParser` to the imports, add `import_work_items_from_csv` to the `from .services import ...` line, and add this method to `BoardViewSet` (after `work_items`):

```python
    @action(detail=True, methods=["post"], url_path="import", parser_classes=[MultiPartParser])
    def import_csv(self, request, pk=None):
        board = self.get_object()
        csv_file = request.FILES.get("csv")
        if not csv_file:
            raise ValidationError({"csv": "This field is required."})
        result = import_work_items_from_csv(board, csv_file, request.user)
        return Response(result)
```

`self.get_object()` already runs `BoardViewSet`'s standard `get_queryset()` + `check_object_permissions()` path (`IsProjectMember`), so a non-member 403s and a genuinely missing board 404s before `import_work_items_from_csv` ever runs — no separate permission check needed here.

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `docker compose run --rm web pytest boards/tests/test_import.py -v`
Expected: 14 passed (10 test functions; `test_each_optional_columns_bad_value_fails_that_row_only` is parametrized ×5).

Run: `docker compose run --rm web pytest -v`
Expected: all tests pass (347 total).

- [ ] **Step 6: Update API docs**

In `docs/api.md`, add a section documenting `POST /api/work-items/bulk-move/`, `POST /api/work-items/bulk-update/`, `POST /api/work-items/bulk-delete/`, and `POST /api/boards/{id}/import/`, matching the style of the existing `/api/work-items/{id}/move/` section — request/response shapes, the best-effort `succeeded`/`failed` contract, and the CSV column reference from this plan's Task 2 Step 3.

- [ ] **Step 7: Commit**

```bash
git add boards/ docs/api.md
git commit -m "Add CSV import for boards"
```
