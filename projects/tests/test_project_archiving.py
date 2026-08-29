import pytest

from boards.models import Board, WorkItem, WorkItemStatus
from boards.services import seed_default_statuses
from projects.models import Project, ProjectMembership


@pytest.mark.django_db
def test_owner_can_archive_a_project(auth_client, project):
    response = auth_client.post(f"/api/projects/{project.id}/archive/")
    assert response.status_code == 200
    body = response.json()
    assert body["is_archived"] is True
    assert body["archived_at"] is not None
    assert body["archived_by_detail"]["username"] == "alice"

    project.refresh_from_db()
    assert project.is_archived is True
    assert project.archived_by_id is not None


@pytest.mark.django_db
def test_admin_and_member_get_403_archiving(auth_client, project, other_user):
    ProjectMembership.objects.create(project=project, user=other_user, role="admin")
    client_as_admin = auth_client
    client_as_admin.force_login(other_user)
    response = client_as_admin.post(f"/api/projects/{project.id}/archive/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_non_member_gets_403_not_404_archiving(auth_client, other_user):
    other_project = Project.objects.create(key="OTHR", name="Other")
    ProjectMembership.objects.create(project=other_project, user=other_user, role="owner")
    response = auth_client.post(f"/api/projects/{other_project.id}/archive/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_double_archive_returns_400(auth_client, project):
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.post(f"/api/projects/{project.id}/archive/")
    assert response.status_code == 400


@pytest.mark.django_db
def test_unarchiving_a_non_archived_project_returns_400(auth_client, project):
    response = auth_client.post(f"/api/projects/{project.id}/unarchive/")
    assert response.status_code == 400


@pytest.mark.django_db
def test_owner_can_unarchive(auth_client, project):
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.post(f"/api/projects/{project.id}/unarchive/")
    assert response.status_code == 200
    body = response.json()
    assert body["is_archived"] is False
    assert body["archived_at"] is None
    assert body["archived_by_detail"] is None


@pytest.mark.django_db
def test_archived_projects_excluded_from_default_list(auth_client, project):
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.get("/api/projects/")
    keys = {p["key"] for p in response.json()}
    assert project.key not in keys


@pytest.mark.django_db
def test_include_archived_query_param_includes_them(auth_client, project):
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.get("/api/projects/?include_archived=true")
    keys = {p["key"] for p in response.json()}
    assert project.key in keys


@pytest.mark.django_db
def test_archived_projects_boards_and_work_items_remain_fully_writable(auth_client, project, user):
    board = Board.objects.create(name="Board", created_by=user, project=project)
    seed_default_statuses(project)
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    item = WorkItem.objects.create(board=board, title="Still editable", status=status)

    auth_client.post(f"/api/projects/{project.id}/archive/")

    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"title": "Edited after archive"}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.title == "Edited after archive"
