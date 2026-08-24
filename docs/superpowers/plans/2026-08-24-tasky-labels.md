# Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production Django/DRF backend for Tasky's Labels feature (sub-project 4 of 13) — a global, free-form `Label` any project member can apply (including inventing a new one) directly on a work item, with rename/recolor/delete gated to any project Owner.

**Architecture:** One new model in the existing `boards` app (`Label`), plus a new `labels` M2M field on `WorkItem` (structurally parallel to the existing `components` M2M, but write-shape is names not ids). `LabelViewSet` exposes `GET /api/labels/` and `GET/PATCH/DELETE /api/labels/{id}/` only — no `POST`, since a `Label` is created only implicitly. That implicit creation lives in a new `boards.services.resolve_labels(names)` function, called from `WorkItemSerializer.create()`/`update()`, mirroring `design/js/store.js`'s `findOrCreateLabel`/`resolveLabelIds` (case-insensitive get-or-create, deterministic palette-hash color) closely enough that the prototype and the real API agree on every observable behavior except the one place the spec's error table requires them to differ (see Global Constraints).

**Tech Stack:** Django 5.2, DRF 3.16, MySQL, pytest-django. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-18-tasky-labels-design.md` (signed off 2026-08-18; the `design/` prototype it argues from was signed off and built 2026-08-24)

## Global Constraints

- **Role vocabulary is `owner` / `admin` / `member`** (lowercase) — unchanged from sub-project 1.
- **Unauthenticated request → `403`, never `401`** (existing site-wide convention, unchanged).
- **`Label` is global, not project-scoped** — `LabelViewSet` uses `IsAuthenticated` only (no object-level project check; there is no project to be "a member of"). The "Owner of any project" governance check for rename/recolor/delete is done explicitly with the existing `user_can_manage_definitions(user)` helper from `boards/serializers.py` (sub-project 2b) — reused verbatim, not redefined.
- **No `POST /api/labels/`.** `LabelViewSet.http_method_names` excludes `"post"`, so a direct `POST` to the collection URL gets Django's own `405`, the same technique `CustomFieldViewSet`/`ScreenViewSet` already use to exclude `"put"`. A `Label` is created exactly one way: implicitly, through a work item write that names one that doesn't exist yet.
- **`WorkItemSerializer.labels` is a list of names (strings), not ids.** This is the one write field in the whole API surface that differs from `component_ids`-style id lists (`components`, and every other M2M/FK write here). Because of that, `labels` must be popped out of `validated_data` in `create()`/`update()` **before** calling `super().create()`/`super().update()` — DRF's `ModelSerializer` auto-detects `labels` as a model-level M2M field by name and will try to call `.set()` on it with whatever is left in `validated_data`, which would crash on a list of plain strings instead of `Label` instances or pks. This is the exact same reason `custom_fields` is already popped early in both methods — follow that precedent, don't fight it.
- **Blank names 400, unlike the prototype.** The signed-off spec's error table requires a work item write containing a blank/whitespace-only label name to `400`, naming `labels`. `design/js/store.js`'s mock (`findOrCreateLabel`) instead silently drops a blank name — a latent gap in the mock that's unreachable in practice (its chip-input widget already filters blanks client-side before ever calling the store), not something this plan needs to reconcile in `design/`. The real API follows the spec, not the mock: reject blank names in `WorkItemSerializer.validate()`, before `resolve_labels()` ever runs.
- **Deleting a `Label` has no "still in use" guard** — deletion always succeeds and simply drops the M2M rows, matching `Component`'s existing delete behavior in this codebase today. Do not add a usage check.
- **Color is deterministic and server-assigned, never client-supplied on creation.** `LABEL_PALETTE` (8 colors, copied verbatim from `design/js/store.js` so the prototype and the real API render identical colors) lives in `boards/services.py`; `label_color_for(name)` hashes a name into it the same way `design/js/store.js`'s `hashLabelColor` does. It is called only from `resolve_labels()`, at the moment a new `Label` row is created — never anywhere else.
- **Every migration in this plan is a plain additive `CreateModel`/`AddField`** — nothing here touches an existing column, so `makemigrations` autodetection is reliable; no hand-written migration is needed (unlike sub-project 3's `WorkItem.status` conversion).

---

## Task 1: `Label` model and admin endpoints

**Files:**
- Create: `boards/migrations/0024_label.py`
- Modify: `boards/models.py`, `boards/serializers.py`, `boards/views.py`, `boards/urls.py`
- Test: `boards/tests/test_labels_api.py`

**Interfaces:**
- Consumes: `user_can_manage_definitions(user) -> bool` (existing, `boards/serializers.py`, sub-project 2b — do not redefine it).
- Produces: `boards.models.Label` (`name`, `color`, `created_by`, `created_at`). `boards.serializers.LabelSerializer` (full record: `id, name, color, created_by, created_at`) and `boards.serializers.LabelSummarySerializer` (`id, name, color` only — this is what Task 2 embeds as `labels_detail` on a work item, mirroring how `WorkItemStatusSummarySerializer` trims down `WorkItemStatusSerializer`). `GET /api/labels/`, `GET/PATCH/DELETE /api/labels/{id}/`. Task 2 imports `Label`, `LabelSummarySerializer` from here.

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_labels_api.py`:

