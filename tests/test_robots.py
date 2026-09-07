"""Tasky is an internal tool. Crawlers must be told to stay out, and any page
one reaches anyway must be unindexable.

Two layers are tested here because neither covers the other: `/robots.txt`
stops a well-behaved crawler fetching anything, and `X-Robots-Tag` keeps a URL
out of the index even when it was discovered from an external link rather than
by crawling. Neither stops a scanner that ignores both — that is Cloudflare's
job, and `docs/deployment.md` says so.
"""

import pytest
from django.urls import resolve


def test_robots_is_not_shadowed_by_the_catchall():
    """Registered below the catch-all, /robots.txt would be answered with the
    SPA shell — a 200 of HTML, which a crawler reads as 'no restrictions'."""
    assert resolve("/robots.txt").url_name == "robots"


@pytest.mark.django_db
def test_robots_disallows_everything(client):
    response = client.get("/robots.txt")
    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/plain")
    body = response.content.decode()
    assert "User-agent: *" in body
    assert "Disallow: /" in body


@pytest.mark.django_db
def test_robots_does_not_require_a_session(client):
    """A crawler is never signed in. If this needed auth it would 403 and the
    crawler would learn nothing about what it may not fetch."""
    response = client.get("/robots.txt")
    assert response.status_code == 200
    assert "<html" not in response.content.decode().lower()


@pytest.mark.django_db
@pytest.mark.parametrize("path", ["/", "/boards/3", "/robots.txt", "/api/auth/me/"])
def test_x_robots_tag_is_set_on_every_response(client, path):
    """Covers the SPA shell, a deep link, robots.txt itself and an API route —
    including the 403 an unauthenticated API call returns."""
    response = client.get(path)
    tag = response["X-Robots-Tag"]
    assert "noindex" in tag
    assert "nofollow" in tag


@pytest.mark.django_db
def test_spa_shell_declares_a_robots_meta_tag(client):
    """Belt and braces for the one page a crawler can actually render."""
    body = client.get("/").content.decode()
    assert 'name="robots"' in body
    assert "noindex" in body
