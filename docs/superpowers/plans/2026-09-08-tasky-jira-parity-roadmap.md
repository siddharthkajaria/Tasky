# Tasky → Jira parity — feature review and delivery roadmap

**Written:** 2026-09-08 · **Author:** planning pass, no code changed
**Goal (stated by the user):** make Tasky a genuine Jira clone — every feature we
realistically need, end to end, reachable from the app.

> **This document plans. It does not authorise development.**
> The hard rule in `CLAUDE.md` still holds: a sub-project's design must be signed
> off *in the user's own words* before Phase 2 starts. Every net-new feature below
> is marked **`GATE`** where a Phase 1 prototype in `design/` plus sign-off is
> required first. Items marked **`WIRE`** are Phase 2 work on an already-signed-off
> design (sub-projects 1–11) and are not gated.

---

## 0. How this review was done

| Source | What it gave |
|---|---|
| `browse` against `atlassian.com` + `support.atlassian.com` | Jira's real feature and permission surface (see §1). Marketing pages were useless; the admin docs were not. |
| `boards/models.py`, `projects/models.py`, `accounts/models.py` | The actual data model |
| `docs/api.md` (436 lines) | The full shipped API contract |
| `config/urls.py`, `*/urls.py`, `boards/views.py` | Every reachable endpoint |
| `ui/static/js/api.js` (127 lines) | **The honest measure of what the production UI can do** |
| `.claude/memory/feature-menu-map.md`, `user-flows.md`, `brand-guidelines.md` | Screen map, state rules, visual system |
| `docs/follow-ups.md`, `docs/tech-debt.md` | Known gaps and deliberate non-goals |
| Live screenshots of `design/` at 1440×900 | Grounding for the UI critique in §7 |

Jira pages actually read: project/space permission scheme (access, config, work item,
time-tracking, voters/watchers/comments/attachments), global permissions, project roles,
team-managed vs company-managed, work type hierarchy, time tracking config, work item
linking, resolutions, and the reports index.

---

## 1. Jira's feature surface — the reference model

This is what we are cloning. Grouped as Jira itself groups it.

### 1.1 Identity, access and administration

| Area | Jira |
|---|---|
| **Global permissions** | Administer Jira · Browse users and groups · Share dashboards and filters · Manage group filter subscriptions · Make bulk changes · Create team-managed projects |
| **User management** | Invite by email, groups, deactivate, user directory, SAML/SSO, API tokens |
| **User profile** | Name, email, avatar, timezone, language, password change, notification preferences |
| **Project types** | Team-managed (self-serve, simple) vs company-managed (shared schemes, admin-controlled) |
| **Project roles** | Default **Administrator / Member / Viewer** + custom roles. Roles are *placeholders* a scheme grants permissions to; each project fills them independently |
| **Project access level** | Open (everyone = Member) · Limited (everyone = Viewer) · Private (invited only) |
| **Permission schemes** | ~40 granular permissions, reusable across projects |
| **Issue security schemes** | Per-work-item visibility levels below project level |

### 1.2 The ~40 project permissions (the real Jira list)

**Project access & configuration:** Administer projects · Browse projects · Manage work item layouts · Edit workflows · Manage versions (releases) · Manage sprints · View aggregated data · View development tools · View (read-only) workflow

**Work item:** Archive · Assign work items · Assignable user · Close · Create · Delete · Edit · Link · Modify reporters · Move · Resolve · Restore archived · Schedule · Transition · Set security level

**Time tracking:** Work on work items · Edit own worklogs · Edit all worklogs · Delete own worklogs · Delete all worklogs

**Comments, attachments, watchers:** Add comments · Edit own/all comments · Delete own/all comments · Create attachments · Delete own/all attachments · Manage watchers · View voters and watchers

> Note the shape: almost everything is split **own vs all**. Tasky has none of that split.

### 1.3 Work items

- **Configurable work types** with icons — not a fixed enum. Work type *schemes* decide which types a project offers.
- **Configurable hierarchy**: level 1 (Epic), level 0 (Story/Task/Bug), level −1 (Subtask), plus custom levels above Epic (Initiative, Theme) on Premium.
- Fields: Summary, Description (rich text), **Reporter**, Assignee, Priority, **Resolution**, Labels, Components, **Fix Version / Affects Version**, Due date, **Start date**, Environment, **Story points / Original estimate / Remaining estimate / Time spent**, custom fields.
- **Typed, directional links**: blocks / is blocked by · duplicates / is duplicated by · clones / is cloned by · relates to. Each has a name, an outward and an inward description.
- Attachments, comments (with @mentions and internal notes), **watchers**, **votes**, **full change history**, **worklog**.
- **Move** between projects and **change work type**.
- **Archive** and **restore**; **trash** with restore.

### 1.4 Workflow

- Statuses grouped into To Do / In Progress / Done categories.
- **Transitions** between statuses — not free movement. Each transition can have conditions (who may), validators (what must be true), post-functions (what happens after), and a screen.
- **Resolution** is set on transition into a Done status. "Done without a resolution" is the classic Jira misconfiguration.
- Workflow schemes map work types → workflows; shared across company-managed projects.
- **Priority schemes**: Highest / High / Medium / Low / Lowest, configurable and per-project.

### 1.5 Planning and views

Board (Scrum + Kanban) with swimlanes, quick filters, card layout, WIP limits, column→status mapping · Backlog · **Sprints** with goal, dates, capacity · **Timeline / roadmap (Gantt)** · **Calendar** · **List** · Summary · **Releases/Versions** with release notes · Components with lead and default assignee · **Goals**.

### 1.6 Search and reporting

