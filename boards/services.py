import csv as csv_module
import datetime
import io
import re

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.db.utils import DataError
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Component, CustomField, Label, ProjectScreenAssignment, ScreenField, Sprint, WorkItem, WorkItemFieldValue, WorkItemStatus

# Derived from WorkItem.Priority.choices (LOW = 1, "Low" / MEDIUM = 2,
# "Medium" / HIGH = 3, "High") rather than hand-duplicated, so this can't
# silently drift from the model's actual priority choices.
PRIORITY_NAMES = {label.lower(): value for value, label in WorkItem.Priority.choices}


def import_work_items_from_csv(board, csv_file, user):
    """Row-by-row, best-effort: a bad row is skipped and reported, the
    rest of the file still imports. A uniform problem (missing `title`
    header, more than 500 rows) is a whole-file ValidationError instead,
    raised before any row is touched — see this plan's Global Constraints."""
    raw = csv_file.read()
    try:
        # "utf-8-sig" strips a leading BOM (U+FEFF) if present — Excel's
        # "CSV UTF-8" export prepends one, which plain "utf-8" decoding
        # leaves attached to the first header cell (`'﻿title'`),
        # making the "title" column look missing even though it's there.
        # A no-op for files without a BOM, so this is a strict improvement.
        text = raw.decode("utf-8-sig") if isinstance(raw, bytes) else raw
    except UnicodeDecodeError:
        raise ValidationError({"csv": "CSV file must be UTF-8 encoded."})
    # No blanket "drop any all-blank row" pass here: `csv.reader` already
    # yields zero rows for a genuinely empty file (`if not reader` below
    # catches that), and a row that's blank because ITS title is blank is
    # exactly the per-row failure `test_a_blank_title_row_fails_without_
    # blocking_the_rest` exercises — dropping it here would silently lose
    # it instead of reporting it, and would also throw off `row_num`
    # (computed from `data_rows`' own index) for every row after it.
    reader = list(csv_module.reader(io.StringIO(text)))
    if not reader:
        raise ValidationError({"csv": "CSV file is empty."})

    header = [h.strip().lower() for h in reader[0]]
    if "title" not in header:
        raise ValidationError({"csv": 'CSV must include a "title" column.'})
    data_rows = reader[1:]
    # Strip trailing all-blank rows only — a common CSV-export artifact
    # (a trailing newline turning into one blank data row) that would
    # otherwise be reported as a spurious "Title is required." failure and
    # count toward the 500-row cap. A blank row in the MIDDLE of the file
    # is left alone: that's the deliberate mid-file blank-title case this
    # module reports as a real per-row failure (see the comment above).
    while data_rows and not any(cell.strip() for cell in data_rows[-1]):
        data_rows.pop()
    if len(data_rows) > 500:
        raise ValidationError({"csv": "CSV has more than 500 rows."})

    imported = 0
    failed = []
    User = get_user_model()

    for i, cells in enumerate(data_rows):
        row_num = i + 2  # header is row 1
        row = {h: (cells[idx].strip() if idx < len(cells) else "") for idx, h in enumerate(header)}
        title = row.get("title", "")

        def fail_row(error, title=title):
            failed.append({"row": row_num, "title": title or None, "error": error})

        if not title:
            fail_row("Title is required.")
            continue

        item_type = (row.get("item_type") or "task").lower()
        if item_type == "subtask":
            fail_row("Subtasks cannot be imported (need a parent).")
            continue
        if item_type not in WorkItem.ItemType.values:
            fail_row(f'Invalid item_type "{item_type}".')
            continue

        if row.get("status"):
            status = WorkItemStatus.objects.filter(
                project=board.project, name__iexact=row["status"]
            ).first()
            if not status:
                fail_row(f'Status "{row["status"]}" not found.')
                continue
        else:
            # Only resolved when the row needs it — resolve_default_status()
            # can seed a project's default statuses as a side effect, which
            # is wasted work (and an extra query) on every row that already
            # supplies its own valid status.
            status = resolve_default_status(board.project)

        priority = 2
        if row.get("priority"):
            priority = PRIORITY_NAMES.get(row["priority"].lower())
            if not priority:
                fail_row(f'Invalid priority "{row["priority"]}".')
                continue

        assignee = None
        if row.get("assignee"):
            assignee = User.objects.filter(username__iexact=row["assignee"]).first()
            if not assignee:
                fail_row(f'User "{row["assignee"]}" not found.')
                continue

        due_date = None
        if row.get("due_date"):
            # Regex alone would pass a calendar-invalid string like
            # "2026-13-01" through to WorkItem.objects.create(), where
            # Django's DateField.to_python() raises its own (uncaught,
            # non-DRF) ValidationError while preparing the INSERT —
            # surfacing as an unhandled 500 instead of a per-row failure.
            # _is_iso_date (below) checks real calendar validity too.
            if not _is_iso_date(row["due_date"]):
                fail_row(f'Invalid due_date "{row["due_date"]}".')
                continue
            due_date = row["due_date"]

        component_ids = []
        bad_component = None
        if row.get("components"):
            for name in [n.strip() for n in row["components"].split(";") if n.strip()]:
                comp = Component.objects.filter(project=board.project, name__iexact=name).first()
                if not comp:
                    bad_component = name
                    break
                component_ids.append(comp.id)
        if bad_component:
            fail_row(f'Component "{bad_component}" not found.')
            continue

        label_names = [n.strip() for n in row.get("labels", "").split(";") if n.strip()]

        # Import never supplies custom field values, but a screen's required
        # custom field must still be enforced against that — exactly the
        # same call WorkItemSerializer.validate() makes on create (with an
        # empty payload, since there's nothing to pass) so a CSV row can't
        # silently create an item the single-item API would have rejected.
        custom_error = custom_fields_write_error(board.project, item_type, {}, existing_item=None)
        if custom_error:
            if isinstance(custom_error, dict):
                message = "; ".join(custom_error.values())
            else:
                message = custom_error
            fail_row(message)
            continue

        try:
            with transaction.atomic():
                item = WorkItem.objects.create(
                    board=board, item_type=item_type, title=title,
                    description=row.get("description", ""), status=status, priority=priority,
                    due_date=due_date, assignee=assignee, created_by=user,
                    position=next_position(board.id, status.id),
                )
                if component_ids:
                    item.components.set(component_ids)
                if label_names:
                    item.labels.set(resolve_labels(label_names, user))
        except (DataError, IntegrityError, DjangoValidationError) as exc:
            fail_row(f"Could not create this row: {exc}")
            continue
        imported += 1

    return {"imported": imported, "failed": failed}


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

