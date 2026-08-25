import pytest

from boards.models import Board, Sprint, WorkItem, WorkItemStatus
from boards.services import seed_default_statuses


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def status(board, project):
    seed_default_statuses(project)
    return WorkItemStatus.objects.filter(project=project, category="todo").first()


@pytest.mark.django_db
def test_a_new_work_item_defaults_to_the_backlog(auth_client, board):
    response = auth_client.post(
        "/api/work-items/", {"board": board.id, "title": "X"}, content_type="application/json"
    )
    assert response.status_code == 201
    assert response.json()["sprint"] is None
    assert response.json()["sprint_detail"] is None


@pytest.mark.django_db
def test_create_rejects_a_sprint_from_a_different_board(auth_client, board, project, user):
    other_board = Board.objects.create(name="Other", created_by=user, project=project)
    other_sprint = Sprint.objects.create(board=other_board, name="S", created_by=None)
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "sprint": other_sprint.id},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "sprint" in response.json()
    assert not WorkItem.objects.filter(title="X").exists()


@pytest.mark.django_db
def test_create_rejects_a_completed_sprint(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None, state="completed")
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "sprint": sprint.id},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "sprint" in response.json()
    assert not WorkItem.objects.filter(title="X").exists()


@pytest.mark.django_db
def test_create_appends_to_the_end_of_the_backlog_not_position_zero(auth_client, board, status):
    # Simulates a backlog whose max backlog_position has already been
    # pushed above 0 by an earlier schedule/complete call — a brand-new
    # work item must still land after everything already there, not jump
    # to the top by defaulting to the model's backlog_position=0.
    existing = WorkItem.objects.create(
        board=board, title="Already there", status=status, backlog_position=5, created_by=None,
    )
    response = auth_client.post(
        "/api/work-items/", {"board": board.id, "title": "New"}, content_type="application/json"
    )
    assert response.status_code == 201
    new_item = WorkItem.objects.get(id=response.json()["id"])
    assert new_item.backlog_position == 6
    existing.refresh_from_db()
    assert existing.backlog_position == 5  # untouched


@pytest.mark.django_db
def test_patch_cannot_change_sprint_directly(auth_client, board, status):
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"sprint": sprint.id}, content_type="application/json"
    )
    assert response.status_code == 400
    assert "sprint" in response.json()
    item.refresh_from_db()
    assert item.sprint_id is None


@pytest.mark.django_db
def test_patch_echoing_back_the_current_unchanged_sprint_is_accepted(auth_client, board, status):
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"sprint": None, "title": "X renamed"}, content_type="application/json"
    )
    assert response.status_code == 200


@pytest.mark.django_db
def test_schedule_moves_an_item_from_backlog_into_a_sprint(auth_client, board, status):
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": sprint.id}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.sprint_id == sprint.id


@pytest.mark.django_db
def test_schedule_moves_an_item_back_to_the_backlog(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    item = WorkItem.objects.create(board=board, title="X", status=status, sprint=sprint, created_by=None)
    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": None}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.sprint_id is None


@pytest.mark.django_db
def test_schedule_appends_to_the_end_and_renumbers_in_payload_order(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    existing = WorkItem.objects.create(
        board=board, title="Already there", status=status, sprint=sprint, backlog_position=0, created_by=None,
    )
    a = WorkItem.objects.create(board=board, title="A", status=status, created_by=None)
    b = WorkItem.objects.create(board=board, title="B", status=status, created_by=None)

    auth_client.post(f"/api/work-items/{a.id}/schedule/", {"sprint": sprint.id}, content_type="application/json")
    auth_client.post(f"/api/work-items/{b.id}/schedule/", {"sprint": sprint.id}, content_type="application/json")

    existing.refresh_from_db()
    a.refresh_from_db()
    b.refresh_from_db()
    assert [existing.backlog_position, a.backlog_position, b.backlog_position] == [0, 1, 2]


@pytest.mark.django_db
def test_schedule_rejects_a_sprint_from_a_different_board(auth_client, board, status, project, user):
    other_board = Board.objects.create(name="Other", created_by=user, project=project)
    other_sprint = Sprint.objects.create(board=other_board, name="S", created_by=None)
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)

    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": other_sprint.id}, content_type="application/json"
    )
    assert response.status_code == 400
    item.refresh_from_db()
    assert item.sprint_id is None


