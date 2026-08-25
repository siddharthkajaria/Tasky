# Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production Django/DRF backend for Tasky's Releases feature (sub-project 7 of 13) — a project-scoped `Release` model (a named, shippable milestone like "v2.4.0") with a flat three-state lifecycle (`unreleased`/`released`/`archived`, no transition rules), CRUD endpoints, and a single nullable `WorkItem.release` FK so work items can be tagged with the release they ship in.

**Architecture:** One new model in the `boards` app (`Release`), following `Component`'s exact structural precedent (project-scoped, `on_delete=CASCADE` from `Project`, nested REST routes under `/api/projects/{id}/releases/`, Owner/Admin-write / any-member-read permission tier) plus `WorkItemStatus`'s exact case-insensitive duplicate-name check (`name__iexact` in `perform_create`/`perform_update`, since `Release.name` must be unique per project, case-insensitively, and DRF's automatic `UniqueTogetherValidator` can't fire here for the same reason it can't for `Component` — `project` is a read-only field sourced from the URL, not the request body). `WorkItem.release` is a single nullable FK (not M2M, per the spec's explicit scope decision) that behaves like `components`: an ordinary writable field on `WorkItemSerializer`, validated for same-project membership in `validate()`, with **no** immutability restriction on `PATCH` (unlike `status`/`sprint` — the spec is explicit that applying a release to a work item is an ordinary edit, no dedicated action endpoint, no side effects to protect).

**Tech Stack:** Django 5.2, DRF 3.16, MySQL, pytest-django. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-tasky-releases-design.md` (signed off — covered by the user's "Sign off on all 10 as-is" standing authorization; the `design/` prototype it argues from was built and browser-tested 2026-08-25)

## Global Constraints

- **Role vocabulary is `owner` / `admin` / `member`** (lowercase) — unchanged.
- **Unauthenticated request → `403`, never `401`** (existing site-wide convention, unchanged).
- **`Release` is project-scoped**, not global — `Release.project` is a real FK, mirroring `Component`, not global like `Label`.
- **One release per work item, via a plain nullable FK, not a M2M.** `WorkItem.release`, `on_delete=SET_NULL`, `blank=True`.
- **Lifecycle is a flat status plus one optional date, no transition rules.** `unreleased` (default) / `released` / `archived`. Any transition is allowed, including `unreleased` → `archived` directly. Ordinary `PATCH` changes `status`; there is no dedicated lifecycle-action endpoint (unlike `Sprint`'s `start`/`complete` — a release status change has no renumbering or locking side effects to protect).
- **`status` is not settable on `POST` create** — a release is always created `unreleased` regardless of what the client submits in the create body; only `PATCH` can change it afterward.
- **Duplicate `name` (case-insensitive) within the same project is rejected with `400`**; the same name in two different projects is allowed.
- **`DELETE` never blocks** — a release with work items assigned deletes unconditionally; `WorkItem.release` becomes `null` for every item that had it (DB-level `SET_NULL`, no application-level "in use" guard), matching `Component`, not `WorkItemStatus`'s `PROTECT`.
- **Cross-project integrity:** assigning a `Release` to a `WorkItem` from a different project is rejected with `400`, mirroring the existing `components`/`sprint` cross-project checks in `WorkItemSerializer.validate()`.
- **Applying a release to a work item is an ordinary edit** — any project member, no separate manage-tier permission check, no immutability restriction on `PATCH` (contrast with `status`/`sprint`, which are blocked on `PATCH` and require a dedicated action).
- **Default list ordering is `release_date` (nulls last), then `name`** — releases aren't rendered as ordered columns the way statuses are, so no `position` field.
- **Every migration is a plain additive `CreateModel`/`AddField`** — no existing column is touched, so no hand-written migration content is needed.

---

## Task 1: `Release` model and CRUD

**Files:**
- Create: `boards/migrations/0028_release.py`
- Modify: `boards/models.py`, `boards/serializers.py`, `boards/views.py`, `boards/urls.py`
- Test: `boards/tests/test_releases_api.py`

**Interfaces:**
- Consumes: `IsProjectMember`, the existing `Component`/`WorkItemStatus` viewset patterns (`get_project()`/`initial()` override for `list`/`create`, `name__iexact` duplicate check in `perform_create`/`perform_update`).
- Produces: `boards.models.Release` (`project`, `name`, `status`, `release_date`; `Release.Status` choices `unreleased`/`released`/`archived`). `boards.serializers.can_manage_releases(role) -> bool`, `ReleaseSerializer`. `GET/POST /api/projects/{id}/releases/`, `GET/PATCH/DELETE /api/projects/{id}/releases/{id}/`. No `work-items` list action yet — see this task's Step 5 note; Task 2 adds it once `WorkItem.release` exists. Task 2 imports `Release`, `ReleaseSerializer`, `ReleaseViewSet` from here.

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_releases_api.py`:

