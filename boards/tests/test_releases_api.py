import pytest

from boards.models import Release


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client, project):
    assert client.get(f"/api/projects/{project.id}/releases/").status_code == 403


@pytest.mark.django_db
def test_any_member_can_list_releases(auth_client, project):
    Release.objects.create(project=project, name="v2.3")
    response = auth_client.get(f"/api/projects/{project.id}/releases/")
    assert response.status_code == 200
    assert response.json()[0]["name"] == "v2.3"


@pytest.mark.django_db
def test_owner_can_create_a_release(auth_client, project):
    response = auth_client.post(
        f"/api/projects/{project.id}/releases/", {"name": "v2.4.0"}, content_type="application/json"
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "v2.4.0"
    assert body["status"] == "unreleased"
    assert body["release_date"] is None


@pytest.mark.django_db
def test_status_is_not_settable_on_create(auth_client, project):
    response = auth_client.post(
        f"/api/projects/{project.id}/releases/",
        {"name": "v2.4.0", "status": "released"},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json()["status"] == "unreleased"


@pytest.mark.django_db
def test_release_date_can_be_set_on_create(auth_client, project):
    response = auth_client.post(
        f"/api/projects/{project.id}/releases/",
        {"name": "v2.4.0", "release_date": "2026-09-01"},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json()["release_date"] == "2026-09-01"


@pytest.mark.django_db
def test_a_plain_member_cannot_create_a_release(auth_client, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    response = auth_client.post(
        f"/api/projects/{project.id}/releases/", {"name": "v2.4.0"}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_a_non_member_cannot_create_a_release(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    response = auth_client.post(
        f"/api/projects/{foreign.id}/releases/", {"name": "v1.0"}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_duplicate_release_name_in_the_same_project_is_rejected(auth_client, project):
    Release.objects.create(project=project, name="v2.3")
    response = auth_client.post(
        f"/api/projects/{project.id}/releases/", {"name": "v2.3"}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_duplicate_check_is_case_insensitive(auth_client, project):
    Release.objects.create(project=project, name="v2.3")
    response = auth_client.post(
        f"/api/projects/{project.id}/releases/", {"name": "V2.3"}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_the_same_release_name_in_two_different_projects_is_allowed(auth_client, project, user):
    from projects.models import Project, ProjectMembership

    other_project = Project.objects.create(key="OTHER", name="Other Project")
    ProjectMembership.objects.create(project=other_project, user=user, role="owner")
    Release.objects.create(project=project, name="v1.0")

    response = auth_client.post(
        f"/api/projects/{other_project.id}/releases/", {"name": "v1.0"}, content_type="application/json"
    )
    assert response.status_code == 201


@pytest.mark.django_db
def test_owner_can_rename_a_release(auth_client, project):
    release = Release.objects.create(project=project, name="Old name")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{release.id}/", {"name": "New name"}, content_type="application/json"
    )
    assert response.status_code == 200
    release.refresh_from_db()
    assert release.name == "New name"


@pytest.mark.django_db
def test_renaming_to_a_duplicate_name_is_rejected(auth_client, project):
    Release.objects.create(project=project, name="v2.3")
    other = Release.objects.create(project=project, name="v2.4.0")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{other.id}/", {"name": "v2.3"}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_owner_can_change_status_via_patch(auth_client, project):
    release = Release.objects.create(project=project, name="v2.3")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{release.id}/", {"status": "released"}, content_type="application/json"
    )
    assert response.status_code == 200
    release.refresh_from_db()
    assert release.status == "released"


@pytest.mark.django_db
def test_status_can_skip_straight_from_unreleased_to_archived(auth_client, project):
    release = Release.objects.create(project=project, name="v2.3")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{release.id}/", {"status": "archived"}, content_type="application/json"
    )
    assert response.status_code == 200
    release.refresh_from_db()
    assert release.status == "archived"


@pytest.mark.django_db
def test_release_date_can_be_changed_after_release_is_marked_released(auth_client, project):
    release = Release.objects.create(project=project, name="v2.3", status="released", release_date="2026-08-01")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{release.id}/",
        {"release_date": "2026-08-15"},
        content_type="application/json",
    )
    assert response.status_code == 200
    release.refresh_from_db()
    assert str(release.release_date) == "2026-08-15"


@pytest.mark.django_db
def test_release_date_can_be_cleared(auth_client, project):
    release = Release.objects.create(project=project, name="v2.3", release_date="2026-08-01")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{release.id}/",
        {"release_date": None},
        content_type="application/json",
    )
    assert response.status_code == 200
    release.refresh_from_db()
    assert release.release_date is None


@pytest.mark.django_db
def test_a_plain_member_cannot_rename_or_change_status(auth_client, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    release = Release.objects.create(project=project, name="v2.3")
    response = auth_client.patch(
        f"/api/projects/{project.id}/releases/{release.id}/", {"status": "released"}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_owner_can_delete_a_release(auth_client, project):
    release = Release.objects.create(project=project, name="Doomed")
    assert auth_client.delete(f"/api/projects/{project.id}/releases/{release.id}/").status_code == 204
    assert not Release.objects.filter(id=release.id).exists()


@pytest.mark.django_db
def test_a_plain_member_cannot_delete_a_release(auth_client, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    release = Release.objects.create(project=project, name="v2.3")
    response = auth_client.delete(f"/api/projects/{project.id}/releases/{release.id}/")
    assert response.status_code == 403
    assert Release.objects.filter(id=release.id).exists()


@pytest.mark.django_db
def test_genuinely_nonexistent_release_returns_404(auth_client, project):
    assert auth_client.get(f"/api/projects/{project.id}/releases/999999/").status_code == 404
    assert auth_client.patch(
        f"/api/projects/{project.id}/releases/999999/", {"name": "X"}, content_type="application/json"
    ).status_code == 404
    assert auth_client.delete(f"/api/projects/{project.id}/releases/999999/").status_code == 404


@pytest.mark.django_db
def test_a_non_member_cannot_list_or_view_releases(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    release = Release.objects.create(project=foreign, name="v1.0")

    assert auth_client.get(f"/api/projects/{foreign.id}/releases/").status_code == 403
    assert auth_client.get(f"/api/projects/{foreign.id}/releases/{release.id}/").status_code == 403
