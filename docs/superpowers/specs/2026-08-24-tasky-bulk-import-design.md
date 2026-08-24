# Tasky — Bulk Operations & Import (Sub-project 2c of 13)

**Status:** Fast-drafted 2026-08-24 by solo authorship (per user's explicit request to speed up
the remaining roadmap) — awaiting user review and sign-off. No `design/` prototype built yet;
per this repo's hard rule, prototype work begins only after this spec is reviewed and approved.

## Context

This is sub-project 2c in Tasky's expansion from a single-board Kanban tool toward a broader,
Jira-inspired feature set. The full roadmap (13 sub-projects, redrawn 2026-08-14) is:

1. Projects & Membership — shipped
2. Work Item Hierarchy — shipped (backend + UI)
   - 2b. Custom Fields & Screens — shipped (backend + `design/` prototype)
   - 2c. **Bulk Operations & Import — this document**
3. Workflows — shipped (backend + `design/` prototype)
4. Labels — shipped (backend + `design/` prototype)
5. Search — fast-drafted, pending review
6. Backlog & Sprints — fast-drafted, pending review
7. Releases — fast-drafted, pending review
8. Task Detail UX — fast-drafted, pending review
9. Permissions & Admin — fast-drafted, pending review
10. Project Types & Setup — fast-drafted, pending review
11. Automation — fast-drafted, pending review
12. Notifications — fast-drafted, pending review
13. Reporting & Dashboards — fast-drafted, pending review

Everything shipped so far (statuses, labels, components, custom fields) is built and edited one
work item at a time, through the detail modal or a single `PATCH`. That's fine for day-to-day
use but breaks down in two recurring situations: acting on a whole batch of cards at once (move
a dozen stale items to Done, relabel everything from last sprint), and getting a project started
from an existing list of work — most commonly a spreadsheet someone already has. Both are
"getting started and staying fast" problems, not new domain concepts, so this sub-project adds
no new field types and only one new small piece of surface: the ability to target N existing
work items or create N new ones in a single request instead of N requests.

## Judgment calls flagged for review

This was fast-drafted without live Q&A, so these are the calls most likely to need a second
look before anyone signs off:

- **Bulk operations and import are both "best-effort," not all-or-nothing.** A batch of 50 can
  partially succeed, with failures reported per-item/per-row rather than the whole request
  rolling back on one bad row. This trades a simpler mental model (either it all happened or
  none of it did) for resilience against one stale/typo'd row blocking 49 good ones. Reasonable
  people could want the opposite, especially for bulk delete.
- **Bulk delete uses the same permission tier as single-item delete: any project member, no
  Owner/Admin gate.** This isn't invented for this spec — `WorkItemViewSet` today has no role
  check beyond project membership, so a Member can already delete one card via the detail modal.
  Bulk delete just makes it faster to delete fifty by mistake instead of one. Worth a deliberate
  yes/no rather than inheriting it silently.
- **CSV import excludes Subtask entirely** (parent is required for a Subtask and import has no
  hierarchy-linking pass). If the real migration story is "bring in an existing tree from Jira,
  parent relationships and all," this spec doesn't cover it and that gap should be named now,
  not discovered later.
- **Bulk label/component edit is add-only** — there's no bulk "remove this label from these 12
  items." If end-of-sprint cleanup ("strip the 'urgent' label from everything now that it's
  closed") is a real workflow, this is a gap.
- **The CSV column set, multi-value delimiter (`;` within a cell), and assignee-by-username
  resolution are all specific technical choices made without a real sample spreadsheet to test
  against.** They're a plausible guess at "what a small team's tracker export looks like," not
  something derived from an actual file.
- **Row/batch size caps (500 rows per import, 200 ids per bulk request) are arbitrary numbers**,
  not measured against anything — there's no usage data yet to size them against.

## Scope decisions from brainstorming

No live brainstorming session happened for this fast-draft; these are judgment calls made
solo, each with the reasoning that would normally come out of that conversation.

- **Bulk operations reuse existing single-item validation and permission logic — no bypass.**
  A bulk status-move validates the target status belongs to the batch's project exactly like
  `POST /api/work-items/{id}/move/` does today; a bulk component-apply rejects a component from
  the wrong project exactly like the single-item `PATCH` does. Nothing about acting on many
  items at once should let a batch do something one item couldn't.
- **Bulk edit covers status (move), assignee, priority, labels (add), components (add), and
  delete — not title, description, `item_type`, or `parent`.** The excluded fields are either
  inherently per-item (title/description) or structural enough that a wrong bulk edit is
  expensive to notice and undo (`item_type`, `parent` reshapes the hierarchy). The included
  fields are exactly the ones already changeable from the board/detail-modal today without
  touching the item's identity or place in the tree.