```python
import pytest

from boards.models import Release


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client, project):
    assert client.get(f"/api/projects/{project.id}/releases/").status_code == 403


@pytest.mark.django_db
def test_any_member_can_list_releases(auth_client, project):
    Release.objects.create(project=project, name="v2.3")
    response = auth_client.get(f"/api/projects/{project.id}/releases/")
    assert response.status_code == 200
    assert response.json()[0]["name"] == "v2.3"


@pytest.mark.django_db
def test_owner_can_create_a_release(auth_client, project):
    response = auth_client.post(
        f"/api/projects/{project.id}/releases/", {"name": "v2.4.0"}, content_type="application/json"
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "v2.4.0"
    assert body["status"] == "unreleased"
    assert body["release_date"] is None


@pytest.mark.django_db
def test_status_is_not_settable_on_create(auth_client, project):
    response = auth_client.post(
        f"/api/projects/{project.id}/releases/",
        {"name": "v2.4.0", "status": "released"},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json()["status"] == "unreleased"


@pytest.mark.django_db
def test_release_date_can_be_set_on_create(auth_client, project):
    response = auth_client.post(
        f"/api/projects/{project.id}/releases/",
        {"name": "v2.4.0", "release_date": "2026-09-01"},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json()["release_date"] == "2026-09-01"


@pytest.mark.django_db
def test_a_plain_member_cannot_create_a_release(auth_client, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    response = auth_client.post(
        f"/api/projects/{project.id}/releases/", {"name": "v2.4.0"}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_a_non_member_cannot_create_a_release(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    response = auth_client.post(
        f"/api/projects/{foreign.id}/releases/", {"name": "v1.0"}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_duplicate_release_name_in_the_same_project_is_rejected(auth_client, project):
    Release.objects.create(project=project, name="v2.3")
    response = auth_client.post(
        f"/api/projects/{project.id}/releases/", {"name": "v2.3"}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_duplicate_check_is_case_insensitive(auth_client, project):
    Release.objects.create(project=project, name="v2.3")
    response = auth_client.post(
        f"/api/projects/{project.id}/releases/", {"name": "V2.3"}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_the_same_release_name_in_two_different_projects_is_allowed(auth_client, project, user):
    from projects.models import Project, ProjectMembership

    other_project = Project.objects.create(key="OTHER", name="Other Project")
    ProjectMembership.objects.create(project=other_project, user=user, role="owner")
    Release.objects.create(project=project, name="v1.0")

    response = auth_client.post(
        f"/api/projects/{other_project.id}/releases/", {"name": "v1.0"}, content_type="application/json"
    )
    assert response.status_code == 201


@pytest.mark.django_db
def test_owner_can_rename_a_release(auth_client, project):
    release = Release.objects.create(project=project, name="Old name")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{release.id}/", {"name": "New name"}, content_type="application/json"
    )
    assert response.status_code == 200
    release.refresh_from_db()
    assert release.name == "New name"


@pytest.mark.django_db
def test_renaming_to_a_duplicate_name_is_rejected(auth_client, project):
    Release.objects.create(project=project, name="v2.3")
    other = Release.objects.create(project=project, name="v2.4.0")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{other.id}/", {"name": "v2.3"}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_owner_can_change_status_via_patch(auth_client, project):
    release = Release.objects.create(project=project, name="v2.3")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{release.id}/", {"status": "released"}, content_type="application/json"
    )
    assert response.status_code == 200
    release.refresh_from_db()
    assert release.status == "released"


@pytest.mark.django_db
def test_status_can_skip_straight_from_unreleased_to_archived(auth_client, project):
    release = Release.objects.create(project=project, name="v2.3")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{release.id}/", {"status": "archived"}, content_type="application/json"
    )
    assert response.status_code == 200
    release.refresh_from_db()
    assert release.status == "archived"


@pytest.mark.django_db
def test_release_date_can_be_changed_after_release_is_marked_released(auth_client, project):
    release = Release.objects.create(project=project, name="v2.3", status="released", release_date="2026-08-01")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{release.id}/",
        {"release_date": "2026-08-15"},
        content_type="application/json",
    )
    assert response.status_code == 200
    release.refresh_from_db()
    assert str(release.release_date) == "2026-08-15"


@pytest.mark.django_db
def test_release_date_can_be_cleared(auth_client, project):
    release = Release.objects.create(project=project, name="v2.3", release_date="2026-08-01")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{release.id}/",
        {"release_date": None},
        content_type="application/json",
    )
    assert response.status_code == 200
    release.refresh_from_db()
    assert release.release_date is None


@pytest.mark.django_db
def test_a_plain_member_cannot_rename_or_change_status(auth_client, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    release = Release.objects.create(project=project, name="v2.3")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{release.id}/", {"status": "released"}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_owner_can_delete_a_release(auth_client, project):
    release = Release.objects.create(project=project, name="Doomed")
    assert auth_client.delete(f"/api/projects/{project.id}/releases/{release.id}/").status_code == 204
    assert not Release.objects.filter(id=release.id).exists()


@pytest.mark.django_db
def test_a_plain_member_cannot_delete_a_release(auth_client, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    release = Release.objects.create(project=project, name="v2.3")
    response = auth_client.delete(f"/api/projects/{project.id}/releases/{release.id}/")
    assert response.status_code == 403
    assert Release.objects.filter(id=release.id).exists()


@pytest.mark.django_db
def test_genuinely_nonexistent_release_returns_404(auth_client, project):
    assert auth_client.get(f"/api/projects/{project.id}/releases/999999/").status_code == 404
    assert auth_client.patch(
        f"/api/projects/{project.id}/releases/999999/", {"name": "X"}, content_type="application/json"
    ).status_code == 404
    assert auth_client.delete(f"/api/projects/{project.id}/releases/999999/").status_code == 404


@pytest.mark.django_db
def test_a_non_member_cannot_list_or_view_releases(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    release = Release.objects.create(project=foreign, name="v1.0")

    assert auth_client.get(f"/api/projects/{foreign.id}/releases/").status_code == 403
    assert auth_client.get(f"/api/projects/{foreign.id}/releases/{release.id}/").status_code == 403
```