LABEL_PALETTE = [
    "#6E4FA3", "#2E7D5B", "#3B3F8F", "#A32218",
    "#B8860B", "#1F7A8C", "#C2447A", "#5B7B29",
]


def label_color_for(name: str) -> str:
    """Deterministic — the same name always resolves to the same palette
    color, including after a delete-and-recreate. Mirrors
    design/js/store.js's hashLabelColor for BMP characters (32-bit unsigned
    overflow, replicated here with an explicit mask since Python ints don't
    wrap) — Python's `ord(ch)` yields a full Unicode code point while JS's
    `charCodeAt` yields a UTF-16 code unit, so the two diverge on an
    astral-plane character (e.g. an emoji in a label name), but the
    prototype and the real API render the same color for the same name
    otherwise."""
    digest = 0
    for ch in name:
        digest = (digest * 31 + ord(ch)) & 0xFFFFFFFF
    return LABEL_PALETTE[digest % len(LABEL_PALETTE)]


def resolve_labels(names, user):
    """Case-insensitive match-or-create against `Label`, in one
    transaction — a work item write can create a brand-new Label and reuse
    an existing one in the same request. Mirrors design/js/store.js's
    findOrCreateLabel/resolveLabelIds, except this assumes every name in
    `names` has already been validated non-blank (WorkItemSerializer.validate()
    does that, and 400s before this ever runs) — the prototype's mock
    instead drops a blank silently, which this deliberately does not
    replicate; see this plan's Global Constraints.

    `user` is the acting user, recorded as `created_by` on any brand-new
    `Label` this call invents.

    The create is collision-safe: two concurrent requests both inventing
    the same brand-new label name can both see `.filter().first()` return
    None and both attempt to `.create()` it — the second one hits the
    unique constraint on `Label.name` and raises `IntegrityError`. That's
    caught and treated as "someone else just created it", re-querying for
    the now-existing row instead of raising. The create attempt runs
    inside its own nested `transaction.atomic()` (a savepoint) so that,
    on MySQL, the IntegrityError doesn't poison the outer transaction this
    function is already called within — without the savepoint, the outer
    atomic block would be left unusable after the exception."""
    resolved = []
    seen_ids = set()
    with transaction.atomic():
        for raw in names:
            clean = raw.strip()
            label = Label.objects.filter(name__iexact=clean).first()
            if label is None:
                try:
                    with transaction.atomic():
                        label = Label.objects.create(name=clean, color=label_color_for(clean), created_by=user)
                except IntegrityError:
                    label = Label.objects.get(name__iexact=clean)
            if label.id not in seen_ids:
                seen_ids.add(label.id)
                resolved.append(label)
    return resolved


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


