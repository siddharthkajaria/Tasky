import pytest

from boards.models import Board, Component, Label, WorkItem, WorkItemStatus
from boards.services import seed_default_statuses


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def epic(board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    return WorkItem.objects.create(
        board=board, title="Redesign onboarding", description="A big project",
        item_type="epic", status=status, created_by=None,
    )


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client):
    assert client.get("/api/search/?q=redesign").status_code == 403


@pytest.mark.django_db
def test_a_bare_request_with_no_q_or_facet_is_rejected(auth_client):
    response = auth_client.get("/api/search/")
    assert response.status_code == 400


@pytest.mark.django_db
def test_a_one_character_q_is_rejected(auth_client):
    response = auth_client.get("/api/search/?q=a")
    assert response.status_code == 400
    assert "q" in response.json()


@pytest.mark.django_db
def test_a_title_match_is_found(auth_client, epic):
    response = auth_client.get("/api/search/?q=onboarding")
    assert response.status_code == 200
    body = response.json()
    assert body["results"][0]["id"] == epic.id
    assert body["results"][0]["key"] == epic.key
    assert body["results"][0]["item_type"] == "epic"
    assert body["results"][0]["status_detail"]["category"] == "todo"


@pytest.mark.django_db
def test_a_key_match_is_found(auth_client, epic):
    response = auth_client.get(f"/api/search/?q={epic.key}")
    assert response.status_code == 200
    assert response.json()["results"][0]["id"] == epic.id


