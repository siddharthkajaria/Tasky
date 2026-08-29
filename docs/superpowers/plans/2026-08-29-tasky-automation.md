# Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production Django/DRF backend for Tasky's Automation feature (sub-project 11 of 13) — a small, non-cascading rules engine: two triggers (work item created, status changed), four actions (set assignee, apply label, remove label, change status), project-scoped, Owner/Admin-managed.

**Architecture:** One new model, `AutomationRule` (`boards/models.py`), config-only — `trigger_filter`/`action_config` are `JSONField`s whose shape depends on `trigger_type`/`action_type`. A new module, `boards/automation.py`, holds the whole rules engine (trigger matching, action execution, config validation) separately from the already-large `boards/services.py` — a genuinely distinct concern deserving its own file. Two hook points, matching the spec's own scoping to "exactly one service function per trigger": `WorkItemSerializer.create()` (`boards/serializers.py`) calls `evaluate_work_item_created()` once, after the instance (with labels/custom fields) is fully built; `WorkItemViewSet.move()` (`boards/views.py`) calls `evaluate_status_changed()` once, wrapped in the same `transaction.atomic()` block as the underlying `move_work_item()` call. Non-cascading is structural, not a runtime flag: `automation.py`'s action-application function calls `move_work_item()`/`resolve_labels()` directly (the same internals a manual edit already uses) but never calls either `evaluate_*` function itself — there is no code path by which an automation-caused change re-enters rule evaluation. `AutomationRuleViewSet` (`boards/views.py`) mirrors `ReleaseViewSet`'s exact shape (nested under project, `GET/POST` list-create, `GET/PATCH/DELETE` detail, Owner/Admin write, any-member read), reusing the position/reorder-on-PATCH and renumber-on-delete pattern already established by `WorkItemStatusViewSet`/`ScreenFieldViewSet`. `WorkItemStatusViewSet.perform_destroy` gains a second guard alongside its existing "still used by N work items" check.

**Tech Stack:** Django 5.2, DRF 3.16, MySQL, pytest-django. No new dependencies. First `JSONField` in this codebase — MySQL 8's native JSON column, standard Django support, no extra configuration needed.

**Spec:** `docs/superpowers/specs/2026-08-24-tasky-automation-design.md` (signed off — covered by the user's "Sign off on all 10 as-is" standing authorization; the `design/` prototype it argues from was built and browser-tested 2026-08-29)

## Global Constraints

- **Role vocabulary is `owner` / `admin` / `member`** (lowercase) — unchanged.
- **Unauthenticated request → `403`, never `401`** (existing site-wide convention, unchanged).
- **Two triggers only**: `work_item_created`, `status_changed`. **Four actions only**: `set_assignee`, `apply_label`, `remove_label`, `change_status`. No others in this pass — see the spec's Out of scope.
- **One rule = one trigger + one action.** No action chains.
- **Non-cascading execution, full stop.** An automation-caused change (a label apply, a status change, an assignee set) never re-triggers rule evaluation — not even once, not even when a rule's own action would otherwise match its own trigger.
- **Rules are project-scoped**, not global — unlike `Label`.
- **Governance reuses the Owner/Admin tier** (`can_manage_components`/`can_manage_statuses`'s exact shape: `role in ("owner", "admin")`) — no new permission level. Any project member can `GET` the list; only Owner/Admin can create/edit/delete/reorder/deactivate.
- **Fully synchronous, inline execution** — no task queue, no background job. A rule's action runs inside the same request/transaction as the triggering write.
- **Bulk operations do not fire automation.** `WorkItemViewSet.bulk_move` (sub-project 2c) writes `status`/`position` directly and does not call `move_work_item()` — it already bypasses the single chokepoint this sub-project hooks into, so it's unaffected and untouched by this plan. This is not a gap to close; it's the spec's own scoping to "exactly one service function" per trigger.
- **`WorkItemStatus` deletion gains a second guard**: also 400s if any `AutomationRule` in the project references that status in `trigger_filter.from_status`, `trigger_filter.to_status`, or `action_config.status_id` — naming the rule(s). `trigger_filter.to_category` is a category, not a status reference, and is deliberately NOT checked here (matching the spec's own wording, which names only `from_status`/`to_status`/`action_config.status_id`).
- **No execution history / audit log.** A rule is config only; nothing records "this rule fired on this work item at this time."
- **No `DELETE` on `/api/projects/{id}/statuses/{id}/`'s existing behavior changes** beyond the new guard being additive — the "still used by N work items" and "category needs at least one status" checks are untouched.

---

## Task 1: `AutomationRule` model, migration, and serializer

**Files:**
- Create: `boards/migrations/0031_automationrule.py`
- Modify: `boards/models.py`, `boards/serializers.py`
- Test: `boards/tests/test_automation_model.py`

**Interfaces:**
- Consumes: `WorkItem`, `WorkItemStatus` (existing models, unchanged).
- Produces: `boards.models.AutomationRule` (`project`, `name`, `trigger_type`, `trigger_filter`, `action_type`, `action_config`, `position`, `is_active`, `created_by`, `created_at`; `AutomationRule.TriggerType`/`AutomationRule.ActionType` choices classes). `boards.serializers.can_manage_automation(role)`, `boards.serializers.AutomationRuleSerializer`.

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_automation_model.py`:

```python
import pytest

from boards.models import AutomationRule
from boards.serializers import AutomationRuleSerializer, can_manage_automation
from projects.models import Project


def test_can_manage_automation_matches_owner_admin_tier():
    assert can_manage_automation("owner") is True
    assert can_manage_automation("admin") is True
    assert can_manage_automation("member") is False


@pytest.mark.django_db
def test_creating_an_automation_rule(user):
    project = Project.objects.create(key="AUTO", name="Automation Test")
    rule = AutomationRule.objects.create(
        project=project, name="Auto-triage new bugs",
        trigger_type=AutomationRule.TriggerType.WORK_ITEM_CREATED,
        trigger_filter={"item_type": "bug"},
        action_type=AutomationRule.ActionType.APPLY_LABEL,
        action_config={"label_name": "needs-design"},
        position=0, created_by=user,
    )
    assert rule.is_active is True
    assert str(rule) == f"Auto-triage new bugs ({project})"


@pytest.mark.django_db
def test_automation_rule_serializer_shape(user):
    project = Project.objects.create(key="AUTO2", name="Automation Test 2")
    rule = AutomationRule.objects.create(
        project=project, name="Clear assignee on Done",
        trigger_type=AutomationRule.TriggerType.STATUS_CHANGED,
        trigger_filter={"to_category": "done"},
        action_type=AutomationRule.ActionType.SET_ASSIGNEE,
        action_config={"mode": "unassign"},
        position=0, created_by=user,
    )
    data = AutomationRuleSerializer(rule).data
    assert data["name"] == "Clear assignee on Done"
    assert data["trigger_type"] == "status_changed"
    assert data["trigger_filter"] == {"to_category": "done"}
    assert data["action_type"] == "set_assignee"
    assert data["action_config"] == {"mode": "unassign"}
    assert data["is_active"] is True
    assert data["created_by_detail"]["username"] == user.username


@pytest.mark.django_db
def test_deleting_a_project_cascades_to_its_automation_rules(user):
    project = Project.objects.create(key="AUTO3", name="Automation Test 3")
    AutomationRule.objects.create(
        project=project, name="R", trigger_type=AutomationRule.TriggerType.WORK_ITEM_CREATED,
        trigger_filter={}, action_type=AutomationRule.ActionType.APPLY_LABEL,
        action_config={"label_name": "x"}, position=0, created_by=user,
    )
    project.delete()
    assert not AutomationRule.objects.exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web pytest boards/tests/test_automation_model.py -v`
Expected: FAIL — `ImportError: cannot import name 'AutomationRule' from 'boards.models'`.

- [ ] **Step 3: Write the minimal implementation**

Modify `boards/models.py` — append at the end of the file:

```python
class AutomationRule(models.Model):
    class TriggerType(models.TextChoices):
        WORK_ITEM_CREATED = "work_item_created", "Work item created"
        STATUS_CHANGED = "status_changed", "Status changed"

    class ActionType(models.TextChoices):
        SET_ASSIGNEE = "set_assignee", "Set assignee"
        APPLY_LABEL = "apply_label", "Apply label"
        REMOVE_LABEL = "remove_label", "Remove label"
        CHANGE_STATUS = "change_status", "Change status"

    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="automation_rules")
    name = models.CharField(max_length=120)
    trigger_type = models.CharField(max_length=30, choices=TriggerType.choices)
    trigger_filter = models.JSONField(default=dict, blank=True)
    action_type = models.CharField(max_length=30, choices=ActionType.choices)
    action_config = models.JSONField(default=dict, blank=True)
    position = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="automation_rules_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self) -> str:
        return f"{self.name} ({self.project})"
```

Create `boards/migrations/0031_automationrule.py`:

```python
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("projects", "0003_project_archiving"),
        ("boards", "0030_attachment"),
    ]

    operations = [
        migrations.CreateModel(
            name="AutomationRule",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120)),
                (
                    "trigger_type",
                    models.CharField(
                        choices=[("work_item_created", "Work item created"), ("status_changed", "Status changed")],
                        max_length=30,
                    ),
                ),
                ("trigger_filter", models.JSONField(blank=True, default=dict)),
                (
                    "action_type",
                    models.CharField(
                        choices=[
                            ("set_assignee", "Set assignee"),
                            ("apply_label", "Apply label"),
                            ("remove_label", "Remove label"),
                            ("change_status", "Change status"),
                        ],
                        max_length=30,
                    ),
                ),
                ("action_config", models.JSONField(blank=True, default=dict)),
                ("position", models.PositiveIntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="automation_rules_created",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="automation_rules",
                        to="projects.project",
                    ),
                ),
            ],
            options={"ordering": ["position", "id"]},
        ),
    ]
