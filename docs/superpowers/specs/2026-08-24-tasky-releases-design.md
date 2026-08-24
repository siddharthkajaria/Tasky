# Tasky — Releases (Sub-project 7 of 13)

**Status:** Fast-drafted 2026-08-24 by solo authorship (per user's explicit request to speed up
the remaining roadmap) — awaiting user review and sign-off. No `design/` prototype built yet; per
this repo's hard rule, prototype work begins only after this spec is reviewed and approved.

## Context

This is sub-project 7 in Tasky's expansion from a single-board Kanban tool toward a broader,
Jira-inspired feature set. The full roadmap (13 sub-projects, redrawn 2026-08-14) is:

1. Projects & Membership — shipped
2. Work Item Hierarchy — shipped (backend + UI)
   - 2b. Custom Fields & Screens — shipped
   - 2c. Bulk Operations & Import — fast-drafted, pending review
3. Workflows — shipped
4. Labels — shipped
5. Search — fast-drafted, pending review
6. Backlog & Sprints — fast-drafted, pending review
7. **Releases — this document**
8. Task Detail UX — not yet designed
9. Permissions & Admin — not yet designed
10. Project Types & Setup — not yet designed
11. Automation — not yet designed
12. Notifications — not yet designed
13. Reporting & Dashboards — not yet designed

A `Release` (Jira calls this a "Version" or "Fix Version") is a named, shippable milestone within
a project — "v2.4.0", "Q3 Launch" — that work items get tagged with. It answers two questions:
"what's targeted for the next release" and "what did we actually ship in v2.3." It is the natural
data-model precursor to changelog/release-notes generation, though that generation step itself is
deferred (see Out of scope).

**Release vs. Sprint — these are different things, not two names for the same concept.** Sub-project
6 (Backlog & Sprints) is being fast-drafted alongside this document and is expected to introduce a
`Sprint` concept scoped to a board: a time-boxed iteration answering "what are we working on right
now." A `Release` answers a different question — "what version does this ship in" — and is
oriented around a shippable artifact, not a unit of time. The two are shaped similarly (both are a
named container with a lifecycle that work items get assigned to) but serve orthogonal purposes: a
single release can span many sprints, and a single sprint's work can land across several releases
(or none, if it slips). This document does not assume anything about `Sprint`'s eventual schema
beyond that surface-level shape resemblance.

## Judgment calls flagged for review

This was fast-drafted without live Q&A, so these are the calls most likely to need a second look:

- **Project-scoped, not global** — the opposite of `Label`'s deliberate global scope. If there's an
  actual cross-project "platform release" use case (e.g. multiple Tasky projects ship together
  under one shared version number), this is the wrong call and would need real rework, not a
  tweak — see the Scope decision below for the reasoning.
- **Single nullable FK on `WorkItem`, not a M2M.** This assumes a work item ships in at most one
  release. If the team actually needs "backported to both v2.3.1 and v2.4.0," this is wrong and
  the fix is a real schema migration (FK → M2M), not a small patch.
- **Invented a three-state lifecycle** (`unreleased` / `released` / `archived`) with no explicit
  ask for `archived`. It exists here to let old versions stop cluttering a picker without deleting
  history; cut it if that's over-engineering for the team's actual usage.
- **`on_delete=SET_NULL`, no "still in use" guard on delete** — following `Component`'s precedent
  rather than the more cautious `PROTECT` used for `WorkItemStatus`. "What shipped in v2.3" is a
  historical record in a way a component tag isn't; worth confirming silent orphaning is actually
  acceptable here.
- **One `release_date` field doing double duty** as both target date (while unreleased) and actual
  ship date (once released), rather than separate `target_date`/`released_at` fields. Chosen for
  leanness; flag if the team wants to track slippage (planned vs. actual) as two real values.
- **No dedicated "mark as released" action endpoint** — ordinary `PATCH` covers status and date
  changes, unlike `WorkItem`'s `move/`, which exists because moving columns has renumbering side
  effects. A release status change has no such side effects, so this seemed safe to keep simple —
  but it also means nothing stops marking a release "released" while work items in it are still
  open. That's deliberate (see Scope decisions) but worth confirming.

