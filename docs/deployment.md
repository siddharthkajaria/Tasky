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

## Sharing the server with another app

**This is the case on `13.200.123.23` today.** That box already runs
`Apache/2.4.58 (Ubuntu)` on the host, serving `efast-staging.tailwebs.com`, and it
owns :80 and :443. `tasky.tailwebs.com` resolves through Cloudflare to the same
IP, hits that host Apache, finds no matching vhost and falls through to efast —
which is exactly the "the URL redirects to the other app" symptom.

The Tasky container **cannot** take :80/:443 there. It binds loopback high ports
and the host Apache proxies to it:

```
Cloudflare ──► host Apache :443 ──► tasky proxy container 127.0.0.1:8081 ──► gunicorn :8000
               (vhost per domain)    (container, TLS off)
```

### 1. Point the container at loopback

In `.env.prod`:

```
TASKY_TLS=off                    # the host Apache terminates TLS, not us
TASKY_HTTP_BIND=127.0.0.1:8081   # loopback only — never 0.0.0.0 on a shared box
TASKY_HTTPS_BIND=127.0.0.1:8444  # unused while TASKY_TLS=off
DJANGO_SECURE_SSL_REDIRECT=0     # the host Apache owns the http->https redirect
DJANGO_BEHIND_PROXY=1            # keep ON  — trust X-Forwarded-Proto
DJANGO_SECURE_COOKIES=1          # keep ON  — the visitor really is on https
```

Binding to `127.0.0.1` matters. `0.0.0.0:8081` would be reachable from the
internet and would bypass both the host Apache and Cloudflare.

Then `make deploy-prod`. Confirm it is listening on loopback only:

```bash
sudo ss -lntp | grep 8081        # expect 127.0.0.1:8081, NOT 0.0.0.0:8081
curl -sI -H 'Host: tasky.tailwebs.com' http://127.0.0.1:8081/ | head -1
```

### 2. Add the host Apache vhost

**The vhosts are committed at [`deploy/apache-host/`](../deploy/apache-host/)** — copy them, do not retype them:

```bash
sudo a2enmod proxy proxy_http headers rewrite
sudo cp deploy/apache-host/tasky.conf /etc/apache2/sites-available/tasky.conf
sudo a2ensite tasky
sudo apache2ctl configtest      # must pass — this Apache also serves efast-staging
sudo systemctl reload apache2
```

Phase 1 (`deploy/apache-host/tasky.conf`), with Cloudflare on **Flexible**:

```apache
<VirtualHost *:80>
    ServerName tasky.tailwebs.com

    # Cloudflare terminates the visitor's TLS, so tell Django the real scheme.
    # Without this it sets Secure cookies the browser will not send back, and
    # the user is signed out on the next request.
    RequestHeader set X-Forwarded-Proto "https"

    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:8081/
    ProxyPassReverse / http://127.0.0.1:8081/

    ErrorLog  ${APACHE_LOG_DIR}/tasky-error.log
    CustomLog ${APACHE_LOG_DIR}/tasky-access.log combined
</VirtualHost>
```

Do **not** add a `Redirect` to https in this vhost while Cloudflare is on
Flexible — Cloudflare would answer it by fetching the origin over http again and
loop forever.

Phase 2 (`deploy/apache-host/tasky-ssl.conf`) — add TLS on the host and move Cloudflare to **Full**:

```apache
<VirtualHost *:80>
    ServerName tasky.tailwebs.com
    RedirectPermanent / https://tasky.tailwebs.com/
</VirtualHost>

<VirtualHost *:443>
    ServerName tasky.tailwebs.com

    SSLEngine on
    SSLCertificateFile    /etc/ssl/tailwebs/origin.pem
    SSLCertificateKeyFile /etc/ssl/tailwebs/origin.key

    RequestHeader set X-Forwarded-Proto "https"
    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:8081/
    ProxyPassReverse / http://127.0.0.1:8081/
</VirtualHost>
```

The certificate can be a Cloudflare Origin Certificate for `*.tailwebs.com`
(SSL/TLS → Origin Server → Create Certificate), or whatever cert
`efast-staging` already uses if it covers the domain. Then set
`DJANGO_SECURE_SSL_REDIRECT=1` in `.env.prod` and redeploy.

### Caveat: client IPs in container logs

`mod_remoteip` in the Tasky container only trusts Cloudflare ranges, and its
immediate peer is now the host Apache, so container access logs will show the
Docker gateway address rather than the real visitor. The host Apache's own logs
have the true client IP. Cosmetic — nothing in the app reads the client address.

### Why keep the Tasky proxy container at all

