import pytest

from boards.models import Board, Release, WorkItem, WorkItemStatus
from boards.services import seed_default_statuses


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def status(board, project):
    seed_default_statuses(project)
    return WorkItemStatus.objects.filter(project=project, category="todo").first()


@pytest.mark.django_db
def test_a_new_work_item_defaults_to_no_release(auth_client, board, status):
    response = auth_client.post(
        "/api/work-items/", {"board": board.id, "title": "X", "status": status.id}, content_type="application/json"
    )
    assert response.status_code == 201
    assert response.json()["release"] is None
    assert response.json()["release_detail"] is None


@pytest.mark.django_db
def test_any_member_can_apply_an_existing_release_to_a_work_item(auth_client, board, project, status):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    release = Release.objects.create(project=project, name="v2.3")
    item = WorkItem.objects.create(board=board, title="Needs tagging", status=status)

    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"release": release.id}, content_type="application/json"
    )

    assert response.status_code == 200
    assert response.json()["release_detail"]["name"] == "v2.3"


@pytest.mark.django_db
def test_a_release_can_be_set_on_create(auth_client, board, project, status):
    release = Release.objects.create(project=project, name="v2.3")
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "status": status.id, "release": release.id},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json()["release"] == release.id


@pytest.mark.django_db
def test_a_release_can_be_cleared(auth_client, board, status, project):
    release = Release.objects.create(project=project, name="v2.3")
    item = WorkItem.objects.create(board=board, title="X", status=status, release=release)
    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"release": None}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.release_id is None


@pytest.mark.django_db
def test_a_release_from_another_project_cannot_be_applied(auth_client, board, other_user, status):
    from projects.models import Project, ProjectMembership

    foreign_project = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign_project, user=other_user, role="owner")
    foreign_release = Release.objects.create(project=foreign_project, name="Not applicable")
    item = WorkItem.objects.create(board=board, title="Item", status=status)

    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"release": foreign_release.id}, content_type="application/json"
    )

    assert response.status_code == 400
    assert "release" in response.json()


@pytest.mark.django_db
def test_deleting_a_release_clears_it_from_work_items_without_deleting_them(auth_client, board, project, status):
    release = Release.objects.create(project=project, name="v2.3")
    item = WorkItem.objects.create(board=board, title="Has a release", status=status, release=release)

    auth_client.delete(f"/api/projects/{project.id}/releases/{release.id}/")

    item.refresh_from_db()
    assert WorkItem.objects.filter(id=item.id).exists()
    assert item.release_id is None


@pytest.mark.django_db
def test_release_can_be_changed_alongside_other_fields_in_one_patch(auth_client, board, project, status):
    release_a = Release.objects.create(project=project, name="v2.3")
    release_b = Release.objects.create(project=project, name="v2.4.0")
    item = WorkItem.objects.create(board=board, title="Old title", status=status, release=release_a)

    response = auth_client.patch(
        f"/api/work-items/{item.id}/",
        {"title": "New title", "release": release_b.id},
        content_type="application/json",
    )

    assert response.status_code == 200
    item.refresh_from_db()
    assert item.title == "New title"
    assert item.release_id == release_b.id


@pytest.mark.django_db
def test_release_work_items_lists_only_items_assigned_to_it(auth_client, board, project, status):
    release = Release.objects.create(project=project, name="v2.3")
    other_release = Release.objects.create(project=project, name="v2.4.0")
    tagged = WorkItem.objects.create(board=board, title="Tagged", status=status, release=release)
    WorkItem.objects.create(board=board, title="Untagged", status=status)
    WorkItem.objects.create(board=board, title="Different release", status=status, release=other_release)

    response = auth_client.get(f"/api/projects/{project.id}/releases/{release.id}/work-items/")
    assert response.status_code == 200
    ids = [item["id"] for item in response.json()]
    assert ids == [tagged.id]


@pytest.mark.django_db
def test_a_non_member_cannot_view_release_work_items(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    release = Release.objects.create(project=foreign, name="v1.0")

    assert auth_client.get(f"/api/projects/{foreign.id}/releases/{release.id}/work-items/").status_code == 403
