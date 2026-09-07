# Tasky — codebase conventions

## Layout

| Path | What |
|---|---|
| `config/` | settings, root urlconf, wsgi/asgi |
| `accounts/` | custom `User`, auth endpoints, Site Admin user management |
| `projects/` | `Project`, `ProjectMembership`, `Invitation`, the role permission matrix |
| `boards/` | everything else — 17 models, all board/work-item/workflow logic |
| `ui/` | production SPA (vanilla JS). `ui/index.html` doubles as the Django template |
| `design/` | signed-off prototype. Opened as a file, no server |
| `deploy/apache/` | reverse proxy image and vhost for tasky.tailwebs.com |
| `docs/` | `api.md` is the contract; `follow-ups.md` has deliberate non-goals |
| `tests/` | cross-cutting tests (settings guard, SPA routing, smoke) |

`boards` is deliberately large. Do not split it without a migration plan —
the models are densely cross-referenced.

## Naming

- Models: singular PascalCase (`WorkItem`, `ProjectMembership`, `AutomationRule`)
- The card model is **`WorkItem`**, renamed from `Card`. Some older docs and the
  mock store still say "card"; the API and models say work item.
- DRF viewsets: `<Model>ViewSet`. Plain views: `<Thing>View`.
- Routes are kebab-case plural: `/api/work-items/`, `/api/automation-rules/`
- Nested resources put the parent in the path even on detail routes:
  `/api/projects/{project_pk}/components/{pk}/`
- Test files: `test_<area>.py`, one per feature area, under `<app>/tests/`

## Where logic lives

**`boards/services.py` is the business-logic layer.** Views stay thin; anything
involving a transaction, a lock, or a rule lives here:

| Function | Responsibility |
|---|---|
| `move_work_item` | Column move — locks and renumbers the whole column |
| `schedule_work_item` | Sprint/backlog move |
| `next_position` / `next_backlog_position` | Position allocation |
| `seed_default_statuses` / `resolve_default_status` | Workflow presets |
| `resolve_labels` / `label_color_for` | Implicit label creation, hashed colour |
| `custom_fields_*` / `apply_custom_fields` / `field_value_error` | Custom field read/write/validate |
| `import_work_items_from_csv` | Per-row CSV import |

**`boards/automation.py`** is the rules engine. It runs **inline** inside the
same request that created or moved the item — there is no queue and no worker.
Entry points: `evaluate_work_item_created`, `evaluate_status_changed`.

## Permission pattern

Three layers, and they are intentionally distinct:

1. **Pure functions** in `projects/permissions.py` (`can_invite`, `can_remove`,
   `can_change_role`, …). These mirror the spec's matrix **and
   `design/js/logic.js`** exactly, so the three stay in lockstep. Change one,
   change all three.
2. **`IsProjectMember`** — object-level only (`has_object_permission`). Because
   it only ever sees objects the queryset already found, a genuinely missing id
   404s before it runs. That is what makes "found, but not yours" a 403 rather
   than a leaked 404.
3. **`IsSiteAdmin`** (`accounts/permissions.py`) — view-level
   (`has_permission`), because every `/api/admin/users/` route needs the same
   check regardless of target id.

## Concurrency

Two places take real database locks, both inside `transaction.atomic()`:

- **Key allocation** locks the `Project` row before incrementing
  `next_item_number`. A duplicate key would be a genuine correctness bug.
- **`move_work_item`** takes its lock **before** reading the item's old column.
  Reading first was a real bug that left permanent gaps in ordering when two
  people dragged the same card. Fixed, and pinned by two regression tests.

There are **no threaded concurrency tests**, by choice — they are flaky against
a shared host MySQL. The bug class is covered by deterministic simulations.

## Adding a feature — the checklist

This repo has a **hard two-phase rule** (see `CLAUDE.md`). Do not skip it.

1. Write or read the spec in `docs/superpowers/specs/`.
2. **Phase 1** — build the screen in `design/` (vanilla JS, mock store enforcing
   the real rules). Get sign-off **in the user's own words**.
3. **Phase 2** — write the implementation plan in `docs/superpowers/plans/`.
4. Model + migration. Migrations are numbered and sequential; `boards` is at 31.
5. Serializer, then viewset, then URL.
6. Business logic into `boards/services.py`, not the view.
7. Tests in `<app>/tests/test_<area>.py`. The suite is the safety net — 554
   tests, 98% coverage. Keep it there.
8. Document the endpoint in `docs/api.md`.
9. Wire it into `ui/` — `api.js` (transport), `logic.js` (pure rules),
   `app.js` (views). **This step is where the project is behind.**

## Front-end structure (both `ui/` and `design/`)

Four files, and the split is load-bearing:

| File | Rule |
|---|---|
| `logic.js` | **Pure. No DOM, no network.** Grouping, overdue rules, permission checks |
| `store.js` | Mock data source. Enforces the same rules the server does |
| `api.js` | Real data source. **Same interface as `store.js`** |
| `app.js` | Views, hash routing, drag and drop, wiring |

`app.js` picks `store` or `api` at boot from `?data=`, with automatic fallback
when the API is unreachable. Nothing above that line knows which is in play —
keep it that way.

Assets live in `ui/static/`, not `ui/`, so the one absolute path
`/static/js/app.js` resolves identically under Django and under VS Code's Live
Server. **Moving them breaks Go Live.**

## Background work

None. No Celery, no cron, no scheduled jobs, no workers, no Redis. Automation
rules run inline. If you are about to add a queue, that is a new dependency and
an architecture decision, not an implementation detail.

## Storage

Attachments go to local disk (`MEDIA_ROOT`), never an object store, and are
**never served statically**. `AttachmentViewSet.download` is the only path a
client can fetch a file through, so it enforces the same membership check as
every other endpoint. There is deliberately no `MEDIA_URL` route in `urls.py`.

## Things that look like bugs and are not

`docs/follow-ups.md` has a **deliberate non-goals** section covering three
things in `boards/services.py`. Read it before "fixing" that file.

Also: `position` is not contiguous. Gaps like `0, 2, 3` are normal after a
delete and are never corruption.
