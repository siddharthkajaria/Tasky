# Tasky — Backlog & Sprints (Sub-project 6 of 13)

**Status:** Fast-drafted 2026-08-24 by solo authorship (per user's explicit request to speed up the remaining roadmap) — awaiting user review and sign-off. No `design/` prototype built yet; per this repo's hard rule, prototype work begins only after this spec is reviewed and approved.

## Context

This is sub-project 6 in Tasky's expansion from a single-board Kanban tool toward a broader, Jira-inspired feature set. The full roadmap (13 sub-projects, redrawn 2026-08-14) is:

1. Projects & Membership — shipped
2. Work Item Hierarchy — shipped (backend + UI)
   - 2b. Custom Fields & Screens — shipped
   - 2c. Bulk Operations & Import — fast-drafted, pending review (this batch)
3. Workflows — shipped
4. Labels — shipped
5. Search — fast-drafted, pending review (this batch)
6. **Backlog & Sprints — this document**
7. Releases — fast-drafted, pending review (this batch)
8. Task Detail UX — not yet designed
9. Permissions & Admin — not yet designed
10. Project Types & Setup — not yet designed
11. Automation — not yet designed
12. Notifications — not yet designed
13. Reporting & Dashboards — not yet designed

Today, every `WorkItem` on a board is always "in play" — the board shows everything, all the time, with no notion of work that's been captured but not yet committed to. Now that Workflows (3) has made `status` a real per-project, per-category concept and Labels (4) has given work items casual free-form tags, the missing piece for anything resembling real sprint-based planning is a second axis entirely: not "what column is this in" but "which iteration, if any, is this committed to." This sub-project adds that axis — a `Sprint` model, a backlog view, and start/complete lifecycle actions — without touching how `status`/board columns already work.

## Judgment calls flagged for review

This was fast-drafted without live Q&A, so these are the calls most likely to need pushback:

- **Sprints are scoped to a `Board`, not a `Project`.** A project with two boards (say, "Engineering" and "Design") gets two independent sprint cadences with no way to run one sprint across both. If the real intent is one team, one cadence, spanning every board in a project, this is the wrong scope and should be caught now — it's a much bigger change to fix after `WorkItem.sprint`/`Sprint.board` ships than to fix in review.
- **Completing a sprint returns unfinished items to the backlog; it does NOT auto-carry them into a next sprint.** This is the opposite of Jira's actual default (auto-move to the next sprint, or to a newly created one). I picked "return to backlog for re-triage" because it needed zero new concept (no "next sprint" to infer, no silent scope changes) and matches this codebase's general aversion to implicit magic — but this is a genuinely 50/50 product call, not an obvious one, and most teams who've used Jira will expect the rollover.
- **The backlog is orthogonal to `status`, not a replacement for it.** A work item can be "Done" and still show in the backlog (nobody ever scheduled it into a sprint), or "To Do" and inside an active sprint. This composes cleanly with Workflows on paper, but it may not match a simpler mental model where "in the backlog" implicitly means "not started yet." Worth sanity-checking against how the team actually plans.
- **No story points, estimation, or capacity concept at all.** A `Sprint` is just a name, an optional goal, and dates — a container, not a planning tool. If the actual reason sprints matter to this team is capacity planning ("can we fit this in two weeks"), this spec doesn't deliver that; it's flagged as deferred below rather than guessed at.
- **Starting/completing/deleting a `Sprint` is gated to Owner/Admin; scheduling an item into or out of a sprint is open to any project member.** This mirrors Labels' "governance split by risk" pattern, but nobody asked for that split here specifically — it's my own extrapolation from house style, worth confirming it's actually wanted for sprints too.
- **A brand-new `WorkItem.backlog_position` field and a new `schedule/` endpoint**, rather than reusing the existing `position` field or folding this into `/move/`. Kept additive to avoid touching `move_work_item`'s already-subtle locking logic, but it does mean work items now carry two independent ordering numbers (`position` for the status column, `backlog_position` for the backlog/sprint bucket) — more surface than the minimum, worth a second look.

## Scope decisions from brainstorming

No live brainstorming happened for this fast-drafted spec — these are solo judgment calls, elaborated from the bullets above.

- **Per-board scope.** `Board` is already the unit `position`/`next_position()`/`move_work_item()` key off (`WorkItem.Meta.indexes = [["board", "status", "position"]]`), and it's the unit a team actually looks at day to day. `WorkItemStatus` is project-scoped because a status vocabulary is a structural, rarely-changed thing; a sprint is a living, week-to-week container that belongs with the board people actually drag cards on.
- **Three-state lifecycle: `planned` → `active` → `completed`, one-way.** No "reopen a completed sprint," no "pause an active one." Mirrors Workflows' "no transition rules" simplicity call — a linear lifecycle covers the common case without new validation surface.
- **Exactly one `active` sprint per board at a time**, enforced at the API layer (a `select_for_update()`-guarded check on start, same lock-then-check pattern `WorkItem.save()` already uses for status-seeding) rather than a DB constraint — MySQL has no clean partial-unique-index primitive here, and this codebase already leans on application-layer invariants for exactly this kind of "at least/at most one" rule (see `WorkItemStatus`'s "every category needs ≥1 status").
- **Multiple `planned` (future) sprints are allowed per board simultaneously** — a team can queue up Sprint 15 and Sprint 16 while Sprint 14 is active, and pre-load items into either. Only the *active* count is capped at one.
- **Sprint dates are set by the lifecycle actions, not chosen up front.** `start_date` is stamped when a sprint starts; `end_date` when it completes. No editable target end date at planning time — matches "no estimation" by not inventing a duration concept either.
- **Backlog/sprint ordering reuses the total-order-plus-renumber-on-move pattern from `position`**, via a new `backlog_position` field and a new `schedule/` action, rather than repurposing `position` itself — `position` is already load-bearing for status columns and mixing two orderings into one field would make both ambiguous.
- **Deleting a sprint is only allowed while it's still `planned` and has zero items scheduled into it.** An `active` or `completed` sprint can never be deleted — completed sprints in particular are the only record of "what did we actually finish this iteration," which sub-project 13 (Reporting) will eventually want.

## Data model

**`Sprint`**
- `board` (FK, `on_delete=CASCADE`) — per-board scope (see above).
- `name` — free text, e.g. "Sprint 14." Not unique (matches `Board.name`).
- `goal` — optional text, one line. The one piece of sprint-level context worth keeping; not estimation.
- `state` — one of `planned` / `active` / `completed`, default `planned`.
- `start_date`, `end_date` — nullable dates, set only by the `start`/`complete` actions (see API surface). Never directly writable via `PATCH`.
- `created_by`, `created_at`.

**`WorkItem.sprint`** — nullable FK to `Sprint`, `on_delete=SET_NULL` (deleting the *board* cascades and takes the sprint with it via `Sprint.board`'s own CASCADE; deleting a work item just clears the FK, same shape as `WorkItem.parent`). Orthogonal to `status`: no relationship, no derived value, no validation between the two.

**`WorkItem.backlog_position`** — integer, default `0`. Orders items within whichever single bucket currently holds them: the board's backlog (`sprint IS NULL`) or one specific `Sprint` (`sprint = X`). Same total-order-plus-`id`-tiebreak contract as `position`, and the same "gaps are expected, renumbering only happens on a move" non-invariant (see `boards/services.py`'s `next_position`/`move_work_item` docstrings — `docs/follow-ups.md`'s existing non-goals apply here too, by the same reasoning).

**Index:** `models.Index(fields=["board", "sprint", "backlog_position"])`, mirroring the existing `["board", "status", "position"]` index.

**Invariant, enforced at the API layer, not the DB:** at most one `Sprint` per `board` may have `state = "active"` at any time.

## API surface

```
GET/POST /api/boards/{id}/sprints/         list this board's sprints (any project member) / create one (Owner/Admin)
GET/PATCH/DELETE /api/sprints/{id}/        read (any member) / rename+edit goal (Owner/Admin) / delete (Owner/Admin, planned + empty only)
POST /api/sprints/{id}/start/              planned -> active (Owner/Admin)
POST /api/sprints/{id}/complete/           active -> completed (Owner/Admin)
GET /api/boards/{id}/backlog/              this board's unscheduled work items (sprint = null), ordered by backlog_position
GET /api/sprints/{id}/work-items/          this sprint's work items, ordered by backlog_position
POST /api/work-items/{id}/schedule/        {sprint: <id>|null, position: <int>} — move into a sprint, out to backlog, or between sprints
```

`POST /api/boards/{id}/sprints/` body: `{name, goal?}`. `PATCH /api/sprints/{id}/` accepts `{name?, goal?}` only — `state`, `start_date`, `end_date` are read-only, changed only via `start`/`complete`.

**`start`** rejects with 400 if the sprint isn't currently `planned`, or if another sprint on the same board is already `active`. Sets `start_date = today`.

**`complete`** rejects with 400 if the sprint isn't currently `active`. Sets `end_date = today`, then — in the same transaction — every work item still pointing at this sprint has its `sprint` field cleared and is appended to the end of the board's backlog ordering (`backlog_position` set past the current backlog max, same "renumber the destination" shape as `move_work_item`). Nothing else about those items changes: `status`, `position`, assignee, etc. are untouched.

**`WorkItemSerializer` gains:**
- `sprint` (write) — a `Sprint` id or `null`. **Cannot be changed via `PATCH`/`PUT`** on `/api/work-items/{id}/`, same rule as `status`/`board` — only `POST /api/work-items/{id}/schedule/` can move an item between sprints/backlog, since that's the one path that also renumbers `backlog_position` correctly. A `PATCH` echoing back the current, unchanged `sprint` is accepted, matching the existing `status`/`board` convention.
- `sprint_detail` (read) — `{id, name, state, start_date, end_date}` or `null`, alongside the raw `sprint` id.

`schedule/` validates the target `sprint` belongs to the item's own board (cross-board sprint id → 400, same shape as move/'s cross-project status check) and that the sprint is not `completed` (items can be scheduled into `planned` or `active` sprints, or cleared to `null` for the backlog, but never dropped into a closed sprint).

## Error handling

| Case | Response |
|---|---|
| Unauthenticated request | 403, never 401 |
| Non-member touches a board's `/sprints/`, `/backlog/`, or a sprint's `/work-items/` | 403 |
| Non-Owner/Admin creates/renames/starts/completes/deletes a sprint | 403 |
| `start` on a sprint that isn't `planned` | 400 |
| `start` while another sprint on the same board is already `active` | 400, naming the active sprint |
| `complete` on a sprint that isn't `active` | 400 |
| `DELETE` a sprint that isn't `planned` | 400 |
| `DELETE` a `planned` sprint that still has work items scheduled into it | 400, naming the count (mirrors `WorkItemStatus`'s in-use message) |
| `schedule/` naming a sprint from a different board than the item's | 400 |
| `schedule/` naming a `completed` sprint | 400 |
| `schedule/` on a genuinely nonexistent sprint id | 404 |
| `PATCH`/`PUT` on `/api/work-items/{id}/` attempting to change `sprint` | 400, naming `sprint`, pointing at `schedule/` |
| Genuinely nonexistent sprint id (direct GET/PATCH/DELETE) | 404 |

## Testing

- Full lifecycle: create (`planned`) → `start` (`active`, `start_date` stamped) → `complete` (`completed`, `end_date` stamped); each transition rejected out of order (can't `complete` a `planned` sprint, can't re-`start` a `completed` one).
- Only one `active` sprint per board: starting a second sprint while one is active is rejected; starting sprints on two *different* boards concurrently both succeed.
- `complete` clears `sprint` on every item still pointing at it and appends them to the board's backlog ordering, leaving `status`/`position`/assignee untouched.
- `schedule/` moves an item backlog → sprint, sprint → sprint, and sprint → backlog, renumbering both the source and destination buckets (mirrors `move_work_item`'s column-renumber test shape).
- Orthogonality: an item can be `Done` and still appear in the backlog (no sprint assigned), and separately, an item can be `To Do` and appear inside an active sprint — status and sprint never constrain each other.
- Deleting a `planned` sprint with items scheduled into it is rejected until those items are moved out; deleting an `active` or `completed` sprint is always rejected regardless of contents.
- Cross-board isolation: a sprint belonging to board A is rejected as a target for a work item on board B.
- `PATCH` on `/api/work-items/{id}/` cannot change `sprint`; echoing back the current value alongside other edits is accepted.
- `GET /api/boards/{id}/backlog/` and `GET /api/sprints/{id}/work-items/` each return items ordered by `backlog_position`, and never include items from the other bucket.

## Out of scope (deferred to later sub-projects)

- **Story points / estimation / capacity planning.** No estimation field exists anywhere in this codebase yet; inventing one here, alongside a new lifecycle concept, is too much new surface for one sub-project. Revisit once sprints are in real use and capacity planning is actually requested.
- **Automatic rollover of unfinished items to a next sprint on `complete`.** Deliberately deferred per the judgment call above — this is the single most likely thing to get relitigated in review.
- **Burndown/velocity charts.** Needs estimation (above) plus historical daily snapshots neither of which exist yet — squarely sub-project 13 (Reporting & Dashboards) territory.
- **Cross-board or project-wide sprints.** Sprints are per-board only, per the scope decision above; a project wanting one shared cadence across boards has no way to express that yet.
- **Sprint cancellation** (an explicit "abandoned" state distinct from `completed`). A `planned` sprint can simply be deleted; an `active` sprint has no "abort" path in this version — it must be completed like any other.
- **Multiple concurrent active sprints per board** (for teams running parallel workstreams). Exactly one `active` sprint per board, no exceptions, for now.
