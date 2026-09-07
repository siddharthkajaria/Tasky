#!/bin/sh
# Apache entrypoint. Picks the vhost from TASKY_TLS and, when TLS is on,
# guarantees a usable certificate exists before httpd starts — no manual step.
set -eu

CONF_DIR=/usr/local/apache2/conf
CERT_DIR="$CONF_DIR/certs"
TASKY_TLS="${TASKY_TLS:-on}"
TASKY_SERVER_NAME="${TASKY_SERVER_NAME:-tasky.tailwebs.com}"

if [ "$TASKY_TLS" = "on" ]; then
    cp "$CONF_DIR/tasky-tls.conf" "$CONF_DIR/tasky.conf"

    mkdir -p "$CERT_DIR"
    if [ ! -s "$CERT_DIR/origin.pem" ] || [ ! -s "$CERT_DIR/origin.key" ]; then
        echo "[entrypoint] No certificate found in $CERT_DIR — generating a self-signed pair."
        echo "[entrypoint] This works with Cloudflare SSL/TLS mode 'Full'."
        echo "[entrypoint] For 'Full (strict)', drop a Cloudflare Origin Certificate"
        echo "[entrypoint] in deploy/apache/certs/ as origin.pem + origin.key and restart."
        # basicConstraints=CA:FALSE matters: `openssl req -x509` defaults to
        # emitting a CA certificate, which Apache warns about (AH01906) and
        # some TLS clients reject as an end-entity cert.
        openssl req -x509 -nodes -newkey rsa:2048 \
            -days 3650 \
            -keyout "$CERT_DIR/origin.key" \
            -out    "$CERT_DIR/origin.pem" \
            -subj   "/CN=$TASKY_SERVER_NAME/O=Tailwebs/OU=Tasky" \
            -addext "subjectAltName=DNS:$TASKY_SERVER_NAME" \
            -addext "basicConstraints=critical,CA:FALSE" \
            -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
            -addext "extendedKeyUsage=serverAuth" \
            2>/dev/null
        chmod 600 "$CERT_DIR/origin.key"
        chmod 644 "$CERT_DIR/origin.pem"
        echo "[entrypoint] Generated a 10-year self-signed certificate for $TASKY_SERVER_NAME."
    else
        # Refuse to start on a key/cert mismatch rather than serving a broken
        # handshake that looks like a DNS or firewall problem from outside.
        c=$(openssl x509 -noout -modulus -in "$CERT_DIR/origin.pem" 2>/dev/null | openssl md5)
        k=$(openssl rsa  -noout -modulus -in "$CERT_DIR/origin.key" 2>/dev/null | openssl md5)
        if [ "$c" != "$k" ]; then
            echo "[entrypoint] FATAL: origin.pem and origin.key do not match." >&2
            exit 1
        fi
        echo "[entrypoint] Using the certificate already present in $CERT_DIR."
    fi
    printf 'Listen 443\nSSLSessionCache "shmcb:/usr/local/apache2/logs/ssl_scache(512000)"\nSSLSessionCacheTimeout 300\n' > "$CONF_DIR/tasky-listen.conf"
else
    echo "[entrypoint] TASKY_TLS=off — serving plain http on :80, no certificates."
    cp "$CONF_DIR/tasky-http.conf" "$CONF_DIR/tasky.conf"
    : > "$CONF_DIR/tasky-listen.conf"
fi

httpd -t
exec httpd-foreground "$@"
