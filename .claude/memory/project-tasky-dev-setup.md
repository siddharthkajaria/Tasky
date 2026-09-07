# Tasky — development setup

## The stack on this machine (verified 2026-09-07)

| Thing | Reality |
|---|---|
| Container runtime | **Docker Desktop** (`context: desktop-linux`). Colima is **not** installed |
| MySQL | **8.4.6**, Oracle build at `/usr/local/mysql`, running natively on the Mac |
| Local DB | `tasky_dev`, user `root`, `127.0.0.1:3306` |
| Python | 3.12-slim, inside the container only — there is no local venv |

> Older docs said "Docker here is Colima" and "port 3307". Both were true for a
> previous developer's machine and are **not true here**. Corrected 2026-09-07.

## Clone to running

```bash
git clone git@github.com:nithin-tailwebs/Tasky.git && cd Tasky
cp docs/.env.local.example .env       # then fill in DJANGO_SECRET_KEY and MySQL creds
```

Create the database (MySQL must already be running):

```bash
mysql -h 127.0.0.1 -u root -p -e "CREATE DATABASE IF NOT EXISTS tasky_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Then:

```bash
make build
make migrate
make createsuperuser
make run                              # http://localhost:8000
```

## Daily commands

| Command | Does |
|---|---|
| `make` / `make help` | List every target |
| `make run` / `make run-d` / `make stop` | Start / background / stop |
| `make restart` | **Required after editing `.env`** — the container reads it at start |
| `make logs` | Follow logs |
| `make test` | Full suite — 554 tests, ~3 min |
| `make test-fast` | Stop at first failure |
| `make test-coverage` | Coverage report (currently 98%) |
| `make smoke` | Just `tests/` — settings guard, SPA routing, smoke |
| `make lint` / `make lint-fix` | ruff |
| `make migrate` / `make makemigrations` | Migrations |
| `make shell` / `make dbshell` | Django shell / MySQL shell |
| `make check-deploy` | Django's production readiness audit against `.env.prod` |

## Environments

Selected by `ENV_FILE`, never guessed from the host.

| Env file | Where it runs | Database |
|---|---|---|
| `.env` | this Mac, Docker, `runserver` | `tasky_dev`, MySQL on the Mac |
| `.env.stage` | this Mac, Docker | `tasky_stage` on RDS (`ap-south-1`) |
| `.env.prod` | the server, gunicorn + Apache | `tasky_prod` on RDS |

```bash
make stage-up            # local server, staging RDS database
make deploy-prod         # full production deploy — prompts first
```

All three are **gitignored**. Templates live in `docs/.env.*.example`.

## macOS-specific gotchas

1. **`MYSQL_HOST` must be `host.docker.internal`, not `localhost`.** Inside the
   container `localhost` is the container. `docker-compose.yml` sets
   `extra_hosts: host.docker.internal:host-gateway` to make this resolve.
2. **MySQL 8.4 dropped `mysql_native_password` from its default plugins.** An
   account created with that plugin fails with
   `ERROR 1524 (HY000): Plugin 'mysql_native_password' is not loaded`.
   Recreate the user with `caching_sha2_password`. This is why the old `tasky`
   MySQL user does not work; local dev uses `root` instead.
3. **MySQL must accept connections from the container.** If you switch off
   `root`, the app user needs `'user'@'%'` (the `%` matters — the container is
   not localhost) with grants on **both** the app database and the
   `test_<db>` one pytest-django creates.
4. **Editing `.env` needs `make restart`**, not just a reload — the container
   reads env at start.
5. **`$` in an env value breaks Docker Compose.** The default `.env` doubles as
   Compose's variable-substitution file, so `$` is interpolated away. Keep
   generated secrets URL-safe (`secrets.token_urlsafe`).

## Dev accounts

**Nothing is seeded.** Per the 2026-09-07 decision, `seed_demo` is not used —
production starts with fresh data and local accounts are made by hand:

```bash
make createsuperuser            # then create the rest in Django admin at /admin/
```

`boards/management/commands/seed_demo.py` still exists and still has tests, but
it creates accounts with a committed, well-known password. **Do not run it
against anything shared.** See `docs/dev-credentials.md`.

## Running the UI without a database

Append `?data=store` to any URL — `http://localhost:8000/?data=store` — to run
on the in-memory mock. A **Mock data** badge appears bottom-right. The same
fallback happens automatically when the API is unreachable.

`design/` needs no server at all: open `design/index.html` directly.

## Showing it to someone on the same Wi-Fi

```bash
ipconfig getifaddr en0                        # e.g. 192.168.1.42
```

Add that IP to `DJANGO_ALLOWED_HOSTS` in `.env`, then `make restart`. Use port
8000 (Django), **not** 5500 (Live Server) — proxying `/api` from a different
origin makes Django's CSRF check see an Origin mismatch and sign-in fails.

This is a development server with `DEBUG=1`. Fine across a desk; not something
to leave on a network you do not control.