- **JQL** — a real query language — plus a basic filter builder.
- **Saved filters**, shared, with email subscriptions.
- **Dashboards** with gadgets; per-user and shared.
- **Reports:** Burndown · Burnup · Velocity · Sprint report · Cumulative flow diagram · Control chart · Cycle time · Epic report · Epic burndown · Release burndown · Version report · Created vs Resolved · Time tracking · Deployment frequency.

### 1.7 Automation, notification and integration

- Rule engine: many triggers (created, transitioned, field changed, commented, **scheduled/cron**, incoming webhook), conditions, branching, multi-action, chaining.
- **Notification schemes**: which event notifies which role, by email and in-app.
- **REST API with API tokens / OAuth**, **webhooks**, Smart Commits, GitHub/GitLab/Bitbucket/Jenkins/Figma/Slack integrations.
- Import from CSV/JSON/Trello/Bitbucket; **export**.
- Audit log.

---

## 2. Tasky today — an honest inventory

Tasky's backend is much further along than it looks; the production UI is the bottleneck.

| Layer | State |
|---|---|
| Backend | Sub-projects 1–11 shipped, 554 tests, 98% coverage |
| `design/` prototype | 11 screens, signed off, faithful to the backend |
| **`ui/` production** | **6 screens** — login, projects, project detail, board, board-redirect, my-tasks |
| Spec-only | 12 Notifications, 13 Reporting & Dashboards |

**`ui/static/js/api.js` defines client methods for auth, projects, members, invitations,
boards, statuses (read-only), work items, components, links, comments, users and my-tasks.
Nothing else.** Roughly ten sub-projects of tested API surface is unreachable from the app.

Not reachable in production today, though the backend and the signed-off design both exist:
custom fields · screens · labels · cross-project search · sprints and backlog · releases ·
attachments · site admin (incl. **creating users**) · project templates · automation ·
bulk operations · CSV import · project archiving · status management.

---

## 3. Gap analysis — what is missing

Three buckets. **Missing** = Jira has it, Tasky has nothing. **Unreachable** = built and
tested on the server, no UI. **Misconfigured** = built, but behaves differently from Jira
in a way that will bite.

### 3.1 Unreachable — built, tested, no UI (`WIRE`, not gated)

| # | Feature | Backend evidence |
|---|---|---|
| U1 | **Add users / Site Admin console** | `/api/admin/users/` full CRUD-minus-delete, self-lockout and last-admin guards **— you flagged this; it exists, it just has no screen** |
| U2 | Status (workflow) management | `/api/projects/{id}/statuses/` |
| U3 | Labels administration | `/api/labels/` |
| U4 | Custom fields + screens + screen assignments | `/api/fields/`, `/api/screens/`, `/api/projects/{id}/screen-assignments/` |
| U5 | Cross-project search | `/api/search/` |
| U6 | Backlog + sprints | `/api/boards/{id}/sprints/`, `/backlog/`, `/api/work-items/{id}/schedule/` |
| U7 | Releases | `/api/projects/{id}/releases/` |
| U8 | Attachments | `/api/work-items/{id}/attachments/`, `/api/attachments/{id}/download/` |
| U9 | Bulk operations + CSV import | `/api/work-items/bulk-*`, `/api/boards/{id}/import/` |
| U10 | Automation rules | `/api/projects/{id}/automation-rules/` |
| U11 | Project templates | `/api/project-templates/` |
| U12 | Project archive / unarchive | `/api/projects/{id}/archive/` |

### 3.2 Missing entirely — no backend, no UI (`GATE`)

**Identity and profile**

| # | Gap | Note |
|---|---|---|
| M1 | **User profile management** | `MeView` is GET-only. No way to change your own name, email, password or avatar. `User.email` exists on the model and is exposed by **no serializer anywhere**. **You flagged this.** |
| M2 | **Email invitations to people without accounts** | `POST /api/projects/{id}/invite/` takes `user_id` only. **You flagged this.** Requires email — an explicit architecture decision (see §9 D1) |
| M3 | Avatars | No image field on `User`, no upload path |
| M4 | Groups | No user grouping; permissions can only be granted per-user |
| M5 | Timezone / locale | Everything is server-local |
| M6 | SSO / SAML | Out of scope for an internal tool, noted for completeness |

**Roles and permissions** — see §4 for the full redesign

| # | Gap |
|---|---|
| M7 | No granular permission model. Three hardcoded roles, ~7 predicate functions, checks duplicated in three files that must be hand-kept in lockstep |
| M8 | No **Viewer** role — Jira's third default. Everyone with access can edit |
| M9 | No own-vs-all split on comments, attachments, worklogs |
| M10 | No custom project roles, no permission schemes |
| M11 | No project access level (Open / Limited / Private) |
| M12 | No work-item-level security |

**Work items**

