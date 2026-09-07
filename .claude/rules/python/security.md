# Django security rules

## Settings that must not regress

`config/settings.py` reads these from the environment:

| Setting | Production |
|---|---|
| `DEBUG` | `0` |
| `SECRET_KEY` | required — startup **fails** without it when `DEBUG=0` |
| `CSRF_TRUSTED_ORIGINS` | `https://tasky.tailwebs.com` |
| `SESSION_COOKIE_SECURE` / `CSRF_COOKIE_SECURE` | `True`, defaulting to `not DEBUG` so forgetting fails closed |
| `SECURE_PROXY_SSL_HEADER` | set **only** when `DJANGO_BEHIND_PROXY=1` |
| `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS` | on |
| `X_FRAME_OPTIONS` | `DENY` |

`SECURE_PROXY_SSL_HEADER` is gated on purpose: if Django were ever exposed
directly, a client could forge `X-Forwarded-Proto` and claim https on a
plaintext connection. Only enable it where something upstream really does
terminate TLS.

`CSRF_COOKIE_HTTPONLY = False` is required — `ui/static/js/api.js` reads the
cookie to send `X-CSRFToken`. The token is not a secret; `SameSite=Lax` is what
stops a cross-site page using it.

Verify with `make check-deploy`.

## ORM

- Use the ORM. There is no raw SQL in this codebase; do not introduce it without
  a stated reason and parameterised values.
- Watch for N+1 — several were fixed during the build (`release_detail`,
  `my-tasks`). Use `select_related` / `prefetch_related` on any list endpoint.

## Never

- Never `permission_classes = []` without a commented reason.
- Never run `seed_demo` against a shared database — it creates accounts with a
  password committed to this repo.
- Never log a password, session key, or token.