```python
import pytest

from boards.models import Label


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client):
    assert client.get("/api/labels/").status_code == 403


@pytest.mark.django_db
def test_any_authenticated_user_can_list_labels(auth_client):
    """No `project` fixture here on purpose — listing labels needs no
    project membership at all, unlike everything project-scoped."""
    Label.objects.create(name="urgent", color="#A32218", created_by=None)
    response = auth_client.get("/api/labels/")
    assert response.status_code == 200
    assert response.json()[0]["name"] == "urgent"


@pytest.mark.django_db
def test_creating_a_label_directly_is_not_allowed(auth_client, project):
    response = auth_client.post(
        "/api/labels/", {"name": "urgent", "color": "#A32218"}, content_type="application/json"
    )
    assert response.status_code == 405


@pytest.mark.django_db
def test_owner_of_any_project_can_rename_a_label(auth_client, project):
    """No relationship between `project` and the label being renamed —
    proves the check keys on being Owner of *some* project, not this one."""
    label = Label.objects.create(name="old-name", color="#A32218", created_by=None)
    response = auth_client.patch(
        f"/api/labels/{label.id}/", {"name": "new-name"}, content_type="application/json"
    )
    assert response.status_code == 200
    label.refresh_from_db()
    assert label.name == "new-name"


@pytest.mark.django_db
def test_a_plain_member_cannot_rename_a_label(auth_client, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    label = Label.objects.create(name="old-name", color="#A32218", created_by=None)
    response = auth_client.patch(
        f"/api/labels/{label.id}/", {"name": "new-name"}, content_type="application/json"
    )
    assert response.status_code == 403
    label.refresh_from_db()
    assert label.name == "old-name"


@pytest.mark.django_db
def test_renaming_to_a_duplicate_name_is_rejected_case_insensitively(auth_client, project):
    Label.objects.create(name="urgent", color="#A32218", created_by=None)
    other = Label.objects.create(name="needs-design", color="#6E4FA3", created_by=None)
    response = auth_client.patch(
        f"/api/labels/{other.id}/", {"name": "URGENT"}, content_type="application/json"
    )
    assert response.status_code == 400
    assert "name" in response.json()


@pytest.mark.django_db
def test_owner_can_recolor_a_label(auth_client, project):
    label = Label.objects.create(name="urgent", color="#A32218", created_by=None)
    response = auth_client.patch(
        f"/api/labels/{label.id}/", {"color": "#2E7D5B"}, content_type="application/json"
    )
    assert response.status_code == 200
    label.refresh_from_db()
    assert label.color == "#2E7D5B"


@pytest.mark.django_db
def test_recoloring_to_a_color_outside_the_palette_is_rejected(auth_client, project):
    label = Label.objects.create(name="urgent", color="#A32218", created_by=None)
    response = auth_client.patch(
        f"/api/labels/{label.id}/", {"color": "#FFFFFF"}, content_type="application/json"
    )
    assert response.status_code == 400
    assert "color" in response.json()
    label.refresh_from_db()
    assert label.color == "#A32218"


@pytest.mark.django_db
def test_owner_can_delete_an_unused_label(auth_client, project):
    label = Label.objects.create(name="doomed", color="#A32218", created_by=None)
    assert auth_client.delete(f"/api/labels/{label.id}/").status_code == 204
    assert not Label.objects.filter(id=label.id).exists()


@pytest.mark.django_db
def test_a_plain_member_cannot_delete_a_label(auth_client, project):
    from projects.models import ProjectMembership

    ProjectMembership.objects.filter(project=project, user__username="alice").update(role="member")
    label = Label.objects.create(name="urgent", color="#A32218", created_by=None)
    response = auth_client.delete(f"/api/labels/{label.id}/")
    assert response.status_code == 403
    assert Label.objects.filter(id=label.id).exists()


@pytest.mark.django_db
def test_patching_a_nonexistent_label_returns_404(auth_client, project):
    response = auth_client.patch(
        "/api/labels/999999/", {"name": "whatever"}, content_type="application/json"
    )
    assert response.status_code == 404


@pytest.mark.django_db
def test_deleting_a_nonexistent_label_returns_404(auth_client, project):
    assert auth_client.delete("/api/labels/999999/").status_code == 404
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `docker compose run --rm web pytest boards/tests/test_labels_api.py -v`
Expected: FAIL — `ImportError` (`Label` doesn't exist yet).

- [ ] **Step 3: Add the model**

In `boards/models.py`, add after the `Component` class:

```python
class Label(models.Model):
    name = models.CharField(max_length=80, unique=True)
    color = models.CharField(max_length=7)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="labels_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name
