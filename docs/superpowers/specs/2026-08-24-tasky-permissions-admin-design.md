# Tasky — Permissions & Admin (Sub-project 9 of 13)

**Status:** Fast-drafted 2026-08-24 by solo authorship (per user's explicit request to speed up
the remaining roadmap) — awaiting user review and sign-off. No `design/` prototype built yet; per
this repo's hard rule, prototype work begins only after this spec is reviewed and approved.

## Context

This is sub-project 9 in Tasky's expansion from a single-board Kanban tool toward a broader,
Jira-inspired feature set. The full roadmap (13 sub-projects, redrawn 2026-08-14) is:

1. Projects & Membership — shipped
2a. Work Item Hierarchy — shipped (backend + UI)
2b. Custom Fields & Screens — shipped (backend + `design/` prototype)
2c. Bulk Operations & Import — fast-drafted, pending review
3. Workflows — shipped
4. Labels — shipped
5. Search — fast-drafted, pending review
6. Backlog & Sprints — fast-drafted, pending review
7. Releases — fast-drafted, pending review
8. Task Detail UX — fast-drafted, pending review
9. **Permissions & Admin — this document**
10. Project Types & Setup — fast-drafted, pending review
11. Automation — fast-drafted, pending review
12. Notifications — fast-drafted, pending review
13. Reporting & Dashboards — fast-drafted, pending review

Every role and governance concept this sub-project touches already exists in some form —
`Projects & Membership` (sub-project 1) established per-project `owner`/`admin`/`member` roles and
invite-only membership; `Custom Fields & Screens`, `Workflows`, and `Labels` (2b, 3, 4) each layered
a global resource on top and gated its management the same way: `user_can_manage_definitions`,
which today means "is `owner` of at least one project, any project, however small." This document
does not reinvent that pattern.

What this sub-project actually investigated was narrower: given everything already shipped, what's
*genuinely missing* under a "Permissions & Admin" heading? The answer turned out to be smaller than
the title suggests. There is exactly one real, concrete gap — **no API exists for a legitimate site
administrator to create or deactivate a user account**; today that only happens via Django's
built-in `/admin/` or the dev-only `seed_demo` management command, even though the login screen's
own copy ("Accounts are created by an admin") implies a real admin-facing flow should exist. Beyond
that, this document is mostly *judgment calls about whether to add scope*, and it deliberately
declines most of it. See Judgment calls, below, and Out of scope, at the end.

## Judgment calls flagged for review

These are the calls most likely to need the user's input rather than mine. Nothing below was
silently resolved — each is implemented one specific way in this draft, but flagged so it can be
overridden on review.

- **Global-resource governance is widened, not narrowed.** `user_can_manage_definitions` (used by
  Labels, Custom Fields, Screens, and Workflows) today means "Owner of any project" — so a user who
  owns one tiny personal project can rename or delete any Label/Custom Field/Screen site-wide. This
  draft does **not** fix that; it adds a genuine site-admin tier *alongside* it (see Data model,
  below), so the existing behavior is preserved and a stricter tier is layered on top. Narrowing the
  existing check — i.e., requiring site-admin status for these actions and revoking that power from
  ordinary project Owners — is a materially bigger, more disruptive change (it would strip a
  capability every existing project Owner currently has) and is left as an explicit open question
  for the user rather than decided here either way.
- **Site Admin reuses Django's built-in `is_staff` flag** rather than adding a new,
  purpose-built field. `is_staff` already exists on every `User` row (via `AbstractUser`) and
  already gates `/admin/` login; this draft treats "can log into Django admin" and "is a Tasky site
  admin" as the same tier. That's the minimal-footprint choice, but it does mean granting someone
  Django-admin database access and granting them Tasky's site-admin API access become the same
  action — some may want those decoupled.