```

Modify `boards/serializers.py` — add after `can_manage_screen_assignments`:

```python
def can_manage_automation(role):
    return role in ("owner", "admin")
```

Add after `ReleaseSerializer` (or anywhere among the other `ModelSerializer` classes):

```python
class AutomationRuleSerializer(serializers.ModelSerializer):
    created_by_detail = UserSerializer(source="created_by", read_only=True)

    class Meta:
        model = AutomationRule
        fields = [
            "id", "project", "name", "trigger_type", "trigger_filter",
            "action_type", "action_config", "position", "is_active",
            "created_by_detail", "created_at",
        ]
        read_only_fields = ["project", "position", "created_by_detail", "created_at"]
```

(add `AutomationRule` to the existing `from .models import Attachment, Board, Comment, Component, ...`
import line at the top of `boards/serializers.py`.)

- [ ] **Step 4: Run the migration and tests to verify they pass**

Run: `docker compose run --rm web python manage.py migrate`
Expected: applies `boards.0031_automationrule` cleanly.

Run: `docker compose run --rm web pytest boards/tests/test_automation_model.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add boards/models.py boards/migrations/0031_automationrule.py boards/serializers.py boards/tests/test_automation_model.py
git commit -m "Add AutomationRule model, migration, and serializer"
```

---

## Task 2: The rules engine — trigger matching, action execution, and wiring

**Files:**
- Create: `boards/automation.py`
- Modify: `boards/serializers.py` (`WorkItemSerializer.create`), `boards/views.py` (`WorkItemViewSet.move`)
- Test: `boards/tests/test_automation_engine.py`

**Interfaces:**
- Consumes: `AutomationRule` (Task 1), `WorkItemStatus`, `WorkItem`, `Label`, `boards.services.move_work_item`, `boards.services.resolve_labels`.
- Produces: `boards.automation.trigger_filter_error(trigger_type, trigger_filter, project)`, `boards.automation.action_config_error(action_type, action_config, project)` (both return an error message string, or `None` if valid — consumed by Task 3's view). `boards.automation.evaluate_work_item_created(item, actor)`, `boards.automation.evaluate_status_changed(item, project_id, from_status_id, to_status, actor)`.

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_automation_engine.py`:

