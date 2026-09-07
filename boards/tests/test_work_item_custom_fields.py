import pytest

from boards.models import (
    Board,
    CustomField,
    FieldOption,
    ProjectScreenAssignment,
    Screen,
    ScreenField,
    WorkItem,
    WorkItemFieldValue,
)


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def screen_with_all_types(project):
    """One screen carrying one field of every type, assigned to Task items
    on `project`. `text_short` is required; everything else is optional, so
    each type's own test can isolate exactly what it's checking."""
    screen = Screen.objects.create(name="Full screen")
    fields = {}
    for field_type in [
        "text_short", "text_long", "number", "date",
        "select", "multiselect", "checkbox", "user_picker",
    ]:
        field = CustomField.objects.create(name=field_type, field_type=field_type, created_by=None)
        fields[field_type] = field
        required = field_type == "text_short"
        ScreenField.objects.create(
            screen=screen, field=field,
            position=len(fields) - 1, required=required,
        )
    FieldOption.objects.create(field=fields["select"], label="High", position=0)
    FieldOption.objects.create(field=fields["select"], label="Low", position=1)
    FieldOption.objects.create(field=fields["multiselect"], label="Red", position=0)
    FieldOption.objects.create(field=fields["multiselect"], label="Blue", position=1)
    ProjectScreenAssignment.objects.create(project=project, item_type="task", screen=screen)
    return fields


@pytest.mark.django_db
def test_no_screen_assigned_means_custom_fields_are_rejected(auth_client, board):
    field = CustomField.objects.create(name="Points", field_type="number", created_by=None)
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "custom_fields": {str(field.id): 5}},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "custom_fields" in response.json()


@pytest.mark.django_db
def test_no_screen_assigned_but_no_custom_fields_submitted_still_works(auth_client, board):
    response = auth_client.post(
        "/api/work-items/", {"board": board.id, "title": "X"}, content_type="application/json"
    )
    assert response.status_code == 201


@pytest.mark.django_db
def test_a_field_not_on_the_screen_is_rejected(auth_client, board, screen_with_all_types):
    stray = CustomField.objects.create(name="Not on screen", field_type="text_short", created_by=None)
    response = auth_client.post(
        "/api/work-items/",
        {
            "board": board.id, "item_type": "task", "title": "X",
            "custom_fields": {
                str(screen_with_all_types["text_short"].id): "ok",
                str(stray.id): "nope",
            },
        },
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "custom_fields" in response.json()


@pytest.mark.django_db
def test_a_missing_required_field_is_rejected(auth_client, board, screen_with_all_types):
    response = auth_client.post(
        "/api/work-items/", {"board": board.id, "item_type": "task", "title": "X"}, content_type="application/json"
    )
    assert response.status_code == 400
    assert "custom_fields" in response.json()


@pytest.mark.django_db
def test_a_valid_submission_round_trips(auth_client, board, screen_with_all_types):
    fields = screen_with_all_types
    response = auth_client.post(
        "/api/work-items/",
        {
            "board": board.id, "item_type": "task", "title": "X",
            "custom_fields": {str(fields["text_short"].id): "ok"},
        },
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json()["custom_fields"] == {str(fields["text_short"].id): "ok"}


@pytest.mark.django_db
@pytest.mark.parametrize(
    "field_type,value,expected",
    [
        ("text_short", "hi", "hi"),
        ("text_long", "a much longer paragraph of notes", "a much longer paragraph of notes"),
        ("number", 4.5, "4.5"),
        ("date", "2026-08-20", "2026-08-20"),
        ("checkbox", True, True),
    ],
)
def test_each_simple_type_accepts_a_valid_value(auth_client, board, screen_with_all_types, field_type, value, expected):
    fields = screen_with_all_types
    payload = {str(fields["text_short"].id): "required ok", str(fields[field_type].id): value}
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "X", "custom_fields": payload},
        content_type="application/json",
    )
    assert response.status_code == 201
    got = response.json()["custom_fields"][str(fields[field_type].id)]
    if field_type == "number":
        assert float(got) == float(expected)
    else:
        assert got == expected


@pytest.mark.django_db
@pytest.mark.parametrize(
    "field_type,value",
    [
        ("number", "not a number"),
        ("date", "20-08-2026"),
        ("date", "not a date"),
    ],
)
def test_each_simple_type_rejects_an_invalid_value(auth_client, board, screen_with_all_types, field_type, value):
    fields = screen_with_all_types
    payload = {str(fields["text_short"].id): "required ok", str(fields[field_type].id): value}
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "X", "custom_fields": payload},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "custom_fields" in response.json()


@pytest.mark.django_db
def test_text_short_over_255_characters_is_rejected(auth_client, board, screen_with_all_types):
    fields = screen_with_all_types
    payload = {str(fields["text_short"].id): "x" * 256}
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "X", "custom_fields": payload},
        content_type="application/json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_select_accepts_a_current_option(auth_client, board, screen_with_all_types):
    fields = screen_with_all_types
    option = fields["select"].options.get(label="High")
    payload = {str(fields["text_short"].id): "ok", str(fields["select"].id): option.id}
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "X", "custom_fields": payload},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json()["custom_fields"][str(fields["select"].id)] == option.id