def resolve_default_status(project):
    """The status a new work item lands in when none is given — the
    lowest-position todo-category status, i.e. the leftmost column.
    Seeds the project's defaults first if it has none at all yet, and tops
    up just the `todo` category if the project has statuses but none in
    that category (e.g. its last todo-category status was deleted or
    recategorized away via `/admin/`, which has no guard against that).

    Never raises KeyError: seed_default_statuses() always creates a
    `todo`-category status when one is missing, so `seeded.get("todo")`
    should always hit — but a `.get()` with a graceful fallback (rather
    than a `["todo"]` lookup) means a code path we haven't thought of still
    can't turn into an uncaught 500 for the caller."""
    status = (
        WorkItemStatus.objects.filter(project=project, category=WorkItemStatus.Category.TODO)
        .order_by("position", "id")
        .first()
    )
    if status is not None:
        return status

    seeded = seed_default_statuses(project)
    todo = seeded.get("todo")
    if todo is not None:
        return todo

    # Should be unreachable given the top-up above, but stay defensive:
    # prefer handing back *some* status over crashing the request.
    fallback = WorkItemStatus.objects.filter(project=project).order_by("position", "id").first()
    if fallback is not None:
        return fallback
    raise ValidationError(
        f"Project {project.pk} has no statuses at all, and none could be created."
    )


def next_position(board_id: int, status_id: int) -> int:
    """The position a new work item takes: the end of its column.

    This read is deliberately UNLOCKED. Two concurrent creates into the
    same column can both read the same Max(position) and both save with
    that same position — that duplicate is a real possible outcome, not a
    theoretical one. It is benign, and only benign, for two independent
    reasons that both have to keep holding:

    1. WorkItem.Meta.ordering = ["position", "id"] is a TOTAL order
       (position ties are broken by id), so a duplicate position never
       makes display order ambiguous or nondeterministic — it just makes
       the tie-break do the work "position" alone couldn't.
    2. move_work_item() renumbers the ENTIRE destination column to a clean
       0..n-1 on every move, not just the two rows it touches — so the
       very first drag in that column, by anyone, heals the duplicate.

    Anyone narrowing move_work_item() to shift only the immediate
    neighbours instead of renumbering the whole column, or dropping the
    `id` tiebreak from WorkItem.Meta.ordering, turns this from a harmless,
    self-healing quirk into a visible board-shuffle bug — two items
    fighting for the same slot with no defined order between them. Don't
    "fix" this by locking next_position(); the cost (a lock on every
    create) buys nothing that isn't already covered above.
    """
    highest = WorkItem.objects.filter(board_id=board_id, status_id=status_id).aggregate(
        highest=Max("position")
    )["highest"]
    return 0 if highest is None else highest + 1


def next_backlog_position(board_id: int, sprint_id) -> int:
    """The backlog_position a work item takes when appended to the end of
    its bucket — the backlog (sprint_id=None) or one specific Sprint.
    Same unlocked-read shape as next_position() above, for the same
    reason: a benign duplicate self-heals the next time schedule_work_item()
    renumbers that bucket."""
    max_position = WorkItem.objects.filter(board_id=board_id, sprint_id=sprint_id).aggregate(
        Max("backlog_position")
    )["backlog_position__max"]
    return 0 if max_position is None else max_position + 1


_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _is_iso_date(value) -> bool:
    text = str(value)
    if not _ISO_DATE_RE.match(text):
        return False
    try:
        datetime.date.fromisoformat(text)
    except ValueError:
        return False
    return True


