# Known follow-ups

Carried out of the backend build (2026-07-30). Nothing here blocks the backend — each item was
considered and consciously deferred. Recorded so the next two plans don't rediscover them.

## Before the app is reachable by anyone

| Item | Why |
|---|---|
| **Rotate the dev superuser** | `admin` / `admin-dev-12345` was created during development. It lives in the dev database only — never committed — but must not survive onto a shared box. |
| **`seed_demo` creates known-password accounts** | The command now prints a warning naming its target database, but nothing technically prevents it running against a shared environment. Local use only. |

## Deployment plan

- `DEBUG=0`, `CSRF_TRUSTED_ORIGINS`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`
- `STATIC_ROOT` + `collectstatic` (absent by design — the React build lands in the UI plan)
- gunicorn worker tuning, the Apache reverse-proxy config, RDS connection and security groups
- Split `requirements.txt` so `pytest`/`pytest-django` don't ship in the production image
- `SECRET_KEY` is now guarded: with `DEBUG=0` and no key in the environment (or an empty one),
  the app refuses to start rather than silently using the committed development key.

## Security items judged low-risk for an internal tool

- **`POST /api/auth/login/` is not CSRF-protected.** DRF's `APIView.as_view()` is `csrf_exempt`, and
  `SessionAuthentication.enforce_csrf()` only runs when authenticating an existing session — which
  login never is. Exposure is login-CSRF (forcing a victim's browser into an attacker's session).
  Fix if wanted: `@method_decorator(csrf_protect, name="post")` on `LoginView`.
- **No login throttling.** Worth revisiting once the box is network-reachable.

## Deliberate non-goals — do not "fix" these

- **`next_position()` is intentionally unlocked.** Two concurrent creates into the same column can
  produce a duplicate position. This is benign *only* because `Card.Meta.ordering = ["position", "id"]`
  is a total order and `move_card` renumbers whole columns, so the first drag heals it. The reasoning
  is recorded in `boards/services.py`. Adding a lock is not the fix; **breaking either of those two
  properties is what would turn it into a bug.**
- **Card positions are not contiguous `0..n-1`.** Deleting the card at position 0 and creating a new
  one yields `1, 2, 3` — no concurrency involved. The guarantee is a *deterministic total order*,
  renormalised on every move. Gaps are expected and harmless. Renumber-on-delete was considered and
  rejected: nothing reads positions in a way contiguity would protect.
- **No concurrency tests.** Threaded tests against a shared host MySQL are flaky. The one real
  concurrency bug found in this build is pinned by two deterministic regression tests instead.
- **`assignee` on a card is not validated against project membership.** `GET /api/users/` (the assignee
  dropdown) returns every active user, unscoped by project — a card can be assigned to someone who isn't a
  member of that card's project. This was harmless before the Projects & Membership work (everyone could
  see every card); now that `MyTasksView` and card retrieval are project-scoped, that assignee silently
  can't see or open the card they were assigned. Left as-is deliberately: restricting `assignee` to project
  members was never requested by any spec or plan, and doing it now would need to touch existing tests that
  intentionally assign cards to non-members. Whoever picks up the "Work Item Hierarchy" sub-project should
  decide whether to close this.

## Known breakage from the Work Item Hierarchy rename

- **`ui/static/js/api.js` and `ui/static/js/store.js` still call `/api/cards/`.** The
  `/api/cards/` → `/api/work-items/` rename (Work Item Hierarchy sub-project) updated the
  backend and `docs/api.md` but not the UI, which now 403/404s on every card create, update,
  delete, move, and comment call. Recorded here so it isn't rediscovered as a mystery bug —
  the fix belongs to whichever sub-project next touches the UI for hierarchy.

## Known breakage from the Workflows backend (Statuses)

- **`design/js/store.js` and `ui/static/js/store.js` still send strings to `POST /api/work-items/{id}/move/`.** The
  move endpoint now requires `{status: <WorkItemStatus id>, position: <int>}` instead of
  `{status: "todo"|"in_progress"|"done", position: <int>}`. Any code sending the old string enum values will
  receive a 400 validation error. Recorded here so it isn't rediscovered as a mystery bug — the fix
  belongs to whichever UI sub-project next touches the move logic for board drag-and-drop.

## Carried out of the Custom Fields & Screens backend build (2026-08-18)

Nothing here blocks the backend — each item was considered during the final whole-branch review
and consciously deferred. The Critical (persisted-500-on-read) and Important findings from that
review were fixed before merge; these are what's left.

- **The `design/` Phase 1 prototype for this sub-project isn't committed anywhere yet.**
  `boards/services.py` and `docs/api.md` both carry "mirrors `design/js/logic.js`/`store.js`
  exactly" comments, but as of this backend build, `design/js/logic.js` and `design/js/store.js`
  contain no custom-fields code at all in any committed branch — the prototype exists only as
  uncommitted changes in the main checkout (it was signed off in chat the same day this plan was
  written). Merging this backend alone lands those "mirrors exactly" comments as unverifiable,
  dangling claims until the design commits land too. Confirm the design/ commits merge before or
  alongside this branch.
- **Stale docstrings in the early tasks' own tests.** `test_custom_fields_api.py` and
  `test_screens_api.py` each have a test whose docstring says "this task's `perform_destroy` has
  no in-use guard yet" — true when written (Tasks 1 and 2 deliberately shipped a guard-less
  `perform_destroy`, replaced by a later task once the model it needed to check existed), false
  by the time the branch merged (both guards are in place). Harmless, but confusing to a future
  reader who doesn't know the history.
- **`_reposition` (on `FieldOptionViewSet` and `ScreenFieldViewSet`) saves before validating
  `position`.** `perform_update()` calls `serializer.save()` first, then `_reposition()` second —
  a `PATCH {"required": true, "position": "abc"}` persists the `required` change and only then
  400s on the bad `position`. No test currently sends both fields in one request, so this hasn't
  surfaced. Fix if it matters: validate `position` before `serializer.save()`, or wrap
  `perform_update` in `transaction.atomic`.
- **A non-conforming `multiselect`/`checkbox` value silently clears the field instead of 400ing.**
  `is_blank_custom_value` treats any non-list as blank for multiselect and anything that isn't
  literally `True` as blank for checkbox — so `{"7": 5}` against an *optional* multiselect field
  validates as "blank" and silently deletes any existing value instead of being rejected. This
  cuts against the reject-rather-than-silently-drop convention the spec itself cites for other
  cases. Only reachable for optional fields (a required field would correctly 400 as missing).
- **Multiselect read order isn't guaranteed.** `WorkItemFieldValue` has no `Meta.ordering` and
  `custom_fields_read_map` doesn't sort, so a multiselect's array order in `custom_fields` can
  vary between reads even though `FieldOption.position` exists precisely to give options a
  stable order.
- **`CustomField`/`Screen`/their nested endpoints are readable by any authenticated user,
  regardless of project membership.** This is a deliberate plan decision (there's no project to
  scope a genuinely global resource to), not an oversight — but it's a documented divergence from
  the spec's general "non-member touches any field/screen endpoint → 403" error-table line, and it
  means a user who belongs to zero projects can still enumerate every custom field and screen name
  in the system. Worth an explicit product call before this matters (e.g. once fields start naming
  anything sensitive).
- **Coverage gaps left from individual task reviews**, all Minor and none blocking: no test for
  unauthenticated access to the nested `/api/fields/{id}/options/...` or
  `/api/screens/{id}/fields/...` routes; no test for a non-owner's PATCH/DELETE on
  `/api/screens/{id}/` itself; no test for a genuinely-missing project id 404ing on
  `/api/projects/{id}/screen-assignments/`; the spec's "a field/screen created by Project A's
  Owner is usable by Project B's *different* Owner" scenario is only tested with the same user
  owning both projects.
- **`PUT /api/projects/{id}/screen-assignments/` is a partial merge, not a full replace.** Only
  the item types present in the request body are touched; item types the body omits keep their
  existing assignment. `docs/api.md` documents this honestly, but it's worth flagging since "PUT"
  conventionally implies a full replace and the spec's `{epic, story, task, bug, subtask}` shape
  reads that way too. Deliberate choice (a client wanting to clear one assignment shouldn't have
  to resend all five) — not a bug.
- **`CustomFieldViewSet`'s queryset doesn't `select_related("created_by")`**, unlike
  `ScreenViewSet`'s three-levels-deep prefetch — `GET /api/fields/` costs one extra query per
  field to resolve `created_by`'s nested `UserSerializer`. Minor, `/api/fields/` is a small,
  infrequently-listed resource.
- **`POST`/`PATCH` on a single work item costs 1+N queries to build `custom_fields`** (N = that
  item's custom field count) when no prefetch cache is present on the instance — a side effect of
  the fix for the list-view N+1 regression above (the same read function now relies on a prefetch
  cache that only the three list/detail *querysets* populate, not a freshly-created or
  freshly-`.get_object()`'d single instance). Bounded by one item's field count, not list size, so
  it's a much smaller version of the problem it fixed — not worth its own fix unless work items
  routinely carry many custom fields.

## Carried out of the Workflows backend build (2026-08-21)

Nothing here blocks the backend — each item was considered during the final whole-branch review
and consciously deferred. The Critical (project-deletion crash) and Important (reachable KeyError,
silently-dropped composite index) findings from that review were fixed before merge; these are
what's left.

- **`seed_default_statuses`'s early-return dict is ambiguous when a project has 2+ statuses in the
  same default category.** If a project has two `todo`-category statuses, the dict returned keys
  both under `"todo"` — whichever was read last wins, not necessarily the lowest-position one.
  `resolve_default_status` doesn't have this problem (it explicitly queries the lowest-position
  status), so there's no live bug — `seed_demo` is the only direct consumer of the dict, and it only
  ever runs against fresh projects. Worth documenting as "one arbitrary status per category" or
  making it lowest-position-wins if another consumer appears.
- **`resolve_default_status`'s docstring is more conservative than what it actually does.** It reads
  as "tops up the `todo` category specifically," but the underlying `seed_default_statuses` call
  tops up *any* missing default category, not just `todo`. The code is more robust than documented,
  not a bug — just worth tightening the wording next time this function is touched.
- **A rejected status `PATCH` (bad `position`) can still commit a `name`/`category` change first.**
  `WorkItemStatusViewSet.perform_update` calls `serializer.save()` before `_reposition()` raises —
  inherited verbatim from sub-project 2b's `FieldOptionViewSet`/`ScreenFieldViewSet`, which have the
  identical ordering. Fix, if ever prioritized, belongs to whichever sub-project next touches all
  three call sites together: validate `position` before saving, or wrap `perform_update` in
  `transaction.atomic`.
- **No automated test proves the data migrations lose nothing.** The spec explicitly asks for this
  ("verify no data loss — every pre-migration `(work_item, status_string)` pair maps to the
  identical status after migration"); the implementer's live spot-check against the dev database
  isn't repeatable. This codebase has no migration-test precedent anywhere, so this is consistent
  with local norms rather than a lapse — but the spec did name it, so it's recorded here rather than
  silently dropped.
- **Reversing migrations `0019`/`0021` silently no-ops instead of raising.** Rolling back past
  `0022` would re-create a plain `status` CharField and flatten every work item back to a fresh
  `"todo"` default, with no error to signal the data shape was lossy going backward. Only relevant
  to a rollback scenario, not the forward path this branch ships — but worth raising instead of
  no-op'ing if a rollback is ever actually attempted.
- **`docs/api.md` doesn't mention that `WorkItemSummarySerializer` (used by `parent_detail` and
  `GET /api/work-items/{id}/children/`) gained a `status_detail` field.** Also worth a line
  clarifying that the spec's "genuinely nonexistent status id → 404" applies to the
  `/api/projects/{id}/statuses/{id}/` routes specifically — a bad status id in a work-item body
  field correctly 400s instead, since it's a field-level validation error, not a missing resource.
- **`Project.delete()`'s override (added to fix the PROTECT/CASCADE deletion crash) only covers
  instance-level deletes**, not a hypothetical bulk `Project.objects.filter(...).delete()` — Django
  doesn't call `.delete()` per-instance for a queryset bulk delete, so such a call would bypass the
  override and hit the same `ProtectedError` this build just fixed. No such call site exists
  anywhere in the codebase today; recorded so whoever adds one first knows to check this.

## Local development note

This machine's `.env` uses `MYSQL_PORT=3307` because a second MySQL occupies 3306. `.env.example`
keeps the conventional 3306 — adjust per machine.
