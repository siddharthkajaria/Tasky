# Task Detail UX (Attachments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production Django/DRF backend for Tasky's Task Detail UX feature (sub-project 8 of 13) — the spec scopes this narrowly to file attachments on work items: upload, list, authenticated streaming download, and delete with a wider permission than `Comment` (uploader OR project Owner/Admin).

**Architecture:** One new model in the `boards` app (`Attachment`), storing files via Django's default `FileField` local-filesystem storage (new `MEDIA_ROOT`/`MEDIA_URL` settings, no object-store dependency). List/upload live as a combined `GET`/`POST` action on `WorkItemViewSet` (`comments`'s exact existing shape: `detail=True, methods=["get", "post"]`), file upload parsed via `MultiPartParser` (`import_csv`'s exact existing pattern). Delete and download live on a small standalone `AttachmentViewSet` (`CommentViewSet`'s exact existing shape: `mixins.DestroyModelMixin` + `GenericViewSet`, "created through the work item's own endpoint"), with an added `download` action that streams the file through Django's `FileResponse` after the same `IsProjectMember` check every other endpoint uses — never a raw `MEDIA_URL` link, so project membership is enforced on every byte served.

**Tech Stack:** Django 5.2, DRF 3.16, MySQL, pytest-django. No new dependencies (no Pillow needed — `FileField`, not `ImageField`).

