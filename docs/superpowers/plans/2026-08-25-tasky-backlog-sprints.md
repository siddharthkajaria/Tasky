# Backlog & Sprints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production Django/DRF backend for Tasky's Backlog & Sprints feature (sub-project 6 of 13) — a per-board `Sprint` lifecycle (planned → active → completed, at most one active per board), a backlog view for unscheduled work items, and a `schedule/` action that moves a work item between the backlog and any non-completed sprint.

**Architecture:** One new model in the `boards` app (`Sprint`), plus two new fields on `WorkItem` (`sprint`, `backlog_position`) added in a second task, since the delete guard and the "return items to backlog on complete" behavior both need `WorkItem.sprint` to exist before they can be real — Task 1 ships them as deliberate placeholders (matching this codebase's established pattern from Custom Fields & Screens: `CustomFieldViewSet.perform_destroy` shipped unguarded until `ScreenField` existed to guard against), Task 2 replaces both with the real checks. Sprint assignment is a second, independent axis from `status` — the two never validate against each other, mirroring how the spec insists a work item can be `Done` and still sit in the backlog, or `To Do` and inside an active sprint.

**Tech Stack:** Django 5.2, DRF 3.16, MySQL, pytest-django. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-tasky-backlog-sprints-design.md` (signed off 2026-08-24; the `design/` prototype it argues from was signed off and built 2026-08-25)

## Global Constraints

- **Role vocabulary is `owner` / `admin` / `member`** (lowercase) — unchanged.
- **Unauthenticated request → `403`, never `401`** (existing site-wide convention, unchanged).
- **Sprints are per-board**, not per-project — `Sprint.board` is a real FK, mirroring how `position`/`next_position()`/`move_work_item()` are already keyed by `(board, status)`, not just `status`.
- **At most one `active` sprint per board at a time**, enforced at the API layer (no DB constraint — MySQL has no clean partial-unique-index primitive here) via a `select_for_update()` lock on the board row before checking, the same lock-then-check shape `WorkItem.save()` already uses for its own per-project invariant.
- **Sprint lifecycle is linear and one-way**: `planned` → `active` → `completed`. No reopening a completed sprint, no pausing an active one. `start`/`complete` are the only ways `state` changes — `PATCH` on a sprint can change `name`/`goal` only, never `state`/`start_date`/`end_date` directly.
- **A sprint can only be deleted while `planned` and empty** (no work items scheduled into it). An `active` or `completed` sprint can never be deleted.
- **`WorkItem.sprint` cannot be changed via `PATCH`/`PUT` on `/api/work-items/{id}/`** — only `POST /api/work-items/{id}/schedule/` can move an item between sprints/backlog, the same "real changes only go through the dedicated action" rule already applied to `status`/`board`. A `PATCH` that echoes back the current, unchanged `sprint` is accepted, matching the existing convention for `status`/`board`.
- **`backlog_position` follows the exact same non-invariant `next_position()`/`move_work_item()` already documents**: gaps are expected and harmless; a renumber is a one-time side effect of a `schedule/` call, not a continuously-held invariant.
- **Every migration in this plan is a plain additive `CreateModel`/`AddField`** — no existing column is touched, so no hand-written migration content is needed.

---

## Task 1: `Sprint` model, CRUD, and lifecycle actions

**Files:**
- Create: `boards/migrations/0026_sprint.py`
- Modify: `boards/models.py`, `boards/serializers.py`, `boards/views.py`, `boards/urls.py`
- Test: `boards/tests/test_sprints_api.py`

**Interfaces:**
- Consumes: `IsProjectMember`, the `WorkItem.project`-style computed-property pattern (needed so `IsProjectMember.has_object_permission`, which reads `obj.project`, works on a `Sprint` the same way it already works on a `WorkItem`).
- Produces: `boards.models.Sprint` (`board`, `name`, `goal`, `state`, `start_date`, `end_date`, `created_by`, `created_at`; `Sprint.State` choices `planned`/`active`/`completed`; a `Sprint.project` property mirroring `WorkItem.project`). `boards.serializers.can_manage_sprints(role) -> bool`, `SprintSerializer`, `SprintSummarySerializer` (`id`, `name`, `state`, `start_date`, `end_date` — this is what Task 2 embeds as `sprint_detail` on a work item). `GET/POST /api/boards/{id}/sprints/`, `GET/PATCH/DELETE /api/sprints/{id}/`, `POST /api/sprints/{id}/start/`, `POST /api/sprints/{id}/complete/`. Task 2 imports `Sprint`, `SprintSummarySerializer` from here.

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_sprints_api.py`:

```python
import pytest

from boards.models import Board, Sprint


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client, board):
    assert client.get(f"/api/boards/{board.id}/sprints/").status_code == 403


@pytest.mark.django_db
def test_any_member_can_list_sprints(auth_client, board, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    Sprint.objects.create(board=board, name="Sprint 1", created_by=None)
    response = auth_client.get(f"/api/boards/{board.id}/sprints/")
    assert response.status_code == 200
    assert response.json()[0]["name"] == "Sprint 1"


@pytest.mark.django_db
def test_owner_can_create_a_sprint(auth_client, board, user):
    response = auth_client.post(
        f"/api/boards/{board.id}/sprints/", {"name": "Sprint 14", "goal": "Ship it"}, content_type="application/json"
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Sprint 14"
    assert body["state"] == "planned"
    assert body["start_date"] is None
    sprint = Sprint.objects.get(pk=body["id"])
    assert sprint.created_by == user


@pytest.mark.django_db
def test_a_plain_member_cannot_create_a_sprint(auth_client, board, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    response = auth_client.post(
        f"/api/boards/{board.id}/sprints/", {"name": "Sprint 14"}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_a_non_member_cannot_create_a_sprint(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    foreign_board = Board.objects.create(name="B", created_by=other_user, project=foreign)
    response = auth_client.post(
        f"/api/boards/{foreign_board.id}/sprints/", {"name": "X"}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_owner_can_rename_a_sprint_and_set_its_goal(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="Old", created_by=None)
    response = auth_client.patch(
        f"/api/sprints/{sprint.id}/", {"name": "New", "goal": "A goal"}, content_type="application/json"
    )
    assert response.status_code == 200
    sprint.refresh_from_db()
    assert sprint.name == "New"
    assert sprint.goal == "A goal"


@pytest.mark.django_db
def test_patch_cannot_change_state_directly(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None)
    response = auth_client.patch(
        f"/api/sprints/{sprint.id}/", {"state": "active"}, content_type="application/json"
    )
    sprint.refresh_from_db()
    assert sprint.state == "planned"


@pytest.mark.django_db
def test_start_moves_a_planned_sprint_to_active_and_stamps_start_date(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None)
    response = auth_client.post(f"/api/sprints/{sprint.id}/start/")
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "active"
    assert body["start_date"] is not None


@pytest.mark.django_db
def test_starting_a_second_sprint_while_one_is_active_is_rejected(auth_client, board):
    first = Sprint.objects.create(board=board, name="First", created_by=None, state="active")
    second = Sprint.objects.create(board=board, name="Second", created_by=None)
    response = auth_client.post(f"/api/sprints/{second.id}/start/")
    assert response.status_code == 400
    second.refresh_from_db()
    assert second.state == "planned"


@pytest.mark.django_db
def test_starting_sprints_on_two_different_boards_both_succeed(auth_client, project, user):
    board_a = Board.objects.create(name="A", created_by=user, project=project)
    board_b = Board.objects.create(name="B", created_by=user, project=project)
    sprint_a = Sprint.objects.create(board=board_a, name="A1", created_by=None)
    sprint_b = Sprint.objects.create(board=board_b, name="B1", created_by=None)
    assert auth_client.post(f"/api/sprints/{sprint_a.id}/start/").status_code == 200
    assert auth_client.post(f"/api/sprints/{sprint_b.id}/start/").status_code == 200


@pytest.mark.django_db
def test_starting_a_non_planned_sprint_is_rejected(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None, state="completed")
    response = auth_client.post(f"/api/sprints/{sprint.id}/start/")
    assert response.status_code == 400


@pytest.mark.django_db
def test_complete_moves_an_active_sprint_to_completed_and_stamps_end_date(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None, state="active")
    response = auth_client.post(f"/api/sprints/{sprint.id}/complete/")
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "completed"
    assert body["end_date"] is not None


@pytest.mark.django_db
def test_completing_a_non_active_sprint_is_rejected(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None)
    response = auth_client.post(f"/api/sprints/{sprint.id}/complete/")
    assert response.status_code == 400


@pytest.mark.django_db
def test_owner_can_delete_a_planned_empty_sprint(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None)
    assert auth_client.delete(f"/api/sprints/{sprint.id}/").status_code == 204


@pytest.mark.django_db
def test_deleting_an_active_sprint_is_rejected(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None, state="active")
    response = auth_client.delete(f"/api/sprints/{sprint.id}/")
    assert response.status_code == 400
    assert Sprint.objects.filter(id=sprint.id).exists()


@pytest.mark.django_db
def test_deleting_a_completed_sprint_is_rejected(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None, state="completed")
    response = auth_client.delete(f"/api/sprints/{sprint.id}/")
    assert response.status_code == 400


@pytest.mark.django_db
def test_a_plain_member_cannot_start_complete_or_delete_a_sprint(auth_client, board, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    planned = Sprint.objects.create(board=board, name="P", created_by=None)
    active = Sprint.objects.create(board=board, name="A", created_by=None, state="active")
    assert auth_client.post(f"/api/sprints/{planned.id}/start/").status_code == 403
    assert auth_client.post(f"/api/sprints/{active.id}/complete/").status_code == 403
    assert auth_client.delete(f"/api/sprints/{planned.id}/").status_code == 403


@pytest.mark.django_db
def test_genuinely_nonexistent_sprint_returns_404(auth_client):
    assert auth_client.get("/api/sprints/999999/").status_code == 404
    assert auth_client.post("/api/sprints/999999/start/").status_code == 404
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `docker compose run --rm web pytest boards/tests/test_sprints_api.py -v`
Expected: FAIL — `ImportError` (`Sprint` doesn't exist yet).

- [ ] **Step 3: Add the model**

In `boards/models.py`, add after the `WorkItemStatus` class:

```python
class Sprint(models.Model):
    class State(models.TextChoices):
        PLANNED = "planned", "Planned"
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"

    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="sprints")
    name = models.CharField(max_length=120)
    goal = models.CharField(max_length=280, blank=True)
    state = models.CharField(max_length=10, choices=State.choices, default=State.PLANNED)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="sprints_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.name} ({self.board})"

    @property
    def project(self):
        return self.board.project
