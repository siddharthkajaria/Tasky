import pytest

from boards.models import Label


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client):
    assert client.get("/api/labels/").status_code == 403


@pytest.mark.django_db
def test_any_authenticated_user_can_list_labels(auth_client):
    """No `project` fixture here on purpose — listing labels needs no
    project membership at all, unlike everything project-scoped."""
    Label.objects.create(name="urgent", color="#A32218", created_by=None)
    response = auth_client.get("/api/labels/")
    assert response.status_code == 200
    assert response.json()[0]["name"] == "urgent"


@pytest.mark.django_db
def test_creating_a_label_directly_is_not_allowed(auth_client, project):
    response = auth_client.post(
        "/api/labels/", {"name": "urgent", "color": "#A32218"}, content_type="application/json"
    )
    assert response.status_code == 405


@pytest.mark.django_db
def test_owner_of_any_project_can_rename_a_label(auth_client, project):
    """No relationship between `project` and the label being renamed —
    proves the check keys on being Owner of *some* project, not this one."""
    label = Label.objects.create(name="old-name", color="#A32218", created_by=None)
    response = auth_client.patch(
        f"/api/labels/{label.id}/", {"name": "new-name"}, content_type="application/json"
    )
    assert response.status_code == 200
    label.refresh_from_db()
    assert label.name == "new-name"


@pytest.mark.django_db
def test_a_plain_member_cannot_rename_a_label(auth_client, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    label = Label.objects.create(name="old-name", color="#A32218", created_by=None)
    response = auth_client.patch(
        f"/api/labels/{label.id}/", {"name": "new-name"}, content_type="application/json"
    )
    assert response.status_code == 403
    label.refresh_from_db()
    assert label.name == "old-name"


@pytest.mark.django_db
def test_renaming_to_a_duplicate_name_is_rejected_case_insensitively(auth_client, project):
    Label.objects.create(name="urgent", color="#A32218", created_by=None)
    other = Label.objects.create(name="needs-design", color="#6E4FA3", created_by=None)
    response = auth_client.patch(
        f"/api/labels/{other.id}/", {"name": "URGENT"}, content_type="application/json"
    )
    assert response.status_code == 400
    assert "name" in response.json()


@pytest.mark.django_db
def test_owner_can_recolor_a_label(auth_client, project):
    label = Label.objects.create(name="urgent", color="#A32218", created_by=None)
    response = auth_client.patch(
        f"/api/labels/{label.id}/", {"color": "#2E7D5B"}, content_type="application/json"
    )
    assert response.status_code == 200
    label.refresh_from_db()
    assert label.color == "#2E7D5B"


@pytest.mark.django_db
def test_recoloring_to_a_color_outside_the_palette_is_rejected(auth_client, project):
    label = Label.objects.create(name="urgent", color="#A32218", created_by=None)
    response = auth_client.patch(
        f"/api/labels/{label.id}/", {"color": "#FFFFFF"}, content_type="application/json"
    )
    assert response.status_code == 400
    assert "color" in response.json()
    label.refresh_from_db()
    assert label.color == "#A32218"


@pytest.mark.django_db
def test_owner_can_delete_an_unused_label(auth_client, project):
    label = Label.objects.create(name="doomed", color="#A32218", created_by=None)
    assert auth_client.delete(f"/api/labels/{label.id}/").status_code == 204
    assert not Label.objects.filter(id=label.id).exists()


@pytest.mark.django_db
def test_a_plain_member_cannot_delete_a_label(auth_client, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    label = Label.objects.create(name="urgent", color="#A32218", created_by=None)
    response = auth_client.delete(f"/api/labels/{label.id}/")
    assert response.status_code == 403
    assert Label.objects.filter(id=label.id).exists()


@pytest.mark.django_db
def test_patching_a_nonexistent_label_returns_404(auth_client, project):
    response = auth_client.patch(
        "/api/labels/999999/", {"name": "whatever"}, content_type="application/json"
    )
    assert response.status_code == 404


@pytest.mark.django_db
def test_deleting_a_nonexistent_label_returns_404(auth_client, project):
    assert auth_client.delete("/api/labels/999999/").status_code == 404
