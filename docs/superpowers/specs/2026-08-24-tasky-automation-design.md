# Tasky — Automation (Sub-project 11 of 13)

**Status:** Fast-drafted 2026-08-24 by solo authorship (per user's explicit request to speed up the remaining roadmap) — awaiting user review and sign-off. No `design/` prototype built yet; per this repo's hard rule, prototype work begins only after this spec is reviewed and approved.

## Context

This is sub-project 11 in Tasky's expansion from a single-board Kanban tool toward a broader, Jira-inspired feature set. The full roadmap (13 sub-projects, redrawn 2026-08-14) is:

1. Projects & Membership — shipped
2. Work Item Hierarchy — shipped (backend + UI)
   - 2b. Custom Fields & Screens — shipped
   - 2c. Bulk Operations & Import — fast-drafted, pending review
3. Workflows — shipped
4. Labels — shipped
5. Search — fast-drafted, pending review
6. Backlog & Sprints — fast-drafted, pending review
7. Releases — fast-drafted, pending review
8. Task Detail UX — fast-drafted, pending review
9. Permissions & Admin — fast-drafted, pending review
10. Project Types & Setup — fast-drafted, pending review
11. **Automation — this document**
12. Notifications — fast-drafted, pending review
13. Reporting & Dashboards — fast-drafted, pending review

Automation is the first sub-project that acts on a work item without a person directly doing it — "when X happens, then do Y." It only becomes coherent once there's something worth reacting to: per-project Workflows (3) gave projects their own statuses and categories, and Labels (4) gave every work item a casual tagging mechanism. This sub-project wires those together into a small rules engine, deliberately scoped far below real automation platforms (Jira Automation, Zapier) — a handful of triggers, a handful of actions, no chaining, no external calls.

## Judgment calls flagged for review

No live Q&A happened for this draft, so these are the calls most likely worth pushing back on:

- **Only two triggers made the cut: work item created, and status changed.** Every other candidate ("field changed" — assignee/priority/label/component) is deferred entirely, not just de-prioritized. All three of the brief's own example rules happen to fit these two triggers, but if there's a use case that genuinely needs a plain field-change trigger, that's a bigger addition than it looks (see Scope decisions).
- **One rule = one trigger + one action, no action chains.** Real automation tools let one rule fire several actions ("apply a label AND set an assignee"). Here that needs two separate rules. Flag if this feels too restrictive for the actual use cases in mind.
- **Loop prevention is "no cascading" rather than a depth cap.** An automation-caused change never re-triggers rule evaluation, full stop — not even once. This is the simplest possible guard and provably can't loop, but it also rules out intentional rule chains (e.g. "created → apply label" feeding into "label applied → …") as a side effect. See Scope decisions for the reasoning and the trade-off.
- **Governance reuses the existing Owner/Admin tier** (`can_manage_statuses`/`can_manage_components`) rather than a new permission level. Low-risk, but it does mean anyone who can manage a project's statuses can also silently change how the project behaves via automation.
- **Execution is fully synchronous, inline with the triggering request.** Confirmed there's no Celery/RQ/task-queue dependency anywhere in `requirements.txt` today, so this isn't a shortcut around infrastructure that already exists — it's the only option without adding new infrastructure. A future sub-project needing background jobs (scheduled triggers, bulk automation replay) will need to introduce that from scratch.
- **`WorkItemStatus` deletion now also checks automation rules.** This sub-project reaches back into Workflows' existing delete guard and adds a new reason a status `DELETE` can 400 (a rule still referencing it). Small, but it's the one place this spec changes previously-shipped behavior rather than only adding new surface.

## Scope decisions from brainstorming

These are solo judgment calls, not a live-brainstormed session — see the flagged list above for the ones most worth contesting.

- **Two triggers, chosen for being cheap to detect given the existing codebase.** `WorkItem` creation already funnels through one path (`WorkItemSerializer.create()`); status changes already funnel through exactly one service function, `move_work_item()`. Both are natural, single hook points. A generic "any field changed" trigger has no equivalent chokepoint — ordinary edits go through `WorkItemSerializer.update()`, which accepts any combination of fields in one `PATCH`, and nothing in the codebase today diffs old-vs-new values to detect which fields actually changed. Building that diffing machinery just to support a first-pass automation trigger is real scope on its own; deferred (see Out of scope).
- **Three actions, matched to what those two triggers can usefully drive:** set assignee, apply/remove a label, change status. `set_priority` was a candidate but dropped from the first pass purely to keep the action set no bigger than the trigger set — it's a trivial follow-on later (same shape as `set_assignee`, a fixed scalar).
- **No external actions.** No "send a Slack message," no "call a webhook." That's real integration scope — auth, retries, failure handling for a system outside Tasky's control — and belongs to a future integration-focused sub-project, not this one.
- **Rules are project-scoped, not global.** Unlike `Label` (deliberately global, shared vocabulary across every project), an automation rule encodes one project's own process — "our Bugs get triaged this way," "our Done column clears the assignee." That's specific to how one project runs, the same reasoning that made `WorkItemStatus` per-project rather than a shared enum. There's no equivalent case here for a rule meaning the same thing across two unrelated projects.
- **Governance reuses the Owner/Admin tier**, matching `can_manage_statuses`/`can_manage_components` exactly — any project member can view a project's rules (so they understand why a card moved or got relabeled on its own), only Owner/Admin can create, edit, delete, reorder, or disable them. Inventing a distinct "automation manager" tier would be new permission surface nobody asked for.
- **Synchronous, inline execution — no task queue.** `requirements.txt` has no Celery, RQ, Dramatiq, or Huey dependency; this app has never had async task infrastructure. Given the intended scale (a small internal tool, a handful of rules per project), running a rule's action inline inside the same transaction as the triggering write is simplest and keeps behavior visible in the very response that caused it. This is a deliberate, acceptable limitation: it doesn't scale to slow actions, external calls, or long chains — none of which this sub-project supports anyway.
- **Non-cascading execution is the loop guard.** An action performed by a rule (a label apply, a status change, an assignee set) is applied directly via the same internals a manual edit would use (`resolve_labels`, `move_work_item`), but that call does **not** re-enter rule evaluation. A "status changed to X → change status to X" rule therefore can't loop even against itself — the second status change simply isn't a trigger event as far as automation is concerned. The cost is that a legitimate two-hop chain ("A fires, which should cause B to fire") isn't supported; that's flagged above as worth reconsidering if real usage wants it.
- **Rules within one project execute in a defined `position` order** when more than one matches the same event, same hand-ordered/renumbered convention as `WorkItemStatus`/`ScreenField`. If two rules' actions conflict (both set status, say), later position wins — both still run, in order, in the same transaction.

## Data model

**`AutomationRule`**
- `project` (FK) — every rule belongs to exactly one project.
- `name` — short label, e.g. "Auto-triage new bugs". Not unique; purely descriptive.
- `trigger_type` — one of `work_item_created`, `status_changed`.
- `trigger_filter` — JSON, shape depends on `trigger_type`:
  - `work_item_created`: `{item_type: <ItemType>|null}` — `null` matches every item type.
  - `status_changed`: `{from_status: <WorkItemStatus id>|null, to_status: <WorkItemStatus id>|null, to_category: <Category>|null}` — `from_status: null` matches any originating status; `to_status` and `to_category` are mutually exclusive ways to filter the destination (an exact status, or any status in a category), both `null` matches any destination.
- `action_type` — one of `set_assignee`, `apply_label`, `remove_label`, `change_status`.
- `action_config` — JSON, shape depends on `action_type`:
  - `set_assignee`: `{mode: "fixed"|"actor"|"unassign", user_id: <int>|null}` — `user_id` required (and validated as a member of the rule's project) only when `mode = "fixed"`; `"actor"` assigns whoever performed the triggering request; `"unassign"` clears the assignee.
  - `apply_label` / `remove_label`: `{label_name: <string>}` — `apply_label` resolves the name the same case-insensitive match-or-create way manual `labels` writes do (reuses `resolve_labels`); `remove_label` matches an existing label case-insensitively and no-ops if the work item doesn't currently have it.
  - `change_status`: `{status_id: <WorkItemStatus id>}` — must belong to the rule's own project.
- `position` — integer, execution order among a project's rules when several match the same event. Same hand-ordered, renumbered-on-delete convention as `WorkItemStatus`/`ScreenField`.
- `is_active` — boolean, default `True`. Lets a rule be paused without deleting its configuration.
- `created_by`, `created_at`.

**No through-model or execution-log table.** A rule is config only; there is no persisted record of "this rule fired on this work item at this time" (see Out of scope).

**`WorkItemStatus` deletion gains a second guard.** Alongside the existing "still used by N work items" check (Workflows), `DELETE /api/projects/{id}/statuses/{id}/` now also 400s if any `AutomationRule` in the project references that status in `trigger_filter.from_status`, `trigger_filter.to_status`, or `action_config.status_id` — naming the rule(s) so the error is actionable, matching the existing message style ("still used by N work item(s)").

## API surface

```
GET/POST /api/projects/{id}/automation-rules/         list (any member) / create (Owner/Admin)
GET/PATCH/DELETE /api/projects/{id}/automation-rules/{id}/   read (any member) / edit, delete (Owner/Admin)
```

Mirrors `Component`'s and `WorkItemStatus`'s existing endpoint shape and permission tier exactly — nested under project, Owner/Admin-write, any-member-read.

- `POST` body: `{name, trigger_type, trigger_filter, action_type, action_config, is_active?}`. New rule appends to the end of the project's `position` ordering.
- `PATCH` body: any of the above, plus `position` for reordering (cascades to siblings, same as `FieldOption`/`ScreenField` reordering).
- No dedicated "run now" / dry-run / test endpoint. A rule only fires from a real `work_item_created` or `status_changed` event.

No changes to `/api/work-items/` or `/api/work-items/{id}/move/`'s request/response shapes — automation runs as a side effect inside those existing endpoints' server-side handling, not as a new field a client sends or reads.

## Error handling

| Case | Response |
|---|---|
| Unauthenticated request | 403, never 401 |
| Non-member touches a project's `/automation-rules/` endpoint | 403 |
| Non-Owner/Admin creates/edits/deletes/reorders a rule | 403 |
| Genuinely nonexistent rule id | 404 |
| Invalid `trigger_type` or `action_type` value | 400 |
| `status_changed` `trigger_filter` sets both `to_status` and `to_category` | 400, naming `trigger_filter` |
| `trigger_filter`/`action_config` references a `WorkItemStatus` from a different project | 400 |
| `set_assignee` with `mode: "fixed"` names a user who isn't a member of the rule's project | 400 |
| `apply_label`/`remove_label` with a blank/whitespace-only `label_name` | 400 |
| `DELETE` a `WorkItemStatus` still referenced by any rule's `trigger_filter`/`action_config` | 400, naming the rule(s) |
| A rule's action targets the same value its own trigger matches (e.g. `change_status` to the exact `to_status` it fires on) | Accepted at write time — harmless at runtime; execution is non-cascading, so this can't loop |
| Two rules match the same event and their actions conflict (e.g. both `change_status`) | Both run, in `position` order; later position's write is what persists |

## Testing

- A work item created with `item_type: bug` fires a matching `work_item_created` rule and applies its label the same way a manual `labels` write would (reuses/creates the `Label` row); a work item of a non-matching type does not fire it.
- A status move matching a rule's `from_status`/`to_status`/`to_category` filter fires its action inline, in the same request/transaction as `move_work_item()` — the response already reflects the automated change.
- A status move that doesn't match any filter (wrong `from_status`, wrong `to_status`/`to_category`) fires nothing.
- A rule whose action changes status to the exact value its own trigger matches does not loop or re-fire — proves the non-cascading guard.
- Two rules matching the same event both execute, in `position` order; when their actions conflict, the later-position rule's write is what persists.
- `set_assignee` with `mode: "actor"` assigns the user who performed the triggering request (creator or mover), not a fixed user; `mode: "fixed"` assigns the configured user; `mode: "unassign"` clears the assignee.
- Owner/Admin can create/edit/delete/reorder/deactivate a project's rules; a plain Member gets 403 on all of those but can still `GET` the list.
- A rule with `is_active: False` does not fire even when its trigger condition is met.
- `POST`/`PATCH` rejects a `trigger_filter`/`action_config` referencing a `WorkItemStatus` from a different project, and a `set_assignee` fixed `user_id` who isn't a member of the rule's project.
- `DELETE /api/projects/{id}/statuses/{id}/` is rejected when a rule still references that status, naming the rule; deleting an unreferenced status is unaffected.
- Cross-project isolation: Project A's rules never fire on Project B's work items, and are not visible via Project B's endpoints.

## Out of scope (deferred to later sub-projects)

- **Generic "field changed" trigger** (assignee/priority/label/component changed). Deferred because nothing in the codebase currently diffs old-vs-new values on an arbitrary `PATCH` — `WorkItemSerializer.update()` has no chokepoint equivalent to `move_work_item()`. Revisit if a real use case needs it; it would need its own pre/post-image diffing mechanism first.
- **Multi-action rules / action chains.** One rule fires exactly one action in this pass. Revisit if "apply a label AND set an assignee" from a single rule proves common enough to be worth the added config shape.
- **Cascading rule chains** (an automation-caused change re-triggering further rule evaluation). The loop-prevention model here is deliberately "no cascading" rather than a depth cap — simplest possible guard, but it also rules out intentional chains. If chaining is wanted later, it needs a bounded mechanism (e.g. a per-request depth cap plus per-request rule+work-item dedupe), not just removing the guard.
- **External integrations** — Slack messages, webhooks, calling any third-party service. Real integration scope (auth, retries, failure handling for something outside Tasky's control); belongs to a future integration-focused sub-project, not this one.
- **Execution history / audit log / "test this rule" dry-run tooling.** No record of "this rule fired on this work item at this time" is persisted. Real scope (its own storage, its own UI) that nobody has asked for yet; sub-project 13 (Reporting) may eventually want an automation activity feed, but that's aggregation/viewing on top of data this sub-project doesn't yet produce.
- **Time-based / scheduled triggers** (e.g. "flag if a work item sits in a status for N days"). Needs a scheduler or cron, which doesn't exist in this app and is out of scope given this pass's fully synchronous, request-driven execution model.
- **`set_priority` action.** Same shape as `set_assignee` (a fixed scalar write), left out purely to keep the first action set no larger than the first trigger set. Trivial to add later.
- **Automated-change notifications.** Telling a user "this happened because of an automation rule" is sub-project 12 (Notifications)'s job once that delivery mechanism exists.
- **Rule templates / cross-project rule sharing.** Rules are deliberately project-scoped (unlike `Label`'s global scope); no mechanism to clone or reuse a rule across projects in this pass.