| # | Gap |
|---|---|
| M13 | **Work types are a fixed enum** (`epic/story/task/bug/subtask`). No "Design", "Spike", "Chore", "Incident". **You explicitly asked for design tickets.** No icons, no per-project type scheme, no configurable hierarchy |
| M14 | **No Resolution field.** "Done" carries no reason. Blocks Created-vs-Resolved reporting and the agent's "close with a reason" story |
| M15 | **No workflow transitions.** Any status → any status, always. No conditions, validators or post-functions |
| M16 | **Priority is a fixed 3-value integer enum.** Jira ships 5 and makes them configurable |
| M17 | **No Reporter field.** `created_by` exists but is immutable and not the same concept |
| M18 | **Links are untyped and symmetric.** One relationship: "relates to". No blocks/duplicates/clones, no direction |
| M19 | **No watchers, no votes, no @mentions** |
| M20 | **No change history / activity log.** Nothing records who changed what, when. This is load-bearing for the agent API, notifications and every report |
| M21 | **No estimation.** No story points, no original/remaining estimate → no velocity, no burndown |
| M22 | **No time tracking and no timer.** No worklog model at all. **You explicitly asked for hours and a timer** |
| M23 | **No checklists.** **You explicitly asked for these on story tickets** |
| M24 | No start date (only `due_date`) → no timeline view possible |
| M25 | No Fix Version / Affects Version split — `release` is a single FK |
| M26 | **Work items cannot move between boards or projects, and `item_type` is immutable.** Both are deliberate today; both are standard Jira operations |
| M27 | No work item archive, no trash, no restore. Delete is permanent |
| M28 | No rich text anywhere — description and comments are plain `TextField` |
| M29 | No comment editing (create and delete only) |

**Files**

| # | Gap |
|---|---|
| M30 | **No project-level file management.** Attachments hang off work items only. **You asked for project-level files, epic/story-level files, and per-environment `.env` storage** — see §9 D2, this one needs a security decision before it is designed |
| M31 | **No link attachments** (attach a URL — Figma, Confluence, PR — rather than a file) |
| M32 | No file versioning, no preview, no thumbnails |

**Views**

| # | Gap |
|---|---|
| M33 | Board only. No **list**, **calendar**, **timeline/roadmap**, or summary view |
| M34 | No swimlanes, no quick filters, no WIP limits, no card layout config |
| M35 | Board columns are hard-mapped 1:1 to statuses; no column→multi-status mapping |
| M36 | No board-level filter |

**Search and reporting**

| # | Gap |
|---|---|
| M37 | No query language, no filter builder beyond 8 fixed facets |
| M38 | No saved filters, no sharing, no subscriptions |
| M39 | **No reports at all.** Spec-only (sub-project 13) |
| M40 | No dashboards, no gadgets |
| M41 | Search is capped at 50 results with **no pagination** |

**Automation, notification, integration**

| # | Gap |
|---|---|
| M42 | **No notifications of any kind** — no email, no in-app, no digest. Spec-only (sub-project 12) |
| M43 | Automation has 2 triggers and 4 actions, single action, no chaining, no scheduling, and **does not fire on bulk operations** |
| M44 | **No API tokens.** Session-cookie auth only — **this is the blocker for your agent API requirement**, see §5 |
| M45 | No webhooks, no outbound integration |
| M46 | No export (import exists) |
| M47 | No audit log |

**Platform**

| # | Gap |
|---|---|
| M48 | **Not responsive.** Fixed-width columns, no breakpoints, unusable below ~1100px |
| M49 | **No PWA.** No manifest, no service worker, no offline shell, no install prompt. **You asked for this** |
| M50 | No keyboard shortcuts, no command palette |
| M51 | No dark/light toggle (dark only, hardcoded) |

### 3.3 Misconfigured — built, but wrong or divergent

These are the ones that will cause real bugs or contradict what you asked for.

| # | Issue | Why it matters |
|---|---|---|
| X1 | **Assignee is not validated against project membership** (`docs/follow-ups.md`, deliberate). `GET /api/users/` returns **every active user, unscoped by project** | Directly contradicts *"everyone in the app can't have access to all projects."* A work item can be assigned to someone who cannot see it. Also leaks the full staff list to anyone signed in |
| X2 | **Project archiving is visibility-only.** An archived project stays fully writable | The word "archive" promises a write-block and does not deliver one |
| X3 | **Custom fields and screens are readable by any authenticated user**, including someone in zero projects | Same isolation leak. Any user can enumerate every field and screen name in the system |
| X4 | **Labels are global**, and rename/recolor/delete is gated to "Owner of *some* project" — not necessarily a project connected to the label | An Owner of Project A can rename a label Project B depends on. Blast radius is site-wide |
| X5 | **Exactly one Owner per project, and the Owner cannot leave without transferring** | Jira allows multiple Administrators. A single point of failure when someone leaves the company |
| X6 | **Permission logic is duplicated in three places** — the spec, `projects/permissions.py`, and `design/js/logic.js` — kept in sync by discipline alone | Guaranteed to drift. §4 replaces this with one server-side source and a client that reads it |
| X7 | **Login is not CSRF-protected and has no throttling** | Brute-forceable. Now urgent: the app is going to production and is about to grow a token API |
| X8 | **The original `admin` superuser has never been rotated** | Known credential in a production-bound system |
| X9 | **Automation does not fire on bulk operations** | Bulk-moving 50 items silently skips every rule. Surprising and undocumented in the UI |
| X10 | **Several endpoints are unpaginated** — labels, users, fields, screens, boards | Fine at 20 users, a problem at 500 |
| X11 | **`WorkItemStatus`/`FieldOption`/`ScreenField` PATCH saves before validating `position`** | A rejected request can still commit half its changes. Three call sites, same bug |
| X12 | **No lookup by key.** Everything is addressed by numeric pk; `TASKY-123` is only reachable through search | Humans and agents both speak in keys. Blocks §5 |
| X13 | Comments cannot be edited; attachments have no `own vs all` delete split beyond uploader/admin | Divergence from Jira's permission model |
| X14 | Deleting a release or a label has **no in-use guard**, while deleting a status or field does | Inconsistent destructive-action policy |

---

## 4. Role management — rebuilt on Jira's model

You asked for Jira's role model, not the one built here. This is the single highest-leverage
change in the plan, and it must land **early**: every feature after it attaches permissions,
so doing it late means reworking all of them.

