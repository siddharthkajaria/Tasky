# Tasky API

Session-cookie auth, same origin. Every endpoint needs a signed-in session except
`GET /api/auth/csrf/` and `POST /api/auth/login/`.

**An unauthenticated call to any other endpoint returns `403`, not `401`.** DRF's
`SessionAuthentication` treats "no session" as "not permitted" rather than "please
authenticate" (there's no `WWW-Authenticate` challenge to issue for a cookie-based
scheme), so `IsAuthenticated` rejects it with 403. The React error interceptor needs
to branch on 403-for-anonymous, not 401.

Any unsafe request (POST, PATCH, DELETE) must carry an `X-CSRFToken` header whose value
is the `csrftoken` cookie. Call `GET /api/auth/csrf/` once on app load to be handed one.

**`custom_fields` values are never trusted as already the right type — every value is coerced and checked server-side against the field's `field_type`, exactly mirroring `design/js/logic.js`'s `fieldValueError`.**

## Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/auth/csrf/` | — | 204, sets the `csrftoken` cookie |
| POST | `/api/auth/login/` | `{username, password}` | the user, or 400 |
| POST | `/api/auth/logout/` | — | 204 |
| GET | `/api/auth/me/` | — | the signed-in user |

## Boards
| Method | Path | Notes |
|---|---|---|
| GET | `/api/boards/` | every board in a project I'm a member of; unpaginated |
| POST | `/api/boards/` | `{project, name, description?}`; `description` is optional; creator is taken from the session; `project` must be one I'm a member of |
| GET/PUT/PATCH/DELETE | `/api/boards/{id}/` | |
| GET | `/api/boards/{id}/work-items/` | every work item on the board — see the ordering note below |

**Ordering of `/api/boards/{id}/work-items/` is NOT "grouped by column."** The queryset
orders by `WorkItem.Meta.ordering = ["position", "id"]`, which is a single ordering
applied across *all three* statuses at once, not per-column. In practice that means
the three columns **interleave**: `todo#0, in_progress#0, done#0, todo#1, …` — a
work item's `position` is only unique *within its own `status`*, so two different-status
work items can and will share the same `position` value back to back in this list. The
client must **group the response by `status` itself** (into `todo` / `in_progress`
/ `done` buckets) before rendering columns; do not assume the API hands back
already-grouped or already-column-ordered data.

**`project` cannot be changed via `PATCH`/`PUT` on `/api/boards/{id}/`** — boards do not
move between projects, mirroring the rule already in place for `status` and `board` on
work items. A `PATCH` that echoes back the board's current, unchanged `project` alongside
other real edits is accepted.

