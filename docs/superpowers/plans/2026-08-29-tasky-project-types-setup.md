# Project Types & Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production Django/DRF backend for Tasky's Project Types & Setup feature (sub-project 10 of 13) — a fixed, in-code registry of 3 project templates (Blank, Software Project, Bug Tracking) that pre-fill a new project's statuses and starter components at creation time, plus a read-only endpoint listing them.

**Architecture:** No new database table — templates and status presets are module-level constants in `boards/services.py`, the same pattern already used there for `LABEL_PALETTE`. `seed_default_statuses(project)` gains an optional `preset_key="simple"` parameter (default unchanged, so all 13 existing call sites across the codebase keep working without modification) and now reads from `STATUS_PRESETS[preset_key]` instead of the hardcoded `_DEFAULT_STATUSES` list, which is deleted (`STATUS_PRESETS["simple"]` is its exact replacement — same names, categories, and derived positions). `ProjectViewSet.perform_create` reads an optional `template` key straight off `request.data` (not through `ProjectSerializer` — `template` isn't a `Project` model field and never persists), validates it against `PROJECT_TEMPLATES`, and seeds the chosen preset plus starter `Component` rows inside the same `transaction.atomic()` block that already wraps membership creation. A new `ProjectTemplateListView` (plain `APIView`, `GET` only) serves the fixed list read-only, no DB query, 405 on every other method automatically.

**Tech Stack:** Django 5.2, DRF 3.16, MySQL, pytest-django. No new dependencies, no new migration.

**Spec:** `docs/superpowers/specs/2026-08-24-tasky-project-types-setup-design.md` (signed off — covered by the user's "Sign off on all 10 as-is" standing authorization; the `design/` prototype it argues from was built and browser-tested 2026-08-29)

## Global Constraints

- **No new database table, no new migration.** Templates and presets are Python constants, not model rows — matching `LABEL_PALETTE`'s existing pattern in `boards/services.py`.
- **`Project` gains no new field.** Nothing on the row records which template (if any) was used to create it.
- **`seed_default_statuses` keeps its existing name and its existing zero-arg call signature working identically** — `preset_key` is a new, optional, default-`"simple"` parameter. Every existing call site (`projects/views.py`, `boards/services.py`'s own `resolve_default_status`, `boards/management/commands/seed_demo.py`, and every test file that calls it directly) needs zero changes.
- **`template` defaults to `"blank"` when omitted from `POST /api/projects/`** — reproduces exactly today's unconditional 3-status seed.
- **Unrecognized `template` value → `400` naming `template`**, and creates no `Project` row at all (the validation happens before `serializer.save()`, inside `perform_create`, still ahead of any write).
- **Unauthenticated request to either endpoint → `403`, never `401`** (existing site-wide convention, unchanged).
- **`GET/POST/PATCH/DELETE` other than `GET` on `/api/project-templates/` → `405`** — the list is code, not a resource collection; DRF's default `APIView` behavior already does this with zero extra code once only `get()` is defined.
- **Whole `POST /api/projects/` rolls back on any failure partway through seeding** — same `transaction.atomic()` guarantee that already wraps membership + status creation today, now also covering starter `Component` creation.
- **A project created from any template is indistinguishable from a hand-configured one afterward** — its statuses and components are ordinary rows, freely renamable/reorderable/deletable exactly like today.

---

## Task 1: Template and status-preset registry

**Files:**
- Modify: `boards/services.py`

**Interfaces:**
- Consumes: `WorkItemStatus` (existing model, unchanged).
- Produces: `boards.services.STATUS_PRESETS` (dict of preset key → list of `(name, category)` tuples), `boards.services.PROJECT_TEMPLATES` (dict of template key → `{name, description, status_preset, components}`), `boards.services.seed_default_statuses(project, preset_key="simple")` (existing function, new optional second parameter — return shape unchanged: `dict` of `category -> WorkItemStatus`).

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_project_templates.py`:

```python
import pytest

from boards.services import PROJECT_TEMPLATES, STATUS_PRESETS, seed_default_statuses
from boards.models import WorkItemStatus
from projects.models import Project


def test_every_status_preset_covers_all_three_categories():
    """Guards the invariant WorkItemStatus already enforces elsewhere —
    every project needs at least one status per category — against a
    future edit to STATUS_PRESETS breaking it silently."""
    for key, statuses in STATUS_PRESETS.items():
        categories = {category for _name, category in statuses}
        assert categories == {"todo", "in_progress", "done"}, key


def test_no_template_has_duplicate_component_names():
    """A duplicate name in one template's components list would hit
    Component's unique_together(project, name) constraint on creation and
    500 instead of 400 — this is a static property of the registry, not
    something that needs a live project to check."""
    for key, template in PROJECT_TEMPLATES.items():
        names = template["components"]
        assert len(names) == len(set(names)), key


@pytest.mark.django_db
def test_seed_default_statuses_with_no_preset_key_uses_simple():
    project = Project.objects.create(key="TST", name="Test")
    seeded = seed_default_statuses(project)
    statuses = list(WorkItemStatus.objects.filter(project=project).order_by("position"))
    assert [(s.name, s.category) for s in statuses] == STATUS_PRESETS["simple"]
    assert set(seeded.keys()) == {"todo", "in_progress", "done"}


@pytest.mark.django_db
def test_seed_default_statuses_with_detailed_preset():
    project = Project.objects.create(key="TST2", name="Test 2")
    seed_default_statuses(project, preset_key="detailed")
    statuses = list(WorkItemStatus.objects.filter(project=project).order_by("position"))
    assert [(s.name, s.category) for s in statuses] == STATUS_PRESETS["detailed"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web pytest boards/tests/test_project_templates.py -v`
Expected: FAIL — `ImportError: cannot import name 'STATUS_PRESETS'` (`PROJECT_TEMPLATES` and the new `preset_key` parameter don't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Modify `boards/services.py` — replace the `_DEFAULT_STATUSES` line and `seed_default_statuses` function:

```python
STATUS_PRESETS = {
    "simple": [("To Do", "todo"), ("In Progress", "in_progress"), ("Done", "done")],
    "detailed": [
        ("To Do", "todo"),
        ("In Progress", "in_progress"),
        ("In Review", "in_progress"),
        ("Blocked", "in_progress"),
        ("Done", "done"),
    ],
}

PROJECT_TEMPLATES = {
    "blank": {
        "name": "Blank",
        "description": "Three statuses, no components — today's default. Good for anything "
                        "that doesn't fit a more specific template.",
        "status_preset": "simple",
        "components": [],
    },
    "software": {
        "name": "Software Project",
        "description": "An engineering-shaped workflow with room for review and blockers, "
                        "plus a starter set of components to tag work by.",
        "status_preset": "detailed",
        "components": ["Frontend", "Backend", "Infrastructure"],
    },
    "bugs": {
        "name": "Bug Tracking",
        "description": "For triaging and tracking defects through to verification.",
        "status_preset": "detailed",
        "components": [],
    },
}
```

(this replaces the existing `_DEFAULT_STATUSES = [("To Do", "todo", 0), ("In Progress", "in_progress", 1), ("Done", "done", 2)]` line — same file location, just above `LABEL_PALETTE`.)

Modify `seed_default_statuses` itself:

```python
def seed_default_statuses(project, preset_key="simple") -> dict:
    """The default statuses every project starts with, seeded from
    STATUS_PRESETS[preset_key] (sub-project 10 — Project Types & Setup;
    preset_key defaults to "simple", which is byte-for-byte what this
    function's old hardcoded 3-status list produced, so every existing
    caller that doesn't pass preset_key keeps working unchanged).
    Idempotent: if the project already has a status in every one of the
    preset's categories, returns its existing todo/in_progress/done rows
    instead of creating duplicates. If it has SOME but not all — e.g. its
    `todo`-category status was deleted or recategorized away via
    `/admin/`, which has no guard against leaving a category empty the
    way the API does — this tops up only the missing categories, so the
    project ends up with at least one status in each without touching the
    ones already there. (Ambiguity when a project already has 2+ statuses
    in the SAME category — which one "the" category's status is — is a
    separate, deliberately-out-of-scope non-goal; only seed_demo hits it,
    on fresh projects, with no live bug.)

    Reached two ways, deliberately: called explicitly from
    ProjectViewSet.perform_create (so a project created through the real
    API has statuses immediately), and reached indirectly — via
    resolve_default_status()'s own fallback, below — from WorkItem.save()
    (so a project created directly via the ORM — every existing test
    fixture, seed_demo, etc. — still works without being rewritten to
    seed anything itself)."""
    preset = STATUS_PRESETS[preset_key]
    existing_qs = list(WorkItemStatus.objects.filter(project=project))
    existing = {s.category: s for s in existing_qs}
    missing = [d for d in preset if d[1] not in existing]
    if not missing:
        # Whatever exists, return a dict good enough for resolve_default_status
        # to work with — a project that already has custom statuses is not
        # re-seeded, only reported back.
        return existing

    # A missing category's default name (e.g. "To Do") might already be in
    # use by some OTHER status in the project — the unique-per-project name
    # constraint doesn't care which category a name belongs to, and nothing
    # stops an admin from renaming/recategorizing a status into exactly this
    # collision. Fall back to a disambiguated name rather than let
    # bulk_create raise an IntegrityError.
    taken_names = {s.name for s in existing_qs}
    next_position = 1 + max((s.position for s in existing_qs), default=-1)

    created = []
    for name, category in missing:
        candidate = name
        suffix = 2
        while candidate in taken_names:
            candidate = f"{name} ({suffix})"
            suffix += 1
        taken_names.add(candidate)
        created.append(
            WorkItemStatus(project=project, name=candidate, category=category, position=next_position)
        )
        next_position += 1
    WorkItemStatus.objects.bulk_create(created)

    # Refetch to get IDs after bulk_create, and to merge with what already existed.
    all_statuses = WorkItemStatus.objects.filter(project=project).order_by("position", "id")
    return {status.category: status for status in all_statuses}
```

(this is the exact existing function body, unchanged except: the new `preset_key="simple"` parameter, `preset = STATUS_PRESETS[preset_key]` replacing the old direct reference to `_DEFAULT_STATUSES`, `missing = [d for d in preset if ...]` instead of `_DEFAULT_STATUSES`, and `for name, category in missing:` — two-tuple unpacking instead of three, since `STATUS_PRESETS`' tuples don't carry an unused position element the way `_DEFAULT_STATUSES`'s did. The docstring is updated; everything below "Idempotent:" through the end of the function body is otherwise identical to today.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm web pytest boards/tests/test_project_templates.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `docker compose run --rm web pytest -q`
Expected: `504` (baseline) `+ 4` = **508 passed** — every existing caller of `seed_default_statuses(project)` (no second argument) must still produce identical output.

- [ ] **Step 6: Commit**

```bash
git add boards/services.py boards/tests/test_project_templates.py
git commit -m "Add STATUS_PRESETS/PROJECT_TEMPLATES registry, widen seed_default_statuses"
```

---

## Task 2: Template selection on project creation, and the template-list endpoint

**Files:**
- Modify: `projects/views.py`, `projects/urls.py`, `docs/api.md`
- Test: `projects/tests/test_project_templates_api.py`

**Interfaces:**
- Consumes: `boards.services.PROJECT_TEMPLATES`, `boards.services.STATUS_PRESETS`, `boards.services.seed_default_statuses(project, preset_key)` (Task 1), `boards.models.Component`.
- Produces: `GET /api/project-templates/`. `POST /api/projects/` gains an optional `template` body field.

- [ ] **Step 1: Write the failing tests**

Create `projects/tests/test_project_templates_api.py`:

```python
import pytest

from boards.models import Component, WorkItemStatus
from boards.services import STATUS_PRESETS
from projects.models import Project


@pytest.mark.django_db
def test_anonymous_callers_are_rejected_on_project_templates(client):
    assert client.get("/api/project-templates/").status_code == 403


@pytest.mark.django_db
def test_listing_project_templates(auth_client):
    """@pytest.mark.django_db is only here for auth_client's sake (it
    needs a `user` row to log in) — ProjectTemplateListView.get() itself
    reads only PROJECT_TEMPLATES/STATUS_PRESETS, both in-code constants,
    so this endpoint issues no query of its own; visible by inspection of
    the view, not asserted mechanically here (no query-count-assertion
    pattern exists elsewhere in this codebase to match)."""
    response = auth_client.get("/api/project-templates/")
    assert response.status_code == 200
    body = response.json()
    keys = [t["key"] for t in body]
    assert keys == ["blank", "software", "bugs"]

    software = next(t for t in body if t["key"] == "software")
    assert software["name"] == "Software Project"
    assert software["statuses"] == [{"name": n, "category": c} for n, c in STATUS_PRESETS["detailed"]]
    assert software["components"] == ["Frontend", "Backend", "Infrastructure"]


@pytest.mark.django_db
def test_post_or_delete_on_project_templates_is_not_allowed(auth_client):
    assert auth_client.post("/api/project-templates/", {}, content_type="application/json").status_code == 405
    assert auth_client.delete("/api/project-templates/").status_code == 405


@pytest.mark.django_db
def test_creating_a_project_with_no_template_produces_the_simple_preset(auth_client):
    response = auth_client.post(
        "/api/projects/", {"key": "NOTPL", "name": "No Template"}, content_type="application/json"
    )
    assert response.status_code == 201
    project = Project.objects.get(key="NOTPL")
    statuses = list(WorkItemStatus.objects.filter(project=project).order_by("position"))
    assert [(s.name, s.category) for s in statuses] == STATUS_PRESETS["simple"]
    assert not Component.objects.filter(project=project).exists()


@pytest.mark.django_db
def test_creating_a_project_with_the_software_template(auth_client):
    response = auth_client.post(
        "/api/projects/",
        {"key": "SOFT", "name": "Software Co", "template": "software"},
        content_type="application/json",
    )
    assert response.status_code == 201
    project = Project.objects.get(key="SOFT")
    statuses = list(WorkItemStatus.objects.filter(project=project).order_by("position"))
    assert [(s.name, s.category) for s in statuses] == STATUS_PRESETS["detailed"]
    component_names = set(Component.objects.filter(project=project).values_list("name", flat=True))
    assert component_names == {"Frontend", "Backend", "Infrastructure"}


@pytest.mark.django_db
def test_creating_a_project_with_the_bugs_template_has_no_components(auth_client):
    response = auth_client.post(
        "/api/projects/",
        {"key": "BUGZ", "name": "Bugs", "template": "bugs"},
        content_type="application/json",
    )
    assert response.status_code == 201
    project = Project.objects.get(key="BUGZ")
    statuses = list(WorkItemStatus.objects.filter(project=project).order_by("position"))
    assert [(s.name, s.category) for s in statuses] == STATUS_PRESETS["detailed"]
    assert not Component.objects.filter(project=project).exists()


@pytest.mark.django_db
def test_creating_a_project_with_an_invalid_template_is_rejected(auth_client):
    response = auth_client.post(
        "/api/projects/",
        {"key": "BAD", "name": "Bad", "template": "nonexistent"},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "template" in response.json()
    assert not Project.objects.filter(key="BAD").exists()


@pytest.mark.django_db
def test_a_templated_project_is_freely_editable_afterward(auth_client):
    response = auth_client.post(
        "/api/projects/",
        {"key": "EDIT", "name": "Editable", "template": "software"},
        content_type="application/json",
    )
    project_id = response.json()["id"]
    status = WorkItemStatus.objects.filter(project_id=project_id, name="To Do").get()
    component = Component.objects.filter(project_id=project_id, name="Frontend").get()

    # Both routes are project-nested — projects/<project_pk>/statuses/<pk>/
    # and projects/<project_pk>/components/<pk>/ — per boards/urls.py.
    rename = auth_client.patch(
        f"/api/projects/{project_id}/statuses/{status.id}/",
        {"name": "Todo (renamed)"}, content_type="application/json",
    )
    assert rename.status_code == 200

    delete = auth_client.delete(f"/api/projects/{project_id}/components/{component.id}/")
    assert delete.status_code == 204
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web pytest projects/tests/test_project_templates_api.py -v`
Expected: FAIL — `/api/project-templates/` 404s (route doesn't exist), and every project created via `POST /api/projects/` with a `template` key ignores it (statuses still come from the un-widened seeding call, components are never created).

- [ ] **Step 3: Write the minimal implementation**

Modify `projects/views.py` — update the import block and `perform_create`:

```python
from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

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

(add `from rest_framework.views import APIView` — every other import line is unchanged.)

Replace `perform_create`:

```python
    def perform_create(self, serializer):
        from boards.models import Component
        from boards.services import PROJECT_TEMPLATES, seed_default_statuses

        template_key = self.request.data.get("template") or "blank"
        template = PROJECT_TEMPLATES.get(template_key)
        if template is None:
            raise ValidationError({"template": f'"{template_key}" is not a valid template.'})

        # Per the Workflows design spec, a project's default statuses are
        # "created alongside the Project row itself, same transaction" —
        # wrap the membership + status-seeding + starter-component writes
        # in one atomic block so that guarantee actually holds (a failure
        # partway through never leaves a Project with an owner but no
        # statuses, or vice versa).
        with transaction.atomic():
            project = serializer.save()
            ProjectMembership.objects.create(
                project=project, user=self.request.user, role=ProjectMembership.Role.OWNER
            )
            seed_default_statuses(project, preset_key=template["status_preset"])
            for name in template["components"]:
                Component.objects.create(project=project, name=name)
```

Append a new view at the end of `projects/views.py`:

```python
class ProjectTemplateListView(APIView):
    """Read-only — the fixed, in-code PROJECT_TEMPLATES registry (sub-
    project 10), never a resource collection: every method but GET 405s
    automatically since none of them are defined here."""

    def get(self, request):
        from boards.services import PROJECT_TEMPLATES, STATUS_PRESETS

        data = [
            {
                "key": key,
                "name": template["name"],
                "description": template["description"],
                "statuses": [
                    {"name": name, "category": category}
                    for name, category in STATUS_PRESETS[template["status_preset"]]
                ],
                "components": template["components"],
            }
            for key, template in PROJECT_TEMPLATES.items()
        ]
        return Response(data)
```

Modify `projects/urls.py`:

```python
from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import InvitationViewSet, ProjectTemplateListView, ProjectViewSet

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("invitations", InvitationViewSet, basename="invitation")

urlpatterns = router.urls + [
    path("project-templates/", ProjectTemplateListView.as_view(), name="project-templates"),
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm web pytest projects/tests/test_project_templates_api.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Document the new endpoint and the `template` field**

Modify `docs/api.md` — add a new section right after `## Projects`'s existing prose (before its endpoint table, or immediately after the table — place it right after the "Archiving is visibility-only" paragraph added by sub-project 9, so it reads as the next thing worth knowing about creating a project):

```markdown
## Project Templates
| Method | Path | Notes |
|---|---|---|
| GET | `/api/project-templates/` | the fixed list of built-in templates; `405` on any other method — read-only, not a resource collection |

```json
[
  {"key": "blank", "name": "Blank", "description": "...", "statuses": [{"name": "To Do", "category": "todo"}, ...], "components": []}
]
```

`POST /api/projects/` gains an optional `template` field: one of `"blank"`, `"software"`, `"bugs"`.
Omitted (or explicitly `"blank"`) reproduces exactly the pre-existing 3-status, no-components
default. An unrecognized value is rejected with `400`, naming `template`. Nothing on the created
`Project` row records which template was used — a template pre-fills statuses and starter
components once, at creation time, and leaves no lasting trace; the project is freely
customizable afterward exactly like any other.
```

- [ ] **Step 6: Commit**

```bash
git add projects/views.py projects/urls.py projects/tests/test_project_templates_api.py docs/api.md
git commit -m "Add project creation templates and the project-templates list endpoint"
```

---

## Final check

- [ ] **Run the full test suite**

Run: `docker compose run --rm web pytest -v`
Expected: `504` (baseline) `+ 4` (Task 1) `+ 8` (Task 2) = **516 passed**.
