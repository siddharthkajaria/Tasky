# Deploying Tasky

Production is **tasky.tailwebs.com**. Everything runs in Docker on one box.

```
Browser ──https──► Cloudflare (proxied) ──► Apache :443 ──► gunicorn :8000 ──► RDS
                     orange cloud            container        container      ap-south-1
```

`main` deploys to production. `stage` deploys to staging, which runs on a
developer's Mac against the staging RDS database — there is no staging server.

---

## Ports — what is actually exposed

| Port | Published to the host? | Why |
|---|---|---|
| 8000 (gunicorn) | **No** — `expose:` only | Reachable only on the Docker network. Nothing can bypass Apache and forge `X-Forwarded-Proto` |
| 80 (Apache) | Yes | Cloudflare must reach the origin |
| 443 (Apache) | Yes | Same, once TLS is on |

**80 and 443 have to be published** or Cloudflare cannot fetch anything — a
"nothing exposed" origin is an unreachable origin. The control that matters is
the **EC2 security group**, not Docker:

```
Inbound  443/tcp  <- Cloudflare IPv4 + IPv6 ranges only
Inbound   80/tcp  <- Cloudflare IPv4 + IPv6 ranges only
Inbound   22/tcp  <- your office/VPN address only
Everything else   <- denied
```

Current ranges: `deploy/apache/cloudflare-ips.conf` (refresh with `make cf-ips`),
or <https://www.cloudflare.com/ips/>.

This matters more than usual here. `DJANGO_BEHIND_PROXY=1` makes Django trust
`X-Forwarded-Proto`, so anyone who can reach port 80 **directly** could claim
their plaintext request arrived over https. Locking 80/443 to Cloudflare is what
makes that assumption true.

---

## Go-live: port 80 first, then 443

Two phases, because the phase-1 config and the phase-2 config differ in one
variable. **Do not skip to phase 2 without a DNS record resolving** — you will be
debugging TLS and DNS at the same time.

### Phase 1 — HTTP only, Cloudflare "Flexible"

Proves DNS, the security group, the container stack and the database before TLS
is in the picture.

1. In Cloudflare DNS: `A` record `tasky` → the EC2 public IP, **proxied (orange
   cloud)**.
2. Cloudflare → SSL/TLS → Overview → **Flexible**.
3. In `.env.prod` on the server:
   ```
   TASKY_TLS=off
   DJANGO_SECURE_SSL_REDIRECT=0
   DJANGO_SECURE_COOKIES=1        # leave ON — see the note below
   DJANGO_BEHIND_PROXY=1          # leave ON — see the note below
   ```
4. `make deploy-prod`

> **Why `SECURE_COOKIES` and `BEHIND_PROXY` stay on in phase 1.** The *visitor's*
> connection is https even under Flexible — Cloudflare terminates it — and
> Cloudflare forwards `X-Forwarded-Proto: https`. Django therefore knows the real
> scheme and Secure cookies work correctly. Only `SECURE_SSL_REDIRECT` must be
> off: with `TASKY_TLS=off` Apache does not redirect, and Django must not either,
> or Cloudflare answers the redirect by fetching the origin over http again and
> you get an **infinite redirect loop** (`ERR_TOO_MANY_REDIRECTS`). That loop is
> the single most common way this go-live goes wrong.

### Phase 2 — HTTPS to the origin, Cloudflare "Full"

1. In `.env.prod`:
   ```
   TASKY_TLS=on
   DJANGO_SECURE_SSL_REDIRECT=1
   ```
2. `make deploy-prod`
3. Cloudflare → SSL/TLS → Overview → **Full**
4. `make prod-verify`

**No certificate step.** The proxy entrypoint generates a self-signed pair into
`deploy/apache/certs/` on first boot if none exists — that is exactly what
Cloudflare "Full" expects, since Full encrypts the origin hop without validating
the certificate. `make prod-certs` shows what is being served.

### Optional phase 3 — "Full (strict)"

Only if you want Cloudflare to *validate* the origin certificate:

1. Cloudflare → SSL/TLS → **Origin Server** → **Create Certificate**, hostname
   `tasky.tailwebs.com`.
2. Save the two files on the server as `deploy/apache/certs/origin.pem` and
   `origin.key`, `chmod 600` the key.
3. `make prod-down && make prod-up` — the entrypoint sees a real certificate and
   uses it instead of generating one.
4. Cloudflare → **Full (strict)**.

An Origin Certificate is trusted only by Cloudflare, which is the point: hitting
the origin IP directly in a browser *should* show a certificate error. Valid 15
years, so there is no renewal daemon. Let's Encrypt would not work here anyway —
port 80 only answers Cloudflare, so an HTTP-01 challenge cannot reach you.

---

## What `make deploy-prod` does

Refuses to start unless you are on `main` with a clean tree — the image is built
from the working directory, so an uncommitted edit would ship.

```
1/6  build images
2/6  makemigrations --check   (fails if a model changed with no migration)
3/6  migrate
4/6  collectstatic
5/6  up -d
6/6  poll for a healthy response (60s)
     prune build cache and dangling images
     run prod-verify
```

