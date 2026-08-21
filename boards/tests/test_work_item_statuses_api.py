import pytest

from boards.models import WorkItemStatus
from boards.services import seed_default_statuses


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client, project):
    assert client.get(f"/api/projects/{project.id}/statuses/").status_code == 403


@pytest.mark.django_db
def test_a_non_member_cannot_view_statuses(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")

    assert auth_client.get(f"/api/projects/{foreign.id}/statuses/").status_code == 403


@pytest.mark.django_db
def test_a_fresh_project_created_through_the_api_has_3_default_statuses(auth_client):
    response = auth_client.post(
        "/api/projects/", {"key": "FRESH", "name": "Fresh Project"}, content_type="application/json"
    )
    assert response.status_code == 201
    project_id = response.json()["id"]

    listed = auth_client.get(f"/api/projects/{project_id}/statuses/")
    names_and_categories = sorted(
        (s["name"], s["category"]) for s in listed.json()
    )
    assert names_and_categories == [
        ("Done", "done"), ("In Progress", "in_progress"), ("To Do", "todo"),
    ]


@pytest.mark.django_db
def test_seed_default_statuses_is_idempotent(project):
    first = seed_default_statuses(project)
    second = seed_default_statuses(project)
    assert first["todo"].id == second["todo"].id
    assert WorkItemStatus.objects.filter(project=project).count() == 3


@pytest.mark.django_db
def test_owner_can_add_a_custom_status(auth_client, project):
    seed_default_statuses(project)
    response = auth_client.post(
        f"/api/projects/{project.id}/statuses/",
        {"name": "Blocked", "category": "in_progress"},
        content_type="application/json",
    )
    assert response.status_code == 201
    status = WorkItemStatus.objects.get(project=project, name="Blocked")
    assert status.category == "in_progress"
    assert status.position == 3


@pytest.mark.django_db
def test_a_plain_member_cannot_add_a_status(auth_client, project):
    from projects.models import ProjectMembership

    seed_default_statuses(project)
    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    response = auth_client.post(
        f"/api/projects/{project.id}/statuses/",
        {"name": "Blocked", "category": "in_progress"},
        content_type="application/json",
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_duplicate_status_name_in_the_same_project_is_rejected(auth_client, project):
    statuses = seed_default_statuses(project)
    response = auth_client.post(
        f"/api/projects/{project.id}/statuses/",
        {"name": "to do", "category": "todo"},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert WorkItemStatus.objects.filter(project=project).count() == 3


@pytest.mark.django_db
def test_owner_can_rename_a_status(auth_client, project):
    statuses = seed_default_statuses(project)
    response = auth_client.patch(
        f"/api/projects/{project.id}/statuses/{statuses['todo'].id}/",
        {"name": "Backlog"},
        content_type="application/json",
    )
    assert response.status_code == 200
    statuses["todo"].refresh_from_db()
    assert statuses["todo"].name == "Backlog"


@pytest.mark.django_db
def test_recategorizing_a_status_is_rejected_if_it_would_empty_a_category(auth_client, project):
    statuses = seed_default_statuses(project)
    response = auth_client.patch(
        f"/api/projects/{project.id}/statuses/{statuses['done'].id}/",
        {"category": "in_progress"},
        content_type="application/json",
    )
    assert response.status_code == 400
    statuses["done"].refresh_from_db()
    assert statuses["done"].category == "done"


@pytest.mark.django_db
def test_recategorizing_a_status_succeeds_when_another_remains_in_its_old_category(auth_client, project):
    statuses = seed_default_statuses(project)
    extra = WorkItemStatus.objects.create(project=project, name="Also Done", category="done", position=3)

    response = auth_client.patch(
        f"/api/projects/{project.id}/statuses/{statuses['done'].id}/",
        {"category": "in_progress"},
        content_type="application/json",
    )
    assert response.status_code == 200
    statuses["done"].refresh_from_db()
    assert statuses["done"].category == "in_progress"


@pytest.mark.django_db
def test_reordering_a_status(auth_client, project):
    statuses = seed_default_statuses(project)
    response = auth_client.patch(
        f"/api/projects/{project.id}/statuses/{statuses['done'].id}/",
        {"position": 0},
        content_type="application/json",
    )
    assert response.status_code == 200
    statuses["todo"].refresh_from_db()
    statuses["done"].refresh_from_db()
    assert statuses["done"].position == 0
    assert statuses["todo"].position == 1


@pytest.mark.django_db
def test_reordering_with_a_non_numeric_position_is_rejected(auth_client, project):
    statuses = seed_default_statuses(project)
    response = auth_client.patch(
        f"/api/projects/{project.id}/statuses/{statuses['todo'].id}/",
        {"position": "not-a-number"},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "position" in response.json()


@pytest.mark.django_db
def test_deleting_an_unused_status_succeeds(auth_client, project):
    statuses = seed_default_statuses(project)
    extra = WorkItemStatus.objects.create(project=project, name="Blocked", category="in_progress", position=3)

    response = auth_client.delete(f"/api/projects/{project.id}/statuses/{extra.id}/")
    assert response.status_code == 204


@pytest.mark.django_db
def test_deleting_the_last_status_in_a_category_is_rejected(auth_client, project):
    statuses = seed_default_statuses(project)
    response = auth_client.delete(f"/api/projects/{project.id}/statuses/{statuses['done'].id}/")
    assert response.status_code == 400
    assert WorkItemStatus.objects.filter(id=statuses["done"].id).exists()


@pytest.mark.django_db
def test_statuses_are_scoped_per_project(auth_client, project, user):
    from projects.models import Project, ProjectMembership

    other_project = Project.objects.create(key="OTHER", name="Elsewhere")
    ProjectMembership.objects.create(project=other_project, user=user, role="owner")
    seed_default_statuses(project)
    seed_default_statuses(other_project)

    response = auth_client.get(f"/api/projects/{project.id}/statuses/")
    assert len(response.json()) == 3
    names = {s["name"] for s in response.json()}
    assert names == {"To Do", "In Progress", "Done"}