```python
import pytest

from boards.models import AutomationRule, Board, Label, WorkItem, WorkItemStatus
from boards.services import seed_default_statuses
from projects.models import Project, ProjectMembership


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def statuses(board, project):
    seed_default_statuses(project)
    return {
        s.category: s for s in WorkItemStatus.objects.filter(project=project)
    }


def make_rule(project, user, **overrides):
    defaults = dict(
        project=project, name="Rule", position=0, created_by=user, is_active=True,
        trigger_type=AutomationRule.TriggerType.WORK_ITEM_CREATED, trigger_filter={},
        action_type=AutomationRule.ActionType.APPLY_LABEL, action_config={"label_name": "auto"},
    )
    defaults.update(overrides)
    return AutomationRule.objects.create(**defaults)


@pytest.mark.django_db
def test_work_item_created_trigger_fires_on_matching_item_type(auth_client, board, project, user):
    make_rule(
        project, user,
        trigger_filter={"item_type": "bug"},
        action_config={"label_name": "needs-design"},
    )
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "bug", "title": "A bug"},
        content_type="application/json",
    )
    assert response.status_code == 201
    item = WorkItem.objects.get(id=response.json()["id"])
    assert set(item.labels.values_list("name", flat=True)) == {"needs-design"}


@pytest.mark.django_db
def test_work_item_created_trigger_does_not_fire_on_non_matching_item_type(auth_client, board, project, user):
    make_rule(project, user, trigger_filter={"item_type": "bug"})
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "A task"},
        content_type="application/json",
    )
    assert response.status_code == 201
    item = WorkItem.objects.get(id=response.json()["id"])
    assert not item.labels.exists()


@pytest.mark.django_db
def test_status_changed_trigger_fires_inline_on_a_matching_move(auth_client, board, statuses, project, user, other_user):
    ProjectMembership.objects.create(project=project, user=other_user, role="member")
    item = WorkItem.objects.create(
        board=board, title="Item", status=statuses["todo"], assignee=other_user,
    )
    make_rule(
        project, user,
        trigger_type=AutomationRule.TriggerType.STATUS_CHANGED,
        trigger_filter={"to_category": "done"},
        action_type=AutomationRule.ActionType.SET_ASSIGNEE,
        action_config={"mode": "unassign"},
    )
    response = auth_client.post(
        f"/api/work-items/{item.id}/move/",
        {"status": statuses["done"].id, "position": 0},
        content_type="application/json",
    )
    assert response.status_code == 200
    assert response.json()["assignee"] is None
    item.refresh_from_db()
    assert item.assignee_id is None


@pytest.mark.django_db
def test_status_changed_trigger_does_not_fire_on_a_non_matching_move(auth_client, board, statuses, project, user, other_user):
    ProjectMembership.objects.create(project=project, user=other_user, role="member")
    item = WorkItem.objects.create(
        board=board, title="Item", status=statuses["todo"], assignee=other_user,
    )
    make_rule(
        project, user,
        trigger_type=AutomationRule.TriggerType.STATUS_CHANGED,
        trigger_filter={"to_status": statuses["done"].id},
        action_type=AutomationRule.ActionType.SET_ASSIGNEE,
        action_config={"mode": "unassign"},
    )
    auth_client.post(
        f"/api/work-items/{item.id}/move/",
        {"status": statuses["in_progress"].id, "position": 0},
        content_type="application/json",
    )
    item.refresh_from_db()
    assert item.assignee_id == other_user.id


@pytest.mark.django_db
def test_a_rules_own_action_targeting_its_own_trigger_does_not_loop(auth_client, board, statuses, project, user):
    """A change_status rule whose target IS the exact status its own
    trigger matches must not recurse or double-apply — the non-cascading
    guard means the action's own move_work_item() call never re-enters
    evaluate_status_changed()."""
    item = WorkItem.objects.create(board=board, title="Item", status=statuses["todo"])
    make_rule(
        project, user,
        trigger_type=AutomationRule.TriggerType.STATUS_CHANGED,
        trigger_filter={"to_status": statuses["done"].id},
        action_type=AutomationRule.ActionType.CHANGE_STATUS,
        action_config={"status_id": statuses["done"].id},
    )
    response = auth_client.post(
        f"/api/work-items/{item.id}/move/",
        {"status": statuses["done"].id, "position": 0},
        content_type="application/json",
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.status_id == statuses["done"].id


@pytest.mark.django_db
def test_two_matching_non_conflicting_rules_both_run(auth_client, board, project, user):
    label_a = Label.objects.create(name="rule-a", color="#A32218", created_by=None)
    label_b = Label.objects.create(name="rule-b", color="#A32218", created_by=None)
    make_rule(
        project, user, name="First",
        position=0, action_config={"label_name": label_a.name},
    )
    make_rule(
        project, user, name="Second",
        position=1, action_config={"label_name": label_b.name},
    )
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "Item"},
        content_type="application/json",
    )
    item = WorkItem.objects.get(id=response.json()["id"])
    assert set(item.labels.values_list("name", flat=True)) == {"rule-a", "rule-b"}


@pytest.mark.django_db
def test_two_conflicting_change_status_rules_the_later_position_wins(auth_client, board, statuses, project, user):
    make_rule(
        project, user, name="First", position=0,
        action_type=AutomationRule.ActionType.CHANGE_STATUS,
        action_config={"status_id": statuses["in_progress"].id},
    )
    make_rule(
        project, user, name="Second", position=1,
        action_type=AutomationRule.ActionType.CHANGE_STATUS,
        action_config={"status_id": statuses["done"].id},
    )
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "Item"},
        content_type="application/json",
    )
    item = WorkItem.objects.get(id=response.json()["id"])
    assert item.status_id == statuses["done"].id


@pytest.mark.django_db
def test_set_assignee_modes(auth_client, board, statuses, project, user, other_user):
    ProjectMembership.objects.create(project=project, user=other_user, role="member")
    make_rule(
        project, user,
        action_type=AutomationRule.ActionType.SET_ASSIGNEE,
        action_config={"mode": "fixed", "user_id": other_user.id},
    )
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "Fixed assignee"},
        content_type="application/json",
    )
    item = WorkItem.objects.get(id=response.json()["id"])
    assert item.assignee_id == other_user.id


@pytest.mark.django_db
def test_set_assignee_mode_actor_assigns_the_acting_user(auth_client, board, project, user):
    make_rule(
        project, user,
        action_type=AutomationRule.ActionType.SET_ASSIGNEE,
        action_config={"mode": "actor"},
    )
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "Actor assignee"},
        content_type="application/json",
    )
    item = WorkItem.objects.get(id=response.json()["id"])
    assert item.assignee_id == user.id


@pytest.mark.django_db
def test_inactive_rule_does_not_fire(auth_client, board, project, user):
    make_rule(project, user, is_active=False)
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "Item"},
        content_type="application/json",
    )
    item = WorkItem.objects.get(id=response.json()["id"])
    assert not item.labels.exists()


@pytest.mark.django_db
def test_a_different_projects_rules_never_fire_here(auth_client, board, project, user, other_user):
    other_project = Project.objects.create(key="OTHR", name="Other")
    ProjectMembership.objects.create(project=other_project, user=other_user, role="owner")
    make_rule(other_project, other_user, action_config={"label_name": "should-not-apply"})

    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "Item"},
        content_type="application/json",
    )
    item = WorkItem.objects.get(id=response.json()["id"])
    assert not item.labels.exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web pytest boards/tests/test_automation_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'boards.automation'` (no rule ever fires; every assertion about a labeled/reassigned item fails).

