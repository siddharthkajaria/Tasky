import pytest

from boards.models import Board, Component, Label, WorkItem, WorkItemStatus


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def three_items(board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    return [
        WorkItem.objects.create(board=board, title=f"Item {i}", status=status, created_by=None)
        for i in range(3)
    ]


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client):
    assert client.post("/api/work-items/bulk-move/", {"ids": [1], "status": 1}, content_type="application/json").status_code == 403


@pytest.mark.django_db
def test_bulk_move_moves_every_item_to_the_target_status(auth_client, project, three_items):
    target = WorkItemStatus.objects.filter(project=project, category="done").first()
    ids = [i.id for i in three_items]
    response = auth_client.post(
        "/api/work-items/bulk-move/", {"ids": ids, "status": target.id}, content_type="application/json"
    )
    assert response.status_code == 200
    body = response.json()
    assert sorted(body["succeeded"]) == sorted(ids)
    assert body["failed"] == []
    for item in three_items:
        item.refresh_from_db()
        assert item.status_id == target.id


@pytest.mark.django_db
def test_bulk_move_rejects_a_status_from_another_project(auth_client, project, three_items, user):
    from projects.models import Project, ProjectMembership

    other = Project.objects.create(key="OTHER", name="Elsewhere")
    ProjectMembership.objects.create(project=other, user=user, role="owner")
    foreign_status = WorkItemStatus.objects.create(project=other, name="Doing", category="in_progress", position=0)

    response = auth_client.post(
        "/api/work-items/bulk-move/",
        {"ids": [three_items[0].id], "status": foreign_status.id},
        content_type="application/json",
    )
    assert response.status_code == 400
    three_items[0].refresh_from_db()
    assert three_items[0].status_id != foreign_status.id


@pytest.mark.django_db
def test_an_id_that_no_longer_exists_lands_in_failed_rest_proceeds(auth_client, project, three_items):
    target = WorkItemStatus.objects.filter(project=project, category="done").first()
    ids = [three_items[0].id, three_items[1].id, 999999]
    response = auth_client.post(
        "/api/work-items/bulk-move/", {"ids": ids, "status": target.id}, content_type="application/json"
    )
    assert response.status_code == 200
    body = response.json()
    assert sorted(body["succeeded"]) == sorted(ids[:2])
    assert body["failed"] == [{"id": 999999, "error": "Not found."}]


@pytest.mark.django_db
def test_ids_spanning_two_projects_is_rejected_before_any_write(auth_client, project, three_items, user):
    from projects.models import Project, ProjectMembership

    other = Project.objects.create(key="OTHER", name="Elsewhere")
    ProjectMembership.objects.create(project=other, user=user, role="owner")
    other_board = Board.objects.create(name="Other Board", created_by=user, project=other)
    other_status = WorkItemStatus.objects.filter(project=other, category="todo").first()
    foreign_item = WorkItem.objects.create(board=other_board, title="Foreign", status=other_status, created_by=None)

    target = WorkItemStatus.objects.filter(project=project, category="done").first()
    response = auth_client.post(
        "/api/work-items/bulk-move/",
        {"ids": [three_items[0].id, foreign_item.id], "status": target.id},
        content_type="application/json",
    )
    assert response.status_code == 400
    three_items[0].refresh_from_db()
    assert three_items[0].status_id != target.id


@pytest.mark.django_db
def test_bulk_move_ids_empty_or_over_200_is_rejected(auth_client, project, three_items):
    target = WorkItemStatus.objects.filter(project=project, category="done").first()
    empty = auth_client.post("/api/work-items/bulk-move/", {"ids": [], "status": target.id}, content_type="application/json")
    assert empty.status_code == 400
    too_many = auth_client.post(
        "/api/work-items/bulk-move/", {"ids": list(range(1, 202)), "status": target.id}, content_type="application/json"
    )
    assert too_many.status_code == 400