- **Labels/components are "add," not "replace," in bulk.** A single-item `PATCH` replaces the
  full `labels`/`components` set (documented in `docs/api.md`), which is fine when one person is
  looking at one item's current tags. Applied to 20 items with 20 different existing tag sets,
  "replace" would silently wipe unrelated tags off every item — "add" is the only safe bulk
  semantic without a much more elaborate diff UI.
- **Bulk move appends selected items to the bottom of the destination status column, in the
  order they were selected — no reordering UI.** Multi-select-and-move's job is "get these off
  my radar," not "get them into this exact stack order." Anyone who cares about position within
  the new column still drags individual cards afterward, same as today.
- **Import is CSV with a fixed column set, not a generic mapping UI.** A column-mapping screen
  ("which of your spreadsheet's columns is 'title'?") is meaningfully more UI than a small
  team's actual need — the ask here is "get my spreadsheet in," and a documented fixed header
  row is a five-minute copy-paste fix on their end versus real scope on ours.
- **Import and bulk operations are both synchronous, in-request — no background job queue.**
  With the row/batch caps below, both complete well within a normal request timeout. Adding
  async job infrastructure (polling, a job model, a progress screen) for an operation that
  finishes in under a second is exactly the kind of enterprise-bulk-tooling this brief says to
  avoid.
- **Import does not touch custom fields / Screens (2b).** A CSV cell can't express "the value of
  whichever custom field this project's Story screen happens to have" without either a dynamic
  column set (defeats the fixed-format goal) or a second mini-mapping step. Deferred; see Out of
  scope.

## Data model

No new models. Both features are pure API/service-layer additions over the existing `WorkItem`,
`WorkItemStatus`, `Label`, and `Component` tables.

- Bulk operations run the *same* per-item mutation path each existing single-item endpoint
  already uses (`WorkItem.save()`, the `move` service, the M2M add for `labels`/`components`),
  just invoked once per id inside one request instead of once per HTTP call. There is nothing to
  persist about a bulk operation itself — like a single edit, once it's applied it's applied;
  consistent with "Activity history" already being a deferred v1 non-goal.
- Import likewise creates ordinary `WorkItem` rows through the same `save()` path a normal
  `POST /api/work-items/` create uses (key generation, default-status resolution, `labels`
  create-or-reuse all included, unchanged). Nothing about "this batch was an import" is recorded
  on the resulting rows or anywhere else — no `ImportJob` table, no import history screen. If
  audit history is wanted later, it lands as part of whatever sub-project adds general activity
  history, not duplicated here.

## API surface

```
POST /api/work-items/bulk-move/     {ids: [...], status: <WorkItemStatus id>}
POST /api/work-items/bulk-update/   {ids: [...], assignee?, priority?, labels_add?, components_add?}
POST /api/work-items/bulk-delete/   {ids: [...]}
POST /api/boards/{id}/import/       multipart form, one file field: csv
```

All three bulk endpoints: `IsAuthenticated`, and every id in `ids` must belong to a work item in
a single project the caller is a member of (`IsProjectMember`, checked once for the whole batch,
before any row is touched — same fail-closed shape as every other endpoint in this codebase).
`ids` max length 200; an empty list is rejected.

- **`bulk-move`** mirrors `POST /api/work-items/{id}/move/`'s validation exactly: `status` must
  be a `WorkItemStatus` belonging to the batch's project, checked once. Items are appended to
  the bottom of the destination status column in the order given, and the column is renumbered
  the same way a single `move/` renumbers its destination — no `position` supplied per item.
- **`bulk-update`** mirrors `PATCH /api/work-items/{id}/`, minus `status`/`board` (unchanged from
  today — column moves still only go through `move/`, now including `bulk-move/`). Every field
  in the body is optional; only the fields present are touched. `assignee` and `priority` are
  validated once and applied to every row identically. `labels_add`/`components_add` are lists
  merged into each item's existing set (create-or-reuse for labels, same as the single-item
  `labels` field; must already exist and belong to the project for `components_add`, same as the
  single-item `components` field).
- **`bulk-delete`** deletes each requested item; a bulk-deleted parent's children have their
  `parent` cleared, not cascaded — identical to a single `DELETE`.
- All three respond `{"succeeded": [<ids>], "failed": [{"id": <id>, "error": "<message>"}]}`
  (bulk-delete's `succeeded` key is `"deleted"`). A row only lands in `failed` for a per-row
  reason (the id no longer exists, e.g. deleted by someone else between page load and submit) —
  a bad *uniform* field (unknown assignee id, out-of-project component, bad status id) rejects
  the whole request with 400 before touching any row, since that failure applies identically to
  every row and there's nothing "partial" about it.
- **`import`** — `IsProjectMember` on the target board's project (any member, same tier as
  `POST /api/work-items/`). Body is `multipart/form-data` with a single `csv` file field.
  Required header: `title`. Optional headers, any subset, any order: `item_type` (one of
  `epic`, `story`, `task`, `bug` — never `subtask`; defaults to `task`), `description`, `status`
  (a status *name* in the target board's project, case-insensitive; defaults to the project's
  default `todo`-category status when the column is blank or absent), `priority` (`low` /
  `medium` / `high`, case-insensitive; defaults to `medium`), `assignee` (a username, exact
  match required), `due_date` (`YYYY-MM-DD`), `labels` (semicolon-separated names — resolved
  create-or-reuse, identical to the single-item `labels` field), `components` (semicolon-
  separated names — must already exist in the target project). Max 500 data rows per file.
  Responds `{"imported": <count>, "failed": [{"row": <line number>, "title": <string or
  null>, "error": "<message>"}]}`. Each row is its own transaction: a bad row is skipped and
  reported, everything else in the file still imports.

