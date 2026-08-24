# Tasky — Reporting & Dashboards (Sub-project 13 of 13)

**Status:** Fast-drafted 2026-08-24 by solo authorship (per user's explicit request to speed up the remaining roadmap) — awaiting user review and sign-off. No `design/` prototype built yet; per this repo's hard rule, prototype work begins only after this spec is reviewed and approved.

## Context

This is sub-project 13 — the last one — in Tasky's expansion from a single-board Kanban tool toward a broader, Jira-inspired feature set. The full roadmap (13 sub-projects, redrawn 2026-08-14):

1. Projects & Membership — shipped
2a. Work Item Hierarchy — shipped
2b. Custom Fields & Screens — shipped
2c. Bulk Operations & Import — fast-drafted, pending review
3. Workflows — shipped
4. Labels — shipped
5. Search — fast-drafted, pending review
6. Backlog & Sprints — fast-drafted, pending review
7. Releases — fast-drafted, pending review
8. Task Detail UX — fast-drafted, pending review
9. Permissions & Admin — fast-drafted, pending review
10. Project Types & Setup — fast-drafted, pending review
11. Automation — fast-drafted, pending review
12. Notifications — fast-drafted, pending review
13. **Reporting & Dashboards — this document**

This document completes the drafted roadmap. It's meant to be the capstone that surfaces value across everything already built: Labels (global, so they were explicitly justified in part by "future cross-project reporting" — this is that payoff), Components, the status/category model from Workflows, and the work item hierarchy.

The single fact that shapes everything below: **there is no activity or audit log anywhere in this system.** `WorkItem` records its *current* `status`, not the history of when it changed status. Sub-project 8 (Task Detail UX) is assumed to have deferred building one. Without that log, Tasky knows where a work item is right now and knows nothing about its past — so this spec is scoped to what a snapshot of current state can honestly support, not to the fuller Jira-style reporting suite that assumes time-series data Tasky doesn't have.

## Judgment calls flagged for review

No live Q&A happened for this draft, so these are the calls most likely to need a second look:

- **Fixed set of report views, not a customizable dashboard.** No per-user widget arrangement, no "add/remove/rearrange widgets" surface. If what's actually wanted is a personalized dashboard people configure, that's meaningfully more product than what's specced here — see Scope decisions below.
- **Burndown/cycle time/velocity are entirely absent, on purpose.** This isn't a trimmed-down version of those reports — they don't appear at all, because the data to compute them honestly doesn't exist. Building them properly is a prerequisite decision about an activity/audit log (sub-project 8's territory), not something this spec can patch around with clever querying.
- **Cross-project label reporting silently scopes to the caller's own projects**, rather than either (a) showing a true system-wide total across every project regardless of membership, or (b) refusing the request outright. This felt like the least-surprising option given `GET /api/labels/` is already global/unscoped, but it's an easy place to get the exposure story wrong — worth confirming.
- **No caching or precomputed snapshot table.** Every report is a live aggregation query at request time. Reasonable for this team's data volume today; flagged because it's an infra tradeoff the user should consciously accept rather than one this document quietly assumes.
- **No cross-project "everything I care about" personal dashboard.** Reports are strictly project-scoped (matching the permission model), so there's no single view assembling a person's workload across every project they're in, beyond the existing `/api/me/tasks/`. Explicitly deferred, not an oversight.
- **Any project member can view that project's reports** (not just Owner/Admin). Consistent with existing precedent — members already see the full board — but reports aggregate things like per-assignee workload, which can read as more "managerial" than a board column, so it's worth a deliberate yes rather than an inherited default.

## Scope decisions from brainstorming

These are this author's own judgment calls (fast-drafted, not discussed live) — flagged in the section above where most consequential.