- **Admin-created accounts get their initial password set directly by the admin**, typed into the
  create-user form and communicated out of band (Slack, in person, whatever). There's no email
  system in this codebase yet (the `Invitation` model's own comments say as much), so there's no
  "invite link" or "set your own password" flow to build this on top of. This mirrors how
  `seed_demo` already works, just per-account instead of a shared demo password. Worth revisiting
  once/if email exists.
- **Deactivating an account does not touch that user's project memberships or ownership.** A
  deactivated Owner remains the Owner of record on every project they owned — deactivation only
  blocks login. Nothing here forces an ownership handoff first, unlike voluntarily *leaving* a
  project (which already blocks an Owner until they transfer). An admin deactivating someone
  expecting a clean handoff will not get one automatically.
- **Project archiving is visibility-only, not a write-block.** An archived project disappears from
  the default "My Projects" list but stays exactly as editable as before for its existing members —
  this draft does not make archived projects read-only. Full enforcement would mean touching the
  write path of every already-shipped feature that writes to a project (boards, work items,
  comments, statuses, screen assignments, invitations...), which is disproportionate scope for what
  was asked. If "archived should mean frozen," that's a real, larger follow-up.
- **No read-only/guest role is added.** Covered under Scope decisions below — flagged here too
  because "Permissions & Admin" as a title might imply this was expected.

## Scope decisions from brainstorming

This was fast-drafted solo, not live-brainstormed with the user — these are the author's own
judgment calls on how to scope the sub-project, made by reading `docs/api.md`, the shipped
Projects & Membership design, and the actual codebase (`accounts/`, `boards/admin.py`,
`projects/admin.py`) rather than assumed from the sub-project's name.

- **Site-wide user account management is the one piece of real net-new scope.** Confirmed by
  reading `accounts/views.py` and `accounts/urls.py`: today's `accounts` app only has
  login/logout/`me`/a read-only `users` list for the assignee dropdown. There is no `POST` anywhere
  that creates a `User`. The only two ways an account comes into existence are Django's `/admin/`
  (works, but is a full Django-admin surface, not a Tasky-native admin flow, and requires shell/DB
  access to reach) and `seed_demo` (explicitly local-dev-only, shared known password, documented as
  unsafe for anything else). The design prototype's login copy ("Accounts are created by an admin")
  already assumes a real flow exists — it doesn't yet. This is the concrete gap worth closing.
- **A genuine site-wide "Site Admin" tier is introduced, additively.** See Judgment calls above for
  the reasoning; mechanically, it reuses `User.is_staff`, gated behind a new `IsSiteAdmin`
  permission class (same shape as `projects/permissions.py`'s `IsProjectMember`), and is checked by
  the new admin-user-management endpoints. `user_can_manage_definitions` is extended to also accept
  `is_staff`, without removing the existing "Owner of any project" branch.
- **No read-only/guest role.** The existing `owner`/`admin`/`member` set was checked against every
  shipped sub-project's permission table (`docs/superpowers/specs/2026-08-13-tasky-projects-
  membership-design.md`, and Labels'/Workflows'/Custom Fields'/Screens' manage-tier checks) and
  nothing in the shipped feature set distinguishes "can view" from "can edit" within a project — a
  `member` today can already edit any work item, comment, and apply/invent labels. Adding a
  stakeholder-facing read-only tier would be genuinely new product surface (a new role, a new
  permission matrix column, and UI to hide every edit affordance) with no concrete request behind
  it yet. Deferred — revisit if a specific need shows up (e.g., an external stakeholder who
  shouldn't be a full `member`).
- **No audit trail for permission/role changes.** This overlaps with the "activity log" concept
  already flagged as deferred out of Task Detail UX (sub-project 8) — a general activity/audit log
  is the right home for "who changed X, when," across roles, statuses, custom fields, everything,
  not a bespoke log bolted onto just this sub-project. Deferred here for the same reason it was
  deferred there.
- **Project archiving is added, deliberately small.** Today `Project.delete()` is the only way to
  retire a project, and it's a real, cascading, irreversible delete (boards, work items, comments,
  memberships, invitations — all gone). That's a lot of blast radius for "we're done with this
  project" or "wrong key, let's redo it," and archiving is a small, well-understood, low-risk
  addition (one boolean, two endpoints, one list filter) — worth doing here rather than punting
  again. Kept intentionally minimal: visibility only, not read-only enforcement (see Judgment
  calls).
- **No bulk ownership transfer.** Not requested, and the existing single-project
  `transfer-ownership` endpoint (sub-project 1) already covers the real case ("I'm leaving project
  X, hand it off"). A "reassign everything this person owns" tool is a distinct, larger admin
  feature nobody has asked for yet.

## Data model

**`User`** (`accounts/models.py`) — no schema change. `is_staff` (inherited from
`AbstractUser`, currently unused for anything except Django-admin login) becomes Tasky's "Site
Admin" flag. `is_superuser` is untouched and keeps its existing Django meaning (full, ungated
Django-admin permissions) — this sub-project doesn't use it for anything.

The very first Site Admin still comes from Django's `createsuperuser` (or an existing
`is_staff=True` row) — this sub-project's API is for admins to manage further accounts *after*
that bootstrap, not to replace it. Documented, not modeled — there's nothing new to migrate.

**`Project`** (`projects/models.py`) gains:
- `is_archived` — boolean, default `False`.
- `archived_at` — nullable datetime, set when archived, cleared on unarchive.
- `archived_by` — nullable FK to `User`, `on_delete=SET_NULL` (matching `Invitation.invited_by`'s
  existing pattern — knowing who archived a project is nice-to-have, not load-bearing, so a deleted
  admin account shouldn't block anything).

No change to `Project.delete()` — hard delete still exists and still behaves exactly as it does
today; archiving is an additional, separate action, not a replacement.

## API surface

```
GET    /api/admin/users/              list every user, active and inactive (Site Admin only)
POST   /api/admin/users/              create a user account: {username, password, first_name?, last_name?} (Site Admin only)
GET    /api/admin/users/{id}/         detail, including is_active/is_staff/date_joined (Site Admin only)
PATCH  /api/admin/users/{id}/         {is_active?, is_staff?, first_name?, last_name?} — activate/deactivate, grant/revoke Site Admin (Site Admin only)
```

Deliberately no `DELETE` — matches the codebase's existing bias toward soft-disable
(`is_active`, already used everywhere `User` is filtered — `/api/users/`, invitation eligibility)
over hard delete for accounts specifically, since a hard `User` delete would cascade through
`ProjectMembership` (`on_delete=CASCADE`) and quietly strip someone out of every project's member
list as a side effect of what was meant to be "this person left the company." Deactivation avoids
that: the account can't log in, but every historical reference (who created this work item, who's
in this project) stays intact.

`PATCH` on your own account: allowed for `first_name`/`last_name`, but `is_active` and `is_staff`
changes to your **own** row are rejected (see Error handling) — the self-lockout guard.

```
POST   /api/projects/{id}/archive/    archive a project (Owner only)
POST   /api/projects/{id}/unarchive/  reverse it (Owner only)
GET    /api/projects/?include_archived=true   include archived projects in "my projects" (default excludes)
```

Both mirror `transfer-ownership`'s existing shape (`POST` on a project sub-route, Owner-only,
object-level `IsProjectMember` plus a role check) rather than introducing a new pattern.

**`user_can_manage_definitions`** (`boards/serializers.py`) changes from:

```python
def user_can_manage_definitions(user):
    return ProjectMembership.objects.filter(user=user, role="owner").exists()
```

to:

```python
def user_can_manage_definitions(user):
    if user.is_staff:
        return True
    return ProjectMembership.objects.filter(user=user, role="owner").exists()
```

Every call site (`boards/views.py`, Labels/Custom Fields/Screens/Workflows manage-tier checks) is
unchanged — the function's contract is the same, just wider. Site Admins gain the ability to
manage every global resource; nobody loses anything they had before.

## Error handling

| Case | Response |
|---|---|
| Unauthenticated request | 403, never 401 |
| Non-Site-Admin calls any `/api/admin/users/...` route | 403 |
| `POST /api/admin/users/` with a duplicate `username` | 400 |
| `POST /api/admin/users/` missing `username`/`password` | 400 |
| `PATCH` your own `is_active` or `is_staff` | 400, explicit "can't change your own admin/active status" |
| `PATCH is_staff: false` on the last remaining Site Admin (someone else's row) | 400, explicit "at least one Site Admin must remain" |
| `PATCH is_active: false` (deactivate) targeting any account, including a project Owner | 200 — allowed; ownership is untouched (see Judgment calls) |
| Genuinely nonexistent user id | 404 |
| Non-Owner calls `archive`/`unarchive` on a project | 403 |
| `archive` an already-archived project, or `unarchive` a non-archived one | 400 |
| Non-member accesses a project's `archive`/`unarchive` route | 403 (`IsProjectMember`, same as every other project sub-route) |

## Testing

- Site Admin CRUD: create an account, confirm it can log in with the set password; deactivate it,
  confirm login now fails; reactivate, confirm login works again.
- A plain user (non-`is_staff`) gets 403 on every `/api/admin/users/...` route, including `GET`
  (list) — this is not a read-only-for-everyone endpoint.
- Self-lockout guards: a Site Admin cannot deactivate their own account or revoke their own
  `is_staff`; a Site Admin *can* revoke another admin's `is_staff` as long as at least one remains
  afterward, and is blocked if it would leave zero.
- Deactivating a project Owner does not change `ProjectMembership.role` or trigger any ownership
  transfer — the project's Owner of record is unchanged, only login is blocked.
- `user_can_manage_definitions`: a `is_staff` user with zero project memberships can still
  rename/delete a Label/Custom Field/Screen/Workflow status; a plain Owner-of-a-project can still
  do the same as before (regression check that the widen didn't accidentally narrow).
- Project archive/unarchive: Owner-only (Admin and Member get 403); archived projects are excluded
  from `GET /api/projects/` by default and included with `?include_archived=true`; an archived
  project's boards/work items remain fully readable *and writable* (proves the deliberate
  visibility-only scope — a regression here would silently expand scope beyond what was decided).
- Double-archive and unarchive-a-non-archived-project both 400 rather than silently no-op'ing.

## Out of scope (deferred to later sub-projects)

- **Narrowing global-resource governance** to Site-Admin-only (removing "Owner of any project" from
  `user_can_manage_definitions`). Flagged as a real, load-bearing open question in Judgment calls,
  not decided here in either direction.
- **Read-only/guest project role.** No concrete need surfaced yet; would be genuinely new role/UI
  surface, not a small addition. Revisit if a specific stakeholder-access request comes in.
- **Audit trail of role/permission changes.** Belongs with a general activity log, which is already
  flagged as deferred out of Task Detail UX (sub-project 8) — not a bespoke log for this sub-project
  alone.
- **Read-only enforcement on archived projects.** This draft ships archiving as a visibility/
  declutter feature only. Making an archived project actually immutable touches the write path of
  every other shipped sub-project and is real, separate scope.
- **Bulk ownership transfer / "reassign everything this person owns."** Not requested; the existing
  per-project `transfer-ownership` endpoint already covers the common case.
- **Self-service password reset / forced password change on first login / email-based invites for
  admin-created accounts.** All blocked on the same underlying gap — there's no email delivery
  system in this codebase yet. `Invitation` already anticipates this ("when email login ships
  later, this extends to inviting by email"); this sub-project's admin-created accounts have the
  identical dependency and the identical deferral.
- **Hard user deletion.** Deactivation (`is_active=False`) is the only account-disable primitive
  this sub-project adds, deliberately, to avoid `ProjectMembership`'s `CASCADE` silently stripping
  someone out of every project's history. A true "erase this account" tool, if ever needed, is a
  separate, harder problem (what happens to their comments, their created boards, their
  `assignee`'d work items) and isn't asked for here.