```

The `project` property exists so `IsProjectMember.has_object_permission` — which reads `obj.project` — works on a `Sprint` the same way it already works on a `WorkItem` (see `WorkItem.project` in this same file for the identical pattern).

```bash
docker compose run --rm web python manage.py makemigrations boards -n sprint
```

Confirm the generated file is `boards/migrations/0026_sprint.py` (it follows `0025_workitem_labels.py`).

- [ ] **Step 4: Add the permission helper and serializers**

In `boards/serializers.py`, add near `can_manage_statuses`:

```python
def can_manage_sprints(role):
    return role in ("owner", "admin")
```

Update the `from .models import ...` line to include `Sprint`. Add, after `WorkItemStatusSerializer`:

```python
class SprintSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)

    class Meta:
        model = Sprint
        fields = ["id", "board", "name", "goal", "state", "start_date", "end_date", "created_by", "created_at"]
        read_only_fields = ["board", "state", "start_date", "end_date", "created_by", "created_at"]

    def validate_name(self, value):
        clean = value.strip()
        if not clean:
            raise serializers.ValidationError("This field may not be blank.")
        return clean


class SprintSummarySerializer(serializers.ModelSerializer):
    """Embedded on a work item as `sprint_detail` — mirrors how
    `WorkItemStatusSummarySerializer` trims down `WorkItemStatusSerializer`
    for the same reason."""

    class Meta:
        model = Sprint
        fields = ["id", "name", "state", "start_date", "end_date"]