@pytest.mark.django_db
def test_title_matches_rank_above_description_only_matches(auth_client, board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    title_match = WorkItem.objects.create(
        board=board, title="Fix the widget", description="", status=status, created_by=None,
    )
    description_match = WorkItem.objects.create(
        board=board, title="Unrelated", description="Contains widget somewhere", status=status, created_by=None,
    )
    response = auth_client.get("/api/search/?q=widget")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids.index(title_match.id) < ids.index(description_match.id)


@pytest.mark.django_db
def test_results_never_include_a_project_im_not_a_member_of(auth_client, other_user, epic):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    foreign_board = Board.objects.create(name="B", created_by=other_user, project=foreign)
    foreign_status = WorkItemStatus.objects.filter(project=foreign, category="todo").first()
    WorkItem.objects.create(
        board=foreign_board, title="Redesign onboarding elsewhere",
        status=foreign_status, created_by=None,
    )

    response = auth_client.get("/api/search/?q=onboarding")
    ids = [r["id"] for r in response.json()["results"]]
    assert epic.id in ids
    assert len(ids) == 1


@pytest.mark.django_db
def test_item_type_facet_filters(auth_client, board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    bug = WorkItem.objects.create(board=board, title="A bug", item_type="bug", status=status, created_by=None)
    WorkItem.objects.create(board=board, title="A task", item_type="task", status=status, created_by=None)

    response = auth_client.get("/api/search/?item_type=bug")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids == [bug.id]


@pytest.mark.django_db
def test_status_category_facet_filters_by_category_not_literal_status(auth_client, board, project):
    seed_default_statuses(project)
    done_status = WorkItemStatus.objects.filter(project=project, category="done").first()
    item = WorkItem.objects.create(board=board, title="Finished thing", status=done_status, created_by=None)

    response = auth_client.get("/api/search/?status_category=done")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids == [item.id]


@pytest.mark.django_db
def test_priority_facet_filters(auth_client, board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    high = WorkItem.objects.create(board=board, title="Urgent", priority=3, status=status, created_by=None)
    WorkItem.objects.create(board=board, title="Normal", priority=2, status=status, created_by=None)

    response = auth_client.get("/api/search/?priority=3")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids == [high.id]


@pytest.mark.django_db
def test_assignee_facet_filters(auth_client, board, project, user):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    mine = WorkItem.objects.create(board=board, title="Mine", assignee=user, status=status, created_by=None)
    WorkItem.objects.create(board=board, title="Unassigned", status=status, created_by=None)

    response = auth_client.get(f"/api/search/?assignee={user.id}")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids == [mine.id]


@pytest.mark.django_db
def test_assignee_facet_with_unknown_id_is_rejected(auth_client):
    response = auth_client.get("/api/search/?assignee=999999")
    assert response.status_code == 400
    assert "assignee" in response.json()


@pytest.mark.django_db
def test_component_facet_filters(auth_client, board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    component = Component.objects.create(project=project, name="Backend")
    item = WorkItem.objects.create(board=board, title="Backend work", status=status, created_by=None)
    item.components.add(component)
    WorkItem.objects.create(board=board, title="Other work", status=status, created_by=None)

    response = auth_client.get(f"/api/search/?component={component.id}")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids == [item.id]


@pytest.mark.django_db
def test_component_facet_from_a_project_im_not_in_is_rejected(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    foreign_component = Component.objects.create(project=foreign, name="Foreign")

    response = auth_client.get(f"/api/search/?component={foreign_component.id}")
    assert response.status_code == 400
    assert "component" in response.json()


@pytest.mark.django_db
def test_label_facet_filters_by_id_and_by_name(auth_client, board, project):
    from boards.models import Label as LabelModel

    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    label = LabelModel.objects.create(name="urgent", color="#A32218", created_by=None)
    item = WorkItem.objects.create(board=board, title="Tagged", status=status, created_by=None)
    item.labels.add(label)

    by_id = auth_client.get(f"/api/search/?label={label.id}")
    by_name = auth_client.get("/api/search/?label=URGENT")
    assert [r["id"] for r in by_id.json()["results"]] == [item.id]
    assert [r["id"] for r in by_name.json()["results"]] == [item.id]


@pytest.mark.django_db
def test_label_facet_with_unknown_name_is_rejected(auth_client):
    response = auth_client.get("/api/search/?label=nonexistent")
    assert response.status_code == 400
    assert "label" in response.json()


@pytest.mark.django_db
def test_project_facet_narrows_to_one_project(auth_client, board, project, user):
    from projects.models import Project, ProjectMembership

    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    in_project = WorkItem.objects.create(board=board, title="Shared term", status=status, created_by=None)

    other = Project.objects.create(key="OTHER", name="Elsewhere")
    ProjectMembership.objects.create(project=other, user=user, role="owner")
    other_board = Board.objects.create(name="Other Board", created_by=user, project=other)
    other_status = WorkItemStatus.objects.filter(project=other, category="todo").first()
    WorkItem.objects.create(board=other_board, title="Shared term too", status=other_status, created_by=None)

    response = auth_client.get(f"/api/search/?q=shared&project={project.id}")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids == [in_project.id]


@pytest.mark.django_db
def test_project_facet_for_a_project_im_not_in_is_rejected(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")

    response = auth_client.get(f"/api/search/?item_type=bug&project={foreign.id}")
    assert response.status_code == 400
    assert "project" in response.json()


@pytest.mark.django_db
def test_invalid_item_type_is_rejected(auth_client):
    response = auth_client.get("/api/search/?item_type=nonsense")
    assert response.status_code == 400


@pytest.mark.django_db
def test_invalid_status_category_is_rejected(auth_client):
    response = auth_client.get("/api/search/?status_category=nonsense")
    assert response.status_code == 400


@pytest.mark.django_db
def test_invalid_priority_is_rejected(auth_client):
    response = auth_client.get("/api/search/?priority=nonsense")
    assert response.status_code == 400


@pytest.mark.django_db
def test_no_matches_returns_an_empty_list_not_an_error(auth_client, epic):
    response = auth_client.get("/api/search/?q=zzzznonexistentzzzz")
    assert response.status_code == 200
    assert response.json()["results"] == []


@pytest.mark.django_db
def test_a_facet_only_search_needs_no_q(auth_client, board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    item = WorkItem.objects.create(board=board, title="Anything", item_type="bug", status=status, created_by=None)
    response = auth_client.get("/api/search/?item_type=bug")
    assert response.status_code == 200
    assert [r["id"] for r in response.json()["results"]] == [item.id]


@pytest.mark.django_db
def test_results_are_capped_at_50(auth_client, board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    for i in range(55):
        WorkItem.objects.create(board=board, title=f"Widget {i}", status=status, created_by=None)
    response = auth_client.get("/api/search/?q=widget")
    assert len(response.json()["results"]) == 50
