import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from boards.models import Attachment, Board, WorkItem, WorkItemStatus
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
    return WorkItem.objects.create(board=board, title="Has attachments", status=status)


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client, item):
    assert client.get(f"/api/work-items/{item.id}/attachments/").status_code == 403


@pytest.mark.django_db
def test_any_member_can_list_attachments(auth_client, item):
    Attachment.objects.create(
        work_item=item, file=SimpleUploadedFile("x.txt", b"hi"),
        filename="x.txt", content_type="text/plain", size=2,
    )
    response = auth_client.get(f"/api/work-items/{item.id}/attachments/")
    assert response.status_code == 200
    assert response.json()[0]["filename"] == "x.txt"


@pytest.mark.django_db
def test_any_member_can_upload_a_file(auth_client, item, user):
    upload = SimpleUploadedFile("report.pdf", b"pdf bytes here", content_type="application/pdf")
    response = auth_client.post(f"/api/work-items/{item.id}/attachments/", {"file": upload})
    assert response.status_code == 201
    body = response.json()
    assert body["filename"] == "report.pdf"
    assert body["content_type"] == "application/pdf"
    assert body["size"] == len(b"pdf bytes here")
    assert body["uploaded_by"]["username"] == user.username
    assert Attachment.objects.filter(work_item=item, filename="report.pdf").exists()


@pytest.mark.django_db
def test_uploading_with_no_file_is_rejected(auth_client, item):
    response = auth_client.post(f"/api/work-items/{item.id}/attachments/", {})
    assert response.status_code == 400
    assert "file" in response.json()
    assert not Attachment.objects.filter(work_item=item).exists()


@pytest.mark.django_db
def test_uploading_a_file_over_the_size_cap_is_rejected(auth_client, item, monkeypatch):
    from boards import views as views_module

    monkeypatch.setattr(views_module, "MAX_ATTACHMENT_SIZE", 5)
    oversized = SimpleUploadedFile("huge.bin", b"x" * 10, content_type="application/octet-stream")
    response = auth_client.post(f"/api/work-items/{item.id}/attachments/", {"file": oversized})
    assert response.status_code == 400
    assert "file" in response.json()
    assert not Attachment.objects.filter(work_item=item).exists()


@pytest.mark.django_db
def test_a_non_member_cannot_list_upload_download_or_delete(auth_client, item, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    foreign_board = Board.objects.create(name="B", created_by=other_user, project=foreign)
    seed_default_statuses(foreign)
    foreign_status = WorkItemStatus.objects.filter(project=foreign, category="todo").first()
    foreign_item = WorkItem.objects.create(board=foreign_board, title="X", status=foreign_status)
    attachment = Attachment.objects.create(
        work_item=foreign_item, file=SimpleUploadedFile("x.txt", b"hi"),
        filename="x.txt", content_type="text/plain", size=2,
    )

    assert auth_client.get(f"/api/work-items/{foreign_item.id}/attachments/").status_code == 403
    assert auth_client.post(
        f"/api/work-items/{foreign_item.id}/attachments/", {"file": SimpleUploadedFile("y.txt", b"x")}
    ).status_code == 403
    assert auth_client.get(f"/api/attachments/{attachment.id}/download/").status_code == 403
    assert auth_client.delete(f"/api/attachments/{attachment.id}/").status_code == 403


@pytest.mark.django_db
def test_the_uploader_can_delete_their_own_attachment_even_as_a_plain_member(client, item, other_user, project):
    # Deliberately a plain member, not the project's Owner (the `project`
    # fixture's default role) — this isolates the "uploader" rule from the
    # "Owner/Admin" rule below, so a pass here can't be secretly explained
    # by the acting user just happening to be a manager.
    from projects.models import ProjectMembership

    ProjectMembership.objects.create(project=project, user=other_user, role="member")
    attachment = Attachment.objects.create(
        work_item=item, file=SimpleUploadedFile("x.txt", b"hi"),
        filename="x.txt", content_type="text/plain", size=2, uploaded_by=other_user,
    )
    client.force_login(other_user)
    response = client.delete(f"/api/attachments/{attachment.id}/")
    assert response.status_code == 204
    assert not Attachment.objects.filter(id=attachment.id).exists()


@pytest.mark.django_db
def test_a_different_plain_member_cannot_delete_someone_elses_attachment(auth_client, item, other_user, project, user):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user=user).update(role="member")
    ProjectMembership.objects.create(project=project, user=other_user, role="member")
    attachment = Attachment.objects.create(
        work_item=item, file=SimpleUploadedFile("x.txt", b"hi"),
        filename="x.txt", content_type="text/plain", size=2, uploaded_by=other_user,
    )
    response = auth_client.delete(f"/api/attachments/{attachment.id}/")
    assert response.status_code == 403
    assert Attachment.objects.filter(id=attachment.id).exists()