**Note:** the `.../work-items/` action deliberately has no test here — it depends on `WorkItem.release`, which doesn't exist until Task 2. Task 1 does not implement the `work_items` action at all (see Step 5's note); Task 2 adds it alongside the field it depends on, plus its tests (including a non-member 403 check on it).

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `docker compose run --rm web pytest boards/tests/test_releases_api.py -v`
Expected: FAIL — `ImportError` (`Release` doesn't exist yet).

- [ ] **Step 3: Add the model**

In `boards/models.py`, add `from django.db.models import F` to the imports at the top of the file if not already present (check first — `F` may already be imported for another purpose). Add, after the `Component` class:

```python
class Release(models.Model):
    class Status(models.TextChoices):
        UNRELEASED = "unreleased", "Unreleased"
        RELEASED = "released", "Released"
        ARCHIVED = "archived", "Archived"

    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="releases")
    name = models.CharField(max_length=80)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.UNRELEASED)
    release_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = [F("release_date").asc(nulls_last=True), "name"]
        constraints = [
            models.UniqueConstraint(fields=["project", "name"], name="unique_release_name_per_project"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.project})"
```

```bash
docker compose run --rm web python manage.py makemigrations boards -n release
```

Confirm the generated file is `boards/migrations/0028_release.py` (it follows `0027_workitem_sprint_and_backlog_position.py`).

- [ ] **Step 4: Add the permission helper and serializer**

In `boards/serializers.py`, add near `can_manage_components`:

```python
def can_manage_releases(role):
    return role in ("owner", "admin")
```

Update the `from .models import ...` line to include `Release`. Add, after `ComponentSerializer`:

```python
class ReleaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Release
        fields = ["id", "project", "name", "status", "release_date"]
        read_only_fields = ["project"]

    def validate_name(self, value):
        clean = value.strip()
        if not clean:
            raise serializers.ValidationError("This field may not be blank.")
        return clean
```

`status` is deliberately left writable at the serializer level (not `read_only`) — `PATCH` needs to change it. The "not settable on create" rule is enforced in the viewset's `perform_create` below, which always saves `status=Release.Status.UNRELEASED` regardless of what the client submits.

- [ ] **Step 5: Add the viewset**

In `boards/views.py`, update the `from .models import ...` line to include `Release`, and the `.serializers import (...)` block to include `ReleaseSerializer, can_manage_releases`. Add, after `ComponentViewSet`:

```python
class ReleaseViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete"]
    serializer_class = ReleaseSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    pagination_class = None

    def get_project(self):
        from projects.models import Project

        return get_object_or_404(Project, pk=self.kwargs["project_pk"])

    def get_queryset(self):
        return Release.objects.filter(project_id=self.kwargs["project_pk"])

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if self.action in ("list", "create"):
            self.check_object_permissions(request, self.get_project())

    def perform_create(self, serializer):
        project = self.get_project()
        role = project.memberships.get(user=self.request.user).role
        if not can_manage_releases(role):
            raise PermissionDenied("You don't have permission to manage releases.")
        name = serializer.validated_data.get("name")
        if Release.objects.filter(project=project, name__iexact=name).exists():
            raise ValidationError({"name": f'"{name}" already exists.'})
        serializer.save(project=project, status=Release.Status.UNRELEASED)

    def perform_update(self, serializer):
        instance = serializer.instance
        role = instance.project.memberships.get(user=self.request.user).role
        if not can_manage_releases(role):
            raise PermissionDenied("You don't have permission to manage releases.")
        name = serializer.validated_data.get("name")
        if name and Release.objects.filter(
            project=instance.project, name__iexact=name
        ).exclude(pk=instance.pk).exists():
            raise ValidationError({"name": f'"{name}" already exists.'})
        serializer.save()

    def perform_destroy(self, instance):
        role = instance.project.memberships.get(user=self.request.user).role
        if not can_manage_releases(role):
            raise PermissionDenied("You don't have permission to manage releases.")
        instance.delete()
```

**Note:** no `work_items` action here. `GET .../releases/{id}/work-items/` needs `WorkItem.release` to filter by, which doesn't exist until Task 2 adds the field — Task 2 adds this action to `ReleaseViewSet` alongside it, not this task.

- [ ] **Step 6: Wire the URLs**

In `boards/urls.py`, update the import to include `ReleaseViewSet`, and add (alongside the existing `projects/<int:project_pk>/components/...` paths):

```python
    path(
        "projects/<int:project_pk>/releases/",
        ReleaseViewSet.as_view({"get": "list", "post": "create"}),
        name="project-releases",
    ),
    path(
        "projects/<int:project_pk>/releases/<int:pk>/",
        ReleaseViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="project-release-detail",
    ),
```

Task 2 adds the `.../work-items/` path entry once its action exists.

- [ ] **Step 7: Run the tests to confirm they pass**

Run: `docker compose run --rm web pytest boards/tests/test_releases_api.py -v`
Expected: 21 passed.

Run: `docker compose run --rm web pytest -v`
Expected: all tests pass (454 total).

- [ ] **Step 8: Commit**

```bash
git add boards/
git commit -m "Add Release model and CRUD"
```

---

## Task 2: `WorkItem.release` wiring

**Files:**
- Create: `boards/migrations/0029_workitem_release.py`
- Modify: `boards/models.py`, `boards/serializers.py`
- Test: `boards/tests/test_release_assignment.py`

**Interfaces:**
- Consumes: `Release`, `ReleaseSerializer`, `ReleaseViewSet` (Task 1).
- Produces: `WorkItem.release` (nullable FK to `Release`, `on_delete=SET_NULL`, `related_name="work_items"`). `WorkItemSerializer` gains `release`/`release_detail`. `GET /api/projects/{id}/releases/{id}/work-items/` (the action Task 1 deliberately left out).

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_release_assignment.py`:

```python
import pytest

from boards.models import Board, Release, WorkItem, WorkItemStatus
from boards.services import seed_default_statuses


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def status(board, project):
    seed_default_statuses(project)
    return WorkItemStatus.objects.filter(project=project, category="todo").first()


@pytest.mark.django_db
def test_a_new_work_item_defaults_to_no_release(auth_client, board, status):
    response = auth_client.post(
        "/api/work-items/", {"board": board.id, "title": "X", "status": status.id}, content_type="application/json"
    )
    assert response.status_code == 201
    assert response.json()["release"] is None
    assert response.json()["release_detail"] is None


@pytest.mark.django_db
def test_any_member_can_apply_an_existing_release_to_a_work_item(auth_client, board, project, status):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    release = Release.objects.create(project=project, name="v2.3")
    item = WorkItem.objects.create(board=board, title="Needs tagging", status=status)

    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"release": release.id}, content_type="application/json"
    )

    assert response.status_code == 200
    assert response.json()["release_detail"]["name"] == "v2.3"