def is_blank_custom_value(field_type, value) -> bool:
    """Mirrors design/js/logic.js's isBlankValue exactly: blankness is
    per-type, not a single "falsy" check."""
    if field_type == CustomField.FieldType.MULTISELECT:
        return not isinstance(value, list) or len(value) == 0
    if field_type == CustomField.FieldType.CHECKBOX:
        return value is not True
    return value is None or (isinstance(value, str) and not value.strip()) or value == ""


def field_value_error(field, value, option_ids, member_ids):
    """Type-checks one value against its field. Returns a message, or None
    when it's fine. Mirrors design/js/logic.js's fieldValueError exactly."""
    field_type = field.field_type

    if field_type == CustomField.FieldType.TEXT_SHORT:
        return f'"{field.name}" must be 255 characters or fewer.' if len(str(value)) > 255 else None
    if field_type == CustomField.FieldType.TEXT_LONG:
        return None
    if field_type == CustomField.FieldType.NUMBER:
        try:
            float(str(value).strip())
        except (TypeError, ValueError):
            return f'"{field.name}" must be a number.'
        return None
    if field_type == CustomField.FieldType.DATE:
        return None if _is_iso_date(value) else f'"{field.name}" must be a date (YYYY-MM-DD).'
    if field_type == CustomField.FieldType.CHECKBOX:
        return None
    if field_type == CustomField.FieldType.SELECT:
        try:
            ok = int(value) in option_ids
        except (TypeError, ValueError):
            ok = False
        return None if ok else f'"{field.name}" must be one of its current options.'
    if field_type == CustomField.FieldType.MULTISELECT:
        try:
            ok = all(int(v) in option_ids for v in value)
        except (TypeError, ValueError):
            ok = False
        return None if ok else f'"{field.name}" must only use its current options.'
    if field_type == CustomField.FieldType.USER_PICKER:
        try:
            ok = int(value) in member_ids
        except (TypeError, ValueError):
            ok = False
        return None if ok else f'"{field.name}" must be a member of this project.'
    return f'"{field.name}" has an unknown field type.'


def resolve_screen(project, item_type):
    assignment = (
        ProjectScreenAssignment.objects.filter(project=project, item_type=item_type)
        .select_related("screen")
        .first()
    )
    return assignment.screen if assignment else None


def custom_fields_read_map(work_item):
    """Every saved value for this work item, keyed by field id (as a
    string, matching JSON object key semantics) — regardless of whether
    its field is still on the currently-assigned screen. Mirrors
    design/js/store.js's customFieldsOf's `map` half exactly.

    Uses `.all()` on the related manager (not `.select_related("field")`,
    which would build a fresh queryset and bypass any `prefetch_related`
    the caller already did) so callers can prefetch `field_values__field`
    on their queryset and avoid an N+1 here.

    Defensive against garbage/legacy rows: a value that fails to coerce
    (e.g. a hand-edited or corrupted `select`/`multiselect`/`user_picker`
    row that isn't a clean integer) is skipped rather than raising — one
    bad field should not make the whole work item unreadable.
    """
    values_by_field = {}
    for value in work_item.field_values.all():
        values_by_field.setdefault(value.field, []).append(value)

    result = {}
    for field, rows in values_by_field.items():
        key = str(field.id)
        if field.field_type == CustomField.FieldType.MULTISELECT:
            ints = []
            for row in rows:
                try:
                    ints.append(int(row.value))
                except (TypeError, ValueError):
                    continue
            result[key] = ints
        elif field.field_type == CustomField.FieldType.CHECKBOX:
            result[key] = True
        elif field.field_type in (CustomField.FieldType.SELECT, CustomField.FieldType.USER_PICKER):
            try:
                result[key] = int(rows[0].value)
            except (TypeError, ValueError):
                continue
        else:
            result[key] = rows[0].value
    return result


