# Tasky — screen and route map

Two front ends exist and they are now **close to parity**:

- **`ui/`** — the production SPA Django serves. 10 of `design/`'s 11 screens,
  after the Wave 1 UI-wiring branch closed most of the gap. **This is what
  users get.**
- **`design/`** — the signed-off vanilla-JS prototype. 11 screens. Opened as a
  file, no server. The one screen still missing from `ui/` — the Site Admin
  user-management panel (`#/admin`, part of sub-project 9) — remains
  prototype-only here; everything else the backend supports is now reachable
  from `ui/`.

Verified 2026-09-16 against `ui/static/js/app.js`, `ui/static/js/api.js` and
`design/js/app.js`. Both are hash-routed SPAs; Django's catch-all in
`config/urls.py` renders `ui/index.html` for any non-`/api/`, non-`/admin/`,
non-`/static/` path.

## Roles

| Role | Scope | Source |
|---|---|---|
| `owner` / `admin` / `member` | Per project | `ProjectMembership.role` |
| **Site Admin** | Global | `User.is_staff` |

"Manage" tier = Owner **or** Admin. Owner-only actions are called out per row.
Site Admin widens global-resource management (labels, fields, screens) without
needing any project role.

---

## Shipped in `ui/` (production)

### `#/` → `#/projects` — Projects list
- **Data:** project name, `key`, your role badge, member count; pending invitations panel
- **Actions:** create project (name + key), open project, accept/decline invitation
- **Access:** any authenticated user; lists only projects you are a member of

### `#/projects/:id` — Project detail
- **Data:** name, key, your role, member list with role badges, board list, component list
- **Actions:** create board · invite member (Owner/Admin) · remove member (Owner any non-Owner; Admin members only) · change role (Owner) · transfer ownership (Owner) · delete project (Owner) · leave project (Admin/Member — Owner must transfer first) · add/rename/delete component (Owner/Admin)
- **Access:** members of that project. A non-member gets 403, a missing id 404.

### `#/projects/:pid/boards/:bid` — Board (the core screen)
- **Data:** one column per `WorkItemStatus`, coloured by category not name. Cards show key pill, type badge, title, assignee, due date, parent chip, component chips, left edge rule (thickness = priority, red = overdue)
- **Actions:** add work item · open detail modal · **drag to move columns** (only path that changes status) · edit title/description/priority/due date/assignee/parent/components · manage "relates to" links · comment (delete own only) · delete item
- **Access:** project members
- **Note:** `GET /api/boards/:id/work-items/` returns all columns interleaved in one position-ordered list; the client groups by `status` itself.

### `#/boards/:id` — Board redirect
Resolves the board, rewrites the hash to the canonical `#/projects/:pid/boards/:bid`. Exists for old links and the My tasks list.

### `#/my-tasks` — My tasks
- **Data:** every work item assigned to you across every project — key, title, project, board, status, due date, overdue styling
- **Actions:** click through to the item's board
- **Access:** authenticated; scoped to yourself

### `#/labels` — Labels admin
- **Data:** every global `Label` — name, color swatch
- **Actions:** rename, recolor (cycles the 8-color hashed palette), delete (unassigns everywhere, no in-use guard)
- **Access:** Owner of any project, or Site Admin

### `#/fields` — Custom fields
- **Data:** every global `Field` (7 types) and its options
- **Actions:** create field, add/edit/delete options, delete field. Type is immutable after create; delete is blocked while the field is on a screen
- **Access:** Owner of any project, or Site Admin

### `#/screens` — Screens
- **Data:** every global `Screen` and its assigned fields
- **Actions:** create screen, add/remove/reorder fields, toggle required, delete (blocked while assigned)
- **Access:** Owner of any project, or Site Admin

### `#/search` — Cross-project search
- **Data:** work items matching a text term (2 char min) plus type/priority/project facets
- **Actions:** search, click through to the item's board
- **Access:** any member; the project pool is scoped to your own memberships before any facet is applied

### `#/projects/:pid/boards/:bid/backlog` — Backlog & sprints
- **Data:** the board's backlog plus every sprint (Planned/Active/Completed) and its items
- **Actions:** create sprint, start (one active per board), complete (items return to backlog), delete (planned only), move items between sprints and backlog
- **Access:** list and "move to" open to any member; start/complete/delete/create are Owner/Admin

### Also shipped, embedded in existing screens

| Feature | Where | Notes |
|---|---|---|
| **Statuses (Workflows)** | Project detail section | rename, reorder, recategorize, add, delete. Owner/Admin |
| **Releases** | Project detail section | create, rename, status (Unreleased/Released/Archived), target date, delete. Project-scoped; name unique per project. Tag a work item with a release from its detail modal (any member) |
| **Automation** | Project detail section | rules in plain English. Triggers: work item created, status changed. Actions: apply label, assign, clear assignee, change status. Members see the list; Owner/Admin manage |
| **Attachments** | Work item detail modal | upload, download, delete. Delete = uploader **or** project Owner/Admin (wider than comments, which are author-only) |
| **Custom field values** | Work item create form + detail modal | rendered from the screen assigned to that item type. Orphaned values stay visible read-only under "Other saved values" |
| **Bulk operations** | Board "Select" mode | multi-select then bulk move / assign / set priority / add label / add component / delete |
| **CSV import** | Board "Import" button | `title` required; optional `item_type`, `status`, `priority`, `assignee`, `labels`, `components`. Per-row success — a bad row is reported and skipped |
| **Project templates** | Create project form | Blank / Software Project / Bug Tracking. Seeds statuses and starter components. Not recorded on the project afterward |
| **Project archiving** | Project detail | Owner-only. A real write-block, not just visibility: an archived project's boards/work items/comments/etc. reject every write with `403`, reads stay open, and the project is hidden from the list unless "Show archived" |

### Login
Username + password, session cookie. Failure message is identical for unknown
username and wrong password, deliberately — a different message would let anyone
enumerate who works here. Deactivated accounts get that same generic message.

### Django admin — `/admin/`
Full model admin. **This is how teammates are created today** (`ui/` has no admin screen).

---

## Prototype only in `design/` — backend shipped, production UI NOT built

One screen remains: everything else sub-projects 1–11 cover shipped into
`ui/` via the Wave 1 UI-wiring branch.

| Route | Screen | Actions | Access |
|---|---|---|---|
| `#/admin` | Site admin (sub-project 9) | create account, activate/deactivate, grant/revoke Site Admin. Self-lockout guarded; last Site Admin cannot be revoked | Site Admin only — no partial view for others |

Teammates are still created via Django admin (`/admin/`) instead, as noted above.

---

## Not built anywhere (spec only)

| # | Sub-project | Spec |
|---|---|---|
| 12 | Notifications | `docs/superpowers/specs/2026-08-24-tasky-notifications-design.md` |
| 13 | Reporting & Dashboards | `docs/superpowers/specs/2026-08-24-tasky-reporting-dashboards-design.md` |

Tasky sends **no email and no push**. There is no task queue, no Redis, no cron.

## Mock mode

Append `?data=store` to any URL to run `ui/` on `ui/static/js/store.js`, an
in-memory mock that enforces the same server rules. The same fallback happens
automatically when the API is unreachable, so the UI degrades to something
reviewable rather than a dead screen. A **Mock data** badge appears bottom-right.
