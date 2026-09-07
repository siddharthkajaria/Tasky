# Host Apache vhosts

These files are **not used by Docker.** They belong on the production server, in
`/etc/apache2/sites-available/`, and are committed so the live host config is
reviewable and reproducible instead of living only on the box.

## Why this exists

`13.200.123.23` already runs `Apache/2.4.58 (Ubuntu)` on the host, serving
`efast-staging.tailwebs.com` on :80 and :443. The Tasky container therefore
cannot take those ports. It binds `127.0.0.1:8081` and the host Apache proxies
to it.

Without a vhost here, `tasky.tailwebs.com` reaches this box, matches nothing,
and falls through to the default vhost — which is why it served efast.

```
Cloudflare ──► host Apache ──► tasky proxy container 127.0.0.1:8081 ──► gunicorn :8000
```

## The two files

| File | Phase | Cloudflare SSL mode |
|---|---|---|
| `tasky.conf` | 1 — http only, host does not terminate TLS for tasky | **Flexible** |
| `tasky-ssl.conf` | 2 — host serves :443 with a certificate | **Full** |

They both install to the same path, `/etc/apache2/sites-available/tasky.conf`.
Phase 2 replaces phase 1; do not enable both.

## Install (phase 1)

```bash
sudo a2enmod proxy proxy_http headers rewrite
sudo cp deploy/apache-host/tasky.conf /etc/apache2/sites-available/tasky.conf
sudo a2ensite tasky
sudo apache2ctl configtest          # must pass
sudo systemctl reload apache2
```

`configtest` is not optional. This Apache serves another production site — a
broken config here refuses the reload and, if pushed through, takes
`efast-staging` down with it.

## Matching `.env.prod`

The vhost only works alongside these, which `docs/.env.production.example`
documents in full:

```
TASKY_TLS=off                    # the host terminates TLS, not the container
TASKY_HTTP_BIND=127.0.0.1:8081   # loopback only
DJANGO_BEHIND_PROXY=1            # trust the X-Forwarded-Proto set below
DJANGO_SECURE_COOKIES=1          # the visitor really is on https
DJANGO_SECURE_SSL_REDIRECT=0     # phase 1 only — the host owns the redirect
```

## Verifying

```bash
sudo ss -lntp | grep 8081                                    # 127.0.0.1:8081, not 0.0.0.0
curl -sI -H 'Host: tasky.tailwebs.com' http://127.0.0.1:8081/ | head -1
curl -sI https://tasky.tailwebs.com/ | grep -iE '^HTTP|cf-ray'
curl -s -o /dev/null -w '%{num_redirects} redirects\n' -L https://tasky.tailwebs.com/
```

The redirect count must be small. A large number means Cloudflare is on
Flexible while something is redirecting to https — see `docs/deployment.md`.

## Keeping these in step

If you change the live config on the server, update the file here and commit it.
A vhost that exists only on the box is one `terminate instance` away from being
lost, and nobody can review it.
