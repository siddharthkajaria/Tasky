import pytest

from boards.models import Board, WorkItem, WorkItemStatus
from projects.models import Project, ProjectMembership


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client):
    assert client.get("/api/projects/").status_code == 403


@pytest.mark.django_db
def test_listing_returns_only_my_projects(auth_client, user, other_user):
    mine = Project.objects.create(key="MINE", name="Mine")
    ProjectMembership.objects.create(project=mine, user=user, role="owner")

    theirs = Project.objects.create(key="THEIRS", name="Theirs")
    ProjectMembership.objects.create(project=theirs, user=other_user, role="owner")

    response = auth_client.get("/api/projects/")

    assert response.status_code == 200
    keys = {p["key"] for p in response.json()}
    assert keys == {"MINE"}


@pytest.mark.django_db
def test_creating_a_project_makes_the_creator_owner(auth_client, user):
    response = auth_client.post(
        "/api/projects/", {"key": "tasky", "name": "Tasky Redesign"}, content_type="application/json"
    )

    assert response.status_code == 201
    body = response.json()
    assert body["key"] == "TASKY"
    assert body["my_role"] == "owner"
    assert ProjectMembership.objects.get(project_id=body["id"], user=user).role == "owner"


@pytest.mark.django_db
def test_creating_a_project_with_a_duplicate_key_is_rejected(auth_client):
    Project.objects.create(key="TASKY", name="Existing")

    response = auth_client.post(
        "/api/projects/", {"key": "TASKY", "name": "New"}, content_type="application/json"
    )

    assert response.status_code == 400
    assert "key" in response.json()


@pytest.mark.django_db
def test_retrieving_a_nonexistent_project_is_404(auth_client):
    assert auth_client.get("/api/projects/999999/").status_code == 404


@pytest.mark.django_db
def test_a_non_member_gets_403_not_404(auth_client, other_user):
    theirs = Project.objects.create(key="THEIRS", name="Theirs")
    ProjectMembership.objects.create(project=theirs, user=other_user, role="owner")

    response = auth_client.get(f"/api/projects/{theirs.id}/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_only_the_owner_can_delete_a_project(auth_client, user, other_user):
    project = Project.objects.create(key="TASKY", name="Tasky Redesign")
    ProjectMembership.objects.create(project=project, user=user, role="admin")
    ProjectMembership.objects.create(project=project, user=other_user, role="owner")

    response = auth_client.delete(f"/api/projects/{project.id}/")

    assert response.status_code == 403
    assert Project.objects.filter(id=project.id).exists()


@pytest.mark.django_db
def test_the_owner_can_delete_a_project(auth_client, user):
    project = Project.objects.create(key="TASKY", name="Tasky Redesign")
    ProjectMembership.objects.create(project=project, user=user, role="owner")

    response = auth_client.delete(f"/api/projects/{project.id}/")

    assert response.status_code == 204
    assert not Project.objects.filter(id=project.id).exists()


@pytest.mark.django_db
def test_editing_a_project_is_not_allowed(auth_client, user):
    project = Project.objects.create(key="TASKY", name="Tasky Redesign")
    ProjectMembership.objects.create(project=project, user=user, role="owner")

    put_response = auth_client.put(
        f"/api/projects/{project.id}/", {"key": "TASKY", "name": "Renamed"}, content_type="application/json"
    )
    patch_response = auth_client.patch(
        f"/api/projects/{project.id}/", {"name": "Renamed"}, content_type="application/json"
    )

    assert put_response.status_code == 405
    assert patch_response.status_code == 405


@pytest.mark.django_db
def test_deleting_a_project_cascades_to_its_boards(auth_client, user):
    project = Project.objects.create(key="TASKY", name="Tasky Redesign")
    ProjectMembership.objects.create(project=project, user=user, role="owner")
    board = Board.objects.create(name="Doomed", created_by=user, project=project)

    auth_client.delete(f"/api/projects/{project.id}/")

    assert not Board.objects.filter(id=board.id).exists()


@pytest.mark.django_db
def test_deleting_a_project_with_work_items_succeeds_and_leaves_nothing_behind(auth_client, user):
    """Regression test: WorkItem.status is on_delete=PROTECT while
    WorkItemStatus.project is on_delete=CASCADE, so deleting a Project that
    still has work items used to raise an uncaught ProtectedError (a 500)
    the moment Django's cascade collector reached the project's statuses —
    Project.delete() must clear out work items first so the cascade can
    proceed cleanly."""
    project = Project.objects.create(key="TASKY", name="Tasky Redesign")
    ProjectMembership.objects.create(project=project, user=user, role="owner")
    board = Board.objects.create(name="Doomed", created_by=user, project=project)
    response = auth_client.post(
        "/api/work-items/", {"board": board.id, "title": "About to be deleted"}, content_type="application/json"
    )
    assert response.status_code == 201
    work_item_id = response.json()["id"]

    response = auth_client.delete(f"/api/projects/{project.id}/")

    assert response.status_code == 204
    assert not Project.objects.filter(id=project.id).exists()
    assert not Board.objects.filter(id=board.id).exists()
    assert not WorkItem.objects.filter(id=work_item_id).exists()
    assert not WorkItemStatus.objects.filter(project_id=project.id).exists()
