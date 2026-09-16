import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction

from boards.models import Attachment, Board, Comment, WorkItem, WorkItemStatus
from boards.services import seed_default_statuses


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def status(board, project):
    seed_default_statuses(project)
    return WorkItemStatus.objects.filter(project=project, category="todo").first()


@pytest.fixture
def item(board, status):
    return WorkItem.objects.create(board=board, title="Has comments", status=status)


@pytest.fixture
def comment(item, user):
    return Comment.objects.create(card=item, author=user, body="Take a look at this")


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client, comment):
    assert client.get(f"/api/comments/{comment.id}/attachments/").status_code == 403


@pytest.mark.django_db
def test_any_member_can_upload_a_file_to_a_comment(auth_client, comment, user):
    upload = SimpleUploadedFile("report.pdf", b"pdf bytes here", content_type="application/pdf")
    response = auth_client.post(f"/api/comments/{comment.id}/attachments/", {"file": upload})

    assert response.status_code == 201
    body = response.json()
    assert body["filename"] == "report.pdf"
    assert body["content_type"] == "application/pdf"
    assert body["size"] == len(b"pdf bytes here")
    assert body["comment"] == comment.id
    assert body["work_item"] is None
    assert body["uploaded_by"]["username"] == user.username
    assert Attachment.objects.filter(comment=comment, filename="report.pdf").exists()


@pytest.mark.django_db
def test_listing_only_returns_that_comments_attachments(auth_client, comment, item, user):
    other_comment = Comment.objects.create(card=item, author=user, body="Another thread")
    Attachment.objects.create(
        comment=comment, file=SimpleUploadedFile("mine.txt", b"a"),
        filename="mine.txt", content_type="text/plain", size=1,
    )
    Attachment.objects.create(
        comment=other_comment, file=SimpleUploadedFile("not-mine.txt", b"b"),
        filename="not-mine.txt", content_type="text/plain", size=1,
    )

    response = auth_client.get(f"/api/comments/{comment.id}/attachments/")

    assert response.status_code == 200
    filenames = [row["filename"] for row in response.json()]
    assert filenames == ["mine.txt"]


@pytest.mark.django_db
def test_uploading_with_no_file_is_rejected(auth_client, comment):
    response = auth_client.post(f"/api/comments/{comment.id}/attachments/", {})
    assert response.status_code == 400
    assert "file" in response.json()
    assert not Attachment.objects.filter(comment=comment).exists()


@pytest.mark.django_db
def test_uploading_a_file_over_the_size_cap_is_rejected(auth_client, comment, monkeypatch):
    from boards import views as views_module

    monkeypatch.setattr(views_module, "MAX_ATTACHMENT_SIZE", 5)
    oversized = SimpleUploadedFile("huge.bin", b"x" * 10, content_type="application/octet-stream")
    response = auth_client.post(f"/api/comments/{comment.id}/attachments/", {"file": oversized})
    assert response.status_code == 400
    assert "file" in response.json()
    assert not Attachment.objects.filter(comment=comment).exists()