The host Apache could proxy straight to gunicorn, but then it would also have to
serve `/static/`, which lives in a Docker volume. Keeping the container's Apache
means the host vhost is four lines and knows nothing about Tasky's internals.

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

### Forcing https while Cloudflare stays on "Flexible"

`deploy/apache-host/tasky.conf` already does this — no Cloudflare change needed.

The trap is that a plain "redirect everything to https" **loops forever** under
Flexible: Cloudflare always fetches this origin over http, so it answers its own
redirect by fetching over http again. The connection scheme at the origin says
nothing about how the visitor connected.

Cloudflare does forward the visitor's real scheme in `X-Forwarded-Proto`, so the
redirect keys on that and nothing else:

```apache
RewriteEngine On
RewriteCond %{HTTP:X-Forwarded-Proto} =http
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

It terminates because after one redirect the visitor is on https, Cloudflare
sends `X-Forwarded-Proto: https`, and the condition stops matching. Verified
through a two-proxy chain: http visitor → 301, https visitor → 200, exactly one
redirect.

This also means the vhost must **not** do `RequestHeader set X-Forwarded-Proto
"https"`. Overwriting it with a constant is what makes the redirect impossible,
because it destroys the only evidence of how the visitor connected. Apache
passes Cloudflare's value through to Django, which reads it via
`SECURE_PROXY_SSL_HEADER`.

Needs `sudo a2enmod rewrite`.

> **What this does not fix.** The visitor's leg is now encrypted, but
> Cloudflare → origin is still plaintext across the public internet, because
> that is what Flexible means. Only phase 2 encrypts that hop. Consider HSTS
> (`DJANGO_HSTS_SECONDS`) only after that — a year-long header is very hard to
> walk back.

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

## Keeping crawlers and bots out

Tasky is internal. Nothing here belongs in a search index, and the login page
should not be discoverable at all.

Four layers ship in this repo, and one does not:

| Layer | Where | Covers |
|---|---|---|
| `/robots.txt` — `Disallow: /` | `ui/robots.txt`, routed in `config/urls.py` | Well-behaved crawlers, before they fetch anything |
| `X-Robots-Tag` response header | `config/middleware.py` | Every Django response, including API 403s |
| Same header on `/static/` | `deploy/apache/tasky-*.conf` | Static files, which Apache's `Alias` answers without ever reaching Django |
| `<meta name="robots">` | `ui/index.html` | The one page a crawler can actually render |
| **Cloudflare Bot Fight Mode** | **Dashboard — not in this repo** | **Bots that ignore all of the above** |

**Only the last one is enforcement.** The first four are a request. A scraper or
a vulnerability scanner reads `Disallow: /` and carries on, so treat the repo
layers as "keep Tasky out of Google", not as a block.

Enable the real one — required, not optional, now the origin is public:

1. Cloudflare → your zone → **Security** → **Bots** → turn on **Bot Fight Mode**.
2. Optional but worth it while `/api/auth/login/` is still unthrottled
   (see `docs/follow-ups.md`): **Security** → **WAF** → **Rate limiting rules**,
   matching `http.request.uri.path eq "/api/auth/login/"`, a handful of requests
   per minute per IP, action *Block*.

The rate-limiting rule matters more than it looks. The login endpoint has no
throttling of its own and returns the same message for an unknown user and a
wrong password — good for stopping enumeration, useless against a bot that just
keeps guessing. Cloudflare is what makes that expensive.

Note that `Disallow: /` also covers `/admin/`, which is how teammates are
created today.

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

# 8. Crawlers are told to stay out, and pages say so too.
curl -s https://tasky.tailwebs.com/robots.txt          # expect: Disallow: /
curl -sI https://tasky.tailwebs.com/ | grep -i x-robots-tag
curl -sI https://tasky.tailwebs.com/static/css/app.css | grep -i x-robots-tag
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
- [ ] **Enable Cloudflare Bot Fight Mode** — the repo's `robots.txt` and
      `X-Robots-Tag` are advisory; this is the only layer that blocks a bot
      that ignores them. See *Keeping crawlers and bots out* above.
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
| **The domain serves a different app on the server** | The host web server has no vhost for `tasky.tailwebs.com`, so the request falls through to its default. See "Sharing the server". |
| `bind: address already in use` on deploy | Another process owns :80/:443. Same section — bind loopback high ports instead. |
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
| Container proxy | `deploy/apache/tasky-tls.conf`, `tasky-http.conf`, `entrypoint.sh` |
| **Host Apache vhosts** | `deploy/apache-host/` — install to `/etc/apache2/sites-available/` |
| Certificates | `deploy/apache/certs/README.md` |
| Accounts and roles | `docs/dev-credentials.md` |
| Outstanding risks | `docs/tech-debt.md`, `docs/follow-ups.md` |
