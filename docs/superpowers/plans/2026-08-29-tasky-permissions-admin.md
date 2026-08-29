# Permissions & Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production Django/DRF backend for Tasky's Permissions & Admin feature (sub-project 9 of 13) — a Site-Admin-only API for creating and deactivating user accounts, Owner-only project archiving (visibility-only), and widening the existing global-resource-management check to also accept Site Admins.

**Architecture:** Three independent pieces, each touching a different app boundary. (1) A new `accounts/permissions.py` (`IsSiteAdmin`, mirroring `projects/permissions.py`'s `IsProjectMember` shape) gates a new `AdminUserViewSet` registered at `/api/admin/users/` in `accounts/urls.py` via a `DefaultRouter`, reusing Django's built-in `User.is_staff` flag as "Site Admin" — no new field, no migration for this piece. (2) `Project` gains three columns (`is_archived`, `archived_at`, `archived_by`) via one additive migration; `archive`/`unarchive` are two new `POST` actions on the existing `ProjectViewSet`, mirroring `transfer_ownership`'s exact shape (`Owner`-only, object-level `IsProjectMember` via `get_object()`), and the `list` action's queryset gains an `?include_archived=true` filter. (3) `boards/serializers.py`'s `user_can_manage_definitions` gains one new branch (`if user.is_staff: return True`) ahead of its existing "Owner of any project" check — every call site (Labels/Custom Fields/Screens/Workflows) is unchanged, since the function's contract doesn't change, only who satisfies it.

**Tech Stack:** Django 5.2, DRF 3.16, MySQL, pytest-django. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-tasky-permissions-admin-design.md` (signed off — covered by the user's "Sign off on all 10 as-is" standing authorization; the `design/` prototype it argues from was built and browser-tested 2026-08-29)

## Global Constraints

- **Role vocabulary is `owner` / `admin` / `member`** (lowercase) — unchanged.
- **Unauthenticated request → `403`, never `401`** (existing site-wide convention, unchanged).
- **Site Admin reuses `User.is_staff`** — no new field, no new migration for the admin-user piece. `is_superuser` is untouched and unused by this feature.
- **`/api/admin/users/...` has no non-admin view at all** — every route 403s for a non-`is_staff` user, including `GET` (list). This is a stricter gate than Labels/Custom Fields/Screens, which stay readable for everyone and only lock their edit controls.
- **No `DELETE` on a user account** — `PATCH {is_active: false}` (deactivation) is the only disable primitive. A hard delete would cascade through `ProjectMembership` (`on_delete=CASCADE`) and silently strip someone out of every project's member list.
- **Self-lockout guard**: `PATCH` on your own account rejects `is_active` or `is_staff` in the payload with `400`, regardless of the value sent. `first_name`/`last_name` on your own row are unaffected.
- **Last-Site-Admin guard**: `PATCH {is_staff: false}` on someone else's row is rejected with `400` if it would leave zero `is_staff=True` users.
- **Deactivating a project Owner does not touch `ProjectMembership`** — the project's Owner of record is unchanged; only login is blocked.
- **`user_can_manage_definitions` is widened, never narrowed** — `is_staff` is an additional way to satisfy it, alongside the existing "Owner of any project" branch. Every existing Owner keeps everything they already had.
- **Project archiving is visibility-only** — `GET /api/projects/` excludes archived projects by default (`?include_archived=true` includes them); nothing about an archived project's boards, work items, or any other write path becomes read-only. `Project.delete()` (hard delete) is untouched and unrelated.
- **`archive`/`unarchive` are Owner-only** — one tier stricter than the Owner/Admin split every other per-project manage action (`Component`, `WorkItemStatus`, `Sprint`, `Release`) already uses.
- **Every migration is a plain additive `AddField`** — no existing column is touched.

---

## Task 1: Site Admin user account management

**Files:**
- Create: `accounts/permissions.py`
- Modify: `accounts/serializers.py`, `accounts/views.py`, `accounts/urls.py`
- Test: `accounts/tests/test_admin_users_api.py`

**Interfaces:**
- Consumes: `accounts.models.User` (`is_staff`, `is_active`, already present via `AbstractUser`), Django's `authenticate()` (already rejects `is_active=False` accounts — no change needed to `LoginView`).
- Produces: `accounts.permissions.IsSiteAdmin`. `accounts.serializers.AdminUserSerializer`, `AdminUserCreateSerializer`, `AdminUserUpdateSerializer`. `GET/POST /api/admin/users/`, `GET/PATCH /api/admin/users/{id}/`.

- [ ] **Step 1: Write the failing tests**

Create `accounts/tests/test_admin_users_api.py`:

```python
import pytest
from django.contrib.auth import get_user_model


@pytest.fixture
def site_admin(db):
    return get_user_model().objects.create_user(
        username="admin1", password="pw-admin1-12345", is_staff=True,
    )


@pytest.fixture
def other_site_admin(db):
    return get_user_model().objects.create_user(
        username="admin2", password="pw-admin2-12345", is_staff=True,
    )


@pytest.fixture
def admin_client(client, site_admin):
    client.force_login(site_admin)
    return client


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client):
    assert client.get("/api/admin/users/").status_code == 403


