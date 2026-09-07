"""Proves the DJANGO_SECRET_KEY production guard in config/settings.py.

Settings are loaded once per process by Django's app registry, so the only
clean way to exercise "importing settings under different environments"
is a fresh subprocess per scenario — reload()-ing config.settings in-process
fights the already-initialised app registry and proves nothing.
"""

import os
import subprocess
import sys

import pytest


def _import_settings(env_overrides: dict, unset: tuple = ()) -> subprocess.CompletedProcess:
    env = {**os.environ, **env_overrides}
    for key in unset:
        env.pop(key, None)
    return subprocess.run(
        [sys.executable, "-c", "import django; django.setup()"],
        env=env,
        capture_output=True,
        text=True,
    )


def test_missing_secret_key_with_debug_false_is_refused():
    """The production-misconfiguration case the guard exists for: no
    DJANGO_SECRET_KEY env var at all (not merely empty — os.environ.get()
    returns None only when the key is truly absent), and DEBUG off. Must
    not silently start up signing sessions with the committed dev-only
    fallback key."""
    result = _import_settings(
        {"DJANGO_SETTINGS_MODULE": "config.settings", "DJANGO_DEBUG": "0"},
        unset=("DJANGO_SECRET_KEY",),
    )

    assert result.returncode != 0
    assert "ImproperlyConfigured" in result.stderr
    assert "DJANGO_SECRET_KEY" in result.stderr


def test_empty_string_secret_key_with_debug_false_is_refused():
    """os.environ.get("DJANGO_SECRET_KEY") returns "" (not None) when the
    var is SET BUT EMPTY, e.g. a production .env containing a bare
    `DJANGO_SECRET_KEY=`. The guard must treat that the same as absent —
    an `is None` check would miss it and silently boot on the committed
    fallback key."""
    result = _import_settings(
        {
            "DJANGO_SETTINGS_MODULE": "config.settings",
            "DJANGO_DEBUG": "0",
            "DJANGO_SECRET_KEY": "",
        }
    )

    assert result.returncode != 0
    assert "ImproperlyConfigured" in result.stderr
    assert "DJANGO_SECRET_KEY" in result.stderr


def test_importing_settings_in_the_test_environment_does_not_raise():
    """This repo's actual test environment (docker, DJANGO_DEBUG=1 from
    .env) must not trip the guard — this is what every other test in the
    suite already relies on implicitly by importing config.settings at
    all; this test just makes that assumption explicit and independently
    checkable."""
    result = _import_settings({"DJANGO_SETTINGS_MODULE": "config.settings"})

    assert result.returncode == 0, result.stderr


def test_x_forwarded_host_is_not_trusted():
    """USE_X_FORWARDED_HOST must stay off.

    Every proxy in the chain appends to X-Forwarded-Host. Production runs two
    (the host Apache, then the container's), so Django would see
    "tasky.tailwebs.com, tasky.tailwebs.com" and reject every browser request
    with 400 DisallowedHost — while the single-hop container healthcheck kept
    passing, so the stack looked healthy. Both vhosts set ProxyPreserveHost On,
    which makes the original Host header correct without this.
    """
    from django.conf import settings

    assert getattr(settings, "USE_X_FORWARDED_HOST", False) is False


@pytest.mark.django_db
def test_appended_x_forwarded_host_is_rejected_not_honoured(client):
    """The concrete failure: a comma-joined X-Forwarded-Host must not be able to
    stand in for the real Host header."""
    response = client.get(
        "/api/auth/csrf/",
        HTTP_HOST="testserver",
        HTTP_X_FORWARDED_HOST="evil.example.com, testserver",
    )
    # Host (testserver) is what counts, so this succeeds; if USE_X_FORWARDED_HOST
    # were on, the joined value would be used instead and this would be a 400.
    assert response.status_code == 204