## Projects
Every board and work item now lives inside a project. Membership is invite-only — nobody
joins a project by any route other than accepting a pending invitation.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/projects/` | projects I'm a member of |
| POST | `/api/projects/` | `{key, name, description?}`; `key` is 2–10 letters, case-insensitive on input but stored uppercase, unique across the system; creator becomes Owner |
| GET | `/api/projects/{id}/` | 403 if I'm not a member (not 404 — see below), 404 if the id doesn't exist at all |
| DELETE | `/api/projects/{id}/` | Owner only; cascades to the project's boards, work items, comments, memberships and invitations |
| GET | `/api/projects/{id}/members/` | sorted Owner, then Admin, then Member |
| DELETE | `/api/projects/{id}/members/{user_id}/` | removes a member; also doubles as "leave" when `user_id` is your own — Owner can remove anyone but themself (and cannot leave without transferring ownership first, 400 if they try), Admin can remove Members only (but can leave freely), Member can only leave |
| POST | `/api/projects/{id}/members/{user_id}/role/` | `{role: "admin"\|"member"}`; Owner only; the Owner's own role can't be changed here |
| POST | `/api/projects/{id}/transfer-ownership/` | `{user_id}`; Owner only; target must already be an Admin; the caller becomes an Admin |
| POST | `/api/projects/{id}/invite/` | `{user_id}`; Owner or Admin; 400 if already a member or already invited |

**A non-member touching a project (or its boards/work items) gets `403`, not `404`.** A
genuinely nonexistent id still 404s — existence is checked first, membership second.

Every project role is one of `owner`, `admin`, `member`. There is exactly one Owner at
all times; the Owner cannot leave a project without transferring ownership to an
existing Admin first (there is no "leave" endpoint of its own — the client models
"leave" as removing your own membership, subject to the same owner restriction as any
other removal).

## Work Items
| Method | Path | Notes |
|---|---|---|
| GET | `/api/work-items/` | every work item on a board in a project I'm a member of |
| POST | `/api/work-items/` | `{board, item_type, title, description?, status?, priority?, due_date?, assignee?, parent?, components?, labels?}` |
| GET/PUT/PATCH/DELETE | `/api/work-items/{id}/` | `key`, `item_type`, `position` are immutable; `status`/`board`/`sprint` unchanged from before |
| POST | `/api/work-items/{id}/move/` | **breaking change:** `status` is now a `WorkItemStatus` id, not a string; see note below |
| POST | `/api/work-items/{id}/schedule/` | `{sprint: <Sprint id or null>, position?: <int>}` — the only way to move a work item between the backlog and a sprint; see Sprints & Backlog below |
| GET | `/api/boards/{id}/work-items/` | every work item on that board |
| GET | `/api/work-items/{id}/children/` | direct children only (not grandchildren) |
| GET/POST | `/api/work-items/{id}/links/` | list / create a "relates to" link; POST body is `{item: <other work item id>}` |

**On write (POST/PATCH)**, `status` accepts a `WorkItemStatus` id (an integer) and **defaults to the project's default status for the `todo` category when omitted on create.** On read (GET), `status` is an integer id; `status_detail` is a read-only nested object `{id, name, category}` that includes the status name and category alongside the id. Both fields appear in every work item response.

**BREAKING CHANGE:** `POST /api/work-items/{id}/move/` now takes `{status: <WorkItemStatus id>, position: <int>}` instead of `{status: "todo"|"in_progress"|"done", position: <int>}`. Any client code sending the old string enum values will receive a 400 error. The request must include a real status id. If sending a status from a different project than the work item's, a 400 is rejected with `{"status": "Status must belong to this item's project."}`.

`priority` is `1` low, `2` medium, `3` high; responses also carry `priority_label`.

`item_type` is one of `epic`, `story`, `task`, `bug`, `subtask` — fixed for every project. `key` (e.g. `TASKY-123`) is generated on create from a per-project counter shared across every type and board, and can never be changed afterward. `parent` must be an Epic for a Story/Task/Bug, must be a Story/Task/Bug for a Subtask (required, not optional), can never be set on an Epic, and must be on the same board as the child — violating any of these is a `400` naming `parent`. Deleting a work item clears its children's `parent` rather than deleting them.

**`status` cannot be changed via `PATCH`/`PUT` on `/api/work-items/{id}/`.** A request whose `status` differs from the work item's current value is rejected with 400: `{"status": "Status cannot be changed here — POST to /api/work-items/{id}/move/ instead."}`. Moving a work item between columns is *only* done via `POST /api/work-items/{id}/move/`, which is the one endpoint that renumbers both the source and destination columns correctly. A `PATCH` that echoes back the work item's current, unchanged `status` alongside other real edits (e.g. `title`) is accepted — a UI PATCHing back the full set of fields it holds does not need to strip `status` out, it just must not try to change it that way.

**`board` cannot be changed via `PATCH`/`PUT` on `/api/work-items/{id}/` either, for the same reason.** Work items do not move between boards in this product at all — a request whose `board` differs from the work item's current board is rejected with 400: `{"board": "Work items cannot be moved between boards."}`. As with `status`, a `PATCH` that echoes back the work item's current, unchanged `board` alongside other real edits is accepted.

**`sprint` cannot be changed via `PATCH`/`PUT` on `/api/work-items/{id}/` either, same rule as `status`/`board`.** A request whose `sprint` differs from the work item's current value is rejected with 400: `{"sprint": "Sprint cannot be changed here — POST to /api/work-items/{id}/schedule/ instead."}`. Moving a work item into a sprint or back to the backlog is *only* done via `POST /api/work-items/{id}/schedule/` (see Sprints & Backlog, below), which is the one endpoint that renumbers both the source and destination buckets correctly. A `PATCH` that echoes back the work item's current, unchanged `sprint` (including `null`) alongside other real edits is accepted. `status` and `sprint` never constrain each other — a work item can be in any status while in the backlog or in any sprint, and moving it between the backlog and a sprint never touches its `status`.

Every work item response carries `sprint` (the current `Sprint` id, or `null` for the backlog) and `sprint_detail` (a read-only nested `{id, name, state, start_date, end_date}` object, or `null` to match). A freshly created work item defaults to the backlog (`sprint: null`) unless `sprint` is given explicitly on create.

Every work item response also carries `release` (the current `Release` id, or `null`) and `release_detail` (a read-only nested `{id, project, name, status, release_date}` object, or `null` to match). A freshly created work item defaults to `release: null` unless `release` is given explicitly on create. **Unlike `status`/`board`/`sprint`, `release` has no immutability restriction on `PATCH`/`PUT`** — it's an ordinary writable field, the same as `components`: any project member can set or clear it in a plain edit, alongside other field changes, in one request. A `release` from a different project than the work item's is rejected with `400` (`{"release": "Release must belong to this item's project."}`). See Releases, below, for the release endpoints themselves.

Work item responses also carry read-only extras beyond the writable fields above: `assignee_detail` (a nested `{id, username, display_name}` object for the current `assignee`, returned alongside the raw `assignee` id), `created_by` (a nested user object), `priority_label` (the human-readable form of `priority`), `status_detail` (a nested `{id, name, category}` object for the current `status`, returned alongside the raw `status` id), `parent_detail` (a nested summary of the parent — `{id, key, title, item_type, status}` — alongside the raw `parent` id, or `null` with no parent), `components_detail` (the full nested `Component` objects for the current `components`, alongside the raw `components` id list), `release_detail` (see above), and `labels_detail` (the full nested `{id, name, color}` `Label` objects for the current `labels`). `key` is likewise response-only, system-generated on create. None of these are accepted on write.

**`labels` is the one field on this endpoint that differs from every other tagging mechanism here: it's write-only and takes label *names* (strings), not ids.** `POST`/`PATCH` `{"labels": ["urgent", "needs-design"]}` resolves each name case-insensitively against the existing `Label` table — a name that already exists (in any case) reuses that row, and a name that doesn't exist yet is created on the spot with a deterministically-hashed color from the same 8-color palette `/api/labels/` uses. Two names in the same write that differ only by case collapse to a single label. A blank/whitespace-only name is rejected with `400: {"labels": "A label name can't be blank."}` and the whole write fails — no work item or label is created. `PATCH` **replaces** the full label set; omitting `labels` from a `PATCH` leaves the work item's existing labels untouched. Applying or inventing a label this way needs only ordinary work-item edit permission (project membership) — no Owner check, unlike renaming/recoloring/deleting a `Label` row directly via `/api/labels/{id}/` (see Labels, below).

**`position` is not a system-wide contiguous `0..n-1` invariant** — it is only guaranteed to give a column a deterministic total order (ties broken by `id`), and it is renormalised to a clean `0..n-1` at the moment `/move/` renumbers that column. Deleting a work item, for instance, does **not** renumber anything afterward, so gaps (`0, 2, 3`, say) are expected and harmless — never treat a gap as a sign of corrupted data, and never rely on `position` values being consecutive.

## Bulk Operations & Import
| Method | Path | Notes |
|---|---|---|
| POST | `/api/work-items/bulk-move/` | `{ids: [...], status: <WorkItemStatus id>}` — moves every id straight to that status |
| POST | `/api/work-items/bulk-update/` | `{ids: [...], assignee?, priority?, components_add?, labels_add?}` |
| POST | `/api/work-items/bulk-delete/` | `{ids: [...]}` |
| POST | `/api/boards/{id}/import/` | multipart `{csv: <file>}` — creates work items from a CSV, best-effort per row |

**The three `/api/work-items/bulk-*/` endpoints all take `{ids: [...]}`, and all three are best-effort, not all-or-nothing:** an id that doesn't resolve to a real work item is reported per-id in the response's `failed` list rather than rejecting the whole request, and every other id in the same request is still processed. `ids` must be a non-empty list of at most 200 integers, or the whole request 400s before anything is touched (`{"ids": "Provide a non-empty list of ids."}` / `"No more than 200 ids per request."` / `"Every id must be an integer."`); if every id given is nonexistent (none resolve), the whole request also 400s (`{"ids": "None of these ids exist."}`) rather than returning an all-failed 200. Every id that *does* resolve must belong to work items in the *same* project — mixing ids from two different projects in one request 400s the whole thing (`{"ids": "All ids must belong to work items in the same project."}`); membership in that one project is what `IsProjectMember` checks (a non-member gets `403`). An id that resolves but the row-level operation still can't apply to (e.g. `bulk-move` given a `status` from a different project) 400s the *whole* request, the same as `/api/work-items/{id}/move/` does — that's a uniform problem, not a per-id one.

`POST /api/work-items/bulk-move/` sets `status` on every resolved item and **appends each one to the bottom of the destination column, in the order given in `ids`** — the same renumbering a single `/api/work-items/{id}/move/` applies to its destination column, just driven by payload order instead of an explicit `position`. There is no `position` in the request body; a client that needs an item at a specific spot within the column (not just "last") still has to use `/move/` for that one item. Response: `{"succeeded": [<ids moved>], "failed": [{"id": <id>, "error": "Not found."}]}`.

`POST /api/work-items/bulk-update/` applies whichever of `assignee`, `priority`, `components_add`, `labels_add` are present in the body to every resolved item — any field left out of the body is left untouched on every item (same "only touch what's named" rule `PATCH /api/work-items/{id}/` already follows). `assignee` accepts a user id or `null` (to unassign); an unknown id 400s the whole request (`{"assignee": "User not found."}`). `priority` must be `1`, `2`, or `3`. `components_add` and `labels_add` are additive only — items keep whichever components/labels they already had, plus these; there is no `components_remove`/`labels_remove`. `components_add` takes ids and 400s the whole request if any id doesn't resolve to a `Component` (`{"components_add": "Component not found."}`, matching `assignee`'s "User not found." behavior) or if any component belongs to a different project (`{"components_add": "Components must belong to this item's project."}`); `labels_add` takes label *names*, resolved/created exactly like `labels` on `/api/work-items/{id}/` does, and a blank name 400s the whole request the same way. Response: `{"succeeded": [<ids updated>], "failed": [{"id": <id>, "error": "Not found."}]}`.

`POST /api/work-items/bulk-delete/` deletes every resolved item outright. Any work item that had one of the deleted items as its `parent` has that `parent` cleared first (same as deleting a single work item does) rather than being deleted itself. Response: `{"deleted": [<ids deleted>], "failed": [{"id": <id>, "error": "Not found."}]}`.

**`POST /api/boards/{id}/import/` creates work items on that board from an uploaded CSV**, `multipart/form-data` with the file under the `csv` field. Like the three bulk endpoints above, it's best-effort per row, not all-or-nothing — but the split between "whole-file problem" and "per-row problem" is different, since a CSV can be malformed in ways a list of ids can't be:

- **Whole-file problems 400 before any row is touched:** an empty upload (`{"csv": "CSV file is empty."}`), a file that isn't UTF-8 text (`{"csv": "CSV file must be UTF-8 encoded."}`), a missing `title` column (`{"csv": "CSV must include a \"title\" column."}`), or more than 500 data rows (`{"csv": "CSV has more than 500 rows."}`).
- **Per-row problems are skipped and reported**, and the rest of the file still imports. Response: `{"imported": <count>, "failed": [{"row": <line number, header is row 1>, "title": <that row's title, or null if blank>, "error": <message>}, ...]}`.

Only `title` is required; every other column is optional and, when the header row doesn't include it at all, behaves exactly as if every row left it blank. Column reference:

| Column | Behavior |
|---|---|
| `title` | Required. A blank title fails just that row (`"Title is required."`) — the file's other rows still import. |
| `item_type` | One of `epic`, `story`, `task`, `bug`; defaults to `task`. `subtask` is rejected (`"Subtasks cannot be imported (need a parent)."`) since a subtask needs a `parent` and CSV import has no way to express one; any other value fails the row (`'Invalid item_type "<value>".'`). |
| `description` | Free text; blank is fine. |
| `status` | Matched case-insensitively by name against this board's project's statuses; defaults to the project's default `todo`-category status when omitted. A name that doesn't match any status in the project fails the row (`'Status "<value>" not found.'`). |
| `priority` | One of `low`, `medium`, `high` (case-insensitive); defaults to `medium`. Anything else fails the row (`'Invalid priority "<value>".'`). |
| `assignee` | Matched case-insensitively by `username`; a name that doesn't match any user fails the row (`'User "<value>" not found.'`). |
| `due_date` | `YYYY-MM-DD`; a value that isn't shape-valid *or* isn't a real calendar date (e.g. `2026-13-01`) fails the row (`'Invalid due_date "<value>".'`). |
| `labels` | `;`-separated label names, resolved/created exactly like `labels` on `/api/work-items/{id}/` — a brand-new name invents a `Label` on the spot. |
| `components` | `;`-separated component names, matched case-insensitively against this board's project's components. A name that doesn't match fails the row (`'Component "<value>" not found.'`); this is the one difference from `labels` — a bad component name fails the row instead of being invented. |

Imported work items go through the same `key`-generation and default-`position` path every other work item creation does — there's nothing import-specific about how a resulting row is numbered or placed in its column.

Import never supplies custom field values, so a row targeting an `item_type` whose assigned screen has a required custom field is rejected as a per-row failure (the field's "is required" message) rather than silently creating an item the single-item create API would have rejected — the rest of the file still imports.

## Components
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/projects/{id}/components/` | POST is Owner/Admin only |
| PATCH/DELETE | `/api/projects/{id}/components/{id}/` | Owner/Admin only |

Any project member can apply an existing component to a work item via `PATCH /api/work-items/{id}/ {"components": [...]}"` — a component from a different project than the work item's is rejected with `400`.

## Releases
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/projects/{id}/releases/` | GET is readable by any project member; POST is Owner/Admin only |
| GET/PATCH/DELETE | `/api/projects/{id}/releases/{id}/` | GET is readable by any project member; PATCH/DELETE are Owner/Admin only |
| GET | `/api/projects/{id}/releases/{id}/work-items/` | every work item in this project currently tagged with this release; any project member |

A `Release` has `{id, project, name, status, release_date}`. `project` is read-only (set from the URL). `name` is required and unique per project (case-insensitive) — a duplicate is rejected with 400 (`{"name": "\"<name>\" already exists."}`). `status` is one of `unreleased`, `released`, `archived` and defaults to `unreleased` on create — it is not settable at creation time via the request body, only via a later `PATCH`. `release_date` is optional. `GET /api/projects/{id}/releases/` is ordered by `release_date` ascending (nulls last), then by `name`.

**`DELETE /api/projects/{id}/releases/{id}/` has no guard against the release still being in use**, the same as deleting a `Label`. Any work item tagged with the deleted release has its `release` cleared (set to `null`); the work items themselves are untouched.

Any project member can apply an existing release to a work item via `PATCH /api/work-items/{id}/ {"release": <Release id or null>}`. Unlike `status`/`sprint`, this is an **ordinary writable field with no immutability restriction** — it can be changed via a plain `PATCH`, alongside any other edit, in one request, with no dedicated action endpoint. A release from a different project than the work item's is rejected with `400` (`{"release": "Release must belong to this item's project."}`).

## Labels
| Method | Path | Notes |
|---|---|---|
| GET | `/api/labels/` | all labels in the system; unpaginated |
| GET/PATCH/DELETE | `/api/labels/{id}/` | PATCH accepts `{name, color}`; DELETE has no guard — see below |

**There is no `POST /api/labels/`.** Labels are created only implicitly, by naming a new label string in a work item write (see `labels` on `/api/work-items/` above). There is no separate endpoint for inventing one ahead of time.

Labels are global, not scoped to a project — the same `Label` row is shared and reused by every project. `name` is unique (case-insensitive); `color` must be one of the 8 hex colors in the fixed palette. `PATCH` re-validates both the same way: a duplicate `name` (case-insensitive, excluding this row) or a `color` outside the palette is rejected with `400`.

**Governance is split, deliberately, from ordinary label use:** any project member can apply an existing label or invent a brand-new one on a work item (see `labels` on `/api/work-items/` above) — that needs only ordinary work-item edit permission. Renaming, recoloring, or deleting the `Label` row itself is a wider-blast-radius action (it affects every work item using that label, across every project) and is gated separately: the caller must be an Owner of *some* project, not necessarily one connected to the label. A non-Owner gets `403`.

**`DELETE /api/labels/{id}/` has no guard against the label still being in use.** Unlike deleting a `CustomField` still assigned to a screen (rejected with 400) or a `WorkItemStatus` still in use by a work item (rejected with 400), deleting a `Label` always succeeds and silently unassigns it from every work item that had it — the work items themselves are untouched, only their `labels` set shrinks.

## Work Item Statuses
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/projects/{id}/statuses/` | GET is readable by any project member; POST is Owner/Admin only |
| PATCH/DELETE | `/api/projects/{id}/statuses/{id}/` | Owner/Admin only |

Each status has a `category` (one of `todo`, `in_progress`, `done`) and a `name` scoped to the project. Responses include `{id, project, name, category, position}`. `project` and `position` are read-only.

**PATCH accepts `{name, category, position}`** (all optional). A category change is rejected with 400 if it's the last remaining status in the original category — every category must always have at least one status.

**DELETE is rejected with 400 in two cases:**
- The status is still in use by one or more work items: `"<name>" is still used by <N> work item(s). Move them first."`
- It's the last remaining status in its category: `"<Category> needs at least one status."`

When a status is deleted, all other statuses in the project are reordered (`position` values are renormalised to `0..n-1`).

## Sprints & Backlog
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/boards/{id}/sprints/` | GET is readable by any project member; POST is Owner/Admin only |
| GET | `/api/sprints/{id}/` | any project member |
| PATCH | `/api/sprints/{id}/` | `{name, goal}`; Owner/Admin only; `board`/`state`/`start_date`/`end_date`/`created_by`/`created_at` are read-only |
| DELETE | `/api/sprints/{id}/` | Owner/Admin only; see the guard below |
| POST | `/api/sprints/{id}/start/` | Owner/Admin only; see the state-transition note below |
| POST | `/api/sprints/{id}/complete/` | Owner/Admin only; see the state-transition note below |
| GET | `/api/sprints/{id}/work-items/` | every work item currently scheduled into this sprint, ordered by `backlog_position` |
| GET | `/api/boards/{id}/backlog/` | every work item on the board with `sprint: null`, ordered by `backlog_position` |

A `Sprint` has a `state` of `planned`, `active`, or `completed`, and belongs to exactly one `board`. Response shape: `{id, board, name, goal, state, start_date, end_date, created_by, created_at}`.

**`POST /api/sprints/{id}/start/` is rejected with 400 unless the sprint is `planned`** (`"Only a planned sprint can be started."`), and **is also rejected with 400 if another sprint on the same board is already `active`** (`"\"<name>\" is already active on this board. Complete it first."`) — a board can have at most one active sprint at a time. On success, `state` becomes `active` and `start_date` is set to today.

**`POST /api/sprints/{id}/complete/` is rejected with 400 unless the sprint is `active`** (`"Only an active sprint can be completed."`). On success, `state` becomes `completed`, `end_date` is set to today, and **every work item still scheduled into that sprint is returned to the backlog** (`sprint` set to `null`), appended to the end of the board's backlog in the sprint's own `backlog_position` order — their `status` is left completely untouched.

**`DELETE /api/sprints/{id}/` is rejected with 400 in two cases:**
- The sprint isn't `planned` (`"Only a planned sprint can be deleted."`) — an `active` or `completed` sprint can never be deleted, only completed sprints keep their history.
- The sprint still has one or more work items scheduled into it (`"Still has <N> work item(s) scheduled into it. Move them first."`) — schedule them elsewhere (or back to the backlog) via `/api/work-items/{id}/schedule/` first.

**`POST /api/work-items/{id}/schedule/`** is the only endpoint that changes a work item's `sprint`. Body: `{sprint: <Sprint id or null>, position?: <int>}`. `sprint: null` schedules the item into the backlog; a `Sprint` id schedules it into that sprint. `position` is optional — omitting it appends the item to the end of the destination bucket (the backlog or the target sprint); an explicit `position` places it there instead, renumbering the bucket the same way `/move/` renumbers a status column. No separate permission check beyond ordinary work-item edit permission (project membership) — unlike creating/deleting a `Sprint` itself, any project member can schedule work into one. Rejected with 400 when:
- `sprint` doesn't resolve to a real `Sprint`, or belongs to a different board than the work item: `{"sprint": "Sprint must belong to this item's board."}`
- `sprint` is a `completed` sprint: `{"sprint": "Can't schedule into a completed sprint."}`

`backlog_position` (like `position` on the status columns) is **not** a system-wide contiguous `0..n-1` invariant — it's a deterministic total order within its own bucket (the backlog, or one sprint), renormalised to a clean `0..n-1` at the moment `/schedule/` (or `/complete/`, for the items it returns to the backlog) renumbers that bucket. Deleting a work item does not renumber anything afterward, so gaps are expected and harmless, same as `position`.

## Custom Fields
| Method | Path | Notes |
|---|---|---|
| GET | `/api/fields/` | all custom fields in the system; unpaginated |
| POST | `/api/fields/` | `{name, field_type}`; `field_type` is one of `text_short`, `text_long`, `number`, `date`, `select`, `multiselect`, `checkbox`, `user_picker`; Creator must be an Owner of at least one project; 400 if `name` already exists (case-insensitive) |
| GET/PATCH/DELETE | `/api/fields/{id}/` | PATCH only on `name`; `field_type` is immutable, 400 if attempting to change it; DELETE rejected with 400 if the field is still assigned to any screen |

## Field Options
| Method | Path | Notes |
|---|---|---|
| POST | `/api/fields/{field_pk}/options/` | `{label}`; only valid for `select` and `multiselect` fields, 400 otherwise; 400 if `label` already exists for this field (case-insensitive); caller must be a project Owner |
| PATCH/DELETE | `/api/fields/{field_pk}/options/{id}/` | PATCH accepts `{label, position}`; position reordering cascades to siblings; DELETE rejected with 400 if the option is still chosen on any work item |

## Screens
| Method | Path | Notes |
|---|---|---|
| GET | `/api/screens/` | all screens in the system; unpaginated |
| POST | `/api/screens/` | `{name}`; Creator must be an Owner of at least one project; 400 if `name` already exists (case-insensitive) |
| GET/PATCH/DELETE | `/api/screens/{id}/` | PATCH only on `name`; DELETE rejected with 400 if the screen is still assigned to any (project, item_type) pair |

Responses carry a `fields` array of nested screen field objects, each with `{id, field, field_detail, position, required}`. `field_detail` is the full `CustomField` object; `field` is just the id.

## Screen Fields
| Method | Path | Notes |
|---|---|---|
| POST | `/api/screens/{screen_pk}/fields/` | `{field, required}`; assigns a custom field to this screen; `field` must be a `CustomField` id; 400 if the field is already on this screen; caller must be a project Owner |
| PATCH/DELETE | `/api/screens/{screen_pk}/fields/{id}/` | PATCH accepts `{required, position}`; position reordering cascades to siblings; DELETE removes the field from this screen (does not delete the `CustomField` itself) |

## Screen Assignments
| Method | Path | Notes |
|---|---|---|
| GET | `/api/projects/{id}/screen-assignments/` | maps each of this project's five item types (`epic`, `story`, `task`, `bug`, `subtask`) to its assigned screen id, or `null` if unassigned; any project member can read |
| PUT | `/api/projects/{id}/screen-assignments/` | body is `{epic: <screen id or null>, story: ..., task: ..., bug: ..., subtask: ...}`; updates any item_type present; 400 if screen id doesn't exist; Owner/Admin only |

## Work Items — `custom_fields`
The existing `/api/work-items/` and `/api/work-items/{id}/` endpoints carry an additional `custom_fields` field:

**Read** (`GET /api/work-items/` or `GET /api/work-items/{id}/`): `custom_fields` is a dict keyed by custom field id (as a string, matching JSON object key semantics) to field values. The value shape depends on field type: `text_short`, `text_long`, `number`, and `date` are strings; `checkbox` is boolean; `select` and `user_picker` are integers; `multiselect` is an array of integers.

**Write** (`POST /api/work-items/` or `PATCH /api/work-items/{id}/`): `custom_fields` is write-only, and accepts the same dict shape as the read format. Values are never trusted as already the right type — every value is coerced and checked server-side against the field's `field_type`. A write fails with 400 (`{"custom_fields": <message>}`) in these cases:
- No screen is assigned to this item type in the item's project: `"Story items in this project have no screen assigned, so custom fields can't be set on them."`
- The payload references a field not on the assigned screen (field id present but not on screen): `{<field_id>: "\"Story Points\" isn't on the \"Create\" screen."}`
- A required field is missing: `{<field_id>: "\"Story Points\" is required."}`
- A value fails type checking (exact message depends on field type):
  - Text longer than 255 chars: `{<field_id>: "\"Description\" must be 255 characters or fewer."}`
  - Non-numeric value for number field: `{<field_id>: "\"Hours\" must be a number."}`
  - Invalid date format: `{<field_id>: "\"Start Date\" must be a date (YYYY-MM-DD)."}`
  - Invalid select option: `{<field_id>: "\"Severity\" must be one of its current options."}`
  - Invalid multiselect option: `{<field_id>: "\"Tags\" must only use its current options."}`
  - Invalid user for user_picker: `{<field_id>: "\"Assignee\" must be a member of this project."}`

## Work Item Links
| Method | Path | Notes |
|---|---|---|
| DELETE | `/api/work-item-links/{id}/` | removes the link from both sides |

See `GET/POST /api/work-items/{id}/links/` above for listing/creating. Self-links, duplicate links, and linking two items already in a parent/child relationship are all rejected with `400`.

**`DELETE /api/work-item-links/{id}/` requires membership in *both* linked items' projects, not just one.** This mirrors the AND semantics the create path already enforces — a link can only be created between two items the caller can see (member of both items' projects), so removing it holds the same bar. A caller who is a member of only one side's project gets `403`.

## Comments
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/work-items/{id}/comments/` | POST takes `{body}`; author comes from the session |
| DELETE | `/api/comments/{id}/` | if the comment has an author, only that author can delete it (otherwise 403); if the comment's author account has been deleted (`author` is `null`), any signed-in user who is a member of the comment's project can delete it (403 for non-members) |

## Invitations
| Method | Path | Notes |
|---|---|---|
| GET | `/api/invitations/` | my own pending invitations |
| POST | `/api/invitations/{id}/accept/` | creates a Member-role membership; 403 if it isn't your invitation |
| POST | `/api/invitations/{id}/decline/` | 403 if it isn't your invitation |

## Me
| Method | Path | Notes |
|---|---|---|
| GET | `/api/me/tasks/` | my open work items in a project I'm still a member of, soonest due first |
| GET | `/api/users/` | `id`, `username`, `display_name` for the assignee dropdown |

**`/api/me/tasks/` exclusion is category-based, not status-based.** It excludes every work item whose status has `category = "done"`, not just those with a literal status named "Done". A project that recategorizes a status (e.g. renames an `in_progress` status to `done` category, or vice versa) will silently change which work items appear here without any change to the endpoint itself.

## Search
| Method | Path | Notes |
|---|---|---|
| GET | `/api/search/` | cross-project search over work items in projects I'm a member of |

Query params — at least one of `q` or a facet is required, or the request 400s:

| Param | Meaning |
|---|---|
| `q` | free-text term, matched against `key`, `title`, and `description`; must be at least 2 characters (400 otherwise) |
| `item_type` | one of `epic`, `story`, `task`, `bug`, `subtask` |
| `status_category` | one of `todo`, `in_progress`, `done` — matches every status in that category, not one literal status |
| `priority` | `1`, `2`, or `3` |
| `assignee` | a user id; 400 if the user doesn't exist |
| `component` | a `Component` id; 400 if it doesn't exist or belongs to a project I'm not a member of |
| `label` | a `Label` id, or a label name (case-insensitive); 400 if no matching label exists |
| `project` | a `Project` id to narrow the search to; 400 if I'm not a member of it |

**`label` tries id first, then falls back to name.** A numeric-looking value (Unicode decimal digits only) is looked up as a `Label` id first; if that finds nothing, it's tried again as an exact case-insensitive name match. This means a label literally named with digits (e.g. `"2026"`) is still reachable by name even though its numeric-looking value is tried as an id first.

Every result is always scoped to projects I'm a member of first, before any facet is applied — a forged `component`, `label`, or `project` value belonging to a project I'm not in can never surface a work item from that project; it just 400s instead.

**Ranking when `q` is given:** results whose `key` or `title` contains `q` (tier 1) always rank above results that only match on `description` (tier 2) — a result matching both counts once, in tier 1. Within each tier, results are ordered by `-updated_at` (most recently updated first), tied on `-id`. When only facets are given (no `q`), results are ordered the same way, `-updated_at` then `-id`.

Results are capped at 50 with no pagination — a search matching more than 50 work items simply returns the top 50 by the ranking above.

Each result has the shape produced by `SearchResultSerializer`: `id`, `key`, `title`, `item_type`, `status_detail` (`{id, name, category}`), `priority`, `priority_label`, `assignee_detail` (nested user or `null`), `project` (`{id, key, name}`), `board` (`{id, name}`), `updated_at`. The response is `{"results": [...]}`.