### 4.1 Target model

**Three layers, matching Jira:**

**Layer 1 — Global permissions** (replaces the single `is_staff` flag)

| Permission | Grants |
|---|---|
| `administer_site` | Everything. Site configuration, work types, global schemes |
| `manage_users` | Create, deactivate, edit accounts; send invitations |
| `browse_users` | See the full user directory in pickers and @mentions. **Without it, you only see users who share a project with you** — this is the fix for X1 |
| `create_projects` | Create new projects |
| `make_bulk_changes` | Use bulk operations |
| `share_filters_dashboards` | Share saved filters and dashboards |

**Layer 2 — Project roles** (replaces `owner/admin/member`)

Default set, matching Jira team-managed projects:

| Role | Intent |
|---|---|
| **Administrator** | Configure the project: statuses, components, releases, automation, screens, members. Multiple allowed — fixes X5 |
| **Member** | Create, edit, transition, comment, log work, attach |
| **Viewer** | Read and comment only. **New — this is what the current model has no answer for** |

Custom roles are creatable per project (Jira allows this; e.g. `Lead Developer`, `QA`, `Release Manager`).

**Layer 3 — Permission scheme** — a role→permission matrix, per project, seeded from a default scheme.

### 4.2 The permission set to implement

Adopt Jira's list, dropping only what Tasky has no concept of (dev tools, issue security).
Critically, **implement the own/all split** — Tasky has none of it today:

`administer_project` · `browse_project` · `manage_layouts` · `edit_workflows` ·
`manage_releases` · `manage_sprints` · `create_work_items` · `edit_work_items` ·
`delete_work_items` · `assign_work_items` · `assignable_user` · `transition_work_items` ·
`resolve_work_items` · `close_work_items` · `link_work_items` · `move_work_items` ·
`modify_reporter` · `schedule_work_items` · `archive_work_items` · `restore_work_items` ·
`add_comments` · `edit_own_comments` · `edit_all_comments` · `delete_own_comments` ·
`delete_all_comments` · `create_attachments` · `delete_own_attachments` ·
`delete_all_attachments` · `manage_watchers` · `view_watchers` · `work_on_work_items` ·
`edit_own_worklogs` · `edit_all_worklogs` · `delete_own_worklogs` · `delete_all_worklogs`

### 4.3 Killing the three-places problem (X6)

Today the matrix lives in the spec, `projects/permissions.py`, and `design/js/logic.js`,
kept in lockstep by hand. Replace with:

- **One source of truth**: the `Permission` / `RolePermission` tables plus a single
  `has_permission(user, project, perm)` resolver in `projects/permissions.py`.
- **The client stops deciding.** Add `GET /api/projects/{id}/my-permissions/` returning the
  caller's resolved permission set. The UI enables and disables controls from that response
  instead of re-implementing the rules. `logic.js` keeps *display* logic only.
- Server-side enforcement is unchanged in principle — every endpoint still checks — but
  against the resolver rather than a bespoke predicate.

### 4.4 Migration

Fully mechanical, no data loss:

| Today | Becomes |
|---|---|
| `is_staff = true` | `administer_site` + `manage_users` + `browse_users` |
| `role = owner` | `Administrator` **and** flagged `is_project_lead` (preserves "exactly one lead" for display; drops the single-point-of-failure) |
| `role = admin` | `Administrator` |
| `role = member` | `Member` |
| — | `Viewer` exists but starts empty |

Seed every existing project with the default scheme so behaviour is unchanged on day one.

---

## 5. The agent API — machine access for internal projects

> *"we need the api accessible for all our internal projects, once the project is done, the
> ai can hit the api to update the specific task based on the tasky id with proper comments
> and details required to close the task or move the task to next step."*