```

- [ ] **Step 5: Add the viewset**

In `boards/views.py`, update the `from .models import ...` line to include `Sprint`, the `.serializers import (...)` block to include `SprintSerializer, can_manage_sprints`, and add `from django.utils import timezone` if not already present (check first — it's likely already imported, used elsewhere in this codebase's services layer, but this file may not have it yet). Add, after `WorkItemStatusViewSet`:

```python
class SprintViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete"]
    serializer_class = SprintSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    pagination_class = None

    def get_board(self):
        return get_object_or_404(Board, pk=self.kwargs["board_pk"])

    def get_queryset(self):
        qs = Sprint.objects.all()
        if "board_pk" in self.kwargs:
            qs = qs.filter(board_id=self.kwargs["board_pk"])
        return qs

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # Only list/create are nested under a board in the URL (see
        # boards/urls.py) — detail routes and the start/complete actions
        # resolve a Sprint directly by id and rely on get_object()'s own
        # check_object_permissions() call, which works because Sprint has
        # a `project` property (see the model).
        if self.action in ("list", "create"):
            self.check_object_permissions(request, self.get_board().project)

    def _role(self, sprint):
        return sprint.board.project.memberships.get(user=self.request.user).role

    def perform_create(self, serializer):
        board = self.get_board()
        if not can_manage_sprints(board.project.memberships.get(user=self.request.user).role):
            raise PermissionDenied("Only this project's Owner or Admins can manage sprints.")
        serializer.save(board=board, created_by=self.request.user)

    def perform_update(self, serializer):
        if not can_manage_sprints(self._role(serializer.instance)):
            raise PermissionDenied("Only this project's Owner or Admins can manage sprints.")
        serializer.save()

    def perform_destroy(self, instance):
        if not can_manage_sprints(self._role(instance)):
            raise PermissionDenied("Only this project's Owner or Admins can manage sprints.")
        if instance.state != Sprint.State.PLANNED:
            raise ValidationError({"detail": "Only a planned sprint can be deleted."})
        # Unguarded against "still has items scheduled into it" — WorkItem.sprint
        # doesn't exist until Task 2, so there's nothing to check yet. Task 2
        # replaces this method with the real "still has N items" guard.
        instance.delete()

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        sprint = self.get_object()
        if not can_manage_sprints(self._role(sprint)):
            raise PermissionDenied("Only this project's Owner or Admins can manage sprints.")
        if sprint.state != Sprint.State.PLANNED:
            raise ValidationError({"detail": "Only a planned sprint can be started."})
        with transaction.atomic():
            board = Board.objects.select_for_update().get(pk=sprint.board_id)
            active = Sprint.objects.filter(board=board, state=Sprint.State.ACTIVE).exclude(pk=sprint.pk).first()
            if active:
                raise ValidationError(
                    {"detail": f'"{active.name}" is already active on this board. Complete it first.'}
                )
            sprint.state = Sprint.State.ACTIVE
            sprint.start_date = timezone.now().date()
            sprint.save(update_fields=["state", "start_date"])
        return Response(SprintSerializer(sprint).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        sprint = self.get_object()
        if not can_manage_sprints(self._role(sprint)):
            raise PermissionDenied("Only this project's Owner or Admins can manage sprints.")
        if sprint.state != Sprint.State.ACTIVE:
            raise ValidationError({"detail": "Only an active sprint can be completed."})
        sprint.state = Sprint.State.COMPLETED
        sprint.end_date = timezone.now().date()
        sprint.save(update_fields=["state", "end_date"])
        # Task 2 adds: return this sprint's remaining work items to the
        # backlog. WorkItem.sprint doesn't exist yet, so there's nothing to
        # move — a sprint completed in this task's tests is always empty.
        return Response(SprintSerializer(sprint).data)
```

- [ ] **Step 6: Wire the URLs**

In `boards/urls.py`, update the import to include `SprintViewSet`, and add (alongside the existing `projects/<int:project_pk>/statuses/...` paths):

```python
    path(
        "boards/<int:board_pk>/sprints/",
        SprintViewSet.as_view({"get": "list", "post": "create"}),
        name="board-sprints",
    ),
    path(
        "sprints/<int:pk>/",
        SprintViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="sprint-detail",
    ),
    path(
        "sprints/<int:pk>/start/",
        SprintViewSet.as_view({"post": "start"}),
        name="sprint-start",
    ),
    path(
        "sprints/<int:pk>/complete/",
        SprintViewSet.as_view({"post": "complete"}),
        name="sprint-complete",
    ),
```

- [ ] **Step 7: Run the tests to confirm they pass**

Run: `docker compose run --rm web pytest boards/tests/test_sprints_api.py -v`
Expected: 18 passed.

Run: `docker compose run --rm web pytest -v`
Expected: all tests pass (411 total).

- [ ] **Step 8: Commit**

```bash
git add boards/
git commit -m "Add Sprint model, CRUD, and start/complete lifecycle"
```

---

## Task 2: `WorkItem.sprint`/`backlog_position`, `schedule/`, and the backlog/sprint work-item lists

**Files:**
- Create: `boards/migrations/0027_workitem_sprint_and_backlog_position.py`
- Modify: `boards/models.py`, `boards/services.py`, `boards/serializers.py`, `boards/views.py`, `boards/urls.py`
- Test: `boards/tests/test_backlog_and_scheduling.py`

**Interfaces:**
- Consumes: `Sprint`, `SprintSummarySerializer`, `can_manage_sprints` (Task 1).
- Produces: `WorkItem.sprint` (nullable FK to `Sprint`, `on_delete=SET_NULL`), `WorkItem.backlog_position` (integer, default `0`). `boards.services.next_backlog_position(board_id, sprint_id) -> int`, `boards.services.schedule_work_item(item, new_sprint_id, new_position) -> WorkItem`. `WorkItemSerializer` gains `sprint`/`sprint_detail`. `GET /api/boards/{id}/backlog/`, `GET /api/sprints/{id}/work-items/`, `POST /api/work-items/{id}/schedule/`. Also replaces Task 1's placeholder `SprintViewSet.perform_destroy` and `complete` action with their real versions.

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_backlog_and_scheduling.py`:

```python
import pytest

from boards.models import Board, Sprint, WorkItem, WorkItemStatus


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def status(board, project):
    return WorkItemStatus.objects.filter(project=project, category="todo").first()


@pytest.mark.django_db
def test_a_new_work_item_defaults_to_the_backlog(auth_client, board):
    response = auth_client.post(
        "/api/work-items/", {"board": board.id, "title": "X"}, content_type="application/json"
    )
    assert response.status_code == 201
    assert response.json()["sprint"] is None
    assert response.json()["sprint_detail"] is None


@pytest.mark.django_db
def test_patch_cannot_change_sprint_directly(auth_client, board, status):
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"sprint": sprint.id}, content_type="application/json"
    )
    assert response.status_code == 400
    assert "sprint" in response.json()
    item.refresh_from_db()
    assert item.sprint_id is None


@pytest.mark.django_db
def test_patch_echoing_back_the_current_unchanged_sprint_is_accepted(auth_client, board, status):
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"sprint": None, "title": "X renamed"}, content_type="application/json"
    )
    assert response.status_code == 200


@pytest.mark.django_db
def test_schedule_moves_an_item_from_backlog_into_a_sprint(auth_client, board, status):
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": sprint.id}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.sprint_id == sprint.id


@pytest.mark.django_db
def test_schedule_moves_an_item_back_to_the_backlog(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    item = WorkItem.objects.create(board=board, title="X", status=status, sprint=sprint, created_by=None)
    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": None}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.sprint_id is None


@pytest.mark.django_db
def test_schedule_appends_to_the_end_and_renumbers_in_payload_order(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    existing = WorkItem.objects.create(
        board=board, title="Already there", status=status, sprint=sprint, backlog_position=0, created_by=None,
    )
    a = WorkItem.objects.create(board=board, title="A", status=status, created_by=None)
    b = WorkItem.objects.create(board=board, title="B", status=status, created_by=None)

    auth_client.post(f"/api/work-items/{a.id}/schedule/", {"sprint": sprint.id}, content_type="application/json")
    auth_client.post(f"/api/work-items/{b.id}/schedule/", {"sprint": sprint.id}, content_type="application/json")

    existing.refresh_from_db()
    a.refresh_from_db()
    b.refresh_from_db()
    assert [existing.backlog_position, a.backlog_position, b.backlog_position] == [0, 1, 2]


@pytest.mark.django_db
def test_schedule_rejects_a_sprint_from_a_different_board(auth_client, board, status, project, user):
    other_board = Board.objects.create(name="Other", created_by=user, project=project)
    other_sprint = Sprint.objects.create(board=other_board, name="S", created_by=None)
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)

    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": other_sprint.id}, content_type="application/json"
    )
    assert response.status_code == 400
    item.refresh_from_db()
    assert item.sprint_id is None


@pytest.mark.django_db
def test_schedule_rejects_a_completed_sprint(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None, state="completed")
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": sprint.id}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_schedule_on_a_nonexistent_sprint_id_returns_400(auth_client, board, status):
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": 999999}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_status_and_sprint_never_constrain_each_other(auth_client, board, project):
    done_status = WorkItemStatus.objects.filter(project=project, category="done").first()
    sprint = Sprint.objects.create(board=board, name="S", created_by=None, state="active")
    item = WorkItem.objects.create(board=board, title="X", status=done_status, created_by=None)
    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": None}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.status_id == done_status.id  # unchanged
    assert item.sprint_id is None  # in the backlog despite being Done


@pytest.mark.django_db
def test_backlog_lists_only_unscheduled_items_ordered_by_backlog_position(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    in_sprint = WorkItem.objects.create(board=board, title="In sprint", status=status, sprint=sprint, created_by=None)
    second = WorkItem.objects.create(board=board, title="Second", status=status, backlog_position=1, created_by=None)
    first = WorkItem.objects.create(board=board, title="First", status=status, backlog_position=0, created_by=None)

    response = auth_client.get(f"/api/boards/{board.id}/backlog/")
    assert response.status_code == 200
    ids = [item["id"] for item in response.json()]
    assert ids == [first.id, second.id]
    assert in_sprint.id not in ids


@pytest.mark.django_db
def test_sprint_work_items_lists_only_that_sprints_items_ordered_by_backlog_position(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    other_sprint = Sprint.objects.create(board=board, name="Other", created_by=None)
    second = WorkItem.objects.create(board=board, title="Second", status=status, sprint=sprint, backlog_position=1, created_by=None)
    first = WorkItem.objects.create(board=board, title="First", status=status, sprint=sprint, backlog_position=0, created_by=None)
    WorkItem.objects.create(board=board, title="Elsewhere", status=status, sprint=other_sprint, created_by=None)

    response = auth_client.get(f"/api/sprints/{sprint.id}/work-items/")
    assert response.status_code == 200
    ids = [item["id"] for item in response.json()]
    assert ids == [first.id, second.id]


@pytest.mark.django_db
def test_completing_a_sprint_returns_its_items_to_the_end_of_the_backlog(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None, state="active")
    pre_existing_backlog_item = WorkItem.objects.create(
        board=board, title="Already in backlog", status=status, backlog_position=0, created_by=None,
    )
    a = WorkItem.objects.create(board=board, title="A", status=status, sprint=sprint, backlog_position=0, created_by=None)
    b = WorkItem.objects.create(board=board, title="B", status=status, sprint=sprint, backlog_position=1, created_by=None)

    response = auth_client.post(f"/api/sprints/{sprint.id}/complete/")
    assert response.status_code == 200

    a.refresh_from_db()
    b.refresh_from_db()
    pre_existing_backlog_item.refresh_from_db()
    assert a.sprint_id is None
    assert b.sprint_id is None
    assert a.status_id == status.id  # untouched
    positions = sorted([pre_existing_backlog_item.backlog_position, a.backlog_position, b.backlog_position])
    assert positions == [0, 1, 2]


@pytest.mark.django_db
def test_deleting_a_planned_sprint_still_holding_items_is_rejected(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    WorkItem.objects.create(board=board, title="X", status=status, sprint=sprint, created_by=None)
    response = auth_client.delete(f"/api/sprints/{sprint.id}/")
    assert response.status_code == 400
    assert Sprint.objects.filter(id=sprint.id).exists()


@pytest.mark.django_db
def test_deleting_an_empty_planned_sprint_still_succeeds(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    assert auth_client.delete(f"/api/sprints/{sprint.id}/").status_code == 204


@pytest.mark.django_db
def test_a_plain_member_can_use_schedule_no_separate_permission_check(auth_client, board, status, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": sprint.id}, content_type="application/json"
    )
    assert response.status_code == 200


@pytest.mark.django_db
def test_a_non_member_cannot_use_backlog_sprint_items_or_schedule(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    foreign_board = Board.objects.create(name="B", created_by=other_user, project=foreign)
    foreign_status = WorkItemStatus.objects.filter(project=foreign, category="todo").first()
    foreign_sprint = Sprint.objects.create(board=foreign_board, name="S", created_by=None)
    foreign_item = WorkItem.objects.create(board=foreign_board, title="X", status=foreign_status, created_by=None)

    assert auth_client.get(f"/api/boards/{foreign_board.id}/backlog/").status_code == 403
    assert auth_client.get(f"/api/sprints/{foreign_sprint.id}/work-items/").status_code == 403
    assert auth_client.post(f"/api/work-items/{foreign_item.id}/schedule/", {"sprint": None}, content_type="application/json").status_code == 403
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `docker compose run --rm web pytest boards/tests/test_backlog_and_scheduling.py -v`
Expected: FAIL — `django.db.utils.OperationalError`/`TypeError` (no `sprint`/`backlog_position` columns exist yet), and `404 Not Found` on `backlog/`/`work-items/`/`schedule/` routes.

- [ ] **Step 3: Add the fields**

In `boards/models.py`, in the `WorkItem` class, add right after the existing `labels` field:

```python
    sprint = models.ForeignKey(
        "Sprint", on_delete=models.SET_NULL, null=True, blank=True, related_name="work_items"
    )
    backlog_position = models.IntegerField(default=0)
```

Add to `WorkItem.Meta.indexes`, alongside the existing `["board", "status", "position"]` index:

```python
        models.Index(fields=["board", "sprint", "backlog_position"]),
```

```bash
docker compose run --rm web python manage.py makemigrations boards -n workitem_sprint_and_backlog_position
```

Confirm the generated file is `boards/migrations/0027_workitem_sprint_and_backlog_position.py`.

- [ ] **Step 4: Add `next_backlog_position` and `schedule_work_item` to `boards/services.py`**

Update the `from .models import ...` line to include `Sprint`. Add, after `next_position`:

```python
def next_backlog_position(board_id: int, sprint_id) -> int:
    """The backlog_position a work item takes when appended to the end of
    its bucket — the backlog (sprint_id=None) or one specific Sprint.
    Same unlocked-read shape as next_position() above, for the same
    reason: a benign duplicate self-heals the next time schedule_work_item()
    renumbers that bucket."""
    max_position = WorkItem.objects.filter(board_id=board_id, sprint_id=sprint_id).aggregate(
        Max("backlog_position")
    )["backlog_position__max"]
    return 0 if max_position is None else max_position + 1
```

Add, after `move_work_item`:

```python
@transaction.atomic
def schedule_work_item(item: WorkItem, new_sprint_id, new_position: int) -> WorkItem:
    """Drop a work item into the backlog (new_sprint_id=None) or a sprint
    at a position, then renumber the affected buckets. Mirrors
    move_work_item()'s locking and renumbering shape exactly, keyed on
    (board, sprint) instead of (board, status) — see that function's
    docstring for the full reasoning on why locking every item on the
    board (not just the two buckets) is what makes concurrent calls on
    the same board serialise instead of deadlocking."""
    locked = list(
        WorkItem.objects.select_for_update()
        .filter(board_id=item.board_id)
        .order_by("id")
    )

    locked_by_pk = {c.pk: c for c in locked}
    if item.pk not in locked_by_pk:
        raise WorkItem.DoesNotExist(
            f"WorkItem {item.pk} was deleted before the schedule could be applied."
        )

    old_sprint_id = locked_by_pk[item.pk].sprint_id
    item.sprint_id = new_sprint_id

    def renumber(sprint_id):
        bucket = [c for c in locked if c.sprint_id == sprint_id and c.pk != item.pk]
        bucket.sort(key=lambda c: (c.backlog_position, c.pk))

        if sprint_id == new_sprint_id:
            index = max(0, min(new_position, len(bucket)))
            bucket.insert(index, item)

        now = timezone.now()
        for index, member in enumerate(bucket):
            member.backlog_position = index
            member.updated_at = now
        return bucket

    touched = renumber(new_sprint_id)
    if old_sprint_id != new_sprint_id:
        touched += renumber(old_sprint_id)

    WorkItem.objects.bulk_update(touched, ["backlog_position", "sprint", "updated_at"])
    return item
```

- [ ] **Step 5: Wire `WorkItemSerializer`, and replace Task 1's `SprintViewSet` placeholders**

In `boards/serializers.py`, update the `from .models import ...` line to include `Sprint`, and the `from .services import ...` line to include `next_backlog_position`.

Add two fields to `WorkItemSerializer`, right after `status_detail`/`status`:

```python
    sprint_detail = SprintSummarySerializer(source="sprint", read_only=True)
```

Add `"sprint", "sprint_detail"` to `Meta.fields`, right after `"status", "status_detail"`. `sprint` itself needs no explicit field declaration — `ModelSerializer` auto-generates a `PrimaryKeyRelatedField(required=False, allow_null=True)` for it from the model's own FK, the same as it already does for `parent`.

In `boards/views.py`, `WorkItemViewSet.update()` already has a raw-`request.data` immutability check for `status`/`board`/`item_type`/`key`. Extend its condition and body to include `sprint`:

```python
        if (
            "status" in request.data or "board" in request.data or "item_type" in request.data
            or "key" in request.data or "sprint" in request.data
        ):
            item = self.get_object()
            if "status" in request.data and str(request.data["status"]) != str(item.status_id):
                raise ValidationError(
                    {
                        "status": (
                            "Status cannot be changed here — "
                            "POST to /api/work-items/{id}/move/ instead."
                        )
                    }
                )
            if "board" in request.data and str(request.data["board"]) != str(item.board_id):
                raise ValidationError(
                    {
                        "board": "Work items cannot be moved between boards."
                    }
                )
            if "item_type" in request.data and request.data["item_type"] != item.item_type:
                raise ValidationError({"item_type": "Type cannot be changed after creation."})
            if "key" in request.data and request.data["key"] != item.key:
                raise ValidationError({"key": "Key cannot be changed."})
            if "sprint" in request.data:
                new_sprint = request.data["sprint"]
                current_sprint = item.sprint_id
                changed = (
                    (new_sprint is None and current_sprint is not None)
                    or (new_sprint is not None and str(new_sprint) != str(current_sprint))
                )
                if changed:
                    raise ValidationError(
                        {
                            "sprint": (
                                "Sprint cannot be changed here — "
                                "POST to /api/work-items/{id}/schedule/ instead."
                            )
                        }
                    )
```

This replaces the existing `if (...): item = self.get_object() ...` block in `update()` — add the `sprint` branch alongside the existing four, don't duplicate the surrounding structure.

Add `SprintViewSet` (Task 1) to the `.views import (...)` if it's a separate import elsewhere — it's already in the same file, no import needed. Replace Task 1's placeholder `perform_destroy`:

```python
    def perform_destroy(self, instance):
        if not can_manage_sprints(self._role(instance)):
            raise PermissionDenied("Only this project's Owner or Admins can manage sprints.")
        if instance.state != Sprint.State.PLANNED:
            raise ValidationError({"detail": "Only a planned sprint can be deleted."})
        still_scheduled = WorkItem.objects.filter(sprint=instance).count()
        if still_scheduled:
            raise ValidationError(
                {
                    "detail": (
                        f"Still has {still_scheduled} work item"
                        f"{'' if still_scheduled == 1 else 's'} scheduled into it. "
                        f"Move {'it' if still_scheduled == 1 else 'them'} first."
                    )
                }
            )
        instance.delete()
```

Replace Task 1's placeholder `complete` action body — after setting `state`/`end_date` and saving, add:

```python
        next_position = next_backlog_position(sprint.board_id, None)
        stragglers = list(WorkItem.objects.filter(sprint=sprint).order_by("backlog_position", "id"))
        for straggler in stragglers:
            straggler.sprint = None
            straggler.backlog_position = next_position
            next_position += 1
        WorkItem.objects.bulk_update(stragglers, ["sprint", "backlog_position"])
```

(Update the `.services import (...)` line in `boards/views.py` to include `next_backlog_position`, `schedule_work_item`.)

- [ ] **Step 6: Add the backlog/sprint-work-items list actions and the `schedule` action**

In `boards/views.py`, add to `BoardViewSet` (after `work_items`):

```python
    @action(detail=True, methods=["get"])
    def backlog(self, request, pk=None):
        board = self.get_object()
        items = board.work_items.filter(sprint__isnull=True).select_related(
            "assignee", "created_by", "parent", "parent__status", "status"
        ).prefetch_related("components", "labels", "field_values__field").order_by("backlog_position", "id")
        return Response(WorkItemSerializer(items, many=True).data)
```

Add to `SprintViewSet` (after `complete`):

```python
    @action(detail=True, methods=["get"], url_path="work-items")
    def work_items(self, request, pk=None):
        sprint = self.get_object()
        items = sprint.work_items.select_related(
            "assignee", "created_by", "parent", "parent__status", "status"
        ).prefetch_related("components", "labels", "field_values__field").order_by("backlog_position", "id")
        return Response(WorkItemSerializer(items, many=True).data)
```

Add to `WorkItemViewSet` (after `move`):

```python
    @action(detail=True, methods=["post"])
    def schedule(self, request, pk=None):
        item = self.get_object()
        raw_sprint = request.data.get("sprint")
        position = request.data.get("position", 0)
        try:
            position = int(position)
        except (TypeError, ValueError):
            raise ValidationError({"position": "Must be an integer."})

        new_sprint_id = None
        if raw_sprint is not None:
            try:
                new_sprint_id = int(raw_sprint)
            except (TypeError, ValueError):
                raise ValidationError({"sprint": "Must be an integer or null."})
            sprint = Sprint.objects.filter(pk=new_sprint_id).first()
            if not sprint or sprint.board_id != item.board_id:
                raise ValidationError({"sprint": "Sprint must belong to this item's board."})
            if sprint.state == Sprint.State.COMPLETED:
                raise ValidationError({"sprint": "Can't schedule into a completed sprint."})

        try:
            schedule_work_item(item, new_sprint_id, position)
        except WorkItem.DoesNotExist:
            raise Http404
        item.refresh_from_db()
        return Response(WorkItemSerializer(item).data)
```

- [ ] **Step 7: Wire the URLs**

`backlog`/`work_items`/`schedule` are all `@action` methods on already-registered/already-URL-wired viewsets (`BoardViewSet`, `SprintViewSet`, `WorkItemViewSet`) — `BoardViewSet`/`WorkItemViewSet` are `router.register()`-based, so their new `@action`s are automatically routed (same as how `move`/`work_items` already are). `SprintViewSet`'s `work_items` action needs an explicit `path()` in `boards/urls.py`, matching Task 1's `start`/`complete` pattern:

```python
    path(
        "sprints/<int:pk>/work-items/",
        SprintViewSet.as_view({"get": "work_items"}),
        name="sprint-work-items",
    ),
```

- [ ] **Step 8: Run the tests to confirm they pass**

Run: `docker compose run --rm web pytest boards/tests/test_backlog_and_scheduling.py -v`
Expected: 17 passed.

Run: `docker compose run --rm web pytest -v`
Expected: all tests pass (428 total).

- [ ] **Step 9: Update API docs**

In `docs/api.md`, add a section documenting `GET/POST /api/boards/{id}/sprints/`, `GET/PATCH/DELETE /api/sprints/{id}/`, `POST /api/sprints/{id}/start/`, `POST /api/sprints/{id}/complete/`, `GET /api/boards/{id}/backlog/`, `GET /api/sprints/{id}/work-items/`, and `POST /api/work-items/{id}/schedule/` — matching the style of the existing `/api/work-items/{id}/move/` section. Document `sprint`/`sprint_detail` on `/api/work-items/`, and the immutability rule (only `schedule/` changes it, same as `status`/`board`).

- [ ] **Step 10: Commit**

```bash
git add boards/ docs/api.md
git commit -m "Add WorkItem.sprint/backlog_position, schedule/, and backlog views"
```
