from unittest.mock import patch

import pytest

from boards.models import Board, Label, WorkItem
from boards.services import resolve_labels


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.mark.django_db
def test_a_brand_new_label_name_creates_and_links_it(auth_client, board):
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "labels": ["urgent"]},
        content_type="application/json",
    )
    assert response.status_code == 201
    label = Label.objects.get(name="urgent")
    body = response.json()
    assert body["labels_detail"] == [{"id": label.id, "name": "urgent", "color": label.color}]


@pytest.mark.django_db
def test_writing_an_existing_name_any_casing_reuses_the_row(auth_client, board):
    existing = Label.objects.create(name="urgent", color="#A32218", created_by=None)
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "labels": ["URGENT"]},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert Label.objects.filter(name__iexact="urgent").count() == 1
    assert response.json()["labels_detail"][0]["id"] == existing.id


@pytest.mark.django_db
def test_two_names_in_one_write_differing_only_by_case_collapse_to_one_label(auth_client, board):
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "labels": ["urgent", "Urgent"]},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert Label.objects.filter(name__iexact="urgent").count() == 1
    assert len(response.json()["labels_detail"]) == 1


@pytest.mark.django_db
def test_two_work_items_in_two_projects_share_the_identical_label_row(auth_client, board, user):
    from projects.models import Project, ProjectMembership

    other_project = Project.objects.create(key="OTHER", name="Elsewhere")
    ProjectMembership.objects.create(project=other_project, user=user, role="owner")
    other_board = Board.objects.create(name="Other Board", created_by=user, project=other_project)

    r1 = auth_client.post(
        "/api/work-items/", {"board": board.id, "title": "A", "labels": ["urgent"]}, content_type="application/json"
    )
    r2 = auth_client.post(
        "/api/work-items/", {"board": other_board.id, "title": "B", "labels": ["urgent"]}, content_type="application/json"
    )
    assert r1.json()["labels_detail"][0]["id"] == r2.json()["labels_detail"][0]["id"]
    assert Label.objects.filter(name="urgent").count() == 1


@pytest.mark.django_db
def test_a_blank_label_name_is_rejected(auth_client, board):
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "labels": ["urgent", "   "]},
        content_type="application/json",
    )
    assert response.status_code == 400
    # DRF wraps a dict-shaped serializer.validate() error into
    # {field: [messages]} (see rest_framework.serializers.as_serializer_error),
    # so this is the real response shape — not the per-index
    # {1: ["This field may not be blank."]} shape DRF's own field-level
    # CharField(blank) check would produce if it fired instead of our
    # object-level validate() check. Asserting the exact list here pins
    # down that our custom message actually reaches the response, and
    # would catch a regression back to that dead-code state.
    assert response.json()["labels"] == ["A label name can't be blank."]
    assert not WorkItem.objects.filter(title="X").exists()


@pytest.mark.django_db
def test_color_is_deterministic_even_after_delete_and_recreate(auth_client, board):
    r1 = auth_client.post(
        "/api/work-items/", {"board": board.id, "title": "A", "labels": ["urgent"]}, content_type="application/json"
    )
    first_color = r1.json()["labels_detail"][0]["color"]
    Label.objects.get(name="urgent").delete()

    r2 = auth_client.post(
        "/api/work-items/", {"board": board.id, "title": "B", "labels": ["urgent"]}, content_type="application/json"
    )
    second_color = r2.json()["labels_detail"][0]["color"]
    assert first_color == second_color


@pytest.mark.django_db
def test_a_plain_member_can_apply_a_label_no_separate_permission_check(auth_client, board, project):
    """Applying/inventing a label on a work item needs only ordinary
    work-item edit permission (project membership) — the Owner-tier check
    in LabelViewSet only gates renaming/recoloring/deleting the Label row
    itself, a deliberately different, wider-blast-radius action."""
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "labels": ["urgent"]},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json()["labels_detail"][0]["name"] == "urgent"


@pytest.mark.django_db
def test_updating_a_work_items_labels_replaces_the_set(auth_client, board):
    item = WorkItem.objects.create(board=board, title="X", created_by=None)
    urgent = Label.objects.create(name="urgent", color="#A32218", created_by=None)
    item.labels.set([urgent])

    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"labels": ["needs-design"]}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert list(item.labels.values_list("name", flat=True)) == ["needs-design"]


@pytest.mark.django_db
def test_omitting_labels_on_update_leaves_them_untouched(auth_client, board):
    item = WorkItem.objects.create(board=board, title="X", created_by=None)
    urgent = Label.objects.create(name="urgent", color="#A32218", created_by=None)
    item.labels.set([urgent])

    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"title": "X renamed"}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert list(item.labels.values_list("name", flat=True)) == ["urgent"]


@pytest.mark.django_db
def test_deleting_a_label_unassigns_it_from_every_work_item_without_a_guard(auth_client, board):
    item = WorkItem.objects.create(board=board, title="X", created_by=None)
    urgent = Label.objects.create(name="urgent", color="#A32218", created_by=None)
    item.labels.set([urgent])

    response = auth_client.delete(f"/api/labels/{urgent.id}/")
    assert response.status_code == 204
    item.refresh_from_db()
    assert item.labels.count() == 0
    assert WorkItem.objects.filter(id=item.id).exists()


@pytest.mark.django_db
def test_a_label_name_over_80_characters_is_rejected_with_400(auth_client, board):
    """Label.name is max_length=80. The `labels` write field on
    WorkItemSerializer is a hand-rolled ListField(child=CharField(...)),
    not derived from the model, so it must repeat that max_length itself —
    otherwise an over-length name sails through serializer validation and
    reaches Label.objects.create() in resolve_labels(), where MySQL raises
    an uncaught error instead of a clean 400."""
    too_long = "x" * 81
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "labels": [too_long]},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert "labels" in response.json()
    assert not WorkItem.objects.filter(title="X").exists()


@pytest.mark.django_db
def test_a_brand_new_label_created_implicitly_records_the_acting_user(auth_client, board, user):
    """resolve_labels() is the only place a Label is ever created in
    production (there's no POST /api/labels/), so this is the only path
    that can ever populate created_by."""
    response = auth_client.post(
        "/api/work-items/",
        {"board": board.id, "title": "X", "labels": ["urgent"]},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert Label.objects.get(name="urgent").created_by == user


@pytest.mark.django_db
def test_concurrent_creation_of_the_same_new_label_name_recovers_via_requery(user):
    """resolve_labels()'s get-or-create is a check-then-act: two concurrent
    requests can both see .filter().first() return None for a brand-new
    name and both attempt Label.objects.create(). The second one collides
    with the unique constraint on Label.name and must recover by
    re-querying the row the first one created, instead of letting
    IntegrityError bubble up as a 500 or returning None.

    There's no real second DB connection here (that would need true
    concurrency), so the race is simulated: the "competing" row is
    pre-created as if a concurrent request had already committed it, and
    this call's own .filter().first() lookup is forced to report None
    anyway — exactly what it would see if its read had run just before the
    competing transaction committed. Label.objects.create() is left real,
    so it genuinely collides with the unique constraint and genuinely
    exercises the except-and-requery path (and the nested-atomic/savepoint
    handling around it) against the real database, not a mock of the
    exception itself.
    """
    competing = Label.objects.create(name="urgent", color="#A32218", created_by=user)

    with patch("boards.services.Label.objects.filter", return_value=Label.objects.none()):
        resolved = resolve_labels(["urgent"], user)

    assert len(resolved) == 1
    assert resolved[0].id == competing.id
    assert Label.objects.filter(name="urgent").count() == 1