- [ ] **Step 3: Write the minimal implementation**

Create `boards/automation.py`:

```python
"""Automation rules engine (sub-project 11) — trigger matching, action
execution, and trigger_filter/action_config validation. Deliberately
separate from services.py: this is a genuinely distinct concern (a small
rules engine) from that file's general-purpose grab-bag, and services.py
is already large.

Non-cascading, by construction: _apply_action below writes directly to
the work item (or calls resolve_labels/move_work_item, the same internals
a manual edit already uses) but this module's functions never call each
other in a way that re-enters evaluate_work_item_created or
evaluate_status_changed — an automation-caused change can never
re-trigger rule evaluation, full stop. See the spec's Scope decisions for
why this "no cascading" model was chosen over a depth cap."""

from .models import AutomationRule, Label, WorkItem, WorkItemStatus
from .services import move_work_item, resolve_labels

# ---- validation (used by AutomationRuleViewSet in Task 3) -----------------
# Both return an error message string, or None if valid. Only check what
# the spec's error table names — no unexpected-key policing beyond that,
# matching custom_fields_write_error's existing return-a-string-or-None
# shape elsewhere in this codebase.


def trigger_filter_error(trigger_type, trigger_filter, project):
    trigger_filter = trigger_filter or {}
    if trigger_type == AutomationRule.TriggerType.STATUS_CHANGED:
        to_status = trigger_filter.get("to_status")
        to_category = trigger_filter.get("to_category")
        if to_status is not None and to_category is not None:
            return "to_status and to_category can't both be set."
        for key in ("from_status", "to_status"):
            value = trigger_filter.get(key)
            if value is not None and not WorkItemStatus.objects.filter(id=value, project_id=project.id).exists():
                return f"{key} must be a status in this project."
    return None


def action_config_error(action_type, action_config, project):
    action_config = action_config or {}
    if action_type == AutomationRule.ActionType.SET_ASSIGNEE:
        if action_config.get("mode") == "fixed":
            user_id = action_config.get("user_id")
            if not user_id or not project.memberships.filter(user_id=user_id).exists():
                return 'user_id must be a member of this project when mode is "fixed".'
    elif action_type in (AutomationRule.ActionType.APPLY_LABEL, AutomationRule.ActionType.REMOVE_LABEL):
        if not (action_config.get("label_name") or "").strip():
            return "label_name can't be blank."
    elif action_type == AutomationRule.ActionType.CHANGE_STATUS:
        status_id = action_config.get("status_id")
        if not status_id or not WorkItemStatus.objects.filter(id=status_id, project_id=project.id).exists():
            return "status_id must be a status in this project."
    return None


# ---- trigger matching -------------------------------------------------


def _matches_work_item_created(trigger_filter, item):
    item_type = (trigger_filter or {}).get("item_type")
    return not item_type or item.item_type == item_type


def _matches_status_changed(trigger_filter, from_status_id, to_status):
    trigger_filter = trigger_filter or {}
    from_status = trigger_filter.get("from_status")
    if from_status is not None and from_status != from_status_id:
        return False
    to_status_filter = trigger_filter.get("to_status")
    if to_status_filter is not None:
        return to_status_filter == to_status.id
    to_category = trigger_filter.get("to_category")
    if to_category is not None:
        return to_category == to_status.category
    return True


# ---- action execution ---------------------------------------------------


def _apply_action(rule, item, actor):
    cfg = rule.action_config or {}
    if rule.action_type == AutomationRule.ActionType.SET_ASSIGNEE:
        mode = cfg.get("mode")
        if mode == "fixed":
            item.assignee_id = cfg.get("user_id")
        elif mode == "actor":
            item.assignee = actor
        else:
            item.assignee = None
        item.save(update_fields=["assignee", "updated_at"])
    elif rule.action_type == AutomationRule.ActionType.APPLY_LABEL:
        labels = resolve_labels([cfg.get("label_name", "")], actor)
        if labels:
            item.labels.add(*labels)
    elif rule.action_type == AutomationRule.ActionType.REMOVE_LABEL:
        label = Label.objects.filter(name__iexact=(cfg.get("label_name") or "").strip()).first()
        if label:
            item.labels.remove(label)
    elif rule.action_type == AutomationRule.ActionType.CHANGE_STATUS:
        status_id = cfg.get("status_id")
        # Appends to the end of the destination column, same "count as
        # position" shape bulk_move already uses for the same purpose.
        position = WorkItem.objects.filter(status_id=status_id).count()
        move_work_item(item, status_id, position)


# ---- evaluation entry points --------------------------------------------
# Called from exactly two places: WorkItemSerializer.create() and
# WorkItemViewSet.move() — see this plan's Architecture section.


def evaluate_work_item_created(item, actor):
    rules = AutomationRule.objects.filter(
        project_id=item.board.project_id,
        is_active=True,
        trigger_type=AutomationRule.TriggerType.WORK_ITEM_CREATED,
    ).order_by("position", "id")
    for rule in rules:
        if _matches_work_item_created(rule.trigger_filter, item):
            _apply_action(rule, item, actor)


def evaluate_status_changed(item, project_id, from_status_id, to_status, actor):
    rules = AutomationRule.objects.filter(
        project_id=project_id,
        is_active=True,
        trigger_type=AutomationRule.TriggerType.STATUS_CHANGED,
    ).order_by("position", "id")
    for rule in rules:
        if _matches_status_changed(rule.trigger_filter, from_status_id, to_status):
            _apply_action(rule, item, actor)
```