def custom_fields_write_error(project, item_type, payload, existing_item=None):
    """None if the payload is fine, else a dict of {field_id: message} (or,
    for the no-screen-assigned case, a single string) suitable for
    `serializers.ValidationError({"custom_fields": <this>})`. Mirrors
    design/js/store.js's customFieldsError exactly."""
    screen = resolve_screen(project, item_type)

    if screen is None:
        if not payload:
            return None
        label = dict(WorkItem.ItemType.choices)[item_type]
        return (
            f"{label} items in this project have no screen assigned, "
            f"so custom fields can't be set on them."
        )

    rows = list(ScreenField.objects.filter(screen=screen).select_related("field").order_by("position", "id"))
    allowed_ids = {row.field_id for row in rows}

    stray = {}
    for key in payload:
        try:
            key_id = int(key)
        except (TypeError, ValueError):
            stray[key] = "That field isn't on this screen."
            continue
        if key_id not in allowed_ids:
            field = CustomField.objects.filter(pk=key_id).first()
            name = f'"{field.name}"' if field else "That field"
            stray[key] = f'{name} isn\'t on the "{screen.name}" screen.'
    if stray:
        return stray

    existing_map = custom_fields_read_map(existing_item) if existing_item else {}
    member_ids = set(project.memberships.values_list("user_id", flat=True))

    errors = {}
    for row in rows:
        field = row.field
        key = str(field.id)
        value = payload[key] if key in payload else existing_map.get(key)

        if is_blank_custom_value(field.field_type, value):
            if row.required:
                errors[key] = f'"{field.name}" is required.'
            continue

        option_ids = set(field.options.values_list("id", flat=True)) if field.has_options else set()
        message = field_value_error(field, value, option_ids, member_ids)
        if message:
            errors[key] = message

    return errors or None


_ID_FIELD_TYPES = (CustomField.FieldType.SELECT, CustomField.FieldType.MULTISELECT, CustomField.FieldType.USER_PICKER)


def _canonicalize_custom_value(field_type, v):
    """The string actually stored for one value. `select`/`multiselect`/
    `user_picker` store a `FieldOption`/user id, so canonicalize to
    `str(int(v))` rather than `str(v)` — that normalizes JSON-float
    (`12.0`) and bool (`True`) input, which `field_value_error`'s
    `int(value) in option_ids` check accepts, to the same canonical
    integer string (`"12"`, `"1"`) an already-clean int would produce.
    Without this, a validated-but-uncanonicalized value like `"12.0"`
    gets persisted verbatim and then crashes every later read, since
    `custom_fields_read_map` calls `int()` on the stored string.

    Falls back to the raw `str(v)` if `int(v)` fails — this function is
    only ever reached after `custom_fields_write_error` has already
    proven `int(v)` succeeds, but stays defensive in case
    `apply_custom_fields` is ever called from a path that skips
    validation."""
    if field_type in _ID_FIELD_TYPES:
        try:
            return str(int(v))
        except (TypeError, ValueError):
            pass
    return str(v)


@transaction.atomic
def apply_custom_fields(work_item, payload):
    """Upsert-by-replacement: every field named in the payload loses all of
    its existing rows first, then gets the new one (or several, for
    multiselect). A blank value clears the field. Mirrors
    design/js/store.js's applyCustomFields exactly.

    Runs inside one transaction (delete-then-insert for every field named
    in the payload) so a failure partway through never leaves a field's
    old rows deleted without their replacement written."""
    for key, raw in (payload or {}).items():
        try:
            field = CustomField.objects.get(pk=int(key))
        except (CustomField.DoesNotExist, TypeError, ValueError):
            continue
        WorkItemFieldValue.objects.filter(work_item=work_item, field=field).delete()
        if is_blank_custom_value(field.field_type, raw):
            continue
        values = raw if field.field_type == CustomField.FieldType.MULTISELECT else [raw]
        seen = set()
        for v in values:
            text = _canonicalize_custom_value(field.field_type, v)
            if text in seen:
                continue
            seen.add(text)
            WorkItemFieldValue.objects.create(work_item=work_item, field=field, value=text)