@pytest.mark.django_db
def test_a_release_can_be_set_on_create(auth_client, board, project, status):
    release = Release.objects.create(project=project, name="v2.3")
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "status": status.id, "release": release.id},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json()["release"] == release.id


@pytest.mark.django_db
def test_a_release_can_be_cleared(auth_client, board, status, project):
    release = Release.objects.create(project=project, name="v2.3")
    item = WorkItem.objects.create(board=board, title="X", status=status, release=release)
    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"release": None}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.release_id is None


@pytest.mark.django_db
def test_a_release_from_another_project_cannot_be_applied(auth_client, board, other_user, status):
    from projects.models import Project, ProjectMembership

    foreign_project = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign_project, user=other_user, role="owner")
    foreign_release = Release.objects.create(project=foreign_project, name="Not applicable")
    item = WorkItem.objects.create(board=board, title="Item", status=status)

    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"release": foreign_release.id}, content_type="application/json"
    )

    assert response.status_code == 400
    assert "release" in response.json()


@pytest.mark.django_db
def test_deleting_a_release_clears_it_from_work_items_without_deleting_them(auth_client, board, project, status):
    release = Release.objects.create(project=project, name="v2.3")
    item = WorkItem.objects.create(board=board, title="Has a release", status=status, release=release)

    auth_client.delete(f"/api/projects/{project.id}/releases/{release.id}/")

    item.refresh_from_db()
    assert WorkItem.objects.filter(id=item.id).exists()
    assert item.release_id is None


