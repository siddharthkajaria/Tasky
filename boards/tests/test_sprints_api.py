import pytest

from boards.models import Board, Sprint


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client, board):
    assert client.get(f"/api/boards/{board.id}/sprints/").status_code == 403


@pytest.mark.django_db
def test_any_member_can_list_sprints(auth_client, board, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    Sprint.objects.create(board=board, name="Sprint 1", created_by=None)
    response = auth_client.get(f"/api/boards/{board.id}/sprints/")
    assert response.status_code == 200
    assert response.json()[0]["name"] == "Sprint 1"


@pytest.mark.django_db
def test_owner_can_create_a_sprint(auth_client, board, user):
    response = auth_client.post(
        f"/api/boards/{board.id}/sprints/", {"name": "Sprint 14", "goal": "Ship it"}, content_type="application/json"
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Sprint 14"
    assert body["state"] == "planned"
    assert body["start_date"] is None
    sprint = Sprint.objects.get(pk=body["id"])
    assert sprint.created_by == user


@pytest.mark.django_db
def test_a_plain_member_cannot_create_a_sprint(auth_client, board, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    response = auth_client.post(
        f"/api/boards/{board.id}/sprints/", {"name": "Sprint 14"}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_a_non_member_cannot_create_a_sprint(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    foreign_board = Board.objects.create(name="B", created_by=other_user, project=foreign)
    response = auth_client.post(
        f"/api/boards/{foreign_board.id}/sprints/", {"name": "X"}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_owner_can_rename_a_sprint_and_set_its_goal(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="Old", created_by=None)
    response = auth_client.patch(
        f"/api/sprints/{sprint.id}/", {"name": "New", "goal": "A goal"}, content_type="application/json"
    )
    assert response.status_code == 200
    sprint.refresh_from_db()
    assert sprint.name == "New"
    assert sprint.goal == "A goal"


@pytest.mark.django_db
def test_patch_cannot_change_state_directly(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None)
    auth_client.patch(
        f"/api/sprints/{sprint.id}/", {"state": "active"}, content_type="application/json"
    )
    sprint.refresh_from_db()
    assert sprint.state == "planned"


@pytest.mark.django_db
def test_start_moves_a_planned_sprint_to_active_and_stamps_start_date(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None)
    response = auth_client.post(f"/api/sprints/{sprint.id}/start/")
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "active"
    assert body["start_date"] is not None


@pytest.mark.django_db
def test_starting_a_second_sprint_while_one_is_active_is_rejected(auth_client, board):
    Sprint.objects.create(board=board, name="First", created_by=None, state="active")
    second = Sprint.objects.create(board=board, name="Second", created_by=None)
    response = auth_client.post(f"/api/sprints/{second.id}/start/")
    assert response.status_code == 400
    second.refresh_from_db()
    assert second.state == "planned"


@pytest.mark.django_db
def test_starting_sprints_on_two_different_boards_both_succeed(auth_client, project, user):
    board_a = Board.objects.create(name="A", created_by=user, project=project)
    board_b = Board.objects.create(name="B", created_by=user, project=project)
    sprint_a = Sprint.objects.create(board=board_a, name="A1", created_by=None)
    sprint_b = Sprint.objects.create(board=board_b, name="B1", created_by=None)
    assert auth_client.post(f"/api/sprints/{sprint_a.id}/start/").status_code == 200
    assert auth_client.post(f"/api/sprints/{sprint_b.id}/start/").status_code == 200


@pytest.mark.django_db
def test_starting_a_non_planned_sprint_is_rejected(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None, state="completed")
    response = auth_client.post(f"/api/sprints/{sprint.id}/start/")
    assert response.status_code == 400


@pytest.mark.django_db
def test_complete_moves_an_active_sprint_to_completed_and_stamps_end_date(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None, state="active")
    response = auth_client.post(f"/api/sprints/{sprint.id}/complete/")
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "completed"
    assert body["end_date"] is not None


@pytest.mark.django_db
def test_completing_a_non_active_sprint_is_rejected(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None)
    response = auth_client.post(f"/api/sprints/{sprint.id}/complete/")
    assert response.status_code == 400


@pytest.mark.django_db
def test_owner_can_delete_a_planned_empty_sprint(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None)
    assert auth_client.delete(f"/api/sprints/{sprint.id}/").status_code == 204


@pytest.mark.django_db
def test_deleting_an_active_sprint_is_rejected(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None, state="active")
    response = auth_client.delete(f"/api/sprints/{sprint.id}/")
    assert response.status_code == 400
    assert Sprint.objects.filter(id=sprint.id).exists()


@pytest.mark.django_db
def test_deleting_a_completed_sprint_is_rejected(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="X", created_by=None, state="completed")
    response = auth_client.delete(f"/api/sprints/{sprint.id}/")
    assert response.status_code == 400


@pytest.mark.django_db
def test_a_plain_member_cannot_start_complete_or_delete_a_sprint(auth_client, board, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    planned = Sprint.objects.create(board=board, name="P", created_by=None)
    active = Sprint.objects.create(board=board, name="A", created_by=None, state="active")
    assert auth_client.post(f"/api/sprints/{planned.id}/start/").status_code == 403
    assert auth_client.post(f"/api/sprints/{active.id}/complete/").status_code == 403
    assert auth_client.delete(f"/api/sprints/{planned.id}/").status_code == 403


@pytest.mark.django_db
def test_genuinely_nonexistent_sprint_returns_404(auth_client):
    assert auth_client.get("/api/sprints/999999/").status_code == 404
    assert auth_client.post("/api/sprints/999999/start/").status_code == 404
