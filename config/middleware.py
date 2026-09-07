"""Project-wide middleware."""


class RobotsTagMiddleware:
    """Stamp `X-Robots-Tag` on every response.

    `/robots.txt` already tells a crawler not to fetch anything, but a URL that
    was never crawled can still be indexed from an external link. The header is
    what covers that case, so it belongs on every response rather than only on
    the SPA shell.

    Apache sets the identical header in `deploy/apache/` — not redundantly:
    `/static/` is served there by `Alias` and never reaches Django, so the two
    together are what cover the whole site.

    Neither layer stops a scanner that ignores robots directives. That is
    Cloudflare's job; see `docs/deployment.md`.
    """

    VALUE = "noindex, nofollow, noarchive"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.headers.setdefault("X-Robots-Tag", self.VALUE)
        return response
