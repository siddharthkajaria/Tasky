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