@pytest.mark.django_db
def test_release_can_be_changed_alongside_other_fields_in_one_patch(auth_client, board, project, status):
    release_a = Release.objects.create(project=project, name="v2.3")
    release_b = Release.objects.create(project=project, name="v2.4.0")
    item = WorkItem.objects.create(board=board, title="Old title", status=status, release=release_a)

    response = auth_client.patch(
        f"/api/work-items/{item.id}/",
        {"title": "New title", "release": release_b.id},
        content_type="application/json",
    )

    assert response.status_code == 200
    item.refresh_from_db()
    assert item.title == "New title"
    assert item.release_id == release_b.id


@pytest.mark.django_db
def test_release_work_items_lists_only_items_assigned_to_it(auth_client, board, project, status):
    release = Release.objects.create(project=project, name="v2.3")
    other_release = Release.objects.create(project=project, name="v2.4.0")
    tagged = WorkItem.objects.create(board=board, title="Tagged", status=status, release=release)
    WorkItem.objects.create(board=board, title="Untagged", status=status)
    WorkItem.objects.create(board=board, title="Different release", status=status, release=other_release)

    response = auth_client.get(f"/api/projects/{project.id}/releases/{release.id}/work-items/")
    assert response.status_code == 200
    ids = [item["id"] for item in response.json()]
    assert ids == [tagged.id]


