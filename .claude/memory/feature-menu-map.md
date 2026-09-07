# Tasky — screen and route map

Two front ends exist and they are **not** at parity:

- **`ui/`** — the production SPA Django serves. 6 screens. **This is what users get.**
- **`design/`** — the signed-off vanilla-JS prototype. 11 screens. Opened as a
  file, no server. This is the *target*, and the backend already supports all of it.

Verified 2026-09-07 against `ui/static/js/app.js`, `ui/static/js/api.js` and
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

### Login
Username + password, session cookie. Failure message is identical for unknown
username and wrong password, deliberately — a different message would let anyone
enumerate who works here. Deactivated accounts get that same generic message.

### Django admin — `/admin/`
Full model admin. **This is how teammates are created today** (`ui/` has no admin screen).

---

## Prototype only in `design/` — backend shipped, production UI NOT built

Every row below has working API endpoints and passing tests. The gap is
purely `ui/`.

| Route | Screen | Actions | Access |
|---|---|---|---|
| `#/fields` | Custom fields | create field (7 types), add/edit/delete options, delete field. Type is immutable after create; delete blocked while on a screen | Owner of any project, or Site Admin |
| `#/screens` | Screens | create screen, add/remove/reorder fields, toggle required, delete (blocked while assigned) | Owner of any project, or Site Admin |
| `#/labels` | Labels | rename, recolor (cycles a hashed palette), delete (unassigns everywhere, no in-use guard) | Owner of any project, or Site Admin |
| `#/search` | Cross-project search | text term (2 char min) + type/priority/project facets; rejects an empty query | Any member; project list is your memberships only |
| `#/admin` | Site admin | create account, activate/deactivate, grant/revoke Site Admin. Self-lockout guarded; last Site Admin cannot be revoked | Site Admin only — no partial view for others |
| `#/projects/:pid/boards/:bid/backlog` | Backlog & sprints | create sprint, start (one active per board), complete (items return to backlog), delete (planned only), move items between sprints and backlog | List and "move to" open to any member; start/complete/delete/create are Owner/Admin |

Also prototype-only, embedded in existing screens:

| Feature | Where | Notes |
|---|---|---|
| **Statuses (Workflows)** | Project detail section | rename, reorder, recategorize, add, delete. `ui/` reads statuses but offers no management UI |
| **Releases** | Project detail section | create, rename, status (Unreleased/Released/Archived), target date, delete. Project-scoped; name unique per project. Tag a work item with a release from its detail modal (any member) |
| **Automation** | Project detail section | rules in plain English. Triggers: work item created, status changed. Actions: apply label, assign, clear assignee, change status. Members see the list; Owner/Admin manage |
| **Attachments** | Work item detail modal | upload, download, delete. Delete = uploader **or** project Owner/Admin (wider than comments, which are author-only) |
| **Custom field values** | Work item create form + detail modal | rendered from the screen assigned to that item type. Orphaned values stay visible read-only under "Other saved values" |
| **Bulk operations** | Board "Select" mode | multi-select then bulk move / assign / set priority / add label / add component / delete |
| **CSV import** | Board "Import" button | `title` required; optional `item_type`, `status`, `priority`, `assignee`, `labels`, `components`. Per-row success — a bad row is reported and skipped |
| **Project templates** | Create project form | Blank / Software Project / Bug Tracking. Seeds statuses and starter components. Not recorded on the project afterward |
| **Project archiving** | Project detail | Owner-only. Visibility-only today — archived projects stay fully editable. Hidden from the list unless "Show archived" |

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
