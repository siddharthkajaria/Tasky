import pytest

from boards.models import AutomationRule
from boards.services import seed_default_statuses
from projects.models import Project, ProjectMembership


@pytest.fixture
def statuses(project):
    # "detailed" preset, not the default "simple" one — it puts three
    # statuses in the in_progress category (In Progress, In Review,
    # Blocked) instead of one. test_deleting_a_status_referenced_by_a_rule_is_rejected
    # deletes an unreferenced in_progress status to prove the new
    # automation-reference guard is specific, not a blanket lock; with
    # "simple" (exactly one status per category) that delete would always
    # 400 on the pre-existing "category needs at least one status" guard
    # regardless of automation, which isn't what that test means to check.
    seed_default_statuses(project, preset_key="detailed")
    from boards.models import WorkItemStatus

    return {s.category: s for s in WorkItemStatus.objects.filter(project=project).order_by("position", "id")}


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
    from boards.models import WorkItemStatus
    from boards.services import seed_default_statuses

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
    from boards.models import WorkItemStatus
    from boards.services import seed_default_statuses

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
    from boards.models import Board, WorkItem

    board = Board.objects.create(name="B", created_by=None, project=project)
    # Attached to `done`, not `todo` — this just proves the project isn't
    # empty; it must NOT sit on `todo` or `in_progress`, since the
    # pre-existing "in use" guard runs before the new referencing guard
    # and would otherwise mask the message this test is checking for.
    WorkItem.objects.create(board=board, title="keep the project non-empty", status=statuses["done"])

    response = auth_client.delete(f"/api/projects/{project.id}/statuses/{statuses['in_progress'].id}/")
    # in_progress isn't referenced by the rule and has no work items — this
    # one should succeed, proving the guard is specific to the referenced
    # status, not a blanket lock on the whole project's statuses.
    assert response.status_code == 204

    referenced = auth_client.delete(f"/api/projects/{project.id}/statuses/{statuses['todo'].id}/")
    assert referenced.status_code == 400
    assert "Change status rule" in referenced.json()["detail"]
