import pytest
from django.contrib.auth import get_user_model


@pytest.fixture
def site_admin(db):
    return get_user_model().objects.create_user(
        username="admin1", password="pw-admin1-12345", is_staff=True,
    )


@pytest.fixture
def other_site_admin(db):
    return get_user_model().objects.create_user(
        username="admin2", password="pw-admin2-12345", is_staff=True,
    )


@pytest.fixture
def admin_client(client, site_admin):
    client.force_login(site_admin)
    return client


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client):
    assert client.get("/api/admin/users/").status_code == 403


@pytest.mark.django_db
def test_non_staff_user_gets_403_on_list(auth_client):
    assert auth_client.get("/api/admin/users/").status_code == 403


@pytest.mark.django_db
def test_non_staff_user_gets_403_on_create(auth_client):
    response = auth_client.post(
        "/api/admin/users/",
        {"username": "newperson", "password": "pw-newperson-12345"},
        content_type="application/json",
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_non_staff_user_gets_403_on_retrieve(auth_client, other_user):
    assert auth_client.get(f"/api/admin/users/{other_user.id}/").status_code == 403


@pytest.mark.django_db
def test_non_staff_user_gets_403_on_update(auth_client, other_user):
    response = auth_client.patch(
        f"/api/admin/users/{other_user.id}/", {"is_active": False}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_site_admin_can_list_all_users_active_and_inactive(admin_client, site_admin, other_user):
    other_user.is_active = False
    other_user.save()
    response = admin_client.get("/api/admin/users/")
    assert response.status_code == 200
    usernames = {u["username"] for u in response.json()}
    assert usernames == {site_admin.username, other_user.username}
    inactive_row = next(u for u in response.json() if u["username"] == other_user.username)
    assert inactive_row["is_active"] is False


@pytest.mark.django_db
def test_site_admin_can_create_a_user_account_and_it_can_log_in(admin_client, client):
    response = admin_client.post(
        "/api/admin/users/",
        {"username": "newperson", "password": "pw-newperson-12345", "first_name": "New"},
        content_type="application/json",
    )
    assert response.status_code == 201
    body = response.json()
    assert body["username"] == "newperson"
    assert body["is_active"] is True
    assert body["is_staff"] is False

    login = client.post(
        "/api/auth/login/",
        {"username": "newperson", "password": "pw-newperson-12345"},
        content_type="application/json",
    )
    assert login.status_code == 200


@pytest.mark.django_db
def test_creating_with_a_duplicate_username_is_rejected(admin_client, site_admin):
    response = admin_client.post(
        "/api/admin/users/",
        {"username": site_admin.username, "password": "pw-whatever-12345"},
        content_type="application/json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_creating_without_a_password_is_rejected(admin_client):
    response = admin_client.post(
        "/api/admin/users/", {"username": "onlyusername"}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_deactivating_an_account_blocks_login_then_reactivating_restores_it(
    admin_client, client, other_user
):
    deactivate = admin_client.patch(
        f"/api/admin/users/{other_user.id}/", {"is_active": False}, content_type="application/json"
    )
    assert deactivate.status_code == 200
    assert deactivate.json()["is_active"] is False

    login_attempt = client.post(
        "/api/auth/login/",
        {"username": other_user.username, "password": "pw-bob-12345"},
        content_type="application/json",
    )
    assert login_attempt.status_code == 400

    reactivate = admin_client.patch(
        f"/api/admin/users/{other_user.id}/", {"is_active": True}, content_type="application/json"
    )
    assert reactivate.status_code == 200

    login_again = client.post(
        "/api/auth/login/",
        {"username": other_user.username, "password": "pw-bob-12345"},
        content_type="application/json",
    )
    assert login_again.status_code == 200


@pytest.mark.django_db
def test_site_admin_cannot_deactivate_or_revoke_own_status(admin_client, site_admin):
    for payload in ({"is_active": False}, {"is_staff": False}):
        response = admin_client.patch(
            f"/api/admin/users/{site_admin.id}/", payload, content_type="application/json"
        )
        assert response.status_code == 400


@pytest.mark.django_db
def test_site_admin_can_rename_their_own_account(admin_client, site_admin):
    response = admin_client.patch(
        f"/api/admin/users/{site_admin.id}/", {"first_name": "Renamed"}, content_type="application/json"
    )
    assert response.status_code == 200
    assert response.json()["first_name"] == "Renamed"


@pytest.mark.django_db
def test_revoking_one_of_two_site_admins_is_allowed(admin_client, site_admin, other_site_admin):
    response = admin_client.patch(
        f"/api/admin/users/{other_site_admin.id}/", {"is_staff": False}, content_type="application/json"
    )
    assert response.status_code == 200
    other_site_admin.refresh_from_db()
    assert other_site_admin.is_staff is False


def test_can_revoke_site_admin_guard_rejects_leaving_zero():
    """Direct unit test of the guard's own arithmetic (accounts/permissions.py),
    not an HTTP round-trip: the self-lockout guard already means an acting
    admin can never revoke their OWN is_staff, and the acting admin always
    counts toward "how many would remain" for any OTHER row they revoke —
    so "revoke someone else's is_staff and it would leave zero" can never
    actually happen in a single request from one session. It's a real
    safety net for a genuinely different case (two Site Admins' requests
    racing in production), which a single synchronous test process can't
    reproduce — so the guard's decision rule is tested directly instead."""
    from accounts.permissions import can_revoke_site_admin

    assert can_revoke_site_admin(other_staff_count=1) is True
    assert can_revoke_site_admin(other_staff_count=0) is False


@pytest.mark.django_db
def test_deactivating_a_project_owner_does_not_touch_membership(admin_client, user, project):
    from projects.models import ProjectMembership

    response = admin_client.patch(
        f"/api/admin/users/{user.id}/", {"is_active": False}, content_type="application/json"
    )
    assert response.status_code == 200
    membership = ProjectMembership.objects.get(project=project, user=user)
    assert membership.role == "owner"


@pytest.mark.django_db
def test_genuinely_nonexistent_user_id_returns_404(admin_client):
    assert admin_client.get("/api/admin/users/999999/").status_code == 404
