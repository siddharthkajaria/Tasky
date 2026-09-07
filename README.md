# Tasky

An internal team Kanban and issue tracker — a Jira clone with the parts we
actually use, self-hosted on our own infrastructure at
**tasky.tailwebs.com**.

Multi-project, with a work item hierarchy, configurable per-project workflows,
custom fields and screens, labels, components, releases, sprints and a backlog,
cross-project search, attachments, bulk operations, CSV import and an inline
automation engine.

**Status (2026-09-07):** the backend is complete for sub-projects 1–11 —
554 tests, 98% coverage. The production UI covers 6 screens of the 11 the
approved prototype defines, so a large amount of shipped, tested API surface is
not yet reachable from the app. See [Where it stands](#where-it-stands).

## Stack

| Layer | Choice |
|---|---|
| Platform | Web app, server-rendered shell + hash-routed SPA |
| Language | Python 3.12 |
| API | Django 5.2 + Django REST Framework 3.16 |
| UI | **Plain HTML, CSS and vanilla JavaScript.** No build step, no npm, no framework |
| Database | MySQL 8.4 — native on the Mac for dev, RDS (`ap-south-1`) for staging and production |
| Auth | Django session cookies, same origin. No tokens, no CORS |
| Runtime | Docker. `runserver` locally, gunicorn in production |
| Proxy | Apache in a container, behind Cloudflare (proxied, Full-strict TLS) |
| Tests | pytest + pytest-django + pytest-cov |
| CI | GitHub Actions |
| Background jobs | **None.** No Celery, no cron, no Redis. Automation runs inline |
| Email / push | **None.** Tasky sends no notifications of any kind |
| File storage | Local disk, served only through a permission-checked view |

React was specced and planned early on, then dropped in favour of shipping the
design that was actually signed off. Those two documents are kept for the record
and marked superseded — they do **not** describe this UI.

## Layout

```
tasky/
├── Makefile                    # the developer interface — start here
├── Dockerfile                  # app image; test tooling is a build-arg opt-in
├── docker-compose.yml          # local dev (runserver)
├── docker-compose.prod.yml     # gunicorn + Apache
├── requirements.txt            # runtime deps
├── requirements-dev.txt        # test/lint deps — never in the prod image
├── pytest.ini
├── config/                     # settings, urls, wsgi
├── accounts/                   # custom User, auth, Site Admin management
├── projects/                   # Project, membership, invitations, role matrix
├── boards/                     # work items, workflows, sprints, releases,
│                               #   labels, fields, automation, attachments
├── ui/                         # PRODUCTION front end (vanilla JS)
│   ├── index.html              #   the SPA shell — also the Django template
│   └── static/{css,js}/
├── design/                     # signed-off prototype — open index.html directly
├── deploy/apache/              # reverse proxy image, vhost, Cloudflare IP ranges
├── docs/
│   ├── api.md                  # THE API CONTRACT — read before any client work
│   ├── follow-ups.md           # deferred work + deliberate non-goals
│   ├── dev-credentials.md
│   └── .env.*.example
└── tests/                      # cross-cutting: settings guard, SPA routing, smoke
```

## First-time setup

Requires Docker and a MySQL 8.4 server running on the host.

```bash
git clone git@github.com:nithin-tailwebs/Tasky.git && cd Tasky

cp docs/.env.local.example .env
# Fill in DJANGO_SECRET_KEY and your MySQL password. Generate a key with:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"

mysql -h 127.0.0.1 -u root -p \
  -e "CREATE DATABASE IF NOT EXISTS tasky_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

make build
make migrate
make createsuperuser
make run
```

Open <http://localhost:8000>. Django admin is at `/admin/`.

> **`MYSQL_HOST` must be `host.docker.internal`, not `localhost`.** Inside the
> container `localhost` is the container. See
> [`.claude/memory/project-tasky-dev-setup.md`](.claude/memory/project-tasky-dev-setup.md)
> for the rest of the macOS gotchas, including the MySQL 8.4
> `mysql_native_password` failure.

## Environment configuration

Which environment a command acts on is set by `ENV_FILE` — never guessed.

| Variable | Local | Staging | Production |
|---|---|---|---|
| `DJANGO_SECRET_KEY` | any URL-safe random string | ✅ required | ✅ required — app refuses to start without it |
| `DJANGO_DEBUG` | `1` | `0` | `0` |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1,host.docker.internal` | `localhost,127.0.0.1` | `tasky.tailwebs.com` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `http://localhost:8000` | `http://localhost:8000` | `https://tasky.tailwebs.com` |
| `DJANGO_SECURE_COOKIES` | `0` | `0` | `1` |
| `DJANGO_BEHIND_PROXY` | `0` | `0` | `1` — trust `X-Forwarded-Proto` |
| `DJANGO_SECURE_SSL_REDIRECT` | `0` | `0` | `1` |
| `DJANGO_HSTS_SECONDS` | `0` | `0` | `31536000` |
| `MYSQL_HOST` | `host.docker.internal` | RDS endpoint | RDS endpoint |
| `MYSQL_DATABASE` | `tasky_dev` | `tasky_stage` | `tasky_prod` |

Files: `.env`, `.env.stage`, `.env.prod` — **all gitignored**. Templates in
`docs/.env.*.example`.

> Keep secrets URL-safe. The default `.env` doubles as Docker Compose's
> variable-substitution file, so a `$` in a value is interpolated away and
> Django silently receives a mangled key.

## Daily commands

```
make              list every target
make run          start (http://localhost:8000)      make stop      stop
make restart      recreate — required after editing .env
make logs         follow logs                        make ps        status
make test         full suite (554 tests, ~3 min)     make test-fast first failure
make test-coverage                                   make smoke     tests/ only
make lint         ruff                               make lint-fix  autofix
make migrate      make makemigrations                make shell     Django shell
make check-deploy Django's production readiness audit
```

Raw equivalents still work — `docker compose run --rm web pytest`.

## Running staging and production

**Staging** runs on a developer's own Mac against the staging RDS database.
There is no staging server.

```bash
make stage-migrate
make stage-up            # http://localhost:8000, DEBUG=0
```

**Production** is `tasky.tailwebs.com`: gunicorn behind Apache behind
Cloudflare. Only Apache is exposed; gunicorn is reachable only on the Compose
network, so nothing can bypass the proxy and forge `X-Forwarded-Proto`.

```bash
make deploy-prod         # prompts, then builds, migrates, collectstatic,
                         # restarts, and waits for a healthy response
make prod-logs
make prod-backup         # mysqldump to ./backups/
```

Before the first deploy, put a **Cloudflare Origin Certificate** in
`deploy/apache/certs/` — see
[that directory's README](deploy/apache/certs/README.md) — and set the zone's
SSL/TLS mode to **Full (strict)**. Refresh the trusted-proxy ranges with
`make cf-ips`.

## Architecture

- **Three Django apps.** `accounts` (custom `User`, auth, Site Admin),
  `projects` (projects, membership, invitations, the role matrix), `boards`
  (everything else — 17 models).
- **Business logic lives in `boards/services.py`**, not in views. Anything
  involving a transaction or a lock belongs there.
- **Two real database locks**, both inside `transaction.atomic()`: work item key
  allocation, and the column move. The move takes its lock *before* reading the
  old column — doing it the other way round was a real bug that left permanent
  gaps in ordering.
- **Permissions in three layers**: pure functions in `projects/permissions.py`
  that mirror the spec and `design/js/logic.js` exactly; `IsProjectMember`
  (object-level, so a missing id 404s before it runs); `IsSiteAdmin`
  (view-level).
- **Automation runs inline** in the same request — no queue, no worker.
- **The SPA catch-all** in `config/urls.py` is registered last on purpose;
  earlier it would swallow `/api/` and `/admin/`.
- **Front end splits four ways**: `logic.js` (pure), `store.js` (mock),
  `api.js` (real, same interface), `app.js` (views and wiring).

## API behaviours that bite

Read [`docs/api.md`](docs/api.md) before writing any client code.

1. Unauthenticated calls return **`403`, never `401`**.
2. `403` is ambiguous — it means both "session expired" and, legitimately, "you
   may not delete another person's comment". **Do not treat every 403 as a logout.**
3. `status` and `board` **cannot be changed via `PATCH`**. Column moves go only
   through `POST /api/work-items/{id}/move/`.
4. `GET /api/boards/{id}/work-items/` **interleaves all columns** in one
   position-ordered list. The client groups by `status` itself.
5. `position` is **not contiguous**. Gaps like `0, 2, 3` are normal after a
   delete and are never corruption.
6. A genuinely missing id returns 404; existence is checked before membership.

## Where it stands

| # | Sub-project | Backend | Prototype | Production UI |
|---|---|---|---|---|
| 1 | Projects & Membership | ✅ | ✅ | ✅ |
| 2a | Work Item Hierarchy | ✅ | ✅ | ✅ |
| 2b | Custom Fields & Screens | ✅ | ✅ | ❌ |
| 2c | Bulk Operations & Import | ✅ | ✅ | ❌ |
| 3 | Workflows | ✅ | ✅ | ⚠️ read-only |
| 4 | Labels | ✅ | ✅ | ❌ |
| 5 | Search | ✅ | ✅ | ❌ |
| 6 | Backlog & Sprints | ✅ | ✅ | ❌ |
| 7 | Releases | ✅ | ✅ | ❌ |
| 8 | Task Detail / Attachments | ✅ | ✅ | ❌ |
| 9 | Permissions & Site Admin | ✅ | ✅ | ❌ |
| 10 | Project Types & Templates | ✅ | ✅ | ❌ |
| 11 | Automation | ✅ | ✅ | ❌ |
| 12 | Notifications | ❌ | ❌ | ❌ |
| 13 | Reporting & Dashboards | ❌ | ❌ | ❌ |

Known gaps are tracked in [`docs/follow-ups.md`](docs/follow-ups.md). The
security items that must clear before the site is reachable are listed in
[`docs/dev-credentials.md`](docs/dev-credentials.md).

## Contributing

**`main` and `stage` take code through a pull request only** — never a direct
commit or push. Branch off whichever branch you intend to merge back into, as
`feat/<slug>`, `fix/<slug>` or `chore/<slug>`, then open a PR against it.

Run `make test` and `make lint` before opening the PR — both must be green.

A GitHub Actions workflow (`.github/workflows/ci.yml`) is committed but
**parked**: Actions is not working for this org yet, so it is `workflow_dispatch`
only and will not fire on push or PR. Uncomment the two trigger blocks to make
it live.

**This repo has a hard two-phase rule.** A sub-project ships a clickable
prototype in `design/` and gets signed off *in the user's own words* before any
production code is written for it. See [`CLAUDE.md`](CLAUDE.md).
