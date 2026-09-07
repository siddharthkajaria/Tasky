# Cloudflare Origin Certificate

Two files belong here and **neither is committed** (see `.gitignore`):

| File | What |
|---|---|
| `origin.pem` | The Origin Certificate body |
| `origin.key` | Its private key |

## Generating them

1. Cloudflare dashboard → the `tailwebs.com` zone → **SSL/TLS → Origin Server**
2. **Create Certificate** → let Cloudflare generate the key → hostnames
   `tasky.tailwebs.com` (add `*.tailwebs.com` if you want to reuse it)
3. Save the certificate as `origin.pem` and the key as `origin.key` in this
   directory, `chmod 600 origin.key`
4. Set **SSL/TLS → Overview → Full (strict)** for the zone

An Origin Certificate is trusted **only by Cloudflare**, which is exactly what
is wanted: the origin is not meant to be reachable except through the proxy.
A browser hitting the origin IP directly will see a certificate error — that is
correct behaviour, not a bug.

## Why not Let's Encrypt

Port 80 on this origin only ever answers Cloudflare, so an HTTP-01 challenge
cannot reach it. A DNS-01 challenge would work but adds a renewal daemon for no
benefit — the Origin Certificate is valid for 15 years.