@pytest.mark.django_db
def test_select_rejects_an_option_id_that_does_not_exist(auth_client, board, screen_with_all_types):
    fields = screen_with_all_types
    payload = {str(fields["text_short"].id): "ok", str(fields["select"].id): 999999}
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "X", "custom_fields": payload},
        content_type="application/json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_multiselect_accepts_several_current_options_and_stores_multiple_rows(auth_client, board, screen_with_all_types):
    fields = screen_with_all_types
    red = fields["multiselect"].options.get(label="Red")
    blue = fields["multiselect"].options.get(label="Blue")
    payload = {str(fields["text_short"].id): "ok", str(fields["multiselect"].id): [red.id, blue.id]}
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "X", "custom_fields": payload},
        content_type="application/json",
    )
    assert response.status_code == 201
    item = WorkItem.objects.get(title="X")
    assert WorkItemFieldValue.objects.filter(work_item=item, field=fields["multiselect"]).count() == 2
    assert sorted(response.json()["custom_fields"][str(fields["multiselect"].id)]) == sorted([red.id, blue.id])


@pytest.mark.django_db
def test_multiselect_rejects_an_option_not_on_the_field(auth_client, board, screen_with_all_types):
    fields = screen_with_all_types
    red = fields["multiselect"].options.get(label="Red")
    payload = {str(fields["text_short"].id): "ok", str(fields["multiselect"].id): [red.id, 999999]}
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "X", "custom_fields": payload},
        content_type="application/json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_user_picker_accepts_a_project_member(auth_client, board, screen_with_all_types, user):
    fields = screen_with_all_types
    payload = {str(fields["text_short"].id): "ok", str(fields["user_picker"].id): user.id}
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "X", "custom_fields": payload},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json()["custom_fields"][str(fields["user_picker"].id)] == user.id


@pytest.mark.django_db
def test_user_picker_rejects_a_non_member(auth_client, board, screen_with_all_types, other_user):
    fields = screen_with_all_types
    payload = {str(fields["text_short"].id): "ok", str(fields["user_picker"].id): other_user.id}
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "X", "custom_fields": payload},
        content_type="application/json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_editing_only_the_title_leaves_custom_field_values_untouched(auth_client, board, screen_with_all_types):
    fields = screen_with_all_types
    create = auth_client.post(
        "/api/work-items/",
        {
            "board": board.id, "item_type": "task", "title": "Before",
            "custom_fields": {str(fields["text_short"].id): "keep me"},
        },
        content_type="application/json",
    )
    item_id = create.json()["id"]

    response = auth_client.patch(
        f"/api/work-items/{item_id}/", {"title": "After"}, content_type="application/json"
    )
    assert response.status_code == 200
    assert response.json()["custom_fields"][str(fields["text_short"].id)] == "keep me"


@pytest.mark.django_db
def test_a_required_field_already_saved_stays_satisfied_on_an_unrelated_edit(auth_client, board, screen_with_all_types):
    fields = screen_with_all_types
    create = auth_client.post(
        "/api/work-items/",
        {
            "board": board.id, "item_type": "task", "title": "Before",
            "custom_fields": {str(fields["text_short"].id): "already set"},
        },
        content_type="application/json",
    )
    item_id = create.json()["id"]

    response = auth_client.patch(
        f"/api/work-items/{item_id}/",
        {"custom_fields": {str(fields["number"].id): 3}},
        content_type="application/json",
    )
    assert response.status_code == 200
    assert response.json()["custom_fields"][str(fields["text_short"].id)] == "already set"
    assert response.json()["custom_fields"][str(fields["number"].id)] == "3"


@pytest.mark.django_db
def test_clearing_a_required_field_on_edit_is_rejected(auth_client, board, screen_with_all_types):
    fields = screen_with_all_types
    create = auth_client.post(
        "/api/work-items/",
        {
            "board": board.id, "item_type": "task", "title": "Before",
            "custom_fields": {str(fields["text_short"].id): "set"},
        },
        content_type="application/json",
    )
    item_id = create.json()["id"]

    response = auth_client.patch(
        f"/api/work-items/{item_id}/",
        {"custom_fields": {str(fields["text_short"].id): ""}},
        content_type="application/json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_viewing_a_work_item_shows_a_saved_value_even_after_its_field_leaves_the_screen(
    auth_client, board, screen_with_all_types, project
):
    fields = screen_with_all_types
    create = auth_client.post(
        "/api/work-items/",
        {
            "board": board.id, "item_type": "task", "title": "X",
            "custom_fields": {str(fields["text_short"].id): "kept forever"},
        },
        content_type="application/json",
    )
    item_id = create.json()["id"]

    # Reassign the project's Task screen to a brand-new, unrelated screen —
    # the old field is now orphaned from the currently-assigned screen.
    empty_screen = Screen.objects.create(name="Empty")
    ProjectScreenAssignment.objects.filter(project=project, item_type="task").update(screen=empty_screen)

    response = auth_client.get(f"/api/work-items/{item_id}/")
    assert response.status_code == 200
    assert response.json()["custom_fields"][str(fields["text_short"].id)] == "kept forever"


