# Tasky — user flows and state rules

Traced from `boards/services.py`, `boards/automation.py`, `projects/permissions.py`,
`accounts/permissions.py` and the specs in `docs/superpowers/specs/`. Where a flow
is prototype-only the row says so.

## Notification triggers

**None.** Tasky sends no email, push or SMS. No SMTP config, no task queue, no
templates. Invitations are surfaced in-app on the Projects screen only.
Sub-project 12 (Notifications) is spec-only.

---

## Flow 1 — Get an account

1. A **Site Admin** creates the account (Django admin today; `#/admin` in the prototype).
2. The Site Admin hands over username + initial password out of band.
3. The user signs in. There is no activation step, no email, no password reset,
   no public signup, and no invite-by-email.

**Deactivation:** a Site Admin flips `is_active`. Login then fails with the same
generic "Incorrect username or password" as a wrong password — a deactivated
account must not reveal that it ever existed.

**Guards:** a Site Admin cannot deactivate or revoke Site Admin from themselves
(the buttons are hidden before it can be attempted), and the last remaining Site
Admin cannot be revoked (`accounts/permissions.py: can_revoke_site_admin`).

## Flow 2 — Create a project and staff it

1. Any authenticated user creates a project: `name` + `key` (2–10 uppercase
   letters, unique system-wide) + optional template.
2. The creator becomes **Owner**. Exactly one Owner exists at all times.
3. Template seeds statuses and starter components:
   - **Blank** → 3-status Simple preset (To Do / In Progress / Done), no components
   - **Software Project** → 5-status Detailed preset, components Frontend/Backend/Infrastructure
   - **Bug Tracking** → 5-status Detailed preset, no components
   The template is a one-time starting point — nothing on the project records it.
4. Owner or Admin invites an **existing account** (`user_id`, never an email).
5. The invitee sees the invitation on their Projects screen and accepts or declines.
   `pending` → `accepted` | `declined`.

**Permission matrix** (`projects/permissions.py` — mirrors `design/js/logic.js`):

| Action | Owner | Admin | Member |
|---|---|---|---|
| Invite member | ✅ | ✅ | ❌ |
| Remove member | ✅ any non-Owner | ✅ members only | ❌ |
| Change role | ✅ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ |
| Delete project | ✅ | ❌ | ❌ |
| Archive project | ✅ | ❌ | ❌ |
| Leave project | ❌ must transfer first | ✅ | ✅ |
| Manage components / statuses / releases / automation / screen assignments | ✅ | ✅ | ❌ |
| View and edit project content, apply labels/components, create links | ✅ | ✅ | ✅ |

## Flow 3 — Create and move a work item

1. On a board, "+ Add work item": type, title, optional parent, assignee,
   priority, due date, labels, components, and any custom fields from the screen
   assigned to that item type.
2. The server allocates the key by **locking the project row inside a
   transaction** and incrementing `next_item_number`. One counter per project
   shared across all types and boards — `TASKY-1, TASKY-2, TASKY-3` follows
   creation order, not type.
3. Automation rules with trigger `work_item_created` fire inline
   (`boards/automation.py: evaluate_work_item_created`).
4. To move columns, the user **drags the card**. The browser sends where it
   landed to `POST /api/work-items/{id}/move/`; the server renumbers that whole
   column inside a transaction.
5. Automation rules with trigger `status_changed` fire inline.
6. A failed drag springs the card back to exactly where it was.

**Hierarchy rules** (enforced on create and on re-parenting):

| Type | Parent |
|---|---|
| `epic` | must have none |
| `story` / `task` / `bug` | optionally an Epic |
| `subtask` | **required**, and must be a Story, Task or Bug |

Parent and child must live on the same board. Deleting an item **orphans** its
children rather than cascading. `item_type` and `key` are immutable after creation.

## Flow 4 — Status transitions

- Statuses are **per project**, configurable, each carrying a category:
  `todo` | `in_progress` | `done`. Many statuses may share one category.
- **No transition rules.** Any status can move to any other.
- Every project must always keep **at least one status in each of the three
  categories** — recategorizing or deleting the last one in a category is rejected.