Then it runs the verification below automatically. **A green deploy already ran
these checks** — `make prod-verify` re-runs them any time.

---

## What to verify after a deploy

### Automatic — `make prod-verify`

| Check | Why it matters |
|---|---|
| both containers running | web + proxy |
| **gunicorn not published to the host** | catches an accidental `ports:` on `web`, which would let a client bypass Apache |
| SPA shell returns 200 | Django, templates and the catch-all route work |
| unauthenticated API returns **403, not 401** | this project's convention; a 401 means something changed |
| static served by **Apache** | `Server: Apache` — if gunicorn serves these, `collectstatic` or the alias broke |
| `DEBUG` is off | a 404 must not be a traceback. A traceback here leaks source paths and settings |
| no unapplied migrations | catches a partial deploy |
| `check --deploy` clean at WARNING | Django's own audit of cookies, HSTS, redirect |

### By hand — from outside the box

The checks above run *on* the server. These prove the public path works:

```bash
# 1. DNS resolves to Cloudflare, not your origin IP.
#    Cloudflare-owned addresses = the orange cloud is on.
dig +short tasky.tailwebs.com

# 2. The site answers over https.
curl -sI https://tasky.tailwebs.com/ | head -1

# 3. http redirects to https rather than serving.
curl -sI http://tasky.tailwebs.com/ | head -1

# 4. Cloudflare is really in front (expect cf-ray, server: cloudflare).
curl -sI https://tasky.tailwebs.com/ | grep -iE 'cf-ray|^server'

# 5. No redirect loop — must be a small number, not 20.
curl -s -o /dev/null -w '%{num_redirects} redirects, final %{http_code}\n' \
  -L https://tasky.tailwebs.com/

# 6. Security headers are present.
curl -sI https://tasky.tailwebs.com/ | grep -iE 'strict-transport|x-frame|x-content-type'

# 7. The origin is NOT reachable except through Cloudflare.
#    This should TIME OUT. If it answers, the security group is open.
curl -m 8 -sI http://<EC2-public-IP>/ && echo "EXPOSED — fix the security group"
```

Then sign in through the browser once and confirm the session sticks across a
page refresh — that is the end-to-end proof that `CSRF_TRUSTED_ORIGINS`,
`SECURE_PROXY_SSL_HEADER` and the Secure cookie flags all agree.

### First deploy only

- [ ] **Create the first Site Admin** — `make prod-shell`, then
      `manage.py createsuperuser`. There is no signup; nobody can get in without this.
- [ ] Confirm **no `seed_demo` data** exists. The command now refuses a non-local
      database host, but check.
- [ ] **Rotate the RDS password** if it has ever been shown in a terminal.
- [ ] Take a first backup: `make prod-backup`.

---

## Rollback

The image is built from the working tree, so rolling back is a checkout plus a
redeploy:

```bash
git checkout main && git pull
git revert <bad-commit>        # or: git checkout <last-good-tag>
make deploy-prod
```

**Migrations do not roll back automatically.** If the bad deploy migrated the
database, reverse it explicitly *before* redeploying older code:

```bash
make prod-shell                                  # inspect first
ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml \
  run --rm web python manage.py migrate boards <previous-migration-number>
```

Take `make prod-backup` before any deploy carrying a destructive migration.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `ERR_TOO_MANY_REDIRECTS` | Cloudflare on **Flexible** while `TASKY_TLS=on` or `DJANGO_SECURE_SSL_REDIRECT=1`. Either move Cloudflare to Full, or set both off. |
| Cloudflare **521** (origin down) | Nothing listening on the port Cloudflare is using, or the security group blocks it. `make prod-logs`. |
| Cloudflare **526** (invalid certificate) | Cloudflare is on **Full (strict)** but the origin has the generated self-signed certificate. Move to Full, or install a real Origin Certificate. |
| **CSRF verification failed** on login | `DJANGO_CSRF_TRUSTED_ORIGINS` missing `https://tasky.tailwebs.com`. It must include the scheme. |
| Signed in, then immediately signed out | Secure cookies set while Django thinks the request is http. Check `DJANGO_BEHIND_PROXY=1`. |
| `DisallowedHost` | `DJANGO_ALLOWED_HOSTS` must contain `tasky.tailwebs.com`. |
| Unstyled page, 404s on `/static/…` | `collectstatic` did not run, or the `static` volume is empty. Redeploy. |
| App refuses to start, `ImproperlyConfigured` | `DJANGO_SECRET_KEY` unset with `DEBUG=0`. Deliberate — it will not fall back to the committed dev key. |
| Every visitor logged as the same IP | `mod_remoteip` ranges are stale. `make cf-ips`, then rebuild. |

Logs: `make prod-logs`. Certificate in use: `make prod-certs`. Disk: `make clean`.

---

## Reference

| | |
|---|---|
| Environment variables | `docs/.env.production.example`, and the table in `README.md` |
| Proxy config | `deploy/apache/tasky-tls.conf`, `tasky-http.conf`, `entrypoint.sh` |
| Certificates | `deploy/apache/certs/README.md` |
| Accounts and roles | `docs/dev-credentials.md` |
| Outstanding risks | `docs/tech-debt.md`, `docs/follow-ups.md` |