@pytest.mark.django_db
def test_removing_a_field_from_a_screen_does_not_delete_saved_values(auth_client, board, screen_with_all_types):
    """Belongs conceptually with Task 2's ScreenField removal, but
    WorkItemFieldValue doesn't exist until this task — so it lives here."""
    fields = screen_with_all_types
    create = auth_client.post(
        "/api/work-items/",
        {
            "board": board.id, "item_type": "task", "title": "X",
            "custom_fields": {str(fields["text_short"].id): "keep me"},
        },
        content_type="application/json",
    )
    item_id = create.json()["id"]
    # `screen_with_all_types` builds exactly one screen, so this field
    # appears on exactly one ScreenField row.
    row = ScreenField.objects.get(field=fields["text_short"])

    auth_client.delete(f"/api/screens/{row.screen_id}/fields/{row.id}/")

    assert WorkItemFieldValue.objects.filter(work_item_id=item_id, field=fields["text_short"]).exists()


@pytest.mark.django_db
def test_deleting_an_option_still_used_by_a_work_item_value_is_rejected(auth_client, board, screen_with_all_types):
    """Belongs conceptually with Task 1's FieldOption deletion, but
    WorkItemFieldValue doesn't exist until this task — so it lives here."""
    fields = screen_with_all_types
    option = fields["select"].options.get(label="High")
    auth_client.post(
        "/api/work-items/",
        {
            "board": board.id, "item_type": "task", "title": "X",
            "custom_fields": {str(fields["text_short"].id): "ok", str(fields["select"].id): option.id},
        },
        content_type="application/json",
    )

    response = auth_client.delete(f"/api/fields/{fields['select'].id}/options/{option.id}/")
    assert response.status_code == 400
    assert FieldOption.objects.filter(id=option.id).exists()


@pytest.mark.django_db
def test_select_value_submitted_as_a_json_float_is_canonicalized_and_round_trips(
    auth_client, board, screen_with_all_types
):
    """A JSON float like 12.0 passes `field_value_error`'s `int(value) in
    option_ids` check, so it must be canonicalized to a plain integer
    string before it's stored — otherwise it round-trips as "12.0" and
    crashes every later GET (custom_fields_read_map's bare int())."""
    fields = screen_with_all_types
    option = fields["select"].options.get(label="High")
    payload = {str(fields["text_short"].id): "ok", str(fields["select"].id): float(option.id)}
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "item_type": "task", "title": "X", "custom_fields": payload},
        content_type="application/json",
    )
    assert response.status_code == 201
    item_id = response.json()["id"]
    assert response.json()["custom_fields"][str(fields["select"].id)] == option.id

    stored = WorkItemFieldValue.objects.get(work_item_id=item_id, field=fields["select"])
    assert stored.value == str(option.id)

    get_response = auth_client.get(f"/api/work-items/{item_id}/")
    assert get_response.status_code == 200
    assert get_response.json()["custom_fields"][str(fields["select"].id)] == option.id


@pytest.mark.django_db
def test_a_garbage_stored_field_value_is_skipped_on_read_instead_of_crashing(
    auth_client, board, screen_with_all_types
):
    """A hand-inserted row that bypasses apply_custom_fields (e.g. a
    legacy/corrupted value) must not take down the whole work item's GET —
    it should just be missing from custom_fields."""
    fields = screen_with_all_types
    item = WorkItem.objects.create(board=board, item_type="task", title="X")
    WorkItemFieldValue.objects.create(work_item=item, field=fields["select"], value="not-a-number")
    WorkItemFieldValue.objects.create(work_item=item, field=fields["text_short"], value="fine")

    response = auth_client.get(f"/api/work-items/{item.id}/")
    assert response.status_code == 200
    custom_fields = response.json()["custom_fields"]
    assert str(fields["select"].id) not in custom_fields
    assert custom_fields[str(fields["text_short"].id)] == "fine"


@pytest.mark.django_db
def test_the_database_rejects_a_duplicate_work_item_field_value(board):
    """apply_custom_fields() de-dupes in Python before insert, so the
    normal API path never actually attempts a duplicate row — it never
    exercises the DB-level UniqueConstraint added via the migration's
    RunSQL (needed because MySQL/InnoDB refuses a plain UNIQUE key over a
    TextField without an explicit prefix length). This test bypasses the
    application layer entirely and proves the constraint is really there
    at the database level, independent of the Python-side dedup."""
    from django.db import IntegrityError

    field = CustomField.objects.create(name="Points", field_type="number", created_by=None)
    item = WorkItem.objects.create(board=board, title="X")
    WorkItemFieldValue.objects.create(work_item=item, field=field, value="5")

    with pytest.raises(IntegrityError):
        WorkItemFieldValue.objects.create(work_item=item, field=field, value="5")
