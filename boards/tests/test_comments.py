import pytest

from boards.models import Board, Comment, WorkItem


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def work_item(board):
    return WorkItem.objects.create(board=board, title="Discuss me")


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client, work_item):
    assert client.get(f"/api/work-items/{work_item.id}/comments/").status_code == 403


@pytest.mark.django_db
def test_posting_a_comment_records_the_author(auth_client, work_item, user):
    response = auth_client.post(
        f"/api/work-items/{work_item.id}/comments/",
        {"body": "Started on this"},
        content_type="application/json",
    )

    assert response.status_code == 201
    assert response.json()["author"]["username"] == "alice"
    assert Comment.objects.get(card=work_item).author == user


@pytest.mark.django_db
def test_comments_come_back_oldest_first(auth_client, work_item, user):
    Comment.objects.create(card=work_item, author=user, body="First")
    Comment.objects.create(card=work_item, author=user, body="Second")

    response = auth_client.get(f"/api/work-items/{work_item.id}/comments/")

    assert [comment["body"] for comment in response.json()] == ["First", "Second"]


@pytest.mark.django_db
def test_comments_are_scoped_to_their_work_item(auth_client, board, work_item, user):
    other_item = WorkItem.objects.create(board=board, title="Elsewhere")
    Comment.objects.create(card=work_item, author=user, body="Mine")
    Comment.objects.create(card=other_item, author=user, body="Not mine")

    response = auth_client.get(f"/api/work-items/{work_item.id}/comments/")

    assert [comment["body"] for comment in response.json()] == ["Mine"]


@pytest.mark.django_db
def test_an_author_can_delete_their_own_comment(auth_client, work_item, user):
    comment = Comment.objects.create(card=work_item, author=user, body="Mine to delete")

    assert auth_client.delete(f"/api/comments/{comment.id}/").status_code == 204
    assert not Comment.objects.filter(id=comment.id).exists()


@pytest.mark.django_db
def test_nobody_can_delete_someone_elses_comment(auth_client, work_item, other_user):
    comment = Comment.objects.create(card=work_item, author=other_user, body="Not yours")

    assert auth_client.delete(f"/api/comments/{comment.id}/").status_code == 403
    assert Comment.objects.filter(id=comment.id).exists()


@pytest.mark.django_db
def test_an_authorless_comment_can_be_deleted_by_anyone_signed_in(auth_client, work_item, other_user):
    """author is SET_NULL when the author's account is deleted. Ownership
    must only be enforced when there IS an owner, or the comment becomes
    permanently undeletable — everyone fails `author != request.user` when
    author is None."""
    comment = Comment.objects.create(card=work_item, author=other_user, body="Orphaned")
    other_user.delete()
    comment.refresh_from_db()
    assert comment.author_id is None

    assert auth_client.delete(f"/api/comments/{comment.id}/").status_code == 204
    assert not Comment.objects.filter(id=comment.id).exists()


@pytest.mark.django_db
def test_an_empty_comment_is_rejected(auth_client, work_item):
    response = auth_client.post(
        f"/api/work-items/{work_item.id}/comments/",
        {"body": "   "},
        content_type="application/json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_deleting_a_work_item_deletes_its_comments(auth_client, work_item, user):
    Comment.objects.create(card=work_item, author=user, body="Goes with the item")
    work_item.delete()
    assert Comment.objects.count() == 0


@pytest.mark.django_db
def test_an_author_can_edit_their_own_comment(auth_client, work_item, user):
    comment = Comment.objects.create(card=work_item, author=user, body="Typo her")

    response = auth_client.patch(
        f"/api/comments/{comment.id}/",
        {"body": "Typo here"},
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json()["body"] == "Typo here"
    comment.refresh_from_db()
    assert comment.body == "Typo here"


@pytest.mark.django_db
def test_editing_a_comment_stamps_edited_at(auth_client, work_item, user):
    comment = Comment.objects.create(card=work_item, author=user, body="Original")
    assert comment.edited_at is None

    response = auth_client.patch(
        f"/api/comments/{comment.id}/",
        {"body": "Revised"},
        content_type="application/json",
    )

    assert response.json()["edited_at"] is not None
    comment.refresh_from_db()
    assert comment.edited_at is not None


@pytest.mark.django_db
def test_an_unedited_comment_reports_no_edited_at(auth_client, work_item, user):
    Comment.objects.create(card=work_item, author=user, body="Untouched")

    response = auth_client.get(f"/api/work-items/{work_item.id}/comments/")

    assert response.json()[0]["edited_at"] is None


@pytest.mark.django_db
def test_nobody_can_edit_someone_elses_comment(auth_client, work_item, other_user):
    comment = Comment.objects.create(card=work_item, author=other_user, body="Not yours")

    response = auth_client.patch(
        f"/api/comments/{comment.id}/",
        {"body": "Hijacked"},
        content_type="application/json",
    )

    assert response.status_code == 403
    comment.refresh_from_db()
    assert comment.body == "Not yours"


@pytest.mark.django_db
def test_an_authorless_comment_cannot_be_edited_by_anyone(auth_client, work_item, other_user):
    comment = Comment.objects.create(card=work_item, author=other_user, body="Orphaned")
    other_user.delete()
    comment.refresh_from_db()
    assert comment.author_id is None

    response = auth_client.patch(
        f"/api/comments/{comment.id}/",
        {"body": "Should not land"},
        content_type="application/json",
    )

    assert response.status_code == 403
    comment.refresh_from_db()
    assert comment.body == "Orphaned"


@pytest.mark.django_db
def test_anonymous_callers_cannot_edit_a_comment(client, work_item, user):
    comment = Comment.objects.create(card=work_item, author=user, body="Mine")

    response = client.patch(
        f"/api/comments/{comment.id}/",
        {"body": "Nope"},
        content_type="application/json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_editing_a_comment_to_blank_is_rejected(auth_client, work_item, user):
    comment = Comment.objects.create(card=work_item, author=user, body="Keep me")

    response = auth_client.patch(
        f"/api/comments/{comment.id}/",
        {"body": "   "},
        content_type="application/json",
    )

    assert response.status_code == 400
    comment.refresh_from_db()
    assert comment.body == "Keep me"


@pytest.mark.django_db
def test_editing_a_missing_comment_is_a_404(auth_client):
    response = auth_client.patch(
        "/api/comments/999999/",
        {"body": "Anything"},
        content_type="application/json",
    )

    assert response.status_code == 404
