# Tasky — the UI

Plain HTML, CSS and vanilla JavaScript. No framework, no build step, no package
manager, no `node_modules`. Django serves this directory directly.

The design was signed off on 2026-08-05 and this is now the production UI.

## Run it

```bash
docker compose up
```

Then open http://localhost:8000 and sign in. Local accounts come from:

```bash
make createsuperuser        # then create teammates in Django admin at /admin/
```

Demo data is **not** seeded — see `../docs/dev-credentials.md`. `seed_demo`
still exists but now refuses any database that does not look local, because it
creates accounts with a password committed to this repository.

## Run it from VS Code's "Go Live"

`.vscode/settings.json` configures the Live Server extension, so the Go Live
button in the status bar opens the UI in Chrome at http://127.0.0.1:5500 with
live reload.

It serves `ui/` as its root and proxies `/api` to Django on :8000, so:

- **Django running** → real data, real sign-in, live reload on save
- **Django not running** → the UI falls back to the mock store by itself and
  shows a *Mock data* badge

This is why assets live in `ui/static/` rather than `ui/`: it makes the one
absolute path `/static/js/app.js` resolve identically under Live Server and
under Django. Move them and Go Live breaks.

## Show it to someone on the same Wi-Fi

Django's port is already published on all interfaces, but `ALLOWED_HOSTS` will
reject a request that arrives by IP until you add that IP.

```bash
ipconfig getifaddr en0          # e.g. 192.168.1.42
```

Put it in `.env` (which is gitignored, so this stays on your machine):

```
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.42
```

Then `docker compose up -d --force-recreate` — the container reads `.env` at
start, so a plain restart is not enough. Your colleague opens
**http://&lt;that-ip&gt;:8000**.

**Your router will hand out a different address eventually** — when the link
stops working, that is almost always why. Re-check the IP and update `.env`.

Use port 8000 (Django), not 5500 (Live Server). Live Server proxying `/api`
from a different origin makes Django's CSRF check see a mismatch between the
browser's `Origin` and the proxied host, and sign-in fails. Going straight to
Django keeps it genuinely same-origin.

⚠️ **This is a development server.** `DEBUG=1` shows tracebacks to anyone who
triggers an error, and the `admin` superuser has never been rotated (see
`../docs/follow-ups.md`). Fine for showing a colleague across the desk; not
something to leave running on a network you do not control, and not a substitute
for deploying properly — `make deploy-stage` runs the real gunicorn/Apache stack
if you want a faithful preview.

## Run it without a database

Append `?data=store` to any URL — http://localhost:8000/?data=store — and the UI
runs on a seeded in-memory mock instead of the API. Sign in as `asha` with any
password. A **Mock data** badge appears bottom-right so the two are never
confused.

The same fallback happens automatically if the API cannot be reached at all, so
the UI degrades to something reviewable rather than a dead screen.

## Files

| File | What it is |
|---|---|
| `index.html` | The shell and every screen's markup, as `<template>` blocks |
| `css/app.css` | The whole visual system |
| `js/logic.js` | **Business logic — pure, no DOM, no network.** Grouping, the optimistic move, overdue rules |
| `js/store.js` | Mock data source. Enforces the same server rules the real API does |
| `js/api.js` | Real data source against the live Django API. Same interface as the store |
| `js/app.js` | Views, hash routing, drag and drop, wiring |

`store.js` and `api.js` implement the same interface, so nothing above them knows
which is in play. `app.js` picks one at boot from the `?data=` parameter, with
the automatic fallback described above.

Django serves this directory via `STATICFILES_DIRS`, and `index.html` doubles as
the template the SPA catch-all route renders. Asset paths are absolute
(`/static/js/app.js`) so a deep link like `/boards/3` resolves them correctly
after a refresh.

## The design

**Colour is attention.** Only In Progress is saturated. To Do stays neutral and
Done recedes — so the board tells you where attention belongs before you read a
word of it.

**The left edge rule.** Each card carries a vertical rule on its left edge.
Its *thickness* is priority (1px low, 2px medium, 4px high) and its *colour*
turns red when the card is overdue. One device carries two dimensions and stays
legible in a dense column, which a row of coloured dots does not.

**Monospace for data.** Every date, count and id is monospace. The audience is
engineers and aligned digits genuinely scan faster in a list. It is functional,
not stylistic.

## Behaviours that bite

These are the awkward parts of the API contract. The mock store enforces every
one of them too, so mock mode stays an honest model rather than a picture:

- Sign-in failure says the same thing for an unknown username and a wrong
  password — a different message would let anyone enumerate who works here
- Changing a card's `status` through the edit form is **rejected**; columns
  change only by dragging
- A failed drag springs the card back to exactly where it was
- Deleting someone else's comment is refused, and that refusal does **not**
  sign you out
- `GET /boards/{id}/cards/` returns all three columns interleaved in one list;
  the client groups them
- Card positions are not contiguous, and gaps are never treated as corruption

## Not built *here* — but built on the server

This is the important gap, and it is not the same as "out of scope". The backend
has shipped sub-projects 1–11 with passing tests, and the signed-off prototype in
`../design/` covers all of them. **This directory covers 6 screens of 11.**

Reachable only in `../design/`, never in production:

custom fields and screens · labels · cross-project search · sprints and backlog ·
releases · attachments · site admin · project templates · automation ·
bulk operations · CSV import · project archiving · status management (this UI
*reads* per-project statuses but cannot edit them)

`static/js/api.js` is the honest measure — it defines no client method for any of
those endpoints. Wiring them up is Phase 2 work on an already-approved design, so
it is not behind the design gate.

Genuinely not built anywhere: notifications and reporting (sub-projects 12 and
13, spec-only), activity history, per-board permissions, and password reset.
Teammates' changes appear on refresh; there is no realtime.
