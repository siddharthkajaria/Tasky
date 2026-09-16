import pytest

from boards.models import CustomField, FieldOption
from projects.models import ProjectMembership


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client):
    assert client.get("/api/fields/").status_code == 403


@pytest.mark.django_db
def test_owner_of_any_project_can_create_a_field(auth_client, project, user):
    response = auth_client.post(
        "/api/fields/", {"name": "Story Points", "field_type": "number"}, content_type="application/json"
    )
    assert response.status_code == 201
    field = CustomField.objects.get(name="Story Points")
    assert field.field_type == "number"
    assert field.created_by == user


@pytest.mark.django_db
def test_a_plain_member_cannot_create_a_field(auth_client, project):
    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    response = auth_client.post(
        "/api/fields/", {"name": "Story Points", "field_type": "number"}, content_type="application/json"
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_being_owner_of_any_project_is_enough_not_necessarily_a_specific_one(auth_client, user):
    """No `project` fixture here on purpose — CustomField isn't scoped to
    any project, so this proves ownership of *some* unrelated project is
    what the check actually keys on, not membership in a project the
    request happens to reference (there isn't one)."""
    from projects.models import Project, ProjectMembership

    somewhere = Project.objects.create(key="SOMEWHERE", name="Somewhere")
    ProjectMembership.objects.create(project=somewhere, user=user, role="owner")

    response = auth_client.post(
        "/api/fields/", {"name": "Severity", "field_type": "select"}, content_type="application/json"
    )
    assert response.status_code == 201


@pytest.mark.django_db
def test_duplicate_field_name_is_rejected_case_insensitively(auth_client, project):
    CustomField.objects.create(name="Story Points", field_type="number", created_by=None)
    response = auth_client.post(
        "/api/fields/", {"name": "story points", "field_type": "number"}, content_type="application/json"
    )
    assert response.status_code == 400
    # `CustomFieldSerializer.validate_name` is the hand-written,
    # case-insensitive duplicate check — it must be the one that actually
    # runs. `name` is `unique=True` on the model, so DRF auto-attaches a
    # `UniqueValidator` that runs first unless the serializer disables it;
    # left unchecked, that validator's own generic message ("custom field
    # with this name already exists.") wins instead and this hand-written
    # wording never executes.
    assert response.json() == {"name": ['"story points" already exists.']}


@pytest.mark.django_db
def test_owner_can_rename_a_field(auth_client, project):
    field = CustomField.objects.create(name="Old name", field_type="text_short", created_by=None)
    response = auth_client.patch(f"/api/fields/{field.id}/", {"name": "New name"}, content_type="application/json")
    assert response.status_code == 200
    field.refresh_from_db()
    assert field.name == "New name"


@pytest.mark.django_db
def test_field_type_cannot_be_changed(auth_client, project):
    field = CustomField.objects.create(name="Points", field_type="number", created_by=None)
    response = auth_client.patch(
        f"/api/fields/{field.id}/", {"field_type": "text_short"}, content_type="application/json"
    )
    assert response.status_code == 400
    assert "field_type" in response.json()
    field.refresh_from_db()
    assert field.field_type == "number"


@pytest.mark.django_db
def test_patching_field_type_to_its_own_current_value_is_a_no_op(auth_client, project):
    field = CustomField.objects.create(name="Points", field_type="number", created_by=None)
    response = auth_client.patch(
        f"/api/fields/{field.id}/", {"field_type": "number", "name": "Story Points"}, content_type="application/json"
    )
    assert response.status_code == 200


@pytest.mark.django_db
def test_owner_can_delete_an_unused_field(auth_client, project):
    """This task's `CustomFieldViewSet.perform_destroy` has no in-use guard
    yet — `ScreenField` doesn't exist until Task 2, which is also where the
    "still on a screen, rejected" guard and its test get added."""
    field = CustomField.objects.create(name="Doomed", field_type="text_short", created_by=None)
    assert auth_client.delete(f"/api/fields/{field.id}/").status_code == 204
    assert not CustomField.objects.filter(id=field.id).exists()


@pytest.mark.django_db
def test_adding_an_option_to_a_select_field(auth_client, project):
    field = CustomField.objects.create(name="Severity", field_type="select", created_by=None)
    response = auth_client.post(
        f"/api/fields/{field.id}/options/", {"label": "High"}, content_type="application/json"
    )
    assert response.status_code == 201
    option = FieldOption.objects.get(field=field, label="High")
    assert option.position == 0


@pytest.mark.django_db
def test_adding_an_option_to_a_non_option_field_is_rejected(auth_client, project):
    field = CustomField.objects.create(name="Points", field_type="number", created_by=None)
    response = auth_client.post(
        f"/api/fields/{field.id}/options/", {"label": "High"}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_duplicate_option_label_on_the_same_field_is_rejected(auth_client, project):
    field = CustomField.objects.create(name="Severity", field_type="select", created_by=None)
    FieldOption.objects.create(field=field, label="High", position=0)
    response = auth_client.post(
        f"/api/fields/{field.id}/options/", {"label": "high"}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_reordering_options(auth_client, project):
    field = CustomField.objects.create(name="Severity", field_type="select", created_by=None)
    low = FieldOption.objects.create(field=field, label="Low", position=0)
    high = FieldOption.objects.create(field=field, label="High", position=1)

    response = auth_client.patch(
        f"/api/fields/{field.id}/options/{high.id}/", {"position": 0}, content_type="application/json"
    )
    assert response.status_code == 200
    low.refresh_from_db()
    high.refresh_from_db()
    assert (high.position, low.position) == (0, 1)


@pytest.mark.django_db
def test_deleting_an_unused_option_renumbers_the_rest(auth_client, project):
    field = CustomField.objects.create(name="Severity", field_type="select", created_by=None)
    low = FieldOption.objects.create(field=field, label="Low", position=0)
    mid = FieldOption.objects.create(field=field, label="Mid", position=1)
    high = FieldOption.objects.create(field=field, label="High", position=2)

    response = auth_client.delete(f"/api/fields/{field.id}/options/{low.id}/")
    assert response.status_code == 204
    mid.refresh_from_db()
    high.refresh_from_db()
    assert (mid.position, high.position) == (0, 1)


@pytest.mark.django_db
def test_non_numeric_position_on_reorder_is_rejected(auth_client, project):
    field = CustomField.objects.create(name="Severity", field_type="select", created_by=None)
    option = FieldOption.objects.create(field=field, label="High", position=0)
    original_position = option.position

    response = auth_client.patch(
        f"/api/fields/{field.id}/options/{option.id}/", {"position": "not-a-number"}, content_type="application/json"
    )
    assert response.status_code == 400
    assert "position" in response.json()
    option.refresh_from_db()
    assert option.position == original_position
