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