- **Snapshot reports only — no time-series.** Everything in this spec answers "what does things look like right now," never "how did this change over time." That's the direct consequence of no activity log existing. Concretely in scope: counts by status/category, by assignee, by label, by component, overdue items, and a per-project summary combining these. Concretely and deliberately excluded: burndown charts, cycle time, time-in-status, velocity trends — see Out of scope.
- **Fixed views, not a widget dashboard.** A true "dashboard" (persisted, per-user-customizable arrangement of widgets) is real product surface — a widget registry, a layout model, drag-to-arrange, per-user persistence. Tasky's actual size doesn't obviously justify that yet, and nothing in the brief asked for it. Instead: one fixed project "Overview" report (the summary endpoint below) plus a couple of fixed supporting views (overdue list, cross-project label usage). No per-user configuration of what appears or where.
- **Reporting is project-scoped, matching the existing permission boundary**, with one deliberate exception: label usage is inherently cross-project because Labels are global. That report is scoped to *the projects the requesting user is a member of* — it does not leak counts from projects the caller can't see, and it does not attempt to be a true global total across the whole system.
- **Pure aggregation, no new persisted model.** Every report is a read-only query over `WorkItem`, `WorkItemStatus`, `Component`, and `Label` — `Count`/`values().annotate()` style aggregation, computed at request time. Nothing is stored ahead of time and nothing needs to be kept in sync. See Data model below — it's intentionally close to empty.
- **Any project member can view that project's reports.** Same tier as viewing the board itself (`IsProjectMember`) — a report is a different *shape* of data a member can already see item-by-item on the board, not new information. No Owner/Admin gate.
- **Overdue is defined identically to how `/api/me/tasks/` already implies it**: `due_date` in the past AND current status's `category != done`. Category-based, not status-name-based, for the same reason `/api/me/tasks/` already is — a project that recategorizes a status shouldn't need this report updated separately.

## Data model

**No new persisted models.** Every report reads existing tables (`WorkItem`, `WorkItemStatus`, `Component`, `Label`) live at request time; nothing is cached, materialized, or snapshotted to disk. If usage patterns later show these queries are too slow to compute on demand, that's a follow-up performance decision (e.g., a materialized summary refreshed periodically) — not something this sub-project needs to pre-build.

## API surface

```
GET /api/projects/{id}/reports/summary/    project overview snapshot (any project member)
GET /api/projects/{id}/reports/overdue/    this project's overdue work items (any project member)
GET /api/labels/{id}/report/               cross-project usage snapshot for one label, scoped to the caller's own projects
```