@pytest.mark.django_db
def test_non_staff_user_gets_403_on_list(auth_client):
    assert auth_client.get("/api/admin/users/").status_code == 403


@pytest.mark.django_db
def test_non_staff_user_gets_403_on_create(auth_client):
    response = auth_client.post(
        "/api/admin/users/",
        {"username": "newperson", "password": "pw-newperson-12345"},
        content_type="application/json",
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_non_staff_user_gets_403_on_retrieve(auth_client, other_user):
    assert auth_client.get(f"/api/admin/users/{other_user.id}/").status_code == 403


@pytest.mark.django_db
def test_non_staff_user_gets_403_on_update(auth_client, other_user):
    response = auth_client.patch(
        f"/api/admin/users/{other_user.id}/", {"is_active": False}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_site_admin_can_list_all_users_active_and_inactive(admin_client, site_admin, other_user):
    other_user.is_active = False
    other_user.save()
    response = admin_client.get("/api/admin/users/")
    assert response.status_code == 200
    usernames = {u["username"] for u in response.json()}
    assert usernames == {site_admin.username, other_user.username}
    inactive_row = next(u for u in response.json() if u["username"] == other_user.username)
    assert inactive_row["is_active"] is False


@pytest.mark.django_db
def test_site_admin_can_create_a_user_account_and_it_can_log_in(admin_client, client):
    response = admin_client.post(
        "/api/admin/users/",
        {"username": "newperson", "password": "pw-newperson-12345", "first_name": "New"},
        content_type="application/json",
    )
    assert response.status_code == 201
    body = response.json()
    assert body["username"] == "newperson"
    assert body["is_active"] is True
    assert body["is_staff"] is False

    login = client.post(
        "/api/auth/login/",
        {"username": "newperson", "password": "pw-newperson-12345"},
        content_type="application/json",
    )
    assert login.status_code == 200


@pytest.mark.django_db
def test_creating_with_a_duplicate_username_is_rejected(admin_client, site_admin):
    response = admin_client.post(
        "/api/admin/users/",
        {"username": site_admin.username, "password": "pw-whatever-12345"},
        content_type="application/json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_creating_without_a_password_is_rejected(admin_client):
    response = admin_client.post(
        "/api/admin/users/", {"username": "onlyusername"}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_deactivating_an_account_blocks_login_then_reactivating_restores_it(
    admin_client, client, other_user
):
    deactivate = admin_client.patch(
        f"/api/admin/users/{other_user.id}/", {"is_active": False}, content_type="application/json"
    )
    assert deactivate.status_code == 200
    assert deactivate.json()["is_active"] is False

    login_attempt = client.post(
        "/api/auth/login/",
        {"username": other_user.username, "password": "pw-bob-12345"},
        content_type="application/json",
    )
    assert login_attempt.status_code == 400

    reactivate = admin_client.patch(
        f"/api/admin/users/{other_user.id}/", {"is_active": True}, content_type="application/json"
    )
    assert reactivate.status_code == 200

    login_again = client.post(
        "/api/auth/login/",
        {"username": other_user.username, "password": "pw-bob-12345"},
        content_type="application/json",
    )
    assert login_again.status_code == 200


@pytest.mark.django_db
def test_site_admin_cannot_deactivate_or_revoke_own_status(admin_client, site_admin):
    for payload in ({"is_active": False}, {"is_staff": False}):
        response = admin_client.patch(
            f"/api/admin/users/{site_admin.id}/", payload, content_type="application/json"
        )
        assert response.status_code == 400


@pytest.mark.django_db
def test_site_admin_can_rename_their_own_account(admin_client, site_admin):
    response = admin_client.patch(
        f"/api/admin/users/{site_admin.id}/", {"first_name": "Renamed"}, content_type="application/json"
    )
    assert response.status_code == 200
    assert response.json()["first_name"] == "Renamed"


@pytest.mark.django_db
def test_revoking_one_of_two_site_admins_is_allowed(admin_client, site_admin, other_site_admin):
    response = admin_client.patch(
        f"/api/admin/users/{other_site_admin.id}/", {"is_staff": False}, content_type="application/json"
    )
    assert response.status_code == 200
    other_site_admin.refresh_from_db()
    assert other_site_admin.is_staff is False


def test_can_revoke_site_admin_guard_rejects_leaving_zero():
    """Direct unit test of the guard's own arithmetic (accounts/permissions.py),
    not an HTTP round-trip: the self-lockout guard already means an acting
    admin can never revoke their OWN is_staff, and the acting admin always
    counts toward "how many would remain" for any OTHER row they revoke —
    so "revoke someone else's is_staff and it would leave zero" can never
    actually happen in a single request from one session. It's a real
    safety net for a genuinely different case (two Site Admins' requests
    racing in production), which a single synchronous test process can't
    reproduce — so the guard's decision rule is tested directly instead."""
    from accounts.permissions import can_revoke_site_admin

    assert can_revoke_site_admin(other_staff_count=1) is True
    assert can_revoke_site_admin(other_staff_count=0) is False


@pytest.mark.django_db
def test_deactivating_a_project_owner_does_not_touch_membership(admin_client, user, project):
    from projects.models import ProjectMembership

    response = admin_client.patch(
        f"/api/admin/users/{user.id}/", {"is_active": False}, content_type="application/json"
    )
    assert response.status_code == 200
    membership = ProjectMembership.objects.get(project=project, user=user)
    assert membership.role == "owner"


@pytest.mark.django_db
def test_genuinely_nonexistent_user_id_returns_404(admin_client):
    assert admin_client.get("/api/admin/users/999999/").status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web pytest accounts/tests/test_admin_users_api.py -v`
Expected: FAIL — `/api/admin/users/` doesn't exist yet (404s from the SPA catch-all, not the 403s the tests expect).

- [ ] **Step 3: Write the minimal implementation**

Create `accounts/permissions.py`:

```python
"""Site Admin gate — mirrors projects/permissions.py's IsProjectMember
shape. Unlike IsProjectMember, this is view-level only (has_permission,
not has_object_permission): every route under /api/admin/users/ needs the
same "is the caller a Site Admin" check regardless of which user id is
being looked at, so there's no per-object variation to layer on top."""

from rest_framework.permissions import BasePermission


class IsSiteAdmin(BasePermission):
    message = "Only a Site Admin can manage user accounts."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)


# Revoking someone else's is_staff is blocked once it would leave zero
# Site Admins. `other_staff_count` is how many *other* is_staff users
# exist besides the one being revoked — see the self-lockout note on
# AdminUserViewSet.perform_update for why this can never actually
# evaluate to False from a single acting admin's own request in practice,
# and why it's still real, load-bearing code for concurrent sessions.
def can_revoke_site_admin(other_staff_count):
    return other_staff_count > 0
```

Modify `accounts/serializers.py` — add after the existing `UserSerializer`:

```python
class AdminUserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = get_user_model()
        fields = [
            "id", "username", "display_name", "first_name", "last_name",
            "is_active", "is_staff", "date_joined",
        ]
        read_only_fields = fields


class AdminUserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = get_user_model()
        fields = ["id", "username", "password", "first_name", "last_name"]
        extra_kwargs = {
            "first_name": {"required": False},
            "last_name": {"required": False},
        }

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = get_user_model()(**validated_data)
        user.set_password(password)
        user.save()
        return user


class AdminUserUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        fields = ["is_active", "is_staff", "first_name", "last_name"]
```

(`accounts/serializers.py` already has `from django.contrib.auth import get_user_model` and `from rest_framework import serializers` at the top — no new imports needed.)

Modify `accounts/views.py` — add imports and the new viewset:

```python
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import IsSiteAdmin, can_revoke_site_admin
from .serializers import (
    AdminUserCreateSerializer,
    AdminUserSerializer,
    AdminUserUpdateSerializer,
    LoginSerializer,
    UserSerializer,
)
```

(replace the existing `from .serializers import LoginSerializer, UserSerializer` line with the block above, and add `mixins`, `viewsets`, `ValidationError`, `IsAuthenticated` to the existing `rest_framework` imports.)

Append to `accounts/views.py`:

```python
class AdminUserViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Deliberately no DELETE — is_active is the only disable primitive
    (see the spec's Error handling table): a hard delete would cascade
    through ProjectMembership and silently strip someone out of every
    project's member list."""

    queryset = get_user_model().objects.all().order_by("username")
    permission_classes = [IsAuthenticated, IsSiteAdmin]

    def get_serializer_class(self):
        if self.action == "create":
            return AdminUserCreateSerializer
        if self.action in ("update", "partial_update"):
            return AdminUserUpdateSerializer
        return AdminUserSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(AdminUserSerializer(user).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        target = serializer.instance
        touches_own_admin_or_active = (
            target.id == self.request.user.id
            and ("is_active" in self.request.data or "is_staff" in self.request.data)
        )
        if touches_own_admin_or_active:
            raise ValidationError({"detail": "You can't change your own admin or active status."})

        # Note: since touches_own_admin_or_active already rejects touching
        # your OWN is_staff, and the acting user must themselves be
        # is_staff to reach this method at all (IsSiteAdmin), the acting
        # user always counts toward other_staff_count for any OTHER row
        # they revoke — so this branch can't reject a single acting
        # admin's own request in practice. It's real protection against
        # two Site Admins' requests racing concurrently in production;
        # see can_revoke_site_admin's own docstring-equivalent comment.
        revoking_staff = (
            "is_staff" in self.request.data
            and serializer.validated_data.get("is_staff") is False
            and target.is_staff
        )
        if revoking_staff:
            other_staff_count = get_user_model().objects.filter(is_staff=True).exclude(id=target.id).count()
            if not can_revoke_site_admin(other_staff_count):
                raise ValidationError({"detail": "At least one Site Admin must remain."})

        serializer.save()

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        return Response(AdminUserSerializer(self.get_object()).data, status=response.status_code)
```

Modify `accounts/urls.py`:

```python
from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AdminUserViewSet, CsrfView, LoginView, LogoutView, MeView, UserListView

router = DefaultRouter()
router.register("admin/users", AdminUserViewSet, basename="admin-user")

urlpatterns = [
    path("auth/csrf/", CsrfView.as_view(), name="csrf"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("users/", UserListView.as_view(), name="user-list"),
] + router.urls
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm web pytest accounts/tests/test_admin_users_api.py -v`
Expected: PASS (16 tests)

- [ ] **Step 5: Document the new endpoints**

Modify `docs/api.md` — add a new section after `## Auth` (before `## Boards`):

```markdown
## Admin: user accounts
Site Admin only (`User.is_staff`, reused rather than a new field) — unlike every other
admin-ish screen in this app (Labels, Custom Fields, Screens), there is **no non-admin view
of this at all**: a plain user gets `403` on every route here, including `GET` (list).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/users/` | every user, active and inactive |
| POST | `/api/admin/users/` | `{username, password, first_name?, last_name?}`; `400` on a duplicate username or a missing username/password |
| GET | `/api/admin/users/{id}/` | includes `is_active`, `is_staff`, `date_joined` |
| PATCH | `/api/admin/users/{id}/` | `{is_active?, is_staff?, first_name?, last_name?}` — activate/deactivate, grant/revoke Site Admin |

**No `DELETE`** — deactivation (`is_active=false`) is the only disable primitive; a hard delete
would cascade through `ProjectMembership` and silently strip someone out of every project's
member list.

**Self-lockout**: `PATCH` on your own account rejects `is_active` or `is_staff` in the payload
with `400`, regardless of value — `first_name`/`last_name` on your own row are unaffected.

**Last-Site-Admin guard**: revoking someone else's `is_staff` is rejected with `400` if it would
leave zero Site Admins.

**Deactivating a project Owner does not touch their `ProjectMembership`** — the project's Owner
of record is unchanged; only login is blocked.
```

- [ ] **Step 6: Commit**

```bash
git add accounts/permissions.py accounts/serializers.py accounts/views.py accounts/urls.py accounts/tests/test_admin_users_api.py docs/api.md
git commit -m "Add Site Admin user account management API"
```

---

## Task 2: Project archiving

**Files:**
- Create: `projects/migrations/0003_project_archiving.py`
- Modify: `projects/models.py`, `projects/permissions.py`, `projects/serializers.py`, `projects/views.py`
- Test: `projects/tests/test_project_archiving.py`

**Interfaces:**
- Consumes: `IsProjectMember`, `ProjectViewSet.get_object()`, `UserSerializer` (for `archived_by_detail`).
- Produces: `Project.is_archived` / `archived_at` / `archived_by`. `projects.permissions.can_manage_archive`. `POST /api/projects/{id}/archive/`, `POST /api/projects/{id}/unarchive/`, `GET /api/projects/?include_archived=true`.

- [ ] **Step 1: Write the failing tests**

Create `projects/tests/test_project_archiving.py`:

```python
import pytest

from boards.models import Board, WorkItem, WorkItemStatus
from boards.services import seed_default_statuses
from projects.models import Project, ProjectMembership


@pytest.mark.django_db
def test_owner_can_archive_a_project(auth_client, project):
    response = auth_client.post(f"/api/projects/{project.id}/archive/")
    assert response.status_code == 200
    body = response.json()
    assert body["is_archived"] is True
    assert body["archived_at"] is not None
    assert body["archived_by_detail"]["username"] == "alice"

    project.refresh_from_db()
    assert project.is_archived is True
    assert project.archived_by_id is not None


@pytest.mark.django_db
def test_admin_and_member_get_403_archiving(auth_client, project, other_user):
    ProjectMembership.objects.create(project=project, user=other_user, role="admin")
    client_as_admin = auth_client
    client_as_admin.force_login(other_user)
    response = client_as_admin.post(f"/api/projects/{project.id}/archive/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_non_member_gets_403_not_404_archiving(auth_client, other_user):
    other_project = Project.objects.create(key="OTHR", name="Other")
    ProjectMembership.objects.create(project=other_project, user=other_user, role="owner")
    response = auth_client.post(f"/api/projects/{other_project.id}/archive/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_double_archive_returns_400(auth_client, project):
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.post(f"/api/projects/{project.id}/archive/")
    assert response.status_code == 400


@pytest.mark.django_db
def test_unarchiving_a_non_archived_project_returns_400(auth_client, project):
    response = auth_client.post(f"/api/projects/{project.id}/unarchive/")
    assert response.status_code == 400


@pytest.mark.django_db
def test_owner_can_unarchive(auth_client, project):
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.post(f"/api/projects/{project.id}/unarchive/")
    assert response.status_code == 200
    body = response.json()
    assert body["is_archived"] is False
    assert body["archived_at"] is None
    assert body["archived_by_detail"] is None


@pytest.mark.django_db
def test_archived_projects_excluded_from_default_list(auth_client, project):
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.get("/api/projects/")
    keys = {p["key"] for p in response.json()}
    assert project.key not in keys


@pytest.mark.django_db
def test_include_archived_query_param_includes_them(auth_client, project):
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.get("/api/projects/?include_archived=true")
    keys = {p["key"] for p in response.json()}
    assert project.key in keys


@pytest.mark.django_db
def test_archived_projects_boards_and_work_items_remain_fully_writable(auth_client, project, user):
    board = Board.objects.create(name="Board", created_by=user, project=project)
    seed_default_statuses(project)
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    item = WorkItem.objects.create(board=board, title="Still editable", status=status)

    auth_client.post(f"/api/projects/{project.id}/archive/")

    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"title": "Edited after archive"}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.title == "Edited after archive"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web pytest projects/tests/test_project_archiving.py -v`
Expected: FAIL — `is_archived` isn't a field on `Project` yet, `/archive/`/`/unarchive/` don't exist.

- [ ] **Step 3: Write the minimal implementation**

Modify `projects/models.py` — add to the `Project` class, after `created_at`:

```python
    is_archived = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
    # SET_NULL, matching Invitation.invited_by's existing pattern — knowing
    # who archived a project is nice-to-have, not load-bearing, so a
    # deleted admin account shouldn't block anything.
    archived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="projects_archived",
    )
```

Create `projects/migrations/0003_project_archiving.py`:

```python
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("projects", "0002_project_next_item_number"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="is_archived",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="project",
            name="archived_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="project",
            name="archived_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="projects_archived",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
```

Modify `projects/permissions.py` — add after `can_leave`:

```python
def can_manage_archive(acting_role):
    return acting_role == OWNER
```

Modify `projects/serializers.py` — update `ProjectSerializer`:

```python
class ProjectSerializer(serializers.ModelSerializer):
    my_role = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    archived_by_detail = UserSerializer(source="archived_by", read_only=True)

    class Meta:
        model = Project
        fields = [
            "id", "key", "name", "description", "my_role", "member_count", "created_at",
            "is_archived", "archived_at", "archived_by_detail",
        ]
        read_only_fields = ["created_at", "is_archived", "archived_at"]

    def get_my_role(self, obj):
        membership = obj.memberships.filter(user=self.context["request"].user).first()
        return membership.role if membership else None

    def get_member_count(self, obj):
        return obj.memberships.count()

    def validate_key(self, value):
        value = value.strip().upper()
        if not KEY_PATTERN.match(value):
            raise serializers.ValidationError("Key must be 2–10 letters, e.g. TASKY.")
        if Project.objects.filter(key=value).exists():
            raise serializers.ValidationError(f'"{value}" is already taken.')
        return value
```

(only the class body changes — `get_my_role`/`get_member_count`/`validate_key` are shown for
context and are unchanged.)

Modify `projects/views.py`:

```python
from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Invitation, Project, ProjectMembership
from .permissions import (
    IsProjectMember,
    can_change_role,
    can_delete_project,
    can_invite,
    can_leave,
    can_manage_archive,
    can_remove,
    can_transfer_ownership,
)
from .serializers import (
    ChangeRoleSerializer,
    InvitationSerializer,
    InviteSerializer,
    ProjectMembershipSerializer,
    ProjectSerializer,
    TransferOwnershipSerializer,
)
```

(add `can_manage_archive` to the existing `.permissions` import — every other import line is
unchanged.)

Replace `ProjectViewSet.get_queryset`:

```python
    def get_queryset(self):
        qs = Project.objects.all()
        if self.action == "list":
            qs = qs.filter(memberships__user=self.request.user).distinct()
            if self.request.query_params.get("include_archived") != "true":
                qs = qs.filter(is_archived=False)
        return qs
```

Add two new actions to `ProjectViewSet`, after `transfer_ownership`:

```python
    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        project = self.get_object()
        acting = project.memberships.get(user=request.user)
        if not can_manage_archive(acting.role):
            raise PermissionDenied("Only the owner can archive a project.")
        if project.is_archived:
            raise ValidationError({"detail": "This project is already archived."})

        project.is_archived = True
        project.archived_at = timezone.now()
        project.archived_by = request.user
        project.save()
        return Response(ProjectSerializer(project, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="unarchive")
    def unarchive(self, request, pk=None):
        project = self.get_object()
        acting = project.memberships.get(user=request.user)
        if not can_manage_archive(acting.role):
            raise PermissionDenied("Only the owner can unarchive a project.")
        if not project.is_archived:
            raise ValidationError({"detail": "This project is not archived."})

        project.is_archived = False
        project.archived_at = None
        project.archived_by = None
        project.save()
        return Response(ProjectSerializer(project, context={"request": request}).data)
```

- [ ] **Step 4: Run the migration and tests to verify they pass**

Run: `docker compose run --rm web python manage.py migrate`
Expected: applies `projects.0003_project_archiving` cleanly.

Run: `docker compose run --rm web pytest projects/tests/test_project_archiving.py -v`
Expected: PASS (9 tests)

- [ ] **Step 5: Document the new endpoints**

Modify `docs/api.md` — in the `## Projects` section, update the endpoint table (add two rows
after `transfer-ownership` and one note after the existing `GET /api/projects/` row's context)
and the `GET /api/projects/` row's Notes column:

```markdown
| GET | `/api/projects/` | projects I'm a member of; excludes archived unless `?include_archived=true` |
```

(replace the existing `GET | /api/projects/ | projects I'm a member of` row with the line above)

```markdown
| POST | `/api/projects/{id}/archive/` | Owner only; `400` if already archived |
| POST | `/api/projects/{id}/unarchive/` | Owner only; `400` if not currently archived |
```

(add these two rows immediately after the existing `transfer-ownership` row)

Add a paragraph after the existing "Every project role is one of..." paragraph:

```markdown
**Archiving is visibility-only.** An archived project drops out of the default `GET
/api/projects/` list but stays exactly as writable as before for its existing members — no
other endpoint treats an archived project's boards, work items, or anything else as read-only.
`Project.delete()` (hard delete, cascading, irreversible) is unrelated and untouched.
```

- [ ] **Step 6: Commit**

```bash
git add projects/migrations/0003_project_archiving.py projects/models.py projects/permissions.py projects/serializers.py projects/views.py projects/tests/test_project_archiving.py docs/api.md
git commit -m "Add Owner-only project archiving (visibility-only)"
```

---

## Task 3: Widen `user_can_manage_definitions` to accept Site Admins

**Files:**
- Modify: `boards/serializers.py`
- Test: `boards/tests/test_labels_api.py`

**Interfaces:**
- Consumes: `boards.serializers.user_can_manage_definitions(user)` (existing function, same
  signature and contract — takes a `User`, returns `bool`).
- Produces: nothing new — every existing call site (Labels, Custom Fields, Screens, Workflows
  manage-tier checks in `boards/views.py`) keeps working unchanged, now also satisfied by
  `is_staff`.

- [ ] **Step 1: Write the failing tests**

Add to `boards/tests/test_labels_api.py` (append at the end of the file):

```python
@pytest.mark.django_db
def test_site_admin_with_no_project_memberships_can_rename_a_label(auth_client, user):
    """No `project` fixture here on purpose — `user` has zero
    ProjectMembership rows, proving is_staff alone satisfies the check."""
    user.is_staff = True
    user.save()
    label = Label.objects.create(name="old-name", color="#A32218", created_by=None)
    response = auth_client.patch(
        f"/api/labels/{label.id}/", {"name": "new-name"}, content_type="application/json"
    )
    assert response.status_code == 200
    label.refresh_from_db()
    assert label.name == "new-name"
```

(the existing `test_owner_of_any_project_can_rename_a_label` in this same file, a few lines
above where this is added, already covers "a non-staff Owner of a project can still rename a
label" — it needs no change, and its continuing to pass in Step 4 below IS the regression
check that widening the `is_staff` branch didn't narrow the existing one.)

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `docker compose run --rm web pytest boards/tests/test_labels_api.py -v`
Expected: `test_site_admin_with_no_project_memberships_can_rename_a_label` FAILS with 403
(`user_can_manage_definitions` doesn't check `is_staff` yet); every other test in the file,
including `test_owner_of_any_project_can_rename_a_label`, already passes.

- [ ] **Step 3: Write the minimal implementation**

Modify `boards/serializers.py`:

```python
def user_can_manage_definitions(user):
    from projects.models import ProjectMembership

    if user.is_staff:
        return True
    return ProjectMembership.objects.filter(user=user, role="owner").exists()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm web pytest boards/tests/test_labels_api.py -v`
Expected: PASS — the new test, plus every existing test in the file (including
`test_owner_of_any_project_can_rename_a_label`) still passing.

- [ ] **Step 5: Commit**

```bash
git add boards/serializers.py boards/tests/test_labels_api.py
git commit -m "Widen user_can_manage_definitions to accept Site Admins"
```

---

## Final check

- [ ] **Run the full test suite**

Run: `docker compose run --rm web pytest -v`
Expected: `478` (baseline) `+ 16` (Task 1) `+ 9` (Task 2) `+ 1` (Task 3) = **504 passed**.