@pytest.mark.django_db
def test_a_non_member_cannot_view_release_work_items(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    release = Release.objects.create(project=foreign, name="v1.0")

    assert auth_client.get(f"/api/projects/{foreign.id}/releases/{release.id}/work-items/").status_code == 403
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `docker compose run --rm web pytest boards/tests/test_release_assignment.py -v`
Expected: FAIL — `TypeError`/`django.db.utils.OperationalError` (no `release` column exists yet).

- [ ] **Step 3: Add the field**

In `boards/models.py`, in the `WorkItem` class, add right after the existing `sprint` field:

```python
    release = models.ForeignKey(
        "Release", on_delete=models.SET_NULL, null=True, blank=True, related_name="work_items"
    )
```

```bash
docker compose run --rm web python manage.py makemigrations boards -n workitem_release
```

Confirm the generated file is `boards/migrations/0029_workitem_release.py`.

- [ ] **Step 4: Add the `work_items` action and wire its URL**

Now that `WorkItem.release` exists (`related_name="work_items"`), add this action to `ReleaseViewSet` in `boards/views.py` (Task 1 deliberately left it out — see that task's note):

```python
    @action(detail=True, methods=["get"], url_path="work-items")
    def work_items(self, request, pk=None):
        release = self.get_object()
        items = release.work_items.select_related(
            "assignee", "created_by", "parent", "parent__status", "status", "sprint"
        ).prefetch_related("components", "labels", "field_values__field")
        return Response(WorkItemSerializer(items, many=True).data)
```

In `boards/urls.py`, add, alongside the existing `projects/<int:project_pk>/releases/...` paths:

```python
    path(
        "projects/<int:project_pk>/releases/<int:pk>/work-items/",
        ReleaseViewSet.as_view({"get": "work_items"}),
        name="project-release-work-items",
    ),
```

- [ ] **Step 5: Wire `WorkItemSerializer`**

In `boards/serializers.py`, update the `from .models import ...` line to include `Release`. Add one field to `WorkItemSerializer`, right after `components_detail`:

```python
    release_detail = ReleaseSerializer(source="release", read_only=True)
```

Add `"release", "release_detail"` to `Meta.fields`, right after `"components", "components_detail"`. `release` itself needs no explicit field declaration — `ModelSerializer` auto-generates a `PrimaryKeyRelatedField(required=False, allow_null=True)` for it from the model's own FK, the same as it already does for `parent`/`sprint`.

In `WorkItemSerializer.validate()`, add a cross-project check alongside the existing `components`/`sprint` checks (after the `sprint` block, before the `custom_fields` block):

```python
        if attrs.get("release") is not None:
            release = attrs["release"]
            if release.project_id != board.project_id:
                raise serializers.ValidationError({"release": "Release must belong to this item's project."})
```

This uses the same `board` local variable the `status`/`sprint` checks above it already resolved — no new lookup needed. `release` is not added to `boards/views.py`'s `update()` immutability-check block — per the spec, applying a release is an ordinary edit, unlike `status`/`sprint`.

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `docker compose run --rm web pytest boards/tests/test_release_assignment.py -v`
Expected: 9 passed.

Run: `docker compose run --rm web pytest -v`
Expected: all tests pass (463 total).

- [ ] **Step 7: Update API docs**

In `docs/api.md`, add a section documenting `GET/POST /api/projects/{id}/releases/`, `GET/PATCH/DELETE /api/projects/{id}/releases/{id}/`, and `GET /api/projects/{id}/releases/{id}/work-items/` — matching the style of the existing Components section. Document `release`/`release_detail` on `/api/work-items/`, and that (unlike `status`/`sprint`) it's an ordinary writable field with no immutability restriction.

- [ ] **Step 8: Commit**

```bash
git add boards/ docs/api.md
git commit -m "Add WorkItem.release wiring"
```