Modify `boards/serializers.py` — `WorkItemSerializer.create`:

```python
    def create(self, validated_data):
        custom_fields = validated_data.pop("custom_fields", None)
        label_names = validated_data.pop("labels", None)
        instance = super().create(validated_data)
        if custom_fields:
            apply_custom_fields(instance, custom_fields)
        if label_names is not None:
            instance.labels.set(resolve_labels(label_names, self.context["request"].user))
        from .automation import evaluate_work_item_created

        evaluate_work_item_created(instance, self.context["request"].user)
        return instance
```

(only the two new lines at the end are added — everything above `return instance` is unchanged.)

Modify `boards/views.py` — `WorkItemViewSet.move`:

```python
    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        item = self.get_object()

        serializer = MoveWorkItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_status = serializer.validated_data["status"]
        if target_status.project_id != item.board.project_id:
            raise ValidationError({"status": "Status must belong to this item's project."})

        old_status_id = item.status_id
        try:
            with transaction.atomic():
                move_work_item(
                    item,
                    target_status.id,
                    serializer.validated_data["position"],
                )
                if old_status_id != target_status.id:
                    from .automation import evaluate_status_changed

                    evaluate_status_changed(
                        item, item.board.project_id, old_status_id, target_status, request.user
                    )
        except WorkItem.DoesNotExist:
            # The item was deleted by another request between this request's
            # (unlocked) get_object() and move_work_item()'s row lock.
            # WorkItem.DoesNotExist is not converted to 404 by DRF's default
            # exception handler on its own (only django.http.Http404 and
            # PermissionDenied are) — it has to be translated explicitly, or
            # this would surface as a 500.
            raise Http404("Work item was deleted before the move could be applied.")
        item.refresh_from_db()
        return Response(WorkItemSerializer(item).data)
```

