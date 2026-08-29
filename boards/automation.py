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