## Scope decisions from brainstorming

These are solo judgment calls made in place of live back-and-forth, not a live-brainstormed
decision log — flagged individually above where most consequential.

- **Project-scoped, matching `Component`, not global like `Label`/`CustomField`/`Screen`.** A
  release name is only meaningful relative to one project's shipping cadence — two projects both
  having a "v1.0" doesn't mean they're the same release, unlike "urgent" meaning the same thing
  everywhere. For a small internal tool with no stated multi-project-simultaneous-ship workflow,
  inventing a shared-release concept now would be speculative scope with no current use case.
  Revisit if two projects are ever asked to actually ship in lockstep under one version number.
- **One release per work item, via a plain nullable FK, not a M2M.** Jira's "multiple fix
  versions" exists for genuinely complex release trains (backporting a fix to several maintained
  versions at once). This tool has no maintained-branches concept and no evidence that scenario
  comes up; a single FK is simpler to model, query, and display, and is easy to widen to a M2M
  later if the need turns out to be real — going the other direction (M2M → FK) would be the
  painful migration, so starting narrow is the safer default.
  - Tie-break precedent, applied here: `WorkItem.status` and `WorkItem.parent` are both `ForeignKey`
    (single-valued relationships to a lifecycle/hierarchy concept); `components` and `labels` are
    both M2M (multi-valued *tags*). A release is conceptually closer to "which bucket does this
    ship in" (status-like, singular) than to a tag (components-like, plural).
- **Lifecycle is a flat status plus one optional date, not a workflow.** `unreleased` (default),
  `released`, `archived`. No transition rules, no required ordering (though going straight from
  `unreleased` to `archived` is allowed and just means "abandoned, never shipped"). This mirrors
  Workflows' own "custom statuses, no transition rules" simplification from sub-project 3 — a
  release doesn't need more process than a work item's own status does.
- **No enforcement tying release status to its work items' statuses.** Marking a release
  `released` does not check whether every work item in it is `done`-category, and does not block
  new work items being added to an already-`released` release afterward (e.g. backfilling a
  changelog after the fact). This tool doesn't have the ceremony of a real release-train process;
  adding a gate here is exactly the kind of process weight the original v1 spec deliberately
  avoided.
