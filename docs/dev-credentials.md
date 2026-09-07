# Dev credentials

> ⚠️ **LOCAL DEVELOPMENT ONLY.** Nothing in this file may ever exist on staging
> or production. Production starts with fresh data and hand-made accounts.

## Test accounts

**None are seeded.** As of 2026-09-07 the team decided not to seed demo data.
Create what you need by hand:

```bash
make createsuperuser          # your own Site Admin
```

Then create teammates in Django admin at <http://localhost:8000/admin/> →
Accounts → Users. That is also how accounts are made in production — Tasky has
no public signup, no invite emails and no password reset.

| Role | How to get it |
|---|---|
| **Site Admin** | `is_staff = True` on the user. `make createsuperuser`, or tick "Staff status" in admin |
| **Project Owner** | Whoever creates a project. Exactly one per project, always |
| **Project Admin** | Owner promotes a member |
| **Project Member** | Owner/Admin invites an existing account; the invitee accepts |

## Account flags

| Flag | Meaning |
|---|---|
| `is_active` | Off = login refused, with the **same generic message** as a wrong password. A deactivated account must not reveal it ever existed |
| `is_staff` | **Site Admin.** Manages user accounts, and can manage global resources (labels, fields, screens) without owning any project |
| `is_superuser` | Full Django admin. Implies nothing extra in the Tasky API — the app checks `is_staff` |

Guards worth knowing: a Site Admin cannot deactivate or de-staff **themselves**,
and the **last** Site Admin cannot be revoked.

## `seed_demo` — exists, do not use

`boards/management/commands/seed_demo.py` creates demo projects, boards, work
items and the accounts `asha` / `kabir` / `lena` with the password `password`,
committed in the repo.

It is kept because it has tests and is useful for throwaway UI work. It is
**not** part of any setup path here.

- Never run it against staging, production, or any shared database.
- Nothing technically prevents that today — it is a documented risk in
  `docs/follow-ups.md`, not an enforced one.

## Before production is reachable by anyone

- [ ] No `seed_demo` accounts anywhere
- [ ] The `admin` superuser from the original build is gone or rotated — it
      still carries a development password
- [ ] `.env.prod` has a real `DJANGO_SECRET_KEY` (settings refuses to start
      without one when `DEBUG=0`)
- [ ] The RDS password shown in a terminal during setup on 2026-09-07 has been
      rotated
- [ ] `make check-deploy` is clean
