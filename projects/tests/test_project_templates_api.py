import pytest

from boards.models import Component, WorkItemStatus
from boards.services import STATUS_PRESETS
from projects.models import Project


@pytest.mark.django_db
def test_anonymous_callers_are_rejected_on_project_templates(client):
    assert client.get("/api/project-templates/").status_code == 403


@pytest.mark.django_db
def test_listing_project_templates(auth_client):
    """@pytest.mark.django_db is only here for auth_client's sake (it
    needs a `user` row to log in) — ProjectTemplateListView.get() itself
    reads only PROJECT_TEMPLATES/STATUS_PRESETS, both in-code constants,
    so this endpoint issues no query of its own; visible by inspection of
    the view, not asserted mechanically here (no query-count-assertion
    pattern exists elsewhere in this codebase to match)."""
    response = auth_client.get("/api/project-templates/")
    assert response.status_code == 200
    body = response.json()
    keys = [t["key"] for t in body]
    assert keys == ["blank", "software", "bugs"]

    software = next(t for t in body if t["key"] == "software")
    assert software["name"] == "Software Project"
    assert software["statuses"] == [{"name": n, "category": c} for n, c in STATUS_PRESETS["detailed"]]
    assert software["components"] == ["Frontend", "Backend", "Infrastructure"]


@pytest.mark.django_db
def test_post_or_delete_on_project_templates_is_not_allowed(auth_client):
    assert auth_client.post("/api/project-templates/", {}, content_type="application/json").status_code == 405
    assert auth_client.delete("/api/project-templates/").status_code == 405


@pytest.mark.django_db
def test_creating_a_project_with_no_template_produces_the_simple_preset(auth_client):
    response = auth_client.post(
        "/api/projects/", {"key": "NOTPL", "name": "No Template"}, content_type="application/json"
    )
    assert response.status_code == 201
    project = Project.objects.get(key="NOTPL")
    statuses = list(WorkItemStatus.objects.filter(project=project).order_by("position"))
    assert [(s.name, s.category) for s in statuses] == STATUS_PRESETS["simple"]
    assert not Component.objects.filter(project=project).exists()


@pytest.mark.django_db
def test_creating_a_project_with_the_software_template(auth_client):
    response = auth_client.post(
        "/api/projects/",
        {"key": "SOFT", "name": "Software Co", "template": "software"},
        content_type="application/json",
    )
    assert response.status_code == 201
    project = Project.objects.get(key="SOFT")
    statuses = list(WorkItemStatus.objects.filter(project=project).order_by("position"))
    assert [(s.name, s.category) for s in statuses] == STATUS_PRESETS["detailed"]
    component_names = set(Component.objects.filter(project=project).values_list("name", flat=True))
    assert component_names == {"Frontend", "Backend", "Infrastructure"}


@pytest.mark.django_db
def test_creating_a_project_with_the_bugs_template_has_no_components(auth_client):
    response = auth_client.post(
        "/api/projects/",
        {"key": "BUGZ", "name": "Bugs", "template": "bugs"},
        content_type="application/json",
    )
    assert response.status_code == 201
    project = Project.objects.get(key="BUGZ")
    statuses = list(WorkItemStatus.objects.filter(project=project).order_by("position"))
    assert [(s.name, s.category) for s in statuses] == STATUS_PRESETS["detailed"]
    assert not Component.objects.filter(project=project).exists()


@pytest.mark.django_db
def test_creating_a_project_with_an_invalid_template_is_rejected(auth_client):
    response = auth_client.post(
        "/api/projects/",
        {"key": "BAD", "name": "Bad", "template": "nonexistent"},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "template" in response.json()
    assert not Project.objects.filter(key="BAD").exists()


@pytest.mark.django_db
def test_a_templated_project_is_freely_editable_afterward(auth_client):
    response = auth_client.post(
        "/api/projects/",
        {"key": "EDIT", "name": "Editable", "template": "software"},
        content_type="application/json",
    )
    project_id = response.json()["id"]
    status = WorkItemStatus.objects.filter(project_id=project_id, name="To Do").get()
    component = Component.objects.filter(project_id=project_id, name="Frontend").get()

    # Both routes are project-nested — projects/<project_pk>/statuses/<pk>/
    # and projects/<project_pk>/components/<pk>/ — per boards/urls.py.
    rename = auth_client.patch(
        f"/api/projects/{project_id}/statuses/{status.id}/",
        {"name": "Todo (renamed)"}, content_type="application/json",
    )
    assert rename.status_code == 200

    delete = auth_client.delete(f"/api/projects/{project_id}/components/{component.id}/")
    assert delete.status_code == 204
