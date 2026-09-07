FROM httpd:2.4

# openssl — the entrypoint generates a self-signed certificate when none is
# supplied, so a fresh server can serve https with no manual step.
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/*

# mod_remoteip     — real client IP from CF-Connecting-IP
# mod_ssl          — TLS termination
# mod_proxy_http   — reverse proxy to gunicorn
# mod_headers      — X-Forwarded-Proto and security headers
RUN sed -i \
    -e 's|^#\(LoadModule remoteip_module\)|\1|' \
    -e 's|^#\(LoadModule ssl_module\)|\1|' \
    -e 's|^#\(LoadModule socache_shmcb_module\)|\1|' \
    -e 's|^#\(LoadModule proxy_module\)|\1|' \
    -e 's|^#\(LoadModule proxy_http_module\)|\1|' \
    -e 's|^#\(LoadModule headers_module\)|\1|' \
    -e 's|^#\(LoadModule rewrite_module\)|\1|' \
    /usr/local/apache2/conf/httpd.conf \
 && printf '\nIncludeOptional conf/tasky-listen.conf\nIncludeOptional conf/tasky.conf\n' \
    >> /usr/local/apache2/conf/httpd.conf

COPY tasky-tls.conf       /usr/local/apache2/conf/tasky-tls.conf
COPY tasky-http.conf      /usr/local/apache2/conf/tasky-http.conf
COPY cloudflare-ips.conf  /usr/local/apache2/conf/cloudflare-ips.conf
COPY entrypoint.sh        /usr/local/bin/entrypoint.sh

EXPOSE 80 443
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
