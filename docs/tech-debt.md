# Tech debt

Observed 2026-09-07 while running the app and reading the code. Complements
`docs/follow-ups.md`, which holds the *deliberate* non-goals — do not confuse
the two. Nothing here is a deliberate non-goal.

## 1. The production UI is ~10 sub-projects behind the backend

The largest single item. `ui/` implements 6 screens; the signed-off prototype in
`design/` defines 11, and the backend supports all 11 with passing tests.

Not reachable from the production app today: custom fields and screens, labels,
search, sprints and backlog, releases, attachments, site admin, project
templates, automation, bulk operations, CSV import, project archiving, and
status management (`ui/` reads statuses but cannot edit them).

`ui/static/js/api.js` is the clearest measure — it defines no client method for
any of those endpoints. `design/js/app.js` is 3,207 lines; `ui/static/js/app.js`
is 1,464.

## 2. Documentation drift, now corrected

Fixed on 2026-09-07. Recorded because the same drift will recur, and because the
shape of it is worth recognising: every one of these files was accurate when
written and silently rotted as the backend moved on.

- `README.md` claimed the UI was React and not yet built.
- `docs/handover.md` said the repo had never been pushed and the backend branch
  was unmerged; it has a GitHub remote and 152 commits on `main`. It also
  reported 92 tests against an actual 556. **Deleted.**
- `docs/project-status.md` said 260 tests and listed Workflows, Labels, Search,
  Sprints, Releases, Attachments, Permissions, Project Types and Automation as
  unbuilt. All nine had shipped. **Deleted.**
- `CLAUDE.md`, `README.md` and `docs/handover.md` all said Docker here is Colima
  on port 3307. This machine runs Docker Desktop and MySQL on 3306.

Both status-style documents were removed rather than corrected. They duplicated
what `README.md` and `design/README.md` already state, and a second place to
record status is exactly what let the first one drift. **`design/README.md` is
the sub-project register; `README.md` carries overall status.** Do not
reintroduce a third.

## 3. Security gaps that are real

Also listed in `docs/follow-ups.md`:

- The login endpoint is **not CSRF-protected** and has **no throttling** — it is
  brute-forceable.
- **Assignee is not validated against project membership** — a user can be
  assigned a work item in a project they cannot see.
- **Custom fields and screens are readable by any authenticated user**, including
  one belonging to zero projects.
- **Project archiving is visibility-only.** An archived project stays fully
  editable; it merely drops out of the default list.
- The original `admin` superuser has never been rotated.

## 4. No type annotations

The codebase has none, so mypy is not configured — turning it on today would
produce thousands of findings. `pyproject.toml` says so explicitly rather than
hiding it behind a permissive config.

## 5. Formatting is not enforced

`ruff format --check` would reformat 69 of 144 files. The lint gate is enforced;
the formatter is opt-in via `make format`. Adopting it is a one-off large diff
someone should choose deliberately.

## 6. Four functions exceed the complexity limit

Carrying `# noqa: C901` with stated reasons: `WorkItemSerializer.validate`,
`import_work_items_from_csv`, `bulk_update`, `SearchView.get`. All are
well-tested. Worth splitting when one of them next needs a change.

## 7. Ruff version skew

The `PostToolUse` hook runs the host's ruff (0.9.2); CI and the container use
the `>=0.8,<1.0` range (0.16.6 today). The hook is advisory and non-blocking, so
this is cosmetic — but a finding could differ between the two.

## 8. Sub-projects 12 and 13 are spec-only

Notifications and Reporting & Dashboards have specs but no prototype, so they
are still behind the two-phase design gate. Notifications in particular would be
the project's first background-work dependency — there is no queue today.