- Deleting a status is rejected while work items sit in it, **or** while an
  automation rule references it. The error names what is in the way.
- Column colour follows the **category**, not the name.

## Flow 5 — Sprints *(prototype only)*

`PLANNED` → `ACTIVE` → `COMPLETED`

1. Create a sprint on a board (Owner/Admin). It starts `PLANNED` with 0 items.
2. Any member moves items between backlog and sprints — scheduling is a plain
   edit, not a manage-tier action.
3. Start the sprint — rejected while another sprint on that board is `ACTIVE`.
   **One active sprint per board.**
4. Complete it — its items return to the backlog.
5. Only a `PLANNED` sprint can be deleted.

## Flow 6 — Releases *(prototype only)*

`Unreleased` → `Released` → `Archived`, **and any jump between them** — no
transition rules. Date can be set or cleared at any time regardless of status.

- Project-scoped: name unique per project, so two projects may both have `v2.4.0`.
- Any member can tag a work item with a release; only Owner/Admin manage the
  release itself.
- Deleting a release has **no in-use guard** — tagged items simply lose the tag.
- Nothing ties a release's status to its work items' statuses, by design.

## Flow 7 — Comments and attachments

| | Create | Edit | Delete |
|---|---|---|---|
| **Comment** | any member | author only | author only |
| **Attachment** *(prototype)* | any member | — | uploader **or** project Owner/Admin |

Attachments are stored on local disk (`MEDIA_ROOT`), never served statically.
`boards.views.AttachmentViewSet.download` is the only path a client can fetch a
file through, so it enforces the same membership check as everything else.

Refusing to delete someone else's comment returns **403 — and that is not a
logout**. See the 403 note below.

## Flow 8 — Custom fields *(prototype only)*

- Fields and Screens are **global and reusable**; only the project-to-screen
  mapping is per-project.
- One screen per item type per project, controlling both create and edit.
- `field_type` is immutable after creation.
- Writing custom fields **replaces the full value set** for each named field
  rather than diffing it.
- Viewing a work item always shows every saved value, even after a screen
  reassignment orphans the field — shown read-only under "Other saved values".
- Deletion guards: a field on a screen, an option in use, and a screen in use
  all refuse deletion until cleared.

## Flow 9 — Labels *(prototype only)*

- **Global**, not project-scoped — the same "urgent" is one row everywhere.
- Any member invents a label by typing it on a work item. **There is no create
  endpoint** — creation is implicit (`boards/services.py: resolve_labels`).
- Colour is deterministically hashed from the name into a fixed palette
  (`label_color_for`), never chosen manually.
- Rename, recolor and delete are gated to any project Owner, or a Site Admin.

## Flow 10 — Automation *(prototype only)*

| Trigger | Filter |
|---|---|
| `work_item_created` | item type |
| `status_changed` | from status / to status (or category) |

| Action |
|---|
| apply label · set assignee · clear assignee · change status |

Rules fire **inline, in the same save** — no queue, no worker, no delay. A rule
can be deactivated without losing its config. Members see the rule list and its
plain-English descriptions (so it is clear why a card changed on its own);
Owner/Admin manage them.

---

## API behaviours that bite (these cause real bugs)

1. **Unauthenticated calls return `403`, never `401`.**
2. **`403` is ambiguous** — "session expired" *and* "you may not delete another
   person's comment". `ui/static/js/api.js` disambiguates by re-checking
   `/api/auth/me/` with a raw `fetch` (going back through `request()` would
   recurse forever once the session is gone). Never treat every 403 as a logout.
3. **`status` and `board` cannot be changed via `PATCH`** on
   `/api/work-items/{id}/`. Column moves go only through
   `POST /api/work-items/{id}/move/`. `item_type` and `key` are also rejected.
4. **`GET /api/boards/{id}/work-items/` interleaves all columns** in one
   position-ordered list. The client groups by `status` itself.
5. **`position` is not contiguous.** Gaps like `0, 2, 3` are normal after a
   delete and are never corruption.
6. **A genuinely missing id returns 404; existence is checked before
   membership.** `IsProjectMember` is object-level only, so "found, but not one
   of your projects" is a 403 rather than a leaked 404.