```

```bash
docker compose run --rm web python manage.py makemigrations boards -n label
```

Confirm the generated file is named `boards/migrations/0024_label.py` (it follows `0023_restore_workitem_status_position_index.py`); if `makemigrations` names it differently, rename it to match.

- [ ] **Step 4: Add the serializers**

In `boards/serializers.py`, update the `from .models import ...` line to include `Label`. Add, after `ComponentSerializer`:

```python
class LabelSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)

    class Meta:
        model = Label
        fields = ["id", "name", "color", "created_by", "created_at"]
        read_only_fields = ["created_by", "created_at"]

    def validate_name(self, value):
        clean = value.strip()
        if not clean:
            raise serializers.ValidationError("This field may not be blank.")
        qs = Label.objects.filter(name__iexact=clean)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f'"{clean}" already exists.')
        return clean

    def validate_color(self, value):
        from .services import LABEL_PALETTE

        if value not in LABEL_PALETTE:
            raise serializers.ValidationError("Pick a color from the palette.")
        return value


class LabelSummarySerializer(serializers.ModelSerializer):
    """Embedded on a work item as `labels_detail` — id/name/color only, no
    `created_by`/`created_at`. Mirrors how `WorkItemStatusSummarySerializer`
    trims down `WorkItemStatusSerializer` for the same reason."""

    class Meta:
        model = Label
        fields = ["id", "name", "color"]
