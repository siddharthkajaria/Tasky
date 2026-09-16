import pytest

from boards.models import CustomField, Screen, ScreenField


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client):
    assert client.get("/api/screens/").status_code == 403


@pytest.mark.django_db
def test_owner_can_create_a_screen(auth_client, project):
    response = auth_client.post("/api/screens/", {"name": "Bug screen"}, content_type="application/json")
    assert response.status_code == 201
    assert Screen.objects.filter(name="Bug screen").exists()


@pytest.mark.django_db
def test_a_plain_member_cannot_create_a_screen(auth_client, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    response = auth_client.post("/api/screens/", {"name": "Bug screen"}, content_type="application/json")
    assert response.status_code == 403


@pytest.mark.django_db
def test_duplicate_screen_name_is_rejected(auth_client, project):
    Screen.objects.create(name="Bug screen")
    response = auth_client.post("/api/screens/", {"name": "bug screen"}, content_type="application/json")
    assert response.status_code == 400
    # `ScreenSerializer.validate_name` is the hand-written, case-insensitive
    # duplicate check — it must be the one that actually runs. `name` is
    # `unique=True` on the model, so DRF auto-attaches a `UniqueValidator`
    # that runs first unless the serializer disables it; left unchecked,
    # that validator's own generic message ("screen with this name already
    # exists.") wins instead and this hand-written wording never executes.
    assert response.json() == {"name": ['"bug screen" already exists.']}


@pytest.mark.django_db
def test_owner_can_rename_a_screen(auth_client, project):
    screen = Screen.objects.create(name="Old name")
    response = auth_client.patch(f"/api/screens/{screen.id}/", {"name": "New name"}, content_type="application/json")
    assert response.status_code == 200
    screen.refresh_from_db()
    assert screen.name == "New name"


@pytest.mark.django_db
def test_owner_can_delete_a_screen(auth_client, project):
    """This task's `ScreenViewSet.perform_destroy` has no assignment guard
    yet — `ProjectScreenAssignment` doesn't exist until Task 3, which is
    also where the "still assigned, rejected" guard and its test get added,
    mirroring how Task 1's `CustomFieldViewSet.perform_destroy` is
    unguarded until Task 2 adds `ScreenField`."""
    screen = Screen.objects.create(name="Doomed")
    assert auth_client.delete(f"/api/screens/{screen.id}/").status_code == 204


@pytest.mark.django_db
def test_adding_a_field_to_a_screen(auth_client, project):
    screen = Screen.objects.create(name="Bug screen")
    field = CustomField.objects.create(name="Severity", field_type="select", created_by=None)

    response = auth_client.post(
        f"/api/screens/{screen.id}/fields/", {"field": field.id}, content_type="application/json"
    )
    assert response.status_code == 201
    row = ScreenField.objects.get(screen=screen, field=field)
    assert row.position == 0
    assert row.required is False


@pytest.mark.django_db
def test_adding_the_same_field_twice_is_rejected(auth_client, project):
    screen = Screen.objects.create(name="Bug screen")
    field = CustomField.objects.create(name="Severity", field_type="select", created_by=None)
    ScreenField.objects.create(screen=screen, field=field, position=0)

    response = auth_client.post(
        f"/api/screens/{screen.id}/fields/", {"field": field.id}, content_type="application/json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_toggling_required_on_a_screen_field(auth_client, project):
    screen = Screen.objects.create(name="Bug screen")
    field = CustomField.objects.create(name="Severity", field_type="select", created_by=None)
    row = ScreenField.objects.create(screen=screen, field=field, position=0)

    response = auth_client.patch(
        f"/api/screens/{screen.id}/fields/{row.id}/", {"required": True}, content_type="application/json"
    )
    assert response.status_code == 200
    row.refresh_from_db()
    assert row.required is True


@pytest.mark.django_db
def test_the_same_field_can_be_required_on_one_screen_and_optional_on_another(auth_client, project):
    field = CustomField.objects.create(name="Severity", field_type="select", created_by=None)
    screen_a = Screen.objects.create(name="A")
    screen_b = Screen.objects.create(name="B")
    row_a = ScreenField.objects.create(screen=screen_a, field=field, position=0, required=True)
    row_b = ScreenField.objects.create(screen=screen_b, field=field, position=0, required=False)

    row_a.refresh_from_db()
    row_b.refresh_from_db()
    assert row_a.required is True
    assert row_b.required is False


@pytest.mark.django_db
def test_reordering_screen_fields(auth_client, project):
    screen = Screen.objects.create(name="Bug screen")
    field_a = CustomField.objects.create(name="A", field_type="text_short", created_by=None)
    field_b = CustomField.objects.create(name="B", field_type="text_short", created_by=None)
    row_a = ScreenField.objects.create(screen=screen, field=field_a, position=0)
    row_b = ScreenField.objects.create(screen=screen, field=field_b, position=1)

    response = auth_client.patch(
        f"/api/screens/{screen.id}/fields/{row_b.id}/", {"position": 0}, content_type="application/json"
    )
    assert response.status_code == 200
    row_a.refresh_from_db()
    row_b.refresh_from_db()
    assert (row_b.position, row_a.position) == (0, 1)


@pytest.mark.django_db
def test_removing_a_field_from_a_screen_renumbers_the_rest(auth_client, project):
    screen = Screen.objects.create(name="Bug screen")
    field_a = CustomField.objects.create(name="A", field_type="text_short", created_by=None)
    field_b = CustomField.objects.create(name="B", field_type="text_short", created_by=None)
    field_c = CustomField.objects.create(name="C", field_type="text_short", created_by=None)
    row_a = ScreenField.objects.create(screen=screen, field=field_a, position=0)
    row_b = ScreenField.objects.create(screen=screen, field=field_b, position=1)
    row_c = ScreenField.objects.create(screen=screen, field=field_c, position=2)

    response = auth_client.delete(f"/api/screens/{screen.id}/fields/{row_a.id}/")
    assert response.status_code == 204
    row_b.refresh_from_db()
    row_c.refresh_from_db()
    assert (row_b.position, row_c.position) == (0, 1)


@pytest.mark.django_db
def test_getting_a_screen_includes_its_ordered_fields(auth_client, project):
    screen = Screen.objects.create(name="Bug screen")
    field = CustomField.objects.create(name="Severity", field_type="select", created_by=None)
    ScreenField.objects.create(screen=screen, field=field, position=0, required=True)

    response = auth_client.get(f"/api/screens/{screen.id}/")
    assert response.status_code == 200
    body = response.json()
    assert body["fields"][0]["field_detail"]["name"] == "Severity"
    assert body["fields"][0]["required"] is True


@pytest.mark.django_db
def test_deleting_a_field_still_on_a_screen_is_rejected(auth_client, project):
    """The real guard, superseding Task 1's placeholder now that ScreenField exists."""
    field = CustomField.objects.create(name="In use", field_type="text_short", created_by=None)
    screen = Screen.objects.create(name="Bug screen")
    ScreenField.objects.create(screen=screen, field=field, position=0)

    response = auth_client.delete(f"/api/fields/{field.id}/")
    assert response.status_code == 400
    assert CustomField.objects.filter(id=field.id).exists()


@pytest.mark.django_db
def test_non_numeric_position_on_reorder_is_rejected(auth_client, project):
    screen = Screen.objects.create(name="Bug screen")
    field = CustomField.objects.create(name="Severity", field_type="select", created_by=None)
    row = ScreenField.objects.create(screen=screen, field=field, position=0)
    original_position = row.position

    response = auth_client.patch(
        f"/api/screens/{screen.id}/fields/{row.id}/", {"position": "not-a-number"}, content_type="application/json"
    )
    assert response.status_code == 400
    assert "position" in response.json()
    row.refresh_from_db()
    assert row.position == original_position


@pytest.mark.django_db
def test_field_cannot_be_changed_after_it_is_added_to_a_screen(auth_client, project):
    screen = Screen.objects.create(name="Bug screen")
    field_a = CustomField.objects.create(name="A", field_type="text_short", created_by=None)
    field_b = CustomField.objects.create(name="B", field_type="text_short", created_by=None)
    row = ScreenField.objects.create(screen=screen, field=field_a, position=0)
    original_field_id = row.field_id

    response = auth_client.patch(
        f"/api/screens/{screen.id}/fields/{row.id}/", {"field": field_b.id}, content_type="application/json"
    )
    assert response.status_code == 400
    assert "field" in response.json()
    row.refresh_from_db()
    assert row.field_id == original_field_id