**`GET /api/projects/{id}/reports/summary/`** — the fixed "Overview" page's data source. Returns:
- `by_status`: `[{status_id, name, category, count}, ...]` for every status the project currently defines (including zero-count statuses, so an empty column still shows).
- `by_category`: `{todo: N, in_progress: N, done: N}` — the same counts rolled up, for a quick top-line read.
- `by_assignee`: `[{user_id, display_name, count}, ...]` plus an explicit `{user_id: null, display_name: "Unassigned", count: N}` entry.
- `by_priority`: `{low: N, medium: N, high: N}`.
- `by_component`: `[{component_id, name, count}, ...]` — project-scoped, since `Component` already is.
- `overdue_count`: integer — same definition as the `/reports/overdue/` endpoint, included here so the Overview page doesn't need a second request just for the headline number.
- Optional `?board=<id>` query param scopes every count above to a single board within the project (400 if the board doesn't belong to this project); omitted, it aggregates across every board in the project.

**`GET /api/projects/{id}/reports/overdue/`** — the full list backing the summary's `overdue_count`, most-overdue-first (oldest `due_date` first). Same item shape as `/api/me/tasks/` entries (`id, key, title, status_detail, assignee_detail, due_date, priority`), just project-wide instead of "mine."

**`GET /api/labels/{id}/report/`** — the cross-project payoff promised in the Labels spec. Returns:
- `label`: `{id, name, color}`.
- `by_project`: `[{project_id, project_key, project_name, count}, ...]` — **only for projects the requesting user is a member of.** A label used in five projects where the caller belongs to two shows only those two rows; it never reveals that the label exists elsewhere.
- `total`: the sum of `by_project` counts (i.e., "total across projects visible to you," not a true system-wide total — worth restating in the UI copy so it isn't misread as global).
- `by_category`: `{todo: N, in_progress: N, done: N}`, summed across the same visible-projects set.

No `board`-level or `item_type`-level breakdown beyond what's listed — kept to what's actually asked for (status/category, assignee, label, component, overdue), not a general-purpose query builder.

## Error handling

| Case | Response |
|---|---|
| Unauthenticated request | 403, never 401 |
| Non-member requests `/api/projects/{id}/reports/...` | 403 |
| Genuinely nonexistent project id | 404 |
| `?board=` on `/reports/summary/` referencing a board from a different project | 400 |
| `?board=` referencing a nonexistent board id | 400 |
| Genuinely nonexistent label id on `/api/labels/{id}/report/` | 404 |
| Caller is a member of zero projects using the requested label | 200, with `by_project: []` and `total: 0` — not 403; the label itself is a visible global row, only the usage breakdown is filtered |
| Malformed/non-integer query param | 400 |

## Testing

- `/reports/summary/` counts match hand-verified totals across a project with multiple boards, multiple statuses per category, and some unassigned/no-due-date work items.
- `by_status` includes a status currently at zero work items (proves it isn't silently dropped for being empty).
- `?board=` scopes every count to that board only, and rejects a board id from a different project with 400.
- `overdue_count` on `/reports/summary/` matches the length of `/reports/overdue/`'s list, and both use category (not status name) to decide "not done" — a status renamed/recategorized to `done` immediately drops its items from both.
- A non-member of the project gets 403 from all three endpoints; a genuinely nonexistent project id gets 404 ahead of any permission check.
- `/api/labels/{id}/report/` for a label used in projects A (caller is a member) and B (caller is not): `by_project` contains only A, `total` reflects only A's count — B's usage is invisible, not merely excluded from a total that still hints at its existence.
- `/api/labels/{id}/report/` for a label the caller has no visible usage of at all returns 200 with empty breakdown, not 403 or 404.
- `by_component` only lists components belonging to the project being reported on (no cross-project leakage, unlike the label report — this is the expected asymmetry since `Component` is project-scoped and `Label` is global).
- `by_assignee` correctly buckets unassigned work items under the `null`/"Unassigned" row rather than omitting them.

## Out of scope (deferred to later sub-projects)

- **Burndown charts, cycle time, time-in-status, velocity trends.** This is the important boundary of this spec. All of these require knowing *when* a work item entered or left a status — a time-series the system does not record. `WorkItem` has `updated_at`, but that timestamp moves on every field edit (a priority change, an assignee change), not specifically on status transitions, so it cannot stand in for a real history log without producing misleading numbers. Building any of these reports honestly requires a real activity/audit log first — a dependency this document names explicitly rather than working around it with an approximation. Sub-project 8 (Task Detail UX) is the natural home for that log, and per the brief for this batch, it's assumed to have deferred building one. Revisit this entire bullet once that log exists.
- **Customizable, per-user dashboards** (widget picker, drag-to-arrange layout, saved arrangements). The fixed-views approach in this spec is judged sufficient for the team's current size; a full dashboard-builder is real, separate scope with its own data model (a `Dashboard`/`DashboardWidget` pair, ownership, sharing rules) that nobody has asked for yet.
- **Sprint- or Release-scoped reports** (sprint burndown, release readiness, "what's left before this release ships"). Sub-projects 6 (Backlog & Sprints) and 7 (Releases) are being fast-drafted in this same batch but haven't landed as reviewed specs, let alone shipped concepts, so there's nothing to report on yet. Once `Sprint`/`Release` exist, extending `/reports/summary/` with a `?sprint=`/`?release=` filter (mirroring the `?board=` pattern already here) is the natural follow-up — snapshot-only, same history-log caveat applies to any sprint burndown specifically.
- **Cross-project personal workload dashboard** ("everything assigned to me, across every project, in one report-style view"). `/api/me/tasks/` already covers the raw list; a richer reporting view on top of it (grouped by project, by priority, etc.) is a plausible future add but wasn't asked for here and would need its own permission reasoning (it's inherently cross-project data owned by the requesting user, unlike everything else in this spec which is project-scoped).
- **Export (CSV/PDF) of any report.** Not requested; these are read-only API responses rendered as pages, not downloadable artifacts.
- **Scheduled or emailed report digests.** Would depend on Notifications (sub-project 12, also fast-drafted this batch and not yet a delivery mechanism) — no delivery channel exists to hang this off of yet.
- **Report caching or a precomputed snapshot table.** Flagged in Judgment calls above as a live tradeoff, not a permanent decision — revisit if live aggregation proves too slow at real data volume.