```

- [ ] **Step 5: Add `LABEL_PALETTE` (used by validation now, and by `resolve_labels()` in Task 2)**

In `boards/services.py`, add near the top, after the `_DEFAULT_STATUSES` constant:

```python
LABEL_PALETTE = [
    "#6E4FA3", "#2E7D5B", "#3B3F8F", "#A32218",
    "#B8860B", "#1F7A8C", "#C2447A", "#5B7B29",
]
```

(This is the exact list from `design/js/store.js`'s `LABEL_PALETTE`, so a label renders the same color in the prototype and the real API.)

- [ ] **Step 6: Add the viewset**

In `boards/views.py`, update the `from .models import ...` line to include `Label`, the `.serializers import (...)` block to include `LabelSerializer`, and add, after `ComponentViewSet`:

```python
class LabelViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "patch", "delete"]
    serializer_class = LabelSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
    queryset = Label.objects.all()

    def perform_update(self, serializer):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage labels. You're not an Owner of any project."
            )
        serializer.save()

    def perform_destroy(self, instance):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage labels. You're not an Owner of any project."
            )
        instance.delete()
```

- [ ] **Step 7: Wire the URL**

In `boards/urls.py`, update the import to include `LabelViewSet`, and register:

```python
router.register("labels", LabelViewSet, basename="label")
```

(alongside the existing `router.register("fields", ...)` / `router.register("screens", ...)` lines — no extra `path()` entries needed, `Label` has no nested child resource.)

- [ ] **Step 8: Run the tests to confirm they pass**

Run: `docker compose run --rm web pytest boards/tests/test_labels_api.py -v`
Expected: 12 passed.

Run: `docker compose run --rm web pytest -v`
Expected: all tests pass (306 total).

- [ ] **Step 9: Commit**

```bash
git add boards/
git commit -m "Add Label model and admin endpoints"
```

---

## Task 2: `WorkItem.labels`, implicit creation, and `WorkItemSerializer` wiring

**Files:**
- Create: `boards/migrations/0025_workitem_labels.py`
- Modify: `boards/models.py`, `boards/services.py`, `boards/serializers.py`, `boards/views.py`
- Test: `boards/tests/test_work_item_labels.py`

**Interfaces:**
- Consumes: `Label`, `LabelSummarySerializer`, `LABEL_PALETTE` (Task 1).
- Produces: `WorkItem.labels` (M2M to `Label`, `related_name="work_items"`, structurally parallel to the existing `components` M2M). `boards.services.label_color_for(name) -> str`, `boards.services.resolve_labels(names) -> list[Label]`. `WorkItemSerializer` gains `labels` (write, list of names) and `labels_detail` (read, `[{id, name, color}]`) on `/api/work-items/`.

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_work_item_labels.py`:

```python
import pytest

from boards.models import Board, Label, WorkItem


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
    assert "labels" in response.json()
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
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `docker compose run --rm web pytest boards/tests/test_work_item_labels.py -v`
Expected: FAIL — work items are created without error but `labels`/`labels_detail` are silently ignored (not yet wired), so the assertions on `labels_detail` fail.

- [ ] **Step 3: Add the M2M field**

In `boards/models.py`, in the `WorkItem` class, add right after the existing `components` field:

```python
    labels = models.ManyToManyField("Label", blank=True, related_name="work_items")
```

```bash
docker compose run --rm web python manage.py makemigrations boards -n workitem_labels
```

Confirm the generated file is named `boards/migrations/0025_workitem_labels.py`.

- [ ] **Step 4: Add `label_color_for` and `resolve_labels` to `boards/services.py`**

Update the `from .models import ...` line to include `Label`. Add, after the `LABEL_PALETTE` constant added in Task 1:

```python
def label_color_for(name: str) -> str:
    """Deterministic — the same name always resolves to the same palette
    color, including after a delete-and-recreate. Mirrors
    design/js/store.js's hashLabelColor exactly (32-bit unsigned overflow,
    replicated here with an explicit mask since Python ints don't wrap),
    so the prototype and the real API render the same color for the same
    name."""
    digest = 0
    for ch in name:
        digest = (digest * 31 + ord(ch)) & 0xFFFFFFFF
    return LABEL_PALETTE[digest % len(LABEL_PALETTE)]


