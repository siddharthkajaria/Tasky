import pytest

from boards.models import Board, WorkItem, WorkItemStatus
from boards.services import seed_default_statuses


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.mark.django_db
def test_a_new_work_item_defaults_to_the_todo_status(auth_client, board, project):
    seed_default_statuses(project)
    response = auth_client.post(
        "/api/work-items/", {"board": board.id, "title": "X"}, content_type="application/json"
    )
    assert response.status_code == 201
    body = response.json()
    assert body["status_detail"]["category"] == "todo"
    assert body["status_detail"]["name"] == "To Do"


@pytest.mark.django_db
def test_creating_a_work_item_with_an_explicit_status_still_works(auth_client, board, project):
    statuses = seed_default_statuses(project)
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "Started already", "status": statuses["in_progress"].id},
        content_type="application/json",
    )
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == statuses["in_progress"].id
    assert body["status_detail"]["name"] == "In Progress"


@pytest.mark.django_db
def test_a_work_item_created_for_a_project_with_no_statuses_yet_self_heals(auth_client, user):
    """Direct-ORM project creation (every test fixture, seed_demo, the admin)
    never calls ProjectViewSet.perform_create, so it never explicitly seeds
    default statuses. WorkItem.save() must seed them on the fly the first
    time a work item actually needs one — this is what keeps the rest of
    this codebase's existing tests working unmodified."""
    from projects.models import Project, ProjectMembership

    fresh_project = Project.objects.create(key="FRESH", name="Fresh")
    ProjectMembership.objects.create(project=fresh_project, user=user, role="owner")
    fresh_board = Board.objects.create(name="B", created_by=user, project=fresh_project)
    assert WorkItemStatus.objects.filter(project=fresh_project).count() == 0

    item = WorkItem.objects.create(board=fresh_board, title="First ever item")

    assert WorkItemStatus.objects.filter(project=fresh_project).count() == 3
    assert item.status.category == "todo"


@pytest.mark.django_db
def test_assigning_a_status_from_another_project_is_rejected(auth_client, board, project, user):
    from projects.models import Project, ProjectMembership

    other_project = Project.objects.create(key="OTHER", name="Elsewhere")
    ProjectMembership.objects.create(project=other_project, user=user, role="owner")
    other_statuses = seed_default_statuses(other_project)

    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "status": other_statuses["todo"].id},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "status" in response.json()


@pytest.mark.django_db
def test_move_rejects_a_status_from_another_project(auth_client, board, project, user):
    from projects.models import Project, ProjectMembership

    seed_default_statuses(project)
    item = WorkItem.objects.create(board=board, title="X")
    other_project = Project.objects.create(key="OTHER", name="Elsewhere")
    ProjectMembership.objects.create(project=other_project, user=user, role="owner")
    other_statuses = seed_default_statuses(other_project)

    response = auth_client.post(
        f"/api/work-items/{item.id}/move/",
        {"status": other_statuses["done"].id, "position": 0},
        content_type="application/json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_my_tasks_excludes_every_status_in_the_done_category(auth_client, board, project, user):
    statuses = seed_default_statuses(project)
    extra_done = WorkItemStatus.objects.create(project=project, name="Archived", category="done", position=3)

    WorkItem.objects.create(board=board, title="Still going", assignee=user, status=statuses["todo"])
    WorkItem.objects.create(board=board, title="Finished", assignee=user, status=statuses["done"])
    WorkItem.objects.create(board=board, title="Also finished", assignee=user, status=extra_done)

    response = auth_client.get("/api/me/tasks/")
    assert [item["title"] for item in response.json()] == ["Still going"]


@pytest.mark.django_db
def test_patching_status_directly_is_still_rejected(auth_client, board, project):
    statuses = seed_default_statuses(project)
    item = WorkItem.objects.create(board=board, title="Untouched", status=statuses["todo"])

    response = auth_client.patch(
        f"/api/work-items/{item.id}/",
        {"status": statuses["done"].id},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "status" in response.json()
    item.refresh_from_db()
    assert item.status_id == statuses["todo"].id


@pytest.mark.django_db
def test_patching_with_status_echoed_back_unchanged_still_updates_other_fields(auth_client, board, project):
    """The bug this task's Global Constraints section calls out by name:
    item.status (once accessed) is a WorkItemStatus instance, never equal
    to the raw id string PATCHed back — the immutability check must compare
    against item.status_id instead, or every echo-back would 400."""
    statuses = seed_default_statuses(project)
    item = WorkItem.objects.create(board=board, title="Before", status=statuses["todo"])

    response = auth_client.patch(
        f"/api/work-items/{item.id}/",
        {"status": statuses["todo"].id, "title": "After"},
        content_type="application/json",
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.title == "After"
    assert item.status_id == statuses["todo"].id


@pytest.mark.django_db
def test_deleting_a_status_still_used_by_a_work_item_is_rejected(auth_client, board, project):
    """The real guard on WorkItemStatusViewSet.perform_destroy, now that
    WorkItem.status is a real FK — Task 1 left this endpoint unguarded
    since WorkItem didn't reference WorkItemStatus yet at that point."""
    statuses = seed_default_statuses(project)
    WorkItem.objects.create(board=board, title="Uses it", status=statuses["todo"])

    response = auth_client.delete(f"/api/projects/{project.id}/statuses/{statuses['todo'].id}/")
    assert response.status_code == 400
    assert WorkItemStatus.objects.filter(id=statuses["todo"].id).exists()