## Error handling

| Case | Response |
|---|---|
| Unauthenticated request | 403, never 401 |
| Non-member of the batch's/board's project | 403, checked before any row is processed |
| `ids` empty, or exceeds 200 | 400 |
| `ids` span more than one project | 400, naming the offending id |
| `bulk-move` `status` doesn't belong to the batch's project | 400, whole request rejected |
| `bulk-update` `assignee` id doesn't exist | 400, whole request rejected |
| `bulk-update` `components_add` includes an id from another project | 400, whole request rejected |
| An id in the batch no longer exists at execution time | That id in `failed`; rest of batch proceeds |
| CSV file missing, unreadable, or missing the `title` header | 400, whole file rejected |
| CSV has more than 500 data rows | 400, whole file rejected before any row processed |
| A row's `title` is blank | That row in `failed`; rest of file proceeds |
| A row's `status`/`priority`/`due_date`/`assignee`/`components` value doesn't resolve | That row in `failed`, naming the column and value; rest of file proceeds |
| A row's `item_type` is `subtask` | That row in `failed` — subtasks aren't importable (need a parent) |
| A row's `labels` name is new | Created (create-or-reuse), not an error |

## Testing

- `bulk-move` validates the target status against the batch's project once; items land at the
  bottom of the destination column in payload order; the column's `position` values renumber
  the same way a single `move/` does.
- `bulk-update` applies `assignee`/`priority` uniformly to every row; `labels_add` reuses an
  existing label and creates a genuinely new one, matching single-item semantics; a component
  from a different project 400s the whole request without touching any row.
- `bulk-delete` removes every requested item in one call; children of a bulk-deleted parent have
  `parent` cleared, not cascaded.
- A batch spanning two projects is rejected 400 without applying to either.
- A non-member of the batch's project is rejected 403 for the whole request.
- An id that no longer exists at execution time appears in `failed`; the rest of the batch still
  applies (proves best-effort, not all-or-nothing).
- CSV happy path: a file using every optional column creates matching work items, including
  label create-or-reuse and default-status/default-priority fallback when a column is blank.
- Each optional CSV column's invalid-value case (bad `status` name, bad `priority`, bad
  `due_date` format, unknown `assignee` username, unknown `components` name) lands in `failed`
  for that row only, without blocking the rest of the file.
- A `subtask` row is rejected with a `failed` entry naming the reason.
- A file missing the `title` header, or exceeding 500 rows, is rejected before any row imports.
- Import uses the same key-generation/default-status logic as `POST /api/work-items/` — no
  duplicate `key`s, no parallel validation path drifting from the single-item create.

## Out of scope (deferred to later sub-projects)

- **Custom fields / Screens in import or bulk-edit.** A CSV column can't express a
  project-and-item-type-specific field set without either a dynamic header row or a mapping
  step, both of which are real scope beyond "get my spreadsheet in." Revisit once someone
  actually needs to bulk-populate a custom field, not preemptively.
- **Hierarchy / parent linkage in import.** Import creates a flat list; `subtask` is excluded
  entirely. Bringing in an existing Epic → Story → Subtask tree from another tool needs a
  multi-pass linking step (parents must exist before children reference them) that's real scope
  no one has asked for yet.
- **Bulk remove for labels/components.** Only additive bulk-apply is covered; removing a label
  from many items at once still means opening each item's modal. A dedicated bulk-remove is easy
  to add later without touching this endpoint shape if it's actually needed.
- **Import formats beyond a fixed-column CSV** (Excel `.xlsx`, a Jira/Trello export, a
  generic column-mapping UI). One header format, one file type.
- **Async/background import or bulk jobs**, progress bars, or resumable imports. The row/batch
  caps keep both operations well within a normal request's timeout; a job queue is unwarranted
  scope for an operation that finishes in under a second.
- **Undo for any bulk operation.** Tasky has no soft-delete or undo mechanic anywhere today;
  bulk delete is exactly as permanent as single delete.
- **Saved/reusable bulk-selection filters** ("select all Bugs assigned to me"). Selection is
  manual multi-select on the currently rendered board only — no saved-search concept exists yet
  (that's sub-project 5, Search).
- **Import/bulk-operation history or an audit trail.** Nothing about a batch is persisted beyond
  its synchronous response, matching v1's already-deferred "Activity history" non-goal.