**Spec:** `docs/superpowers/specs/2026-08-24-tasky-task-detail-ux-design.md` (signed off — covered by the user's "Sign off on all 10 as-is" standing authorization; the `design/` prototype it argues from was built and browser-tested 2026-08-25)

## Global Constraints

- **Role vocabulary is `owner` / `admin` / `member`** (lowercase) — unchanged.
- **Unauthenticated request → `403`, never `401`** (existing site-wide convention, unchanged).
- **Attachments live directly on a work item**, not on a comment — `Attachment.work_item`, `on_delete=CASCADE`.
- **Delete permission is wider than `Comment`'s**: the uploader can delete their own upload, **and** any Owner/Admin of the work item's project can delete any attachment — not uploader-only.
- **No `PATCH` on `Attachment`** — immutable once uploaded; replacing means delete-and-reupload.
- **25 MB size cap**, enforced at the view level (not the DB) on `POST`; `400` naming `file` if exceeded or missing.
- **No file-type allowlist/blocklist, no malware scanning, no thumbnails** — accept anything, store as-is.
- **Downloads are a separate, authenticated endpoint** (`GET /api/attachments/{id}/download/`), never a raw `MEDIA_URL` link — every byte served re-checks project membership the same way every other endpoint does.
- **Local filesystem storage** via Django's default `FileField` storage, under a new `MEDIA_ROOT` (`BASE_DIR / 'media'`, already `.gitignore`d) — no S3/object-store backend.
- **Orphaned files on disk after a work item delete are accepted debt** — `Attachment` rows cascade-delete correctly via the DB; the underlying files are not actively cleaned up in this pass.
- **List responses return metadata only** — never raw file bytes or a direct storage URL. `uploaded_by` is a nested `{id, username, display_name}`, matching `assignee_detail`'s shape.
- **Every migration is a plain additive `CreateModel`** — no existing column is touched, so no hand-written migration content is needed.

---

## Task 1: `Attachment` model, upload/list, delete, and download

**Files:**
- Create: `boards/migrations/0030_attachment.py`
- Modify: `config/settings.py`, `boards/models.py`, `boards/serializers.py`, `boards/views.py`, `boards/urls.py`
- Test: `boards/tests/test_attachments_api.py`

**Interfaces:**
- Consumes: `IsProjectMember`, `UserSerializer`, the existing `CommentViewSet`/`WorkItemViewSet.comments` action patterns (delete-only standalone viewset; combined list/create action nested under the work item).
- Produces: `boards.models.Attachment` (`work_item`, `file`, `filename`, `content_type`, `size`, `uploaded_by`, `uploaded_at`; `Attachment.project` computed property mirroring `Comment.project`). `boards.serializers.AttachmentSerializer`. `GET/POST /api/work-items/{id}/attachments/`, `DELETE /api/attachments/{id}/`, `GET /api/attachments/{id}/download/`. `MEDIA_ROOT`/`MEDIA_URL` in `config/settings.py`.

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_attachments_api.py`:

```python
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
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `docker compose run --rm web pytest boards/tests/test_attachments_api.py -v`
Expected: FAIL — `ImportError` (`Attachment` doesn't exist yet).

- [ ] **Step 3: Add `MEDIA_ROOT`/`MEDIA_URL` settings**

In `config/settings.py`, add right after the existing `STATIC_ROOT = BASE_DIR / 'staticfiles'` line:

```python
# Attachment file storage — local filesystem, not an object store (see
# docs/superpowers/specs/2026-08-24-tasky-task-detail-ux-design.md). Never
# served directly: boards.views.AttachmentViewSet.download is the only
# path a client can fetch a file through, so it can enforce the same
# project-membership check every other endpoint does. No urls.py entry
# maps MEDIA_URL to a static-serving view — that's deliberate.
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'
```

`media/` is already listed in `.gitignore`.

- [ ] **Step 4: Add the model**

In `boards/models.py`, add after the `Comment` class:

```python
class Attachment(models.Model):
    work_item = models.ForeignKey(WorkItem, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to="attachments/")
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100, blank=True)
    size = models.PositiveIntegerField()
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="attachments_uploaded",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at", "id"]

    def __str__(self) -> str:
        return f"{self.filename} on {self.work_item}"

    @property
    def project(self):
        return self.work_item.board.project
```

The `project` property exists so `IsProjectMember.has_object_permission` — which reads `obj.project` — works on an `Attachment` the same way it already works on a `Comment` (see `Comment.project` in this same file for the identical pattern).

```bash
docker compose run --rm web python manage.py makemigrations boards -n attachment
```

Confirm the generated file is `boards/migrations/0030_attachment.py` (it follows `0029_workitem_release.py`).

- [ ] **Step 5: Add the serializer**

In `boards/serializers.py`, update the `from .models import ...` line to include `Attachment`. Add, after `CommentSerializer`:

```python
class AttachmentSerializer(serializers.ModelSerializer):
    uploaded_by = UserSerializer(read_only=True)

    class Meta:
        model = Attachment
        fields = ["id", "work_item", "filename", "content_type", "size", "uploaded_by", "uploaded_at"]
```

This serializer is read-only in practice — creation happens in the view directly from `request.FILES` (see Step 6), since `filename`/`content_type`/`size` are derived from the uploaded file object itself, not client-supplied JSON. No `read_only_fields` needed: nothing ever calls `.is_valid()`/`.save()` on it.

- [ ] **Step 6: Add the `attachments` action to `WorkItemViewSet`**

In `boards/views.py`, update the `from .models import ...` line to include `Attachment`, and the `.serializers import (...)` block to include `AttachmentSerializer`. Add a module-level constant near the top of the file (alongside other module-level constants, or just above `WorkItemViewSet` if none exist yet):

```python
MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024  # 25 MB
```

Add, after the existing `comments` action on `WorkItemViewSet`:

```python
    @action(detail=True, methods=["get", "post"], parser_classes=[MultiPartParser])
    def attachments(self, request, pk=None):
        item = self.get_object()

        if request.method == "POST":
            upload = request.FILES.get("file")
            if not upload:
                raise ValidationError({"file": "This field is required."})
            if upload.size > MAX_ATTACHMENT_SIZE:
                raise ValidationError({"file": "File exceeds the 25 MB limit."})
            attachment = Attachment.objects.create(
                work_item=item,
                file=upload,
                filename=upload.name,
                content_type=upload.content_type or "",
                size=upload.size,
                uploaded_by=request.user,
            )
            return Response(AttachmentSerializer(attachment).data, status=201)

        return Response(AttachmentSerializer(item.attachments.select_related("uploaded_by"), many=True).data)
```

`parser_classes=[MultiPartParser]` mirrors `import_csv`'s exact existing pattern — DRF's default JSON parser can't read `multipart/form-data`, and `GET` requests have no body to parse either way, so applying it to the whole action (not just `POST`) is harmless.

- [ ] **Step 7: Add `AttachmentViewSet`**

Add, after `CommentViewSet` in `boards/views.py`:

```python
class AttachmentViewSet(mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Deletion and download only — attachments are created through the
    work item's own /attachments/ endpoint (see WorkItemViewSet)."""

    serializer_class = AttachmentSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]

    def get_queryset(self):
        return Attachment.objects.select_related("uploaded_by", "work_item__board__project")

    def perform_destroy(self, instance):
        role = instance.project.memberships.get(user=self.request.user).role
        is_uploader = instance.uploaded_by_id is not None and instance.uploaded_by_id == self.request.user.id
        if not is_uploader and not can_manage_components(role):
            raise PermissionDenied("Only the uploader or an Owner/Admin can delete this attachment.")
        instance.delete()

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        attachment = self.get_object()
        response = FileResponse(
            attachment.file.open("rb"), as_attachment=True, filename=attachment.filename
        )
        return response
```

`can_manage_components` is reused rather than a new `can_manage_attachments` helper — it's already exactly the `role in ("owner", "admin")` check this needs, and adding an identically-bodied second function would just be the same rule under two names. If a future sub-project needs to diverge the two, split them then.

Update the existing `from django.http import Http404` line at the top of `boards/views.py` to `from django.http import FileResponse, Http404`.

- [ ] **Step 8: Wire the URLs**

In `boards/urls.py`, update the import to include `AttachmentViewSet`, and register it on the router alongside the existing `CommentViewSet`/`WorkItemLinkViewSet` registrations:

```python
router.register("attachments", AttachmentViewSet, basename="attachment")
```

The nested `attachments` action on `WorkItemViewSet` needs no separate `path()` entry — it's a router-registered `@action`, automatically routed the same way `comments`/`links`/`move`/`schedule` already are.

- [ ] **Step 9: Run the tests to confirm they pass**

Run: `docker compose run --rm web pytest boards/tests/test_attachments_api.py -v`
Expected: 15 passed.

Run: `docker compose run --rm web pytest -v`
Expected: all tests pass (478 total).

- [ ] **Step 10: Update API docs**

In `docs/api.md`, add a section documenting `GET/POST /api/work-items/{id}/attachments/`, `DELETE /api/attachments/{id}/`, and `GET /api/attachments/{id}/download/` — matching the style of the existing Comments section. Note the 25 MB cap, the wider (uploader-or-Owner/Admin) delete permission versus Comment's narrower rule, and that downloads are never served via a raw `MEDIA_URL`.

- [ ] **Step 11: Commit**

```bash
git add boards/ config/settings.py docs/api.md
git commit -m "Add Attachment model, upload/list, delete, and download"
```