**Today this is impossible.** The API is session-cookie + CSRF only (`docs/api.md`: *"Session-cookie
auth, same origin"*), and nothing is addressable by `TASKY-123` (X12). This is a self-contained
feature and should ship as one piece.

### 5.1 What to build

**Authentication — API tokens**

- New `ApiToken` model: owner (a real user or a dedicated **bot account**), name, hashed
  secret, scopes, `expires_at`, `last_used_at`, `created_at`, revoked flag.
- Show the plaintext token exactly once, on creation. Store only a hash.
- Custom DRF authentication class accepting `Authorization: Bearer tasky_pat_…`.
- **Token auth is CSRF-exempt by construction** (no cookie, no ambient authority) —
  and must be explicitly excluded from `SessionAuthentication`'s CSRF path so the two
  schemes do not interfere.
- Scopes, minimally: `work_items:read`, `work_items:write`, `comments:write`,
  `worklogs:write`, `transitions:write`. A token can never exceed its owner's own
  permissions — scopes narrow, never widen.
- Tokens are issued per project or site-wide; a project-scoped token cannot touch
  another project even if its owner is a member there.

**Addressing — by key, not by pk**

```
GET    /api/work-items/by-key/{KEY}/            → the item, fully expanded
PATCH  /api/work-items/by-key/{KEY}/            → same rules as the pk route
POST   /api/work-items/by-key/{KEY}/transition/ → move to the next status
POST   /api/work-items/by-key/{KEY}/comments/
POST   /api/work-items/by-key/{KEY}/worklog/
```

Keys are already unique system-wide (`WorkItem.key`), so no project prefix is needed in the path.

**The transition endpoint — the core of the request**

```jsonc
POST /api/work-items/by-key/TASKY-42/transition/
{
  "status": "Done",              // by name or id; validated against the project's statuses
  "resolution": "Fixed",         // requires M14 (Resolution), see §6 wave 2
  "comment": "Shipped in v2.4.0. All 554 tests green; deployed 2026-09-08.",
  "time_spent": "3h 20m",        // optional, creates a worklog — requires M22
  "fields": { "assignee": null } // optional field updates applied in the same transaction
}
```

One request, one transaction, one audit entry. Returns the updated item plus the
transition that was applied.

**Discovery — so the agent does not have to guess**

```
GET /api/work-items/by-key/{KEY}/transitions/   → the statuses this item may move to now
GET /api/projects/{key}/meta/                   → statuses, types, priorities, resolutions,
                                                  components, releases, members
```

This is what makes the agent reliable: it asks what is legal, then does it.

**Accountability**

- Every token-authenticated write records `via_token` on the change-history entry (M20).
- Comments made by a bot render as **"Claude Code · via @venkatesh"**, never as a
  human's own words.
- `last_used_at` on every token; a Site Admin page listing all tokens with revoke.
- Rate limiting per token (see §8 W0.6).

### 5.2 Why it needs M20 and M14 first

The transition endpoint's value is *"close the task with the reason and the detail"*. Without
a **Resolution** (M14) there is no reason, and without **change history** (M20) there is no
record of what the agent did. Both are prerequisites, and both are cheap.

### 5.3 Beyond the immediate ask (same wave, cheap once tokens exist)

- **Webhooks out** — Tasky notifies your CI when an item transitions, closing the loop.
- **Smart-commit style parsing** — `TASKY-42 #close #time 2h` in a commit message.
- A thin **MCP server** wrapping the token API, so agents get typed tools rather than raw HTTP.

---

## 6. The delivery plan

**Rule you set, applied throughout: no feature is split across waves.** When a wave touches
a feature it ships that feature end to end — model, migration, service, API, permissions,
UI, tests, and `docs/api.md`.

Sizes are engineer-days for one developer working with AI assistance: **S** ≤ 2, **M** 3–5,
**L** 6–10, **XL** 11–20.

### Wave 0 — Foundations (nothing else should start first)

Everything here is cross-cutting. Built later, each one forces rework of every feature
already shipped.

| # | Feature | Closes | Size | Gate |
|---|---|---|---|---|
| **W0.1** | **Design system + app shell + PWA** — new visual language, responsive layout, navigation, manifest, service worker, install. See §7 and §8 | M48, M49, M50, M51 | **XL** | `GATE` |
| **W0.2** | **Jira role & permission model** — the whole of §4, including `my-permissions`, migration, and removing the three-places duplication | M7–M12, X6, X5 | **XL** | `GATE` |
| **W0.3** | **Identity & profile** — self-service profile (name, email, avatar, password change), Site Admin user console UI, project-scoped user picker | M1, M3, U1, **X1**, X3 | **L** | `GATE` (profile) / `WIRE` (admin console) |
| **W0.4** | **Change history / activity log** — every field change recorded, rendered as an activity tab | M20, M47 | **L** | `GATE` |
| **W0.5** | **Agent API** — the whole of §5: tokens, by-key routes, transition, discovery, token admin UI | M44, X12 | **L** | `GATE` |
| **W0.6** | **Security hardening** — login CSRF + throttling, per-token rate limits, rotate the `admin` superuser, pagination everywhere, fix the save-before-validate bug | X7, X8, X10, X11 | **M** | not gated (defect fixes) |

W0.5 depends on W0.4 and on **M14 Resolution**, which is pulled forward into W0.5 as part of
that feature rather than split across waves.

> **Sequencing note.** W0.1 and W0.2 can run in parallel — one is presentation, one is
> policy — but both must complete before Wave 1 starts, or Wave 1's twelve screens get
> built twice.

### Wave 1 — Close the UI gap (`WIRE` — already signed off, not gated)

Ten sub-projects of tested backend become reachable. Low risk, very high visible return —
this is where the app stops feeling half-built. Each item is one screen or section, built
inside the W0.1 shell and gated by W0.2 permissions.

| # | Feature | Size |
|---|---|---|
| W1.1 | Status / workflow management UI (U2) | S |
| W1.2 | Labels administration UI (U3) | S |
| W1.3 | Project archive + **make it a real write-block** (U12, **X2**) | S |
| W1.4 | Attachments on work items (U8) | M |
| W1.5 | Releases (U7) | M |
| W1.6 | Cross-project search + pagination (U5, M41) | M |
| W1.7 | Bulk operations + CSV import + **export** (U9, M46) | M |
| W1.8 | Backlog + sprints (U6) | L |
| W1.9 | Custom fields + screens + assignments (U4, fixing X3 scoping) | L |
| W1.10 | Automation rules UI + **fire on bulk ops** (U10, **X9**) | M |
| W1.11 | Project templates in the create flow (U11) | S |

### Wave 2 — Jira core parity (`GATE` — each needs a prototype and sign-off)

The features that make it a Jira clone rather than a Kanban board.

| # | Feature | Closes | Size | Why here |
|---|---|---|---|---|
| W2.1 | **Configurable work types + hierarchy** — types with icons, per-project type schemes, custom hierarchy levels. **Delivers your "design tickets" ask** | M13 | **XL** | Everything below tags a type; do it before them |
| W2.2 | **Workflow transitions** — allowed moves, conditions, validators, post-functions, transition screens | M15 | **XL** | Depends on W2.1's type→workflow mapping |
| W2.3 | **Priority schemes** — 5 configurable levels | M16 | M | Independent, small |
| W2.4 | **Reporter field** + `modify_reporter` permission | M17 | S | |
| W2.5 | **Typed directional links** — blocks / duplicates / clones / relates, with link-type admin | M18 | M | Migrate existing symmetric links to `relates` |
| W2.6 | **Estimation** — story points, original and remaining estimate | M21 | M | Prerequisite for burndown and velocity in W3 |
| W2.7 | **Time tracking + timer** — worklog model, log-work dialog, **live start/stop timer**, time-tracking permissions, time-spent rollup. **Your explicit ask** | M22 | **L** | Depends on W0.2's own/all worklog permissions |
| W2.8 | **Checklists** — ordered items with done state, progress on the card, templates per work type. **Your explicit ask** | M23 | M | |
| W2.9 | **Watchers, votes and @mentions** | M19 | M | Feeds W3.1 notifications |
| W2.10 | **Start date + due date + calendar view** | M24, M33 (partial) | M | Prerequisite for the timeline in W3.5 |
| W2.11 | **Move between projects/boards + change work type** | M26 | M | Needs W2.1 and W2.2 to know what is legal |
| W2.12 | **Archive / trash / restore for work items** | M27 | M | |
| W2.13 | **Rich text** description and comments + **comment editing** | M28, M29, X13 | M | |
| W2.14 | **Fix Version / Affects Version** split | M25 | S | |

### Wave 3 — Collaboration, files and insight (`GATE`)

| # | Feature | Closes | Size | Note |
|---|---|---|---|---|
| W3.1 | **Notifications** — in-app first, then email; notification schemes per role and event; per-user preferences | M42 | **XL** | Sub-project 12's spec exists. **Email needs decision D1 (§9)** |
| W3.2 | **Email invitations for people without accounts** — invite by email, signup-by-invite-token, join the project on accept. **Your explicit ask.** Public signup stays disabled | M2 | **L** | Depends on W3.1's email transport |
| W3.3 | **Project file management** — project-level files, epic/story-level files, folders, **link attachments**, versioning, preview. **Your explicit ask.** Environment-config storage is carved out under **decision D2 (§9)** | M30, M31, M32 | **L** | |
| W3.4 | **Reports** — burndown, burnup, velocity, sprint report, CFD, cycle time, created-vs-resolved, time tracking | M39 | **XL** | Sub-project 13's spec exists. Needs W0.4 history, W2.6 estimation, W2.7 worklogs |
| W3.5 | **Timeline / roadmap** with dependencies | M33 | **L** | Needs W2.10 dates and W2.5 links |
| W3.6 | **List view + board configuration** — swimlanes, quick filters, WIP limits, card layout, column→multi-status mapping | M33, M34, M35, M36 | **L** | |
| W3.7 | **Advanced search + saved filters + subscriptions** | M37, M38 | **L** | Subscriptions need W3.1 |
| W3.8 | **Dashboards + gadgets** | M40 | **L** | Needs W3.4 and W3.7 |
| W3.9 | **Automation v2** — more triggers, conditions, branching, multi-action, scheduled rules | M43 | **L** | |

### Wave 4 — Platform and integration

| # | Feature | Closes | Size |
|---|---|---|---|
| W4.1 | Webhooks out + GitHub/GitLab integration + smart commits | M45 | L |
| W4.2 | Groups, project access levels (Open/Limited/Private), work-item security | M4, M11, M12 | L |
| W4.3 | Timezone and locale | M5 | M |
| W4.4 | Accessibility audit and fixes (WCAG AA) | — | M |
| W4.5 | Performance — N+1 sweep, indexes, query budgets on list endpoints | — | M |

### 6.1 Suggested order at a glance

```
W0.1 shell+PWA ─┬─────────────────────────► Wave 1 (11 screens, WIRE)
W0.2 roles ─────┤                                    │
W0.3 identity ──┤                                    ▼
W0.4 history ───┴─► W0.5 agent API             Wave 2 (parity, GATE)
W0.6 security ─────────────────────────►               │
                                                       ▼
                                                 Wave 3 (insight, GATE)
                                                       │
                                                       ▼
                                                    Wave 4
```

Rough totals: Wave 0 ≈ 55–70 days · Wave 1 ≈ 35–45 · Wave 2 ≈ 85–110 · Wave 3 ≈ 90–120 ·
Wave 4 ≈ 30–40. Call it **300–385 engineer-days** for full parity. If that is more than the
budget, the honest cut is: **Wave 0 + Wave 1 + W2.1/W2.7/W2.8 + W3.3** — that alone delivers
everything you named explicitly, in roughly 130–160 days.

---

## 7. UI redesign

You said the current UI is "not that catchy and looking very bad." Having run the prototype
at 1440×900, that is a fair read, and the reasons are specific rather than a matter of taste.

### 7.1 What is actually wrong

**Layout**

1. **Roughly 60% of the viewport is empty.** Board columns are fixed-width and left-aligned;
   at 1440px, three columns end at ~1420px horizontally but stop at ~540px vertically with
   nothing below. The page does not use the space it takes.
2. **No sidebar.** Everything hangs off a single top nav — Projects, Fields, Screens, Labels,
   Search, Admin — which mixes project context with site administration at the same level.
   Jira's project sidebar exists because a project has ten destinations, not one.
3. **No breadcrumb, and the project name is not shown on its own board.** The header reads
   `PROJECT` / `Sprint Board` — the project's name is missing entirely.
4. **"Projects" stays highlighted** in the nav while you are deep inside a board.

**Information design**

5. **All-caps micro-labels everywhere** (`ALL PROJECTS`, `BOARDS`, `COMPONENTS`, `STATUSES`,
   `FIELD SCREENS`, `RELEASES`, `AUTOMATION`, `MEMBERS`) as the primary structural device.
   Eight identical grey labels down one page create no hierarchy at all.
6. **Explanatory prose is the dominant text on the project page.** Every section leads with a
   two-line paragraph of documentation. That is a manual, not an interface. It should be a
   tooltip or a help affordance, not the first thing in every section.
7. **The project page is one undifferentiated column** of eight sections with no cards, no
   panels, no grouping, and no visual weight difference between "Members" and "Automation".

**Components**

8. **Inconsistent controls in one row**: `Backlog` is an underlined text link, `Select` and
   `Import` are outlined buttons — three visual treatments for three peer actions.
9. **A type legend** (Epic · Story · Task · Bug · Subtask dots) sits permanently in the board
   header, spending prime space on a key nobody re-reads after week one.
10. **No avatars anywhere.** Assignee is a plain grey name in the card's bottom-right.
11. **No icons anywhere.** Work types are text badges; nav items are bare words.
12. **Priority is invisible on the card.** The "left edge rule" (1px/2px/4px) is a genuinely
    good idea, but at these values it is imperceptible against a `#232226` border.
13. **Empty states are bare** — the Done column shows a count of `0` and a dashed
    "+ Add work item", nothing else.

**The brand rule contradicts itself**

14. `brand-guidelines.md` states *"black is the given; red is the one accent allowed to mean
    something"* — and then labels render as **pink** and **green** chips from an 8-colour
    hashed palette. Two saturated non-red colours sit on the highest-traffic screen. Either
    the thesis or the label palette has to give.

### 7.2 What to keep

The system is not without merit and a rewrite should not throw these away:

- **The colour thesis.** "Only In Progress is saturated" is a real idea and it works — the
  eye does land on the active column first.
- **Monospace for keys, dates and counts.** Correct for this audience.
- **The left edge rule** as a concept. Increase the values (2/4/6px) and let it carry.
- **The 3px radius.** A deliberate, consistent choice.
- **Dark-first.** Right for an internal engineering tool.

### 7.3 The redesign

**Structure**

- **Three-zone shell**: a slim global rail (product switcher, search, create, notifications,
  avatar) · a **contextual project sidebar** (Board, Backlog, Timeline, Calendar, List,
  Releases, Reports, Files, Settings) · the content area.
- **Breadcrumb** on every screen: `Project ▸ Board ▸ TASKY-42`.
- **Full-height, flexible board columns** that fill the viewport and scroll independently,
  with a horizontal scroller once there are more than five.

**Density and hierarchy**

- Replace the eight all-caps labels with **cards and a settings sub-navigation**. Project
  configuration belongs on a `Project settings` page with its own left nav (Details, Access,
  Statuses, Work types, Fields, Components, Releases, Automation, Files) — not stacked on the
  project landing page.
- The project landing page becomes a **summary**: sprint progress, my items, recent activity,
  release burndown, quick links. Real content, not a table of contents.
- Move every explanatory paragraph into an `(i)` popover.

**Components**

- Build a real component library: `Button` (primary/secondary/ghost/danger, one visual per
  tier), `Card`, `Panel`, `Field`, `Select`, `Avatar`, `AvatarStack`, `Badge`, `Chip`,
  `Menu`, `Modal`, `Drawer`, `Tabs`, `Table`, `Toast`, `EmptyState`, `Skeleton`.
- **Avatars everywhere** — generated initials on a deterministic tint, real images once M3 lands.
- **Icons for work types** (a small inline SVG set, no icon-font dependency, no CDN).
- Resolve the palette contradiction: give labels a **desaturated, tinted** chip family that
  reads as neutral at a glance, and keep full saturation exclusively for red.

**Work item detail**

- Promote from a modal to a **full-page route** (`#/browse/TASKY-42`) with a modal *option*
  from the board. It must hold description, checklist, subtasks, links, attachments,
  worklog, activity, comments, watchers and custom fields — a modal cannot.
- Two-column: content left, field rail right, activity tabbed at the bottom.

**Interaction**

- Global command palette (`Cmd+K`): jump to a key, search, create, switch project.
- Keyboard shortcuts on the board: `c` create, `a` assign to me, `i` assign, `.` actions.
- Optimistic updates with an explicit failure rollback (the existing drag behaviour is
  already right — extend the pattern).

**Responsive** — even though this is desktop-first:

| Breakpoint | Behaviour |
|---|---|
| ≥1280px | Full three-zone shell |
| 1024–1280px | Project sidebar collapses to icons |
| 768–1024px | Sidebar becomes a drawer; board scrolls horizontally |
| <768px | Single column; board becomes a status-tabbed list; detail is full-screen |

**Process** — this is `GATE` work. Build it in `design/` first as W0.1's Phase 1, get sign-off,
then implement. Consider running `/design-consultation` and `/design-shotgun` to generate
directions before committing to one.

**Constraint that does not move:** no build step, no npm, no framework
(`CLAUDE.md`). Everything above is achievable in vanilla JS and CSS — the current
`app.js` is 1,464 lines and `design/js/app.js` is 3,207, both without a bundler. Expect the
production `app.js` to need splitting into ES modules (native `import`, no bundler) as it grows.

---

## 8. PWA

You want it installable even though the app is not mobile-first. Deliver it as part of W0.1
so the shell is built PWA-aware rather than retrofitted.

| Piece | Detail |
|---|---|
| **Manifest** | `ui/static/manifest.webmanifest` — name, short name, `#0D0D0F` theme and background, `display: standalone`, `start_url: /`, `scope: /`. Icons at 192/256/384/512 plus a maskable variant. The existing Tailwebs favicons are 150/300px — **new icon sizes must be cut** |
| **Service worker** | `ui/sw.js`, served from the root so its scope covers the app (Django route above the SPA catch-all, same as `robots.txt` and `favicon.ico`) |
| **Caching** | App shell (`index.html`, CSS, JS, icons) **cache-first with a versioned cache name**; `/api/**` **network-only** by default. Never cache an authenticated API response into a shared cache |
| **Offline** | An offline fallback page. Optionally cache the last `GET /api/me/tasks/` for read-only offline viewing — **explicitly opt-in, and cleared on sign-out** |
| **Updates** | Version the cache on deploy; show an in-app "A new version is available — reload" toast rather than silently swapping |
| **Install** | Capture `beforeinstallprompt`, offer install from the profile menu. iOS Safari has no prompt — add a short "Add to Home Screen" hint |
| **Sign-out** | Must `caches.delete()` every app cache and unregister nothing else. A shared machine must not leak the previous user's cached shell state |

**Security notes, both load-bearing:**

- The service worker must **never** cache a response carrying a session cookie or a
  `Bearer` token. `/api/**` is network-only, no exceptions.
- `ui/robots.txt` and the crawler middleware shipped on `feat/block-crawlers` already tell
  bots to stay out. A `manifest.webmanifest` is a new crawlable surface — confirm the
  middleware covers it, or the manifest advertises an internal tool to anything that asks.

**Not doing (and why):** background sync and push notifications. Push requires a push service
and a server-side subscription store, which is the queue/worker decision (D1) this repo has
deliberately avoided. Revisit alongside W3.1.

---

## 9. Decisions I need from you

These change the shape of the work and I should not pick them alone.

**D1 — Email and background work.** `CLAUDE.md` states: *"No background jobs, no queue, no
cron, no email, no push. Adding any of these is an architecture decision."* But you asked for
**invitations to people without accounts** (M2), which needs email; and notifications (W3.1)
and report subscriptions (W3.7) do too. Options:

- **(a)** SMTP sent inline in the request. Simplest, no new infrastructure, but a slow mail
  server makes a user-facing request hang. Workable for invitations only.
- **(b)** Add a queue (Celery/RQ + Redis). Correct, and unblocks scheduled automation
  (W3.9), digests and report subscriptions — but it is a real infrastructure addition to a
  deliberately simple stack.
- **(c)** No email. Invitations become a **shareable signup link** an admin copies and sends
  themselves. Zero infrastructure; meets the letter of your ask ("send an invite") without a
  mail server.

*My recommendation:* **(c) for Wave 0–2, (b) when Wave 3 starts.** Link-based invites solve
your immediate ask with no new moving parts, and by Wave 3 you need a queue for three separate
features anyway — so buy it once, deliberately, rather than sliding into it.

**D2 — Storing `.env` files.** You asked for *"project level file management, including the
.env of each environment."* Storing production secrets in a Django app with attachments on
local disk, unencrypted, reachable by every project member, is a materially different risk
from storing a design PDF. Options:

- **(a)** Plain files in the existing attachment store. **I would not do this.**
- **(b)** A separate `EnvironmentConfig` model — encrypted at rest (Fernet, key from the
  environment, never in the database), gated behind a dedicated `manage_secrets` permission
  (Administrator-only by default), values masked in the UI until explicitly revealed,
  every read and reveal written to the audit log, and excluded from search, export and
  the agent API.
- **(c)** Store only *references* — a name and a pointer to AWS Secrets Manager / 1Password —
  never the value itself.

*My recommendation:* **(c) if you already have a secret store, otherwise (b).** Either way,
this is its own feature with its own threat model, and it should not be quietly folded into
"project files". W3.3 above splits it out on that basis.

**D3 — How faithful a clone?** Jira's company-managed model (shared permission schemes,
workflow schemes, screen schemes, field configuration schemes across projects) is a large
amount of machinery that pays off at 200 projects and costs a lot at 10. §4 plans the
**team-managed** model — per-project roles and permissions, no cross-project schemes. Tell
me if you want the full company-managed layer; it roughly doubles W0.2.

