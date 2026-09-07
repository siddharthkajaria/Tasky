# Django patterns — how we do it *here*

Not generic Django advice. These are this repo's conventions.

## Adding an endpoint

1. **Model + migration.** `boards` is at migration 31; they are sequential.
   Data migrations are separate, named `NNNN_backfill_*`.
2. **Serializer** in `<app>/serializers.py`. Reject immutable fields explicitly —
   `status`, `board`, `item_type` and `key` are rejected on `WorkItem` update.
3. **ViewSet** in `<app>/views.py`. Keep it thin: resolve, authorise, delegate.
4. **URL** in `<app>/urls.py`. Nested resources carry the parent in the path even
   on detail routes: `/api/projects/{project_pk}/components/{pk}/`.
5. **Logic** in `boards/services.py`.
6. **Tests** in `<app>/tests/test_<area>.py`.
7. **Document** in `docs/api.md`.

## Permission checks

Three layers, deliberately distinct:

```python
# 1. Pure predicate — mirrors the spec AND design/js/logic.js
def can_change_role(acting_role):
    return acting_role == OWNER

# 2. Object-level: only sees objects the queryset already found, so a
#    genuinely missing id 404s before this runs.
class IsProjectMember(BasePermission):
    def has_object_permission(self, request, view, obj):
        project = obj if isinstance(obj, Project) else obj.project
        return project.memberships.filter(user=request.user).exists()

# 3. View-level: same check for every route under /api/admin/users/
class IsSiteAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated
                    and request.user.is_staff)
```

Changing a rule means changing it in **all three** of: the spec,
`projects/permissions.py`, `design/js/logic.js`.

## Transactions and locks

Two places take real row locks, both inside `transaction.atomic()`:

```python
# Key allocation — lock the project row BEFORE incrementing.
project = Project.objects.select_for_update().get(pk=board.project_id)
```

**`move_work_item` takes its lock before reading the item's old column.**
Reading first was a real bug: two people dragging the same card left a
permanent gap in the ordering. Pinned by two regression tests. Do not reorder.

## Positions

`position` is **not contiguous**. Gaps after a delete are normal and are never
corruption. `next_position()` and `next_backlog_position()` allocate; a column
move renumbers that whole column inside the transaction.

## Automation

`boards/automation.py` runs **inline**, in the same request that created or
moved the item. There is no queue and no worker. Entry points:
`evaluate_work_item_created`, `evaluate_status_changed`. If you are adding a
trigger, add it to both the engine and `design/js/logic.js`.

## Statuses

Per-project, configurable, each with a `todo` / `in_progress` / `done` category.
Never assume three columns and never assume the fixed enum — that was v1.
Invariants enforced server-side:

- at least one status per category, always
- a status in use by a work item **or an automation rule** cannot be deleted

## Settings

Environment-driven via `_env_flag` / `_env_list` helpers. Add new configuration
as an env var with a safe default, document it in `README.md`'s table and in all
three `docs/.env.*.example` files.

## Things that look like bugs and are not

`docs/follow-ups.md` has a **deliberate non-goals** section covering three items
in `boards/services.py`. Read it before "fixing" that file.
