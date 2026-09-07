import pytest
from django.db import IntegrityError

from boards.automation import action_config_error, trigger_filter_error
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


# ---- fix-round regression tests: transactional create + int/str status ids ----


@pytest.mark.django_db
def test_create_path_rolls_back_all_automation_on_a_later_rule_failure(auth_client, board, project, user):
    """WorkItemSerializer.create() must run the triggering write and every
    matching create-rule inside one transaction: if a later rule's action
    fails, an earlier rule's already-applied side effect (a label, here)
    must not be left committed alongside a work item whose creation never
    really finished."""
    make_rule(
        project, user, name="First", position=0,
        action_type=AutomationRule.ActionType.APPLY_LABEL,
        action_config={"label_name": "should-not-persist"},
    )
    make_rule(
        project, user, name="Second", position=1,
        action_type=AutomationRule.ActionType.CHANGE_STATUS,
        # A status id that can't possibly exist forces move_work_item's
        # bulk_update to violate the WorkItemStatus foreign key, raising
        # instead of silently no-oping (unlike a non-numeric status_id,
        # which _to_status_id now treats as a no-op).
        action_config={"status_id": 999999999},
    )
    with pytest.raises(IntegrityError):
        auth_client.post(
            "/api/work-items/",
            {"board": board.id, "item_type": "task", "title": "Item"},
            content_type="application/json",
        )
    assert not WorkItem.objects.filter(title="Item").exists()
    assert not Label.objects.filter(name="should-not-persist").exists()


@pytest.mark.django_db
def test_trigger_filter_error_coerces_a_stringy_to_status_and_normalizes_it(project, statuses):
    trigger_filter = {"to_status": str(statuses["done"].id)}
    assert trigger_filter_error(AutomationRule.TriggerType.STATUS_CHANGED, trigger_filter, project) is None
    assert trigger_filter["to_status"] == statuses["done"].id


@pytest.mark.django_db
def test_trigger_filter_error_rejects_a_non_numeric_to_status(project, statuses):
    error = trigger_filter_error(
        AutomationRule.TriggerType.STATUS_CHANGED, {"to_status": "not-a-number"}, project
    )
    assert error is not None


@pytest.mark.django_db
def test_action_config_error_coerces_a_stringy_status_id_and_normalizes_it(project, statuses):
    action_config = {"status_id": str(statuses["done"].id)}
    assert action_config_error(AutomationRule.ActionType.CHANGE_STATUS, action_config, project) is None
    assert action_config["status_id"] == statuses["done"].id


@pytest.mark.django_db
def test_action_config_error_rejects_a_non_numeric_status_id(project, statuses):
    error = action_config_error(AutomationRule.ActionType.CHANGE_STATUS, {"status_id": "not-a-number"}, project)
    assert error is not None


@pytest.mark.django_db
def test_action_config_error_coerces_a_stringy_user_id_and_normalizes_it(project, user):
    """Same coercion bug class as status_id: a vanilla-JS <select>.value
    arrives as a string, and action_config_error must normalize it to int
    in place so a later DRF response never emits a stringy assignee id."""
    action_config = {"mode": "fixed", "user_id": str(user.id)}
    assert action_config_error(AutomationRule.ActionType.SET_ASSIGNEE, action_config, project) is None
    assert action_config["user_id"] == user.id
    assert isinstance(action_config["user_id"], int)


@pytest.mark.django_db
def test_action_config_error_rejects_a_non_numeric_user_id(project):
    error = action_config_error(
        AutomationRule.ActionType.SET_ASSIGNEE, {"mode": "fixed", "user_id": "not-a-number"}, project
    )
    assert error is not None


@pytest.mark.django_db
def test_status_changed_trigger_matches_a_stringy_to_status_stored_in_the_db(auth_client, board, statuses, project, user):
    """A rule created directly against the model (bypassing the not-yet-
    built AutomationRuleViewSet's validation) with a JSON string to_status
    must still match at runtime — the matcher, not just the validator, is
    responsible for int/str consistency."""
    item = WorkItem.objects.create(board=board, title="Item", status=statuses["todo"])
    make_rule(
        project, user,
        trigger_type=AutomationRule.TriggerType.STATUS_CHANGED,
        trigger_filter={"to_status": str(statuses["done"].id)},
        action_config={"label_name": "auto"},
    )
    response = auth_client.post(
        f"/api/work-items/{item.id}/move/",
        {"status": statuses["done"].id, "position": 0},
        content_type="application/json",
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert set(item.labels.values_list("name", flat=True)) == {"auto"}


@pytest.mark.django_db
def test_change_status_action_applies_with_a_stringy_status_id(auth_client, board, statuses, project, user):
    make_rule(
        project, user,
        action_type=AutomationRule.ActionType.CHANGE_STATUS,
        action_config={"status_id": str(statuses["done"].id)},
    )
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "Item"},
        content_type="application/json",
    )
    item = WorkItem.objects.get(id=response.json()["id"])
    assert item.status_id == statuses["done"].id


@pytest.mark.django_db
def test_set_assignee_action_applies_with_a_stringy_user_id(auth_client, board, project, user, other_user):
    """A rule created directly against the model (bypassing the
    AutomationRuleViewSet's validation) with a JSON string user_id must
    still assign correctly at runtime, and the resulting assignee_id must
    be a genuine int — not the string that was stored — matching the
    status_id coercion already proven above for CHANGE_STATUS."""
    ProjectMembership.objects.create(project=project, user=other_user, role="member")
    make_rule(
        project, user,
        action_type=AutomationRule.ActionType.SET_ASSIGNEE,
        action_config={"mode": "fixed", "user_id": str(other_user.id)},
    )
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "Item"},
        content_type="application/json",
    )
    item = WorkItem.objects.get(id=response.json()["id"])
    assert item.assignee_id == other_user.id
    assert isinstance(item.assignee_id, int)
    assert isinstance(response.json()["assignee"], int)
