# Tasky — working agreement

Internal team Kanban and issue tracker — a Jira clone with the parts we actually
use. Django + DRF + MySQL, with a vanilla-JS front end Django serves directly.

## File layout

| Path | Purpose |
|---|---|
| `.claude/memory/` | Auto-loaded project intelligence — read these first |
| `.claude/rules/` | Standing rules for working in this repo |
| `.claude/tailwebs-profile.json` | Committed setup record (archetype, phases) |
| `docs/api.md` | **The API contract.** Read before any client code |
| `docs/follow-ups.md` | Deferred work **and deliberate non-goals** |
| `docs/deployment.md` | Go-live runbook, post-deploy verification, rollback |
| `docs/superpowers/specs/` | Per-sub-project design specs |
| `docs/superpowers/plans/` | Executed implementation plans |

Memory files: `feature-menu-map.md` (every screen and route),
`user-flows.md` (journeys, permissions, state rules),
`brand-guidelines.md` (colours, type, the left-edge rule),
`project-tasky-conventions.md` (where logic lives, how to add a feature),
`project-tasky-dev-setup.md` (machine setup and macOS gotchas).

---

## Status

**Design signed off: 2026-08-05.** Phase 2 is unlocked, and sub-projects 1–11
have shipped backends. Sign-off is **per sub-project**, not once for the project.

The live gap is the **production UI**: `ui/` implements 6 screens, `design/`
defines 11, and the backend supports all 11. Roughly ten sub-projects' worth of
tested API surface is not reachable from the app.

## HARD RULE — design is signed off before development starts

**Do not begin product development until the design has been explicitly signed
off by the user.**

This is not a preference or a default that can be reasoned around. It holds even when:

- the design "looks obviously right" and building it seems faster
- a plan or spec already exists and appears approved
- the user asks for a feature that would be quick to just build
- an earlier session left scaffolding or a partial implementation in place

**What counts as sign-off:** the user saying, in their own words, that the design
is approved / signed off / good to build. Nothing else counts. Not silence, not
"ok" to an unrelated question, not a skill's internal approval gate, not your own
judgement that the design is complete.

**If you are unsure whether sign-off has happened, it has not.** Ask.

### The two phases

**Phase 1 — Design.** Plain HTML and vanilla JavaScript in `design/`. No
frameworks, no build step, no package manager. Every screen, with the business
logic expressed in vanilla JS so the flows are real and clickable rather than
static pictures. This phase exists so the product can be seen and corrected cheaply.

**Phase 2 — Development.** Only after sign-off. The production implementation.

> Sub-projects 1–11 are already signed off and shipped. **Wiring an
> already-signed-off sub-project into `ui/` is Phase 2 work on an approved
> design, not new design work.** Sub-projects 12 and 13 have specs but no
> prototype, so they are still behind the gate.

## The UI is vanilla JS, on purpose

`ui/` is the production front end: plain HTML, CSS and JavaScript, served
directly by Django. **There is no build step, no npm, no `node_modules`, no
framework.** Do not introduce one.

React was specced and planned earlier, then dropped in favour of shipping the
design that was actually signed off. Those documents are kept for the record and
marked superseded:

- `docs/superpowers/specs/2026-08-05-tasky-ui-design.md`
- `docs/superpowers/plans/2026-08-05-tasky-ui.md`

**They do not describe the current UI.** Read `ui/README.md` instead.

---

## Backend facts that bite

The API is documented in `docs/api.md`. Read it before writing any client code.
These cause bugs if missed:

- **Unauthenticated calls return `403`, never `401`.**
- **`status` and `board` cannot be changed via `PATCH`** on
  `/api/work-items/{id}/`. Column moves go only through
  `POST /api/work-items/{id}/move/`. `item_type` and `key` are rejected too.
- **`GET /api/boards/{id}/work-items/` interleaves all columns** in one
  position-ordered list. The client groups by `status` itself.
- **`position` is not contiguous.** Gaps like `0, 2, 3` are normal after a
  delete and must never be treated as corruption.
- **`403` is ambiguous** — it means both "session expired" and, legitimately,
  "you may not delete another person's comment". Do not treat every 403 as a
  logout. `ui/static/js/api.js` disambiguates by re-checking `/api/auth/me/`.
- **A missing id returns 404**; existence is checked before membership.

## Do not "fix" these

`docs/follow-ups.md` has a **deliberate non-goals** section covering three things
in `boards/services.py` that look like bugs and are not. Read it before touching
that file.

---

## Running it

**Docker Desktop**, and MySQL 8.4 running natively on the Mac. (Older docs said
Colima and port 3307 — both were a previous developer's machine, corrected
2026-09-07.)

```bash
make               # list every target
make run           # http://localhost:8000
make test          # 554 tests, ~3 min
make migrate
make stage-up      # local server, staging RDS database
make deploy-prod   # tasky.tailwebs.com — prompts first
```

`MYSQL_HOST` must be `host.docker.internal`, not `localhost`. `make restart`
after editing `.env` — the container reads it at start. Keep generated secrets
URL-safe: the default `.env` is also Docker Compose's substitution file, so a
`$` in a value is interpolated away.

## Git

**`main` and `stage` receive code through a pull request only** — no direct
commits or pushes, however small the change. Branch off the branch you are
merging back into. Full rules in `.claude/rules/common/git-workflow.md`.

`main` deploys to production, `stage` to staging (`stage` does not exist yet).
`make deploy-prod` and `make deploy-stage` refuse to run on the wrong branch or
a dirty tree, because the image is built from the working directory.

## Environments

`.env` (local), `.env.stage` (this Mac, staging RDS), `.env.prod` (the server).
All gitignored; templates in `docs/.env.*.example`. Selected with `ENV_FILE`,
never guessed from the host.

## Development commands

Everything runs through `make` — see `make help`. Test tooling lives in
`requirements-dev.txt` and is installed only when the image is built with
`INSTALL_DEV=1`, which `docker-compose.yml` does and `docker-compose.prod.yml`
does not. **Test packages are not removed — they are excluded from the
production image only.**

## Key conventions

- Business logic goes in `boards/services.py`, not in views.
- The permission matrix exists in three places that must stay in lockstep:
  the spec, `projects/permissions.py`, and `design/js/logic.js`.
- Front end splits four ways: `logic.js` (pure — no DOM, no network),
  `store.js` (mock), `api.js` (real, same interface), `app.js` (views).
  `app.js` picks store or api at boot; nothing above that line knows which.
- Assets live in `ui/static/`, not `ui/`, so `/static/js/app.js` resolves under
  both Django and VS Code Live Server. Moving them breaks Go Live.
- The SPA catch-all in `config/urls.py` is registered **last** on purpose.
- The card model is `WorkItem` (renamed from `Card`). Some older docs still say
  "card".
- No background jobs, no queue, no cron, no email, no push. Automation rules run
  inline in the request. Adding any of these is an architecture decision.
- Attachments are on local disk and never served statically — `AttachmentViewSet.download`
  is the only path, so it can enforce membership.
