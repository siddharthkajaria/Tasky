# Security rules

## Secrets

- **Never commit a secret.** `.env`, `.env.stage`, `.env.prod` are gitignored;
  templates live in `docs/.env.*.example` with placeholder values only.
- Generate keys with `secrets.token_urlsafe(64)`. **Not** Django's
  `get_random_secret_key()` — it can emit `$`, and the default `.env` doubles as
  Docker Compose's substitution file, so a `$` is interpolated away and Django
  silently receives a mangled key.
- TLS material in `deploy/apache/certs/` is gitignored. Database dumps in
  `backups/` are production data — never commit them.
- `config/settings.py` refuses to start when `DEBUG=0` and `DJANGO_SECRET_KEY`
  is unset, rather than silently signing sessions with the committed dev
  fallback. Do not soften that guard.

## Access control

- Every endpoint is `IsAuthenticated` by default (`REST_FRAMEWORK` defaults).
  Do not set `permission_classes = []` without an explicit, commented reason.
- Membership checks go through `IsProjectMember` (object-level) so a missing id
  404s before the check runs. Do not replace it with a queryset filter that
  turns "not yours" into a 404 — the distinction is deliberate.
- Site Admin checks go through `IsSiteAdmin` (`accounts/permissions.py`).
- The permission matrix lives in **three places that must stay in lockstep**:
  the spec, `projects/permissions.py`, and `design/js/logic.js`.

## Input

- Validate in serializers or `boards/services.py`, never in the view body.
- Attachments are never served statically. `AttachmentViewSet.download` is the
  only fetch path so it can enforce membership. Do not add a `MEDIA_URL` route.
- CSV import is capped at 500 rows and validates per row.

## Auth responses

- Sign-in failure returns the **same message** for an unknown username, a wrong
  password, and a deactivated account. Do not make them distinguishable — that
  would let anyone enumerate who works here.
- Unauthenticated → **403, never 401**.

## Known gaps — do not add to them

Tracked in `docs/follow-ups.md` and `docs/dev-credentials.md`:

- The login endpoint is not CSRF-protected and has no throttling.
- Assignee is not validated against project membership.
- Custom fields and screens are readable by any authenticated user.
- Project archiving is visibility-only, not a write-block.