@pytest.mark.django_db
def test_an_owner_can_delete_any_attachment_regardless_of_uploader(auth_client, item, other_user, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.create(project=project, user=other_user, role="member")
    attachment = Attachment.objects.create(
        work_item=item, file=SimpleUploadedFile("x.txt", b"hi"),
        filename="x.txt", content_type="text/plain", size=2, uploaded_by=other_user,
    )
    # `user`/`auth_client` is Owner of `project` per the `project` fixture.
    response = auth_client.delete(f"/api/attachments/{attachment.id}/")
    assert response.status_code == 204
    assert not Attachment.objects.filter(id=attachment.id).exists()


@pytest.mark.django_db
def test_an_attachment_with_no_uploader_can_still_be_deleted_by_an_owner(auth_client, item):
    attachment = Attachment.objects.create(
        work_item=item, file=SimpleUploadedFile("x.txt", b"hi"),
        filename="x.txt", content_type="text/plain", size=2, uploaded_by=None,
    )
    response = auth_client.delete(f"/api/attachments/{attachment.id}/")
    assert response.status_code == 204


@pytest.mark.django_db
def test_download_streams_the_correct_bytes_and_filename(auth_client, item):
    attachment = Attachment.objects.create(
        work_item=item, file=SimpleUploadedFile("report.pdf", b"the actual bytes"),
        filename="report.pdf", content_type="application/pdf", size=17,
    )
    response = auth_client.get(f"/api/attachments/{attachment.id}/download/")
    assert response.status_code == 200
    assert b"".join(response.streaming_content) == b"the actual bytes"
    assert "report.pdf" in response["Content-Disposition"]


@pytest.mark.django_db
def test_deleting_a_work_item_cascades_to_delete_its_attachments(auth_client, item):
    Attachment.objects.create(
        work_item=item, file=SimpleUploadedFile("x.txt", b"hi"),
        filename="x.txt", content_type="text/plain", size=2,
    )
    item_id = item.id
    auth_client.delete(f"/api/work-items/{item_id}/")
    assert not Attachment.objects.filter(work_item_id=item_id).exists()


@pytest.mark.django_db
def test_multiple_attachments_are_listed_ordered_by_uploaded_at(auth_client, item):
    first = Attachment.objects.create(
        work_item=item, file=SimpleUploadedFile("a.txt", b"a"),
        filename="a.txt", content_type="text/plain", size=1,
    )
    second = Attachment.objects.create(
        work_item=item, file=SimpleUploadedFile("b.txt", b"b"),
        filename="b.txt", content_type="text/plain", size=1,
    )
    response = auth_client.get(f"/api/work-items/{item.id}/attachments/")
    ids = [row["id"] for row in response.json()]
    assert ids == [first.id, second.id]


@pytest.mark.django_db
def test_genuinely_nonexistent_attachment_returns_404(auth_client):
    assert auth_client.get("/api/attachments/999999/download/").status_code == 404
    assert auth_client.delete("/api/attachments/999999/").status_code == 404


@pytest.mark.django_db
def test_no_patch_method_is_exposed_on_attachments(auth_client, item):
    attachment = Attachment.objects.create(
        work_item=item, file=SimpleUploadedFile("x.txt", b"hi"),
        filename="x.txt", content_type="text/plain", size=2,
    )
    response = auth_client.patch(
        f"/api/attachments/{attachment.id}/", {"filename": "renamed.txt"}, content_type="application/json"
    )
    assert response.status_code == 405
