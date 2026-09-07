"""The SPA catch-all must serve the UI without shadowing the API or admin."""

import pytest
from django.urls import resolve


def test_api_routes_are_not_shadowed_by_the_catchall():
    """Registered any earlier, the catch-all would swallow every API call."""
    assert resolve("/api/boards/").url_name != "spa"
    assert resolve("/api/auth/login/").url_name != "spa"
    assert resolve("/api/me/tasks/").url_name == "my-tasks"


def test_admin_is_not_shadowed_by_the_catchall():
    assert resolve("/admin/").app_name == "admin"


@pytest.mark.parametrize("path", ["/", "/boards", "/boards/3", "/my-tasks"])
def test_deep_links_resolve_to_the_spa(path):
    """A refresh on /boards/3 must reach the UI, not 404."""
    assert resolve(path).url_name == "spa"


@pytest.mark.django_db
def test_spa_shell_renders_and_loads_the_app(client):
    """The shell must actually render and pull in the real asset paths."""
    response = client.get("/boards/3")
    assert response.status_code == 200
    body = response.content.decode()
    assert "/static/js/app.js" in body
    assert "/static/css/app.css" in body


@pytest.mark.django_db
def test_spa_shell_does_not_require_a_session(client):
    """The shell is public; it decides what to show after calling /api/auth/me/."""
    assert client.get("/").status_code == 200


def test_favicon_is_not_shadowed_by_the_catchall():
    """Registered below the catch-all, /favicon.ico would be answered with the
    SPA shell — HTML where the browser asked for an image."""
    assert resolve("/favicon.ico").url_name == "favicon"


@pytest.mark.django_db
def test_favicon_redirects_to_the_static_file(client):
    response = client.get("/favicon.ico")
    assert response.status_code == 301
    assert response["Location"] == "/static/img/favicon-150.png"


@pytest.mark.django_db
def test_spa_shell_declares_a_favicon(client):
    """The shell must point at the icon itself; the /favicon.ico redirect is
    only the fallback for contexts that render no template of ours."""
    body = client.get("/").content.decode()
    assert 'rel="icon"' in body
    assert "/static/img/favicon-150.png" in body