@transaction.atomic
def move_work_item(item: WorkItem, new_status_id: int, new_position: int) -> WorkItem:
    """Drop a work item into a column at a position, then renumber the
    affected columns.

    The honest guarantee this module gives is NOT "positions are always a
    contiguous 0..n-1 for a column" — that is not a standing system
    invariant, and nothing enforces it outside of a move. Deleting the
    item at position 0 out of [0, 1, 2] leaves [1, 2] with no concurrency,
    no bug, and no renumbering involved — gaps like that are EXPECTED and
    HARMLESS, not a defect to fix (this module deliberately does not
    renumber on delete; see next_position() above for why a non-zero-based
    column is still safe to append to).

    What IS guaranteed: `position` (tie-broken by `id`, see
    WorkItem.Meta.ordering) gives every column a deterministic total
    order, and THIS function renormalises the columns it touches to a
    clean 0..n-1 at the moment it runs — that renumbering is a one-time
    side effect of a move, not an invariant that holds continuously
    afterward (the next delete reopens a gap, same as always). Every item
    on the board is locked with SELECT ... FOR UPDATE. That is heavier
    than locking two columns, but a board holds tens of rows, and it buys
    real safety: two concurrent moves on the SAME board issue the
    identical `WHERE board_id = ?` predicate against the same index, so
    both transactions scan (and therefore lock) the rows in the same
    order — that shared predicate/index is what makes them serialise
    instead of deadlocking. The trailing `order_by("id")` is a filesort
    applied to rows that are already locked by then; it gives the
    renumbering a stable, deterministic order to read in, but it plays no
    part in lock acquisition and is NOT what prevents the deadlock. Moves
    on different boards lock disjoint row sets and never contend at all.
    Do not narrow this to a two-column lock on the theory that the ORDER
    BY protects it — it doesn't; any narrower filter would need its own
    argument for why it stays deadlock-free.
    """
    locked = list(
        WorkItem.objects.select_for_update()
        .filter(board_id=item.board_id)
        .order_by("id")
    )

    locked_by_pk = {c.pk: c for c in locked}
    if item.pk not in locked_by_pk:
        # `item` was fetched (unlocked) by the view before this transaction
        # took the lock. If another request deleted it in between, trusting
        # `item.status` here would use a stale, possibly-wrong old_status,
        # renumbering the wrong column, and inserting `item` into the
        # destination column would resurrect a ghost row that bulk_update
        # never writes, leaving the destination with a hole. Surface it as
        # "gone" instead.
        raise WorkItem.DoesNotExist(
            f"WorkItem {item.pk} was deleted before the move could be applied."
        )

    old_status_id = locked_by_pk[item.pk].status_id
    item.status_id = new_status_id

    def renumber(status_id: int) -> list[WorkItem]:
        column = [c for c in locked if c.status_id == status_id and c.pk != item.pk]
        column.sort(key=lambda c: (c.position, c.pk))

        if status_id == new_status_id:
            index = max(0, min(new_position, len(column)))
            column.insert(index, item)

        now = timezone.now()
        for index, member in enumerate(column):
            member.position = index
            member.updated_at = now
        return column

    touched = renumber(new_status_id)
    if old_status_id != new_status_id:
        touched += renumber(old_status_id)

    WorkItem.objects.bulk_update(touched, ["position", "status", "updated_at"])
    return item


@transaction.atomic
def schedule_work_item(item: WorkItem, new_sprint_id, new_position: int) -> WorkItem:
    """Drop a work item into the backlog (new_sprint_id=None) or a sprint
    at a position, then renumber the affected buckets. Mirrors
    move_work_item()'s locking and renumbering shape exactly, keyed on
    (board, sprint) instead of (board, status) — see that function's
    docstring for the full reasoning on why locking every item on the
    board (not just the two buckets) is what makes concurrent calls on
    the same board serialise instead of deadlocking."""
    locked = list(
        WorkItem.objects.select_for_update()
        .filter(board_id=item.board_id)
        .order_by("id")
    )

    locked_by_pk = {c.pk: c for c in locked}
    if item.pk not in locked_by_pk:
        raise WorkItem.DoesNotExist(
            f"WorkItem {item.pk} was deleted before the schedule could be applied."
        )

    old_sprint_id = locked_by_pk[item.pk].sprint_id
    item.sprint_id = new_sprint_id

    def renumber(sprint_id):
        bucket = [c for c in locked if c.sprint_id == sprint_id and c.pk != item.pk]
        bucket.sort(key=lambda c: (c.backlog_position, c.pk))

        if sprint_id == new_sprint_id:
            index = max(0, min(new_position, len(bucket)))
            bucket.insert(index, item)

        now = timezone.now()
        for index, member in enumerate(bucket):
            member.backlog_position = index
            member.updated_at = now
        return bucket

    touched = renumber(new_sprint_id)
    if old_sprint_id != new_sprint_id:
        touched += renumber(old_sprint_id)

    WorkItem.objects.bulk_update(touched, ["backlog_position", "sprint", "updated_at"])
    return item
