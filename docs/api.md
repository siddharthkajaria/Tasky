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
| GET/PUT/PATCH/DELETE | `/api/work-items/{id}/` | `key`, `item_type`, `position` are immutable; `status`/`board` unchanged from before |
| POST | `/api/work-items/{id}/move/` | **breaking change:** `status` is now a `WorkItemStatus` id, not a string; see note below |
| GET | `/api/boards/{id}/work-items/` | every work item on that board |
| GET | `/api/work-items/{id}/children/` | direct children only (not grandchildren) |
| GET/POST | `/api/work-items/{id}/links/` | list / create a "relates to" link; POST body is `{item: <other work item id>}` |

**On write (POST/PATCH)**, `status` accepts a `WorkItemStatus` id (an integer) and **defaults to the project's default status for the `todo` category when omitted on create.** On read (GET), `status` is an integer id; `status_detail` is a read-only nested object `{id, name, category}` that includes the status name and category alongside the id. Both fields appear in every work item response.

**BREAKING CHANGE:** `POST /api/work-items/{id}/move/` now takes `{status: <WorkItemStatus id>, position: <int>}` instead of `{status: "todo"|"in_progress"|"done", position: <int>}`. Any client code sending the old string enum values will receive a 400 error. The request must include a real status id. If sending a status from a different project than the work item's, a 400 is rejected with `{"status": "Status must belong to this item's project."}`.

`priority` is `1` low, `2` medium, `3` high; responses also carry `priority_label`.

`item_type` is one of `epic`, `story`, `task`, `bug`, `subtask` — fixed for every project. `key` (e.g. `TASKY-123`) is generated on create from a per-project counter shared across every type and board, and can never be changed afterward. `parent` must be an Epic for a Story/Task/Bug, must be a Story/Task/Bug for a Subtask (required, not optional), can never be set on an Epic, and must be on the same board as the child — violating any of these is a `400` naming `parent`. Deleting a work item clears its children's `parent` rather than deleting them.

**`status` cannot be changed via `PATCH`/`PUT` on `/api/work-items/{id}/`.** A request whose `status` differs from the work item's current value is rejected with 400: `{"status": "Status cannot be changed here — POST to /api/work-items/{id}/move/ instead."}`. Moving a work item between columns is *only* done via `POST /api/work-items/{id}/move/`, which is the one endpoint that renumbers both the source and destination columns correctly. A `PATCH` that echoes back the work item's current, unchanged `status` alongside other real edits (e.g. `title`) is accepted — a UI PATCHing back the full set of fields it holds does not need to strip `status` out, it just must not try to change it that way.

**`board` cannot be changed via `PATCH`/`PUT` on `/api/work-items/{id}/` either, for the same reason.** Work items do not move between boards in this product at all — a request whose `board` differs from the work item's current board is rejected with 400: `{"board": "Work items cannot be moved between boards."}`. As with `status`, a `PATCH` that echoes back the work item's current, unchanged `board` alongside other real edits is accepted.

Work item responses also carry read-only extras beyond the writable fields above: `assignee_detail` (a nested `{id, username, display_name}` object for the current `assignee`, returned alongside the raw `assignee` id), `created_by` (a nested user object), `priority_label` (the human-readable form of `priority`), `status_detail` (a nested `{id, name, category}` object for the current `status`, returned alongside the raw `status` id), `parent_detail` (a nested summary of the parent — `{id, key, title, item_type, status}` — alongside the raw `parent` id, or `null` with no parent), `components_detail` (the full nested `Component` objects for the current `components`, alongside the raw `components` id list), and `labels_detail` (the full nested `{id, name, color}` `Label` objects for the current `labels`). `key` is likewise response-only, system-generated on create. None of these are accepted on write.

**`labels` is the one field on this endpoint that differs from every other tagging mechanism here: it's write-only and takes label *names* (strings), not ids.** `POST`/`PATCH` `{"labels": ["urgent", "needs-design"]}` resolves each name case-insensitively against the existing `Label` table — a name that already exists (in any case) reuses that row, and a name that doesn't exist yet is created on the spot with a deterministically-hashed color from the same 8-color palette `/api/labels/` uses. Two names in the same write that differ only by case collapse to a single label. A blank/whitespace-only name is rejected with `400: {"labels": "A label name can't be blank."}` and the whole write fails — no work item or label is created. `PATCH` **replaces** the full label set; omitting `labels` from a `PATCH` leaves the work item's existing labels untouched. Applying or inventing a label this way needs only ordinary work-item edit permission (project membership) — no Owner check, unlike renaming/recoloring/deleting a `Label` row directly via `/api/labels/{id}/` (see Labels, below).

**`position` is not a system-wide contiguous `0..n-1` invariant** — it is only guaranteed to give a column a deterministic total order (ties broken by `id`), and it is renormalised to a clean `0..n-1` at the moment `/move/` renumbers that column. Deleting a work item, for instance, does **not** renumber anything afterward, so gaps (`0, 2, 3`, say) are expected and harmless — never treat a gap as a sign of corrupted data, and never rely on `position` values being consecutive.

## Components
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/projects/{id}/components/` | POST is Owner/Admin only |
| PATCH/DELETE | `/api/projects/{id}/components/{id}/` | Owner/Admin only |

Any project member can apply an existing component to a work item via `PATCH /api/work-items/{id}/ {"components": [...]}"` — a component from a different project than the work item's is rejected with `400`.

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