**D4 — Rich text.** W2.13 needs an editor. No npm and no build step means either a
`contenteditable` implementation written here, or Markdown with a small vendored renderer.
Markdown is the smaller, more durable choice and fits an engineering audience — confirm.

**D5 — Wave 1 vs Wave 2 first.** Wave 1 is low-risk and makes the app feel finished fast, but
builds eleven screens against the *current* work-type and workflow model, which Wave 2 then
changes. Doing W2.1 and W2.2 before Wave 1 avoids some rework at the cost of a slower visible
start. *My recommendation: Wave 1 first* — the rework is mostly in the create/edit forms, and
shipping visible progress against a ten-sub-project backlog is worth more than avoiding it.

---

## 10. What I would do first, concretely

If you want to start Monday:

1. **Decide D1, D2, D3, D5** — everything downstream branches on them.
2. **W0.6 security hardening** — not gated, it is defect work, and it is a few days.
   The login endpoint is brute-forceable and the `admin` superuser is unrotated on a
   production-bound system. Do it before anything else ships.
3. **Start W0.1 Phase 1** — the design prototype for the new shell, in `design/`, for
   sign-off. This is the long pole and it blocks all of Wave 1.
4. **In parallel, W0.2 Phase 1** — the permission model design. It is mostly a data model
   and a matrix; it can be specced while the visual work is in flight.
5. **W0.5 agent API** can start as soon as W0.4 lands. It is self-contained, it is the thing
   you will use every day, and it does not wait on the UI.