@pytest.mark.django_db
def test_a_non_member_is_rejected(auth_client, other_user, project, three_items):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    board = Board.objects.create(name="B", created_by=other_user, project=foreign)
    status = WorkItemStatus.objects.filter(project=foreign, category="todo").first()
    item = WorkItem.objects.create(board=board, title="X", status=status, created_by=None)
    # `status` above is None (no default statuses exist yet for this brand-new
    # project) — WorkItem.save() lazily seeds and assigns them, but only on
    # `item.status`, not this local variable. Use the resolved id instead.

    response = auth_client.post(
        "/api/work-items/bulk-move/", {"ids": [item.id], "status": item.status_id}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_bulk_update_sets_assignee_and_priority_on_every_item(auth_client, project, three_items, user):
    ids = [i.id for i in three_items]
    response = auth_client.post(
        "/api/work-items/bulk-update/",
        {"ids": ids, "assignee": user.id, "priority": 3},
        content_type="application/json",
    )
    assert response.status_code == 200
    assert sorted(response.json()["succeeded"]) == sorted(ids)
    for item in three_items:
        item.refresh_from_db()
        assert item.assignee_id == user.id
        assert item.priority == 3


@pytest.mark.django_db
def test_bulk_update_assignee_null_clears_it(auth_client, project, three_items, user):
    three_items[0].assignee = user
    three_items[0].save(update_fields=["assignee"])
    response = auth_client.post(
        "/api/work-items/bulk-update/",
        {"ids": [three_items[0].id], "assignee": None},
        content_type="application/json",
    )
    assert response.status_code == 200
    three_items[0].refresh_from_db()
    assert three_items[0].assignee_id is None


@pytest.mark.django_db
def test_bulk_update_unknown_assignee_rejects_whole_request(auth_client, project, three_items):
    response = auth_client.post(
        "/api/work-items/bulk-update/",
        {"ids": [three_items[0].id], "assignee": 999999},
        content_type="application/json",
    )
    assert response.status_code == 400
    three_items[0].refresh_from_db()
    assert three_items[0].assignee_id is None


@pytest.mark.django_db
def test_bulk_update_labels_add_reuses_existing_and_creates_new(auth_client, project, three_items):
    existing = Label.objects.create(name="urgent", color="#A32218", created_by=None)
    response = auth_client.post(
        "/api/work-items/bulk-update/",
        {"ids": [i.id for i in three_items], "labels_add": ["urgent", "brand-new"]},
        content_type="application/json",
    )
    assert response.status_code == 200
    assert Label.objects.filter(name__iexact="urgent").count() == 1
    for item in three_items:
        item.refresh_from_db()
        names = set(item.labels.values_list("name", flat=True))
        assert names == {"urgent", "brand-new"}
    assert Label.objects.get(name="urgent").id == existing.id


@pytest.mark.django_db
def test_bulk_update_labels_add_is_additive_not_replace(auth_client, project, three_items):
    pre_existing = Label.objects.create(name="keep-me", color="#2E7D5B", created_by=None)
    three_items[0].labels.set([pre_existing])
    response = auth_client.post(
        "/api/work-items/bulk-update/",
        {"ids": [three_items[0].id], "labels_add": ["also-this"]},
        content_type="application/json",
    )
    assert response.status_code == 200
    three_items[0].refresh_from_db()
    names = set(three_items[0].labels.values_list("name", flat=True))
    assert names == {"keep-me", "also-this"}


@pytest.mark.django_db
def test_bulk_update_components_add_rejects_component_from_another_project(auth_client, project, three_items, user):
    from projects.models import Project, ProjectMembership

    other = Project.objects.create(key="OTHER", name="Elsewhere")
    ProjectMembership.objects.create(project=other, user=user, role="owner")
    foreign_component = Component.objects.create(project=other, name="Foreign")

    response = auth_client.post(
        "/api/work-items/bulk-update/",
        {"ids": [three_items[0].id], "components_add": [foreign_component.id]},
        content_type="application/json",
    )
    assert response.status_code == 400
    three_items[0].refresh_from_db()
    assert three_items[0].components.count() == 0


@pytest.mark.django_db
def test_bulk_delete_removes_every_item_and_orphans_children(auth_client, project, board, three_items):
    child = WorkItem.objects.create(
        board=board, title="Child", parent=three_items[0],
        status=three_items[0].status, item_type="subtask", created_by=None,
    )
    response = auth_client.post(
        "/api/work-items/bulk-delete/", {"ids": [three_items[0].id]}, content_type="application/json"
    )
    assert response.status_code == 200
    assert response.json()["deleted"] == [three_items[0].id]
    assert not WorkItem.objects.filter(id=three_items[0].id).exists()
    child.refresh_from_db()
    assert child.parent_id is None