@pytest.mark.django_db
def test_schedule_rejects_a_completed_sprint(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None, state="completed")
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": sprint.id}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_schedule_on_a_nonexistent_sprint_id_returns_400(auth_client, board, status):
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": 999999}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_status_and_sprint_never_constrain_each_other(auth_client, board, project):
    seed_default_statuses(project)
    done_status = WorkItemStatus.objects.filter(project=project, category="done").first()
    sprint = Sprint.objects.create(board=board, name="S", created_by=None, state="active")
    item = WorkItem.objects.create(board=board, title="X", status=done_status, created_by=None)
    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": None}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.status_id == done_status.id  # unchanged
    assert item.sprint_id is None  # in the backlog despite being Done


@pytest.mark.django_db
def test_backlog_lists_only_unscheduled_items_ordered_by_backlog_position(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    in_sprint = WorkItem.objects.create(board=board, title="In sprint", status=status, sprint=sprint, created_by=None)
    second = WorkItem.objects.create(board=board, title="Second", status=status, backlog_position=1, created_by=None)
    first = WorkItem.objects.create(board=board, title="First", status=status, backlog_position=0, created_by=None)

    response = auth_client.get(f"/api/boards/{board.id}/backlog/")
    assert response.status_code == 200
    ids = [item["id"] for item in response.json()]
    assert ids == [first.id, second.id]
    assert in_sprint.id not in ids


@pytest.mark.django_db
def test_sprint_work_items_lists_only_that_sprints_items_ordered_by_backlog_position(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    other_sprint = Sprint.objects.create(board=board, name="Other", created_by=None)
    second = WorkItem.objects.create(board=board, title="Second", status=status, sprint=sprint, backlog_position=1, created_by=None)
    first = WorkItem.objects.create(board=board, title="First", status=status, sprint=sprint, backlog_position=0, created_by=None)
    WorkItem.objects.create(board=board, title="Elsewhere", status=status, sprint=other_sprint, created_by=None)

    response = auth_client.get(f"/api/sprints/{sprint.id}/work-items/")
    assert response.status_code == 200
    ids = [item["id"] for item in response.json()]
    assert ids == [first.id, second.id]


@pytest.mark.django_db
def test_completing_a_sprint_returns_its_items_to_the_end_of_the_backlog(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None, state="active")
    pre_existing_backlog_item = WorkItem.objects.create(
        board=board, title="Already in backlog", status=status, backlog_position=0, created_by=None,
    )
    a = WorkItem.objects.create(board=board, title="A", status=status, sprint=sprint, backlog_position=0, created_by=None)
    b = WorkItem.objects.create(board=board, title="B", status=status, sprint=sprint, backlog_position=1, created_by=None)

    response = auth_client.post(f"/api/sprints/{sprint.id}/complete/")
    assert response.status_code == 200

    a.refresh_from_db()
    b.refresh_from_db()
    pre_existing_backlog_item.refresh_from_db()
    assert a.sprint_id is None
    assert b.sprint_id is None
    assert a.status_id == status.id  # untouched
    positions = sorted([pre_existing_backlog_item.backlog_position, a.backlog_position, b.backlog_position])
    assert positions == [0, 1, 2]


@pytest.mark.django_db
def test_deleting_a_planned_sprint_still_holding_items_is_rejected(auth_client, board, status):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    WorkItem.objects.create(board=board, title="X", status=status, sprint=sprint, created_by=None)
    response = auth_client.delete(f"/api/sprints/{sprint.id}/")
    assert response.status_code == 400
    assert Sprint.objects.filter(id=sprint.id).exists()


@pytest.mark.django_db
def test_deleting_an_empty_planned_sprint_still_succeeds(auth_client, board):
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    assert auth_client.delete(f"/api/sprints/{sprint.id}/").status_code == 204


@pytest.mark.django_db
def test_a_plain_member_can_use_schedule_no_separate_permission_check(auth_client, board, status, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    sprint = Sprint.objects.create(board=board, name="S", created_by=None)
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    response = auth_client.post(
        f"/api/work-items/{item.id}/schedule/", {"sprint": sprint.id}, content_type="application/json"
    )
    assert response.status_code == 200


@pytest.mark.django_db
def test_a_non_member_cannot_use_backlog_sprint_items_or_schedule(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    foreign_board = Board.objects.create(name="B", created_by=other_user, project=foreign)
    foreign_status = WorkItemStatus.objects.filter(project=foreign, category="todo").first()
    foreign_sprint = Sprint.objects.create(board=foreign_board, name="S", created_by=None)
    foreign_item = WorkItem.objects.create(board=foreign_board, title="X", status=foreign_status, created_by=None)

    assert auth_client.get(f"/api/boards/{foreign_board.id}/backlog/").status_code == 403
    assert auth_client.get(f"/api/sprints/{foreign_sprint.id}/work-items/").status_code == 403
    assert auth_client.post(f"/api/work-items/{foreign_item.id}/schedule/", {"sprint": None}, content_type="application/json").status_code == 403