(the only changes: `old_status_id = item.status_id` before the `try`, the whole body of the `try` wrapped in one outer `transaction.atomic()` — `move_work_item` is already independently `@transaction.atomic`, and Django nests atomic blocks as savepoints, so this is safe — and the new `if old_status_id != target_status.id: evaluate_status_changed(...)` call. Everything else, including the `except`/`refresh_from_db`/`return`, is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm web pytest boards/tests/test_automation_engine.py -v`
Expected: PASS (11 tests)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `docker compose run --rm web pytest -q`
Expected: `516` (baseline) `+ 4` (Task 1) `+ 11` (Task 2) = **531 passed** — every existing work-item-create and move test must still pass unchanged (automation only ever adds behavior when a matching, active rule exists, and none do outside this plan's own fixtures).

- [ ] **Step 6: Commit**

```bash
git add boards/automation.py boards/serializers.py boards/views.py boards/tests/test_automation_engine.py
git commit -m "Add the automation rules engine and wire it into work item create/move"
```

---

## Task 3: `AutomationRuleViewSet` API, the `WorkItemStatus` delete guard, and docs

**Files:**
- Modify: `boards/views.py`, `boards/urls.py`, `docs/api.md`
- Test: `boards/tests/test_automation_rules_api.py`

**Interfaces:**
- Consumes: `AutomationRuleSerializer` (Task 1), `trigger_filter_error`/`action_config_error` (Task 2), `can_manage_automation` (Task 1), `IsProjectMember`.
- Produces: `GET/POST /api/projects/{id}/automation-rules/`, `GET/PATCH/DELETE /api/projects/{id}/automation-rules/{id}/`. The widened `WorkItemStatusViewSet.perform_destroy`.

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_automation_rules_api.py`:

```python
import pytest

from boards.models import AutomationRule
from boards.services import seed_default_statuses
from projects.models import Project, ProjectMembership


@pytest.fixture
def statuses(project):
    seed_default_statuses(project)
    from boards.models import WorkItemStatus

    return {s.category: s for s in WorkItemStatus.objects.filter(project=project)}


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client, project):
    assert client.get(f"/api/projects/{project.id}/automation-rules/").status_code == 403


@pytest.mark.django_db
def test_a_non_member_gets_403_not_404(auth_client, other_user):
    """`auth_client` (alice, from the `user`/`auth_client` fixtures) has no
    membership at all in a project owned by someone else."""
    other_project = Project.objects.create(key="OTHR", name="Other")
    ProjectMembership.objects.create(project=other_project, user=other_user, role="owner")
    assert auth_client.get(f"/api/projects/{other_project.id}/automation-rules/").status_code == 403


@pytest.mark.django_db
def test_any_member_can_list_rules_but_only_owner_admin_can_create(auth_client, project, other_user):
    ProjectMembership.objects.create(project=project, user=other_user, role="member")
    assert auth_client.get(f"/api/projects/{project.id}/automation-rules/").status_code == 200

    payload = {
        "name": "New rule", "trigger_type": "work_item_created", "trigger_filter": {},
        "action_type": "apply_label", "action_config": {"label_name": "urgent"},
    }
    owner_response = auth_client.post(
        f"/api/projects/{project.id}/automation-rules/", payload, content_type="application/json"
    )
    assert owner_response.status_code == 201
    assert owner_response.json()["position"] == 0


@pytest.mark.django_db
def test_plain_member_gets_403_on_create_edit_delete(auth_client, project, other_user):
    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    rule = AutomationRule.objects.create(
        project=project, name="R", trigger_type=AutomationRule.TriggerType.WORK_ITEM_CREATED,
        trigger_filter={}, action_type=AutomationRule.ActionType.APPLY_LABEL,
        action_config={"label_name": "x"}, position=0,
    )
    payload = {
        "name": "New rule", "trigger_type": "work_item_created", "trigger_filter": {},
        "action_type": "apply_label", "action_config": {"label_name": "urgent"},
    }
    assert auth_client.post(
        f"/api/projects/{project.id}/automation-rules/", payload, content_type="application/json"
    ).status_code == 403
    assert auth_client.patch(
        f"/api/projects/{project.id}/automation-rules/{rule.id}/", {"is_active": False}, content_type="application/json"
    ).status_code == 403
    assert auth_client.delete(f"/api/projects/{project.id}/automation-rules/{rule.id}/").status_code == 403


@pytest.mark.django_db
def test_owner_can_edit_reorder_and_delete_a_rule(auth_client, project):
    rule_a = AutomationRule.objects.create(
        project=project, name="A", trigger_type=AutomationRule.TriggerType.WORK_ITEM_CREATED,
        trigger_filter={}, action_type=AutomationRule.ActionType.APPLY_LABEL,
        action_config={"label_name": "a"}, position=0,
    )
    rule_b = AutomationRule.objects.create(
        project=project, name="B", trigger_type=AutomationRule.TriggerType.WORK_ITEM_CREATED,
        trigger_filter={}, action_type=AutomationRule.ActionType.APPLY_LABEL,
        action_config={"label_name": "b"}, position=1,
    )

    rename = auth_client.patch(
        f"/api/projects/{project.id}/automation-rules/{rule_a.id}/",
        {"name": "Renamed"}, content_type="application/json",
    )
    assert rename.status_code == 200
    assert rename.json()["name"] == "Renamed"

    deactivate = auth_client.patch(
        f"/api/projects/{project.id}/automation-rules/{rule_a.id}/",
        {"is_active": False}, content_type="application/json",
    )
    assert deactivate.json()["is_active"] is False

    reorder = auth_client.patch(
        f"/api/projects/{project.id}/automation-rules/{rule_a.id}/",
        {"position": 1}, content_type="application/json",
    )
    assert reorder.status_code == 200
    rule_b.refresh_from_db()
    assert rule_b.position == 0

    delete = auth_client.delete(f"/api/projects/{project.id}/automation-rules/{rule_a.id}/")
    assert delete.status_code == 204
    assert not AutomationRule.objects.filter(id=rule_a.id).exists()


@pytest.mark.django_db
def test_genuinely_nonexistent_rule_returns_404(auth_client, project):
    assert auth_client.get(f"/api/projects/{project.id}/automation-rules/999999/").status_code == 404


@pytest.mark.django_db
def test_invalid_trigger_type_or_action_type_is_rejected(auth_client, project):
    bad_trigger = auth_client.post(
        f"/api/projects/{project.id}/automation-rules/",
        {"name": "R", "trigger_type": "nonsense", "trigger_filter": {}, "action_type": "apply_label", "action_config": {"label_name": "x"}},
        content_type="application/json",
    )
    assert bad_trigger.status_code == 400

    bad_action = auth_client.post(
        f"/api/projects/{project.id}/automation-rules/",
        {"name": "R", "trigger_type": "work_item_created", "trigger_filter": {}, "action_type": "nonsense", "action_config": {}},
        content_type="application/json",
    )
    assert bad_action.status_code == 400


@pytest.mark.django_db
def test_status_changed_filter_rejects_setting_both_to_status_and_to_category(auth_client, project, statuses):
    response = auth_client.post(
        f"/api/projects/{project.id}/automation-rules/",
        {
            "name": "R", "trigger_type": "status_changed",
            "trigger_filter": {"to_status": statuses["done"].id, "to_category": "done"},
            "action_type": "apply_label", "action_config": {"label_name": "x"},
        },
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "trigger_filter" in response.json()


@pytest.mark.django_db
def test_trigger_filter_referencing_a_foreign_project_status_is_rejected(auth_client, project, other_user):
    other_project = Project.objects.create(key="OTHR", name="Other")
    ProjectMembership.objects.create(project=other_project, user=other_user, role="owner")
    from boards.services import seed_default_statuses
    from boards.models import WorkItemStatus

    seed_default_statuses(other_project)
    foreign_status = WorkItemStatus.objects.filter(project=other_project).first()

    response = auth_client.post(
        f"/api/projects/{project.id}/automation-rules/",
        {
            "name": "R", "trigger_type": "status_changed",
            "trigger_filter": {"to_status": foreign_status.id},
            "action_type": "apply_label", "action_config": {"label_name": "x"},
        },
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "trigger_filter" in response.json()


@pytest.mark.django_db
def test_action_config_referencing_a_foreign_project_status_is_rejected(auth_client, project, other_user):
    other_project = Project.objects.create(key="OTHR2", name="Other 2")
    ProjectMembership.objects.create(project=other_project, user=other_user, role="owner")
    from boards.services import seed_default_statuses
    from boards.models import WorkItemStatus

    seed_default_statuses(other_project)
    foreign_status = WorkItemStatus.objects.filter(project=other_project).first()

    response = auth_client.post(
        f"/api/projects/{project.id}/automation-rules/",
        {
            "name": "R", "trigger_type": "work_item_created", "trigger_filter": {},
            "action_type": "change_status", "action_config": {"status_id": foreign_status.id},
        },
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "action_config" in response.json()


@pytest.mark.django_db
def test_set_assignee_fixed_with_a_non_member_is_rejected(auth_client, project, other_user):
    response = auth_client.post(
        f"/api/projects/{project.id}/automation-rules/",
        {
            "name": "R", "trigger_type": "work_item_created", "trigger_filter": {},
            "action_type": "set_assignee", "action_config": {"mode": "fixed", "user_id": other_user.id},
        },
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "action_config" in response.json()


@pytest.mark.django_db
def test_apply_label_with_a_blank_label_name_is_rejected(auth_client, project):
    response = auth_client.post(
        f"/api/projects/{project.id}/automation-rules/",
        {
            "name": "R", "trigger_type": "work_item_created", "trigger_filter": {},
            "action_type": "apply_label", "action_config": {"label_name": "   "},
        },
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "action_config" in response.json()


@pytest.mark.django_db
def test_deleting_a_status_referenced_by_a_rule_is_rejected(auth_client, project, statuses):
    AutomationRule.objects.create(
        project=project, name="Change status rule",
        trigger_type=AutomationRule.TriggerType.WORK_ITEM_CREATED, trigger_filter={},
        action_type=AutomationRule.ActionType.CHANGE_STATUS,
        action_config={"status_id": statuses["todo"].id}, position=0,
    )
    from boards.models import WorkItem, Board

    board = Board.objects.create(name="B", created_by=None, project=project)
    WorkItem.objects.create(board=board, title="keep todo populated", status=statuses["todo"])

    response = auth_client.delete(f"/api/projects/{project.id}/statuses/{statuses['in_progress'].id}/")
    # in_progress isn't referenced by the rule and has no work items — this
    # one should succeed, proving the guard is specific to the referenced
    # status, not a blanket lock on the whole project's statuses.
    assert response.status_code == 204

    referenced = auth_client.delete(f"/api/projects/{project.id}/statuses/{statuses['todo'].id}/")
    assert referenced.status_code == 400
    assert "Change status rule" in referenced.json()["detail"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web pytest boards/tests/test_automation_rules_api.py -v`
Expected: FAIL — `/api/projects/{id}/automation-rules/` 404s (route doesn't exist), and deleting a referenced status succeeds instead of 400ing.

- [ ] **Step 3: Write the minimal implementation**

Modify `boards/views.py` — update the imports:

```python
from .models import Attachment, AutomationRule, Board, Comment, Component, CustomField, FieldOption, Label, ProjectScreenAssignment, Release, Screen, ScreenField, Sprint, WorkItem, WorkItemLink, WorkItemStatus
from .serializers import (
    AttachmentSerializer,
    AutomationRuleSerializer,
    BoardSerializer,
    CommentSerializer,
    ComponentSerializer,
    CustomFieldSerializer,
    FieldOptionSerializer,
    LabelSerializer,
    MoveWorkItemSerializer,
    ReleaseSerializer,
    ScreenFieldSerializer,
    ScreenSerializer,
    SearchResultSerializer,
    SprintSerializer,
    WorkItemLinkSerializer,
    WorkItemSerializer,
    WorkItemSummarySerializer,
    WorkItemStatusSerializer,
    can_manage_automation,
    can_manage_components,
    can_manage_releases,
    can_manage_sprints,
    can_manage_statuses,
    can_manage_screen_assignments,
    user_can_manage_definitions,
)
from .automation import action_config_error, trigger_filter_error
```

(add `AutomationRule` to the `.models` import, `AutomationRuleSerializer`/`can_manage_automation` to the `.serializers` import, and the new `from .automation import ...` line — every other existing import is unchanged.)

Append a new viewset to `boards/views.py`, after `WorkItemStatusViewSet`:

```python
class AutomationRuleViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete"]
    serializer_class = AutomationRuleSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    pagination_class = None

    def get_project(self):
        from projects.models import Project

        return get_object_or_404(Project, pk=self.kwargs["project_pk"])

    def get_queryset(self):
        return AutomationRule.objects.filter(project_id=self.kwargs["project_pk"]).select_related("created_by")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if self.action in ("list", "create"):
            self.check_object_permissions(request, self.get_project())

    def perform_create(self, serializer):
        project = self.get_project()
        role = project.memberships.get(user=self.request.user).role
        if not can_manage_automation(role):
            raise PermissionDenied("You don't have permission to manage this project's automation rules.")

        trigger_type = serializer.validated_data["trigger_type"]
        trigger_filter = serializer.validated_data.get("trigger_filter") or {}
        action_type = serializer.validated_data["action_type"]
        action_config = serializer.validated_data.get("action_config") or {}

        error = trigger_filter_error(trigger_type, trigger_filter, project)
        if error:
            raise ValidationError({"trigger_filter": error})
        error = action_config_error(action_type, action_config, project)
        if error:
            raise ValidationError({"action_config": error})

        position = AutomationRule.objects.filter(project=project).count()
        serializer.save(project=project, position=position, created_by=self.request.user)

    def perform_update(self, serializer):
        instance = serializer.instance
        role = instance.project.memberships.get(user=self.request.user).role
        if not can_manage_automation(role):
            raise PermissionDenied("You don't have permission to manage this project's automation rules.")

        trigger_type = serializer.validated_data.get("trigger_type", instance.trigger_type)
        trigger_filter = serializer.validated_data.get("trigger_filter", instance.trigger_filter)
        action_type = serializer.validated_data.get("action_type", instance.action_type)
        action_config = serializer.validated_data.get("action_config", instance.action_config)

        if "trigger_filter" in serializer.validated_data or "trigger_type" in serializer.validated_data:
            error = trigger_filter_error(trigger_type, trigger_filter, instance.project)
            if error:
                raise ValidationError({"trigger_filter": error})
        if "action_config" in serializer.validated_data or "action_type" in serializer.validated_data:
            error = action_config_error(action_type, action_config, instance.project)
            if error:
                raise ValidationError({"action_config": error})

        serializer.save()
        if "position" in self.request.data:
            self._reposition(instance)

    def _reposition(self, instance):
        try:
            target = max(0, int(self.request.data["position"]))
        except (TypeError, ValueError):
            raise ValidationError({"position": "Must be a whole number."})
        siblings = list(
            AutomationRule.objects.filter(project=instance.project)
            .exclude(pk=instance.pk)
            .order_by("position", "id")
        )
        target = min(target, len(siblings))
        siblings.insert(target, instance)
        for index, rule in enumerate(siblings):
            if rule.position != index:
                rule.position = index
                rule.save(update_fields=["position"])

    def perform_destroy(self, instance):
        role = instance.project.memberships.get(user=self.request.user).role
        if not can_manage_automation(role):
            raise PermissionDenied("You don't have permission to manage this project's automation rules.")
        project = instance.project
        instance.delete()
        siblings = list(AutomationRule.objects.filter(project=project).order_by("position", "id"))
        for index, rule in enumerate(siblings):
            if rule.position != index:
                rule.position = index
                rule.save(update_fields=["position"])
```

Modify `WorkItemStatusViewSet.perform_destroy` — add the new guard between the existing "still used by work items" check and the "category needs at least one status" check:

```python
    def perform_destroy(self, instance):
        role = instance.project.memberships.get(user=self.request.user).role
        if not can_manage_statuses(role):
            raise PermissionDenied("You don't have permission to manage this project's statuses.")

        in_use = instance.work_items_with_status.count()
        if in_use:
            raise ValidationError(
                {"detail": f'"{instance.name}" is still used by {in_use} work item{"" if in_use == 1 else "s"}. Move {"it" if in_use == 1 else "them"} first.'}
            )

        # sub-project 11 — a rule can reference a status in its
        # trigger_filter (from_status/to_status) or action_config
        # (status_id); deleting it out from under a rule would leave that
        # rule silently broken. Checked in Python, not a JSON-field query
        # lookup — this project's rule count is always small, and it
        # sidesteps any MySQL JSON-lookup type-coercion edge case entirely.
        referencing = [
            r for r in AutomationRule.objects.filter(project=instance.project)
            if (r.trigger_filter or {}).get("from_status") == instance.id
            or (r.trigger_filter or {}).get("to_status") == instance.id
            or (r.action_config or {}).get("status_id") == instance.id
        ]
        if referencing:
            names = ", ".join(f'"{r.name}"' for r in referencing)
            raise ValidationError(
                {"detail": f'"{instance.name}" is still referenced by automation rule(s) {names}.'}
            )

        remaining = WorkItemStatus.objects.filter(
            project=instance.project, category=instance.category
        ).exclude(pk=instance.pk)
        if not remaining.exists():
            raise ValidationError({"detail": f"{instance.get_category_display()} needs at least one status."})

        project = instance.project
        instance.delete()
        siblings = list(WorkItemStatus.objects.filter(project=project).order_by("position", "id"))
        for index, status in enumerate(siblings):
            if status.position != index:
                status.position = index
                status.save(update_fields=["position"])
```

(only the new "referencing" block is added, between the existing `in_use` check and the existing `remaining` check — everything else in this method is unchanged.)

Modify `boards/urls.py` — add to the `.views` import and to `urlpatterns`:

```python
from .views import (
    AttachmentViewSet,
    AutomationRuleViewSet,
    BoardViewSet,
    CommentViewSet,
    ComponentViewSet,
    CustomFieldViewSet,
    FieldOptionViewSet,
    LabelViewSet,
    ProjectScreenAssignmentsView,
    ReleaseViewSet,
    ScreenFieldViewSet,
    ScreenViewSet,
    SearchView,
    SprintViewSet,
    WorkItemLinkViewSet,
    WorkItemStatusViewSet,
    WorkItemViewSet,
)
```

Add these two `path()` entries to `urlpatterns` (alongside the other `projects/<int:project_pk>/...` entries, e.g. right after the existing `project-statuses`/`project-status-detail` pair):

```python
    path(
        "projects/<int:project_pk>/automation-rules/",
        AutomationRuleViewSet.as_view({"get": "list", "post": "create"}),
        name="project-automation-rules",
    ),
    path(
        "projects/<int:project_pk>/automation-rules/<int:pk>/",
        AutomationRuleViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="project-automation-rule-detail",
    ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose run --rm web pytest boards/tests/test_automation_rules_api.py -v`
Expected: PASS (13 tests)

- [ ] **Step 5: Document the new endpoints**

Modify `docs/api.md` — add a new section after `## Work Item Statuses` (find that section's existing table and add this immediately after it):

```markdown
## Automation
Project-scoped rules: when a trigger fires, run exactly one action — no chaining, no
cascading (an automation-caused change never re-triggers rule evaluation).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/projects/{id}/automation-rules/` | any project member |
| POST | `/api/projects/{id}/automation-rules/` | `{name, trigger_type, trigger_filter, action_type, action_config, is_active?}`; Owner/Admin only |
| GET | `/api/projects/{id}/automation-rules/{id}/` | any project member |
| PATCH | `/api/projects/{id}/automation-rules/{id}/` | any of the above, plus `position` (cascades to siblings); Owner/Admin only |
| DELETE | `/api/projects/{id}/automation-rules/{id}/` | Owner/Admin only; renumbers remaining siblings |

**`trigger_type`** is `work_item_created` or `status_changed`. **`trigger_filter`** shape
depends on it:
- `work_item_created`: `{item_type: <ItemType>|null}` — `null` matches every item type.
- `status_changed`: `{from_status: <id>|null, to_status: <id>|null, to_category: <category>|null}`
  — `to_status`/`to_category` are mutually exclusive (`400` if both set); everything `null`
  matches any origin/destination.

**`action_type`** is `set_assignee`, `apply_label`, `remove_label`, or `change_status`.
**`action_config`** shape depends on it:
- `set_assignee`: `{mode: "fixed"|"actor"|"unassign", user_id?}` — `user_id` required (and
  validated as a project member) only when `mode: "fixed"`.
- `apply_label`/`remove_label`: `{label_name}` — `apply_label` matches-or-creates the same
  way a manual `labels` write does; `remove_label` no-ops if the item doesn't have it.
- `change_status`: `{status_id}` — must belong to the rule's own project.

**Governance reuses the Owner/Admin tier** — same as Components and Statuses. Any project
member can `GET` the list (so it's clear why a card changed on its own); only Owner/Admin
can create, edit, delete, reorder, or deactivate.

**Bulk operations do not fire automation.** `POST /api/work-items/bulk-move/` writes status
directly and bypasses the single `move_work_item()` chokepoint this feature hooks into —
only the single-item `POST /api/work-items/{id}/move/` and `POST /api/work-items/` fire
rules.

**Deleting a `WorkItemStatus` still referenced by a rule's `trigger_filter.from_status`,
`trigger_filter.to_status`, or `action_config.status_id` is rejected with `400`, naming the
rule.** A `to_category` reference is a category, not a specific status, and does not block
deletion.
```

- [ ] **Step 6: Commit**

```bash
git add boards/views.py boards/urls.py boards/tests/test_automation_rules_api.py docs/api.md
git commit -m "Add the automation rules API and the WorkItemStatus delete guard"
```

---

## Final check

- [ ] **Run the full test suite**

Run: `docker compose run --rm web pytest -v`
Expected: `516` (baseline) `+ 4` (Task 1) `+ 11` (Task 2) `+ 13` (Task 3) = **544 passed**.