- **Deleting a release un-assigns, doesn't block.** Matches `Component` (no "in use" guard) rather
  than `WorkItemStatus` (`PROTECT`, blocks). `WorkItemStatus` is protected because a work item
  without a status is a broken invariant (every work item must be somewhere on the board); a work
  item without a release is a completely normal, common state (most items, most of the time,
  aren't tagged to any specific release). No structural reason to block the delete.

## Data model

**`Release`** (project-scoped)
- `project` (FK, `on_delete=CASCADE`) — real per-project rows, matching `Component`/
  `WorkItemStatus`, not a global table.
- `name` — e.g. "v2.4.0", "Q3 Launch". Unique together with `project`, case-insensitive at the
  serializer level (matching every other duplicate-name check in this codebase).
- `status` — one of `unreleased` (default), `released`, `archived`.
- `release_date` — nullable `DateField`. Optional target date while `unreleased`; can be edited at
  any time, including after the release is marked `released`, to record the actual ship date.
- No `position` field — releases aren't rendered as ordered columns the way statuses are; a
  reasonable default list ordering is `release_date` (nulls last) then `name`.

**`WorkItem.release`** — nullable `ForeignKey` to `Release`, `on_delete=SET_NULL`, `blank=True`.
Absent by default; a work item with no release assigned is the normal, common case.

**Cross-project integrity:** assigning a `Release` to a `WorkItem` from a different project is
rejected with `400`, mirroring the existing `components` cross-project check.

## API surface

```
GET/POST /api/projects/{id}/releases/            list this project's releases (any member) /
                                                   create one (Owner/Admin)
GET/PATCH/DELETE /api/projects/{id}/releases/{id}/  Owner/Admin only for write; GET any member
GET /api/projects/{id}/releases/{id}/work-items/  every work item currently assigned to this
                                                   release (any project member) — a plain list,
                                                   no aggregation; see Out of scope
```

Mirrors `Component`'s existing endpoint shape and permission tier (`GET/POST
/api/projects/{id}/components/`, `PATCH/DELETE /api/projects/{id}/components/{id}/`): same
nesting under project, same Owner/Admin-write / any-member-read split.

- `POST` body: `{name, release_date?}`. `status` defaults to `unreleased` and is not settable on
  create (a release is created before it exists to be released).
- `PATCH` body: any of `{name?, status?, release_date?}`.
- `DELETE`: no guard — unassigns from every work item that had it, same as `Component`.

**`WorkItemSerializer` gains, on `/api/work-items/`:**
- `release` (write) — a `Release` id, or `null` to clear. Validated to belong to the item's own
  project, same pattern as `components`/`parent`.
- `release_detail` (read) — `{id, name, status, release_date}`, alongside the raw `release` id,
  matching the `components`/`components_detail` naming convention.

## Error handling

| Case | Response |
|---|---|
| Unauthenticated request | 403, never 401 |
| Non-member touches any project's `/releases/` endpoint | 403 (`IsProjectMember`) |
| Non-Owner/Admin creates/renames/deletes a release, or changes its status/date | 403 |
| Duplicate `name` (case-insensitive) within the same project | 400 |
| `PATCH`/`DELETE`/nested-list on a genuinely nonexistent release id | 404 |
| Work item write assigns a `release` from a different project | 400 |
| Invalid `status` value on create/PATCH | 400 |
| `DELETE` a release still assigned to work items | Succeeds — `WorkItem.release` set to `null` for every item that had it, no block |
| Applying a release to a work item | Any project member — ordinary edit permission, no separate check |

## Testing

- Create/rename/delete a release; duplicate name (any casing) within one project is rejected;
  the same name in two different projects is allowed (proves project scope, not global).
- Non-Owner/Admin is rejected creating, renaming, or deleting a release; any member can read the
  list and assign an existing release to a work item.
- Assigning a release from a different project to a work item is rejected with 400.
- Deleting a release with work items assigned un-assigns them (their `release` becomes `null`)
  without touching any other field on those work items.
- Status transitions (`unreleased` → `released`, → `archived`, and the direct `unreleased` →
  `archived` skip) are all accepted — no transition-order validation.
- `release_date` can be set, changed, or cleared at any point regardless of `status`.
- `GET /api/projects/{id}/releases/{id}/work-items/` returns exactly the work items currently
  assigned, and nothing else.
- Cross-project isolation: Project A's releases aren't usable or visible from Project B's
  endpoints.

## Out of scope (deferred to later sub-projects)

- **Multiple releases per work item** ("fix versions" plural). Deliberately a single FK — see
  Scope decisions. Revisit only if a real multi-version-backport workflow shows up.
- **Cross-project/global releases.** Every release lives in exactly one project. No shared
  "platform release" concept — see Scope decisions.
- **Release burndown, velocity, or any "what shipped in this release" reporting/aggregation.**
  This sub-project is the data model plus basic CRUD and assignment only; the `.../work-items/`
  endpoint above is a plain list, not a report. All charting/aggregation is sub-project 13
  (Reporting & Dashboards).
- **Changelog / release-notes generation.** A natural next step on top of this data model (group a
  release's work items by type, format as notes) but not requested yet and not assigned to a
  specific sub-project on the current roadmap — revisit once someone asks for it.
- **Transition rules or workflow validation on release status** (e.g. blocking "mark released"
  while items are still open). Deliberately unenforced, matching Workflows' own no-transition-
  rules simplification — see Scope decisions.
- **Notifications on release date arriving or status changing.** Sub-project 12 (Notifications).
- **Release-level permissions finer than the project's existing Owner/Admin/Member tiers.**
  Sub-project 9 (Permissions & Admin), if ever needed.