def resolve_labels(names):
    """Case-insensitive match-or-create against `Label`, in one
    transaction — a work item write can create a brand-new Label and reuse
    an existing one in the same request. Mirrors design/js/store.js's
    findOrCreateLabel/resolveLabelIds, except this assumes every name in
    `names` has already been validated non-blank (WorkItemSerializer.validate()
    does that, and 400s before this ever runs) — the prototype's mock
    instead drops a blank silently, which this deliberately does not
    replicate; see this plan's Global Constraints."""
    resolved = []
    seen_ids = set()
    with transaction.atomic():
        for raw in names:
            clean = raw.strip()
            label = Label.objects.filter(name__iexact=clean).first()
            if label is None:
                label = Label.objects.create(name=clean, color=label_color_for(clean), created_by=None)
            if label.id not in seen_ids:
                seen_ids.add(label.id)
                resolved.append(label)
    return resolved
```

- [ ] **Step 5: Wire `WorkItemSerializer`**

In `boards/serializers.py`, update the `from .models import ...` line to include `Label`, and the `from .services import ...` line to include `resolve_labels`.

Add two fields to `WorkItemSerializer`, right after `components_detail`:

```python
    labels = serializers.ListField(child=serializers.CharField(), required=False, write_only=True)
    labels_detail = LabelSummarySerializer(source="labels", many=True, read_only=True)
```

Add `"labels", "labels_detail"` to `Meta.fields`, right after `"components", "components_detail"`.

In `validate()`, add this block right after the existing `"components" in attrs` check:

```python
        if "labels" in attrs:
            if any(not name.strip() for name in attrs["labels"]):
                raise serializers.ValidationError({"labels": "A label name can't be blank."})
```

Update `create()` and `update()` to pop and resolve `labels` — **before** the `super().create()`/`super().update()` call, same reasoning as the existing `custom_fields` pop (see this plan's Global Constraints for why `labels` must never reach DRF's automatic M2M handling as a list of strings):

```python
    def create(self, validated_data):
        custom_fields = validated_data.pop("custom_fields", None)
        label_names = validated_data.pop("labels", None)
        instance = super().create(validated_data)
        if custom_fields:
            apply_custom_fields(instance, custom_fields)
        if label_names is not None:
            instance.labels.set(resolve_labels(label_names))
        return instance

    def update(self, instance, validated_data):
        custom_fields = validated_data.pop("custom_fields", None)
        label_names = validated_data.pop("labels", None)
        instance = super().update(instance, validated_data)
        if custom_fields is not None:
            apply_custom_fields(instance, custom_fields)
        if label_names is not None:
            instance.labels.set(resolve_labels(label_names))
        return instance
```

- [ ] **Step 6: Prefetch `labels` on the two hot read endpoints**

In `boards/views.py`, both `BoardViewSet.work_items()` and `WorkItemViewSet.get_queryset()` currently end with `.prefetch_related("components", "field_values__field")` — change both to `.prefetch_related("components", "labels", "field_values__field")`, so listing a board's work items doesn't N+1 on `labels_detail`.

- [ ] **Step 7: Run the tests to confirm they pass**

Run: `docker compose run --rm web pytest boards/tests/test_work_item_labels.py -v`
Expected: 10 passed.

Run: `docker compose run --rm web pytest -v`
Expected: all tests pass (316 total).

- [ ] **Step 8: Update API docs**

In `docs/api.md`, find the `/api/work-items/` section (where `components`/`components_detail` are documented) and add `labels`/`labels_detail` alongside them, noting the names-not-ids write shape. Add a new section for `GET /api/labels/` and `GET/PATCH/DELETE /api/labels/{id}/`, matching the style of the existing `/api/fields/` section (sub-project 2b) — including the "no `POST`, created only implicitly" note and the governance split (any member applies, Owner of any project manages).

- [ ] **Step 9: Commit**

```bash
git add boards/ docs/api.md
git commit -m "Add WorkItem.labels, implicit label creation, and labels_detail"
```