@pytest.mark.django_db
def test_a_non_member_cannot_list_or_upload(auth_client, comment, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    foreign_board = Board.objects.create(name="B", created_by=other_user, project=foreign)
    seed_default_statuses(foreign)
    foreign_status = WorkItemStatus.objects.filter(project=foreign, category="todo").first()
    foreign_item = WorkItem.objects.create(board=foreign_board, title="X", status=foreign_status)
    foreign_comment = Comment.objects.create(card=foreign_item, author=other_user, body="Not yours")

    assert auth_client.get(f"/api/comments/{foreign_comment.id}/attachments/").status_code == 403
    assert auth_client.post(
        f"/api/comments/{foreign_comment.id}/attachments/", {"file": SimpleUploadedFile("y.txt", b"x")}
    ).status_code == 403


@pytest.mark.django_db
def test_a_missing_comment_id_returns_404(auth_client):
    assert auth_client.get("/api/comments/999999/attachments/").status_code == 404
    assert auth_client.post(
        "/api/comments/999999/attachments/", {"file": SimpleUploadedFile("y.txt", b"x")}
    ).status_code == 404


@pytest.mark.django_db
def test_attachment_requires_exactly_one_of_work_item_or_comment(item, comment):
    with pytest.raises(IntegrityError), transaction.atomic():
        Attachment.objects.create(
            work_item=item, comment=comment, file=SimpleUploadedFile("both.txt", b"x"),
            filename="both.txt", content_type="text/plain", size=1,
        )

    with pytest.raises(IntegrityError), transaction.atomic():
        Attachment.objects.create(
            file=SimpleUploadedFile("neither.txt", b"x"),
            filename="neither.txt", content_type="text/plain", size=1,
        )


@pytest.mark.django_db
def test_the_uploader_can_delete_their_own_comment_attachment_even_as_a_plain_member(
    client, comment, other_user, project
):
    # Deliberately a plain member, not the project's Owner (the `project`
    # fixture's default role) — this isolates the "uploader" rule from the
    # "Owner/Admin" rule below, so a pass here can't be secretly explained
    # by the acting user just happening to be a manager.
    from projects.models import ProjectMembership

    ProjectMembership.objects.create(project=project, user=other_user, role="member")
    attachment = Attachment.objects.create(
        comment=comment, file=SimpleUploadedFile("x.txt", b"hi"),
        filename="x.txt", content_type="text/plain", size=2, uploaded_by=other_user,
    )
    client.force_login(other_user)
    response = client.delete(f"/api/attachments/{attachment.id}/")
    assert response.status_code == 204
    assert not Attachment.objects.filter(id=attachment.id).exists()


@pytest.mark.django_db
def test_a_different_plain_member_cannot_delete_someone_elses_comment_attachment(
    auth_client, comment, other_user, project, user
):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user=user).update(role="member")
    ProjectMembership.objects.create(project=project, user=other_user, role="member")
    attachment = Attachment.objects.create(
        comment=comment, file=SimpleUploadedFile("x.txt", b"hi"),
        filename="x.txt", content_type="text/plain", size=2, uploaded_by=other_user,
    )
    response = auth_client.delete(f"/api/attachments/{attachment.id}/")
    assert response.status_code == 403
    assert Attachment.objects.filter(id=attachment.id).exists()


@pytest.mark.django_db
def test_an_owner_can_delete_any_comment_attachment_regardless_of_uploader(
    auth_client, comment, other_user, project
):
    from projects.models import ProjectMembership

    ProjectMembership.objects.create(project=project, user=other_user, role="member")
    attachment = Attachment.objects.create(
        comment=comment, file=SimpleUploadedFile("x.txt", b"hi"),
        filename="x.txt", content_type="text/plain", size=2, uploaded_by=other_user,
    )
    # `user`/`auth_client` is Owner of `project` per the `project` fixture.
    response = auth_client.delete(f"/api/attachments/{attachment.id}/")
    assert response.status_code == 204
    assert not Attachment.objects.filter(id=attachment.id).exists()


@pytest.mark.django_db
def test_download_still_works_for_a_comment_attachment(auth_client, comment):
    attachment = Attachment.objects.create(
        comment=comment, file=SimpleUploadedFile("report.pdf", b"the actual bytes"),
        filename="report.pdf", content_type="application/pdf", size=17,
    )
    response = auth_client.get(f"/api/attachments/{attachment.id}/download/")
    assert response.status_code == 200
    assert b"".join(response.streaming_content) == b"the actual bytes"
    assert "report.pdf" in response["Content-Disposition"]


@pytest.mark.django_db
def test_deleting_a_comment_cascades_to_delete_its_attachments(auth_client, comment):
    Attachment.objects.create(
        comment=comment, file=SimpleUploadedFile("x.txt", b"hi"),
        filename="x.txt", content_type="text/plain", size=2,
    )
    comment_id = comment.id
    auth_client.delete(f"/api/comments/{comment_id}/")
    assert not Attachment.objects.filter(comment_id=comment_id).exists()
