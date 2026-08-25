# Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production Django/DRF backend for Tasky's Search feature (sub-project 5 of 13) — a single `GET /api/search/` endpoint, cross-project but strictly scoped to the caller's own memberships, combining free-text and structured facet filters over `WorkItem`.

**Architecture:** No new model — a read-only aggregation over the existing `WorkItem`/`WorkItemStatus`/`Component`/`Label` tables. One new `APIView` (`SearchView`, matching the existing `ProjectScreenAssignmentsView` precedent for a single endpoint with no natural ModelViewSet home) plus one new slim serializer (`SearchResultSerializer`). All query-building logic lives in the view; there's no service-layer function to extract since nothing else in the codebase will ever call this logic — the write side has service functions to share and reuse (`resolve_labels`, `move_work_item`), search has none.

**Tech Stack:** Django 5.2, DRF 3.16, MySQL, pytest-django. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-tasky-search-design.md` (signed off 2026-08-24; the `design/` prototype it argues from was signed off and built 2026-08-25)

## Global Constraints

- **Role vocabulary is `owner` / `admin` / `member`** (lowercase) — unchanged, and irrelevant here anyway: search has no manage tier, every authenticated user can search, scoped to their own memberships.
- **Unauthenticated request → `403`, never `401`** (existing site-wide convention, unchanged).
- **At least one of `q` or a facet filter (`item_type`, `status_category`, `priority`, `assignee`, `component`, `label`, `project`) must be present** — a bare `GET /api/search/` 400s with `{"detail": "Provide a search term or at least one filter."}` rather than silently returning a recency-ordered dump of every work item across every project the caller is in.
- **`q` requires 2+ characters if present.**
- **Cross-project, scoped strictly to `ProjectMembership.objects.filter(user=request.user)`** — the base queryset is scoped this way before any facet is applied, so no facet value can ever leak a work item from a project the caller isn't a member of. `project`, `component`, and `label` facet values that resolve to something outside the caller's membership set are rejected with `400`, not silently ignored or 403'd (these are filter-value rejections on a list endpoint, not object-level access-control failures — matching the design/ prototype's mock behavior exactly, verified during that prototype's browser testing including an adversarial forged-value probe).
- **`status_category` filters by category** (`todo`/`in_progress`/`done`), never a literal `WorkItemStatus` id — status names and even category assignment vary per project, so category is the one status concept guaranteed to mean the same thing across every project in a cross-project search.
- **Results capped at 50, no pagination.** Ranking: when `q` is present, two tiers — `key`/`title` match first, `description`-only match second — each tier ordered `-updated_at, -id`; when `q` is absent (facet-only), the whole result set is ordered `-updated_at, -id`.
- **Every new migration is a plain additive change** — this plan has no migrations at all (no schema change).

---

## Task 1: `GET /api/search/`

**Files:**
- Create: `boards/tests/test_search_api.py`
- Modify: `boards/serializers.py`, `boards/views.py`, `boards/urls.py`

**Interfaces:**
- Consumes: `WorkItem`, `WorkItemStatus`, `Component`, `Label`, `ProjectMembership` (all pre-existing). `WorkItemStatusSummarySerializer`, `UserSerializer` (existing, reused for the response shape).
- Produces: `boards.serializers.SearchResultSerializer`. `GET /api/search/`. Nothing later in the roadmap currently depends on this — it's a leaf feature.

- [ ] **Step 1: Write the failing tests**

Create `boards/tests/test_search_api.py`:

```python
import pytest

from boards.models import Board, Component, Label, WorkItem, WorkItemStatus


@pytest.fixture
def board(user, project):
    return Board.objects.create(name="Test Board", created_by=user, project=project)


@pytest.fixture
def epic(board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    return WorkItem.objects.create(
        board=board, title="Redesign onboarding", description="A big project",
        item_type="epic", status=status, created_by=None,
    )


@pytest.mark.django_db
def test_anonymous_callers_are_rejected(client):
    assert client.get("/api/search/?q=redesign").status_code == 403


@pytest.mark.django_db
def test_a_bare_request_with_no_q_or_facet_is_rejected(auth_client):
    response = auth_client.get("/api/search/")
    assert response.status_code == 400


@pytest.mark.django_db
def test_a_one_character_q_is_rejected(auth_client):
    response = auth_client.get("/api/search/?q=a")
    assert response.status_code == 400
    assert "q" in response.json()


@pytest.mark.django_db
def test_a_title_match_is_found(auth_client, epic):
    response = auth_client.get("/api/search/?q=onboarding")
    assert response.status_code == 200
    body = response.json()
    assert body["results"][0]["id"] == epic.id
    assert body["results"][0]["key"] == epic.key
    assert body["results"][0]["item_type"] == "epic"
    assert body["results"][0]["status_detail"]["category"] == "todo"


@pytest.mark.django_db
def test_a_key_match_is_found(auth_client, epic):
    response = auth_client.get(f"/api/search/?q={epic.key}")
    assert response.status_code == 200
    assert response.json()["results"][0]["id"] == epic.id


@pytest.mark.django_db
def test_title_matches_rank_above_description_only_matches(auth_client, board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    title_match = WorkItem.objects.create(
        board=board, title="Fix the widget", description="", status=status, created_by=None,
    )
    description_match = WorkItem.objects.create(
        board=board, title="Unrelated", description="Contains widget somewhere", status=status, created_by=None,
    )
    response = auth_client.get("/api/search/?q=widget")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids.index(title_match.id) < ids.index(description_match.id)


@pytest.mark.django_db
def test_results_never_include_a_project_im_not_a_member_of(auth_client, other_user, epic):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    foreign_board = Board.objects.create(name="B", created_by=other_user, project=foreign)
    foreign_status = WorkItemStatus.objects.filter(project=foreign, category="todo").first()
    WorkItem.objects.create(
        board=foreign_board, title="Redesign onboarding elsewhere",
        status=foreign_status, created_by=None,
    )

    response = auth_client.get("/api/search/?q=onboarding")
    ids = [r["id"] for r in response.json()["results"]]
    assert epic.id in ids
    assert len(ids) == 1


@pytest.mark.django_db
def test_item_type_facet_filters(auth_client, board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    bug = WorkItem.objects.create(board=board, title="A bug", item_type="bug", status=status, created_by=None)
    WorkItem.objects.create(board=board, title="A task", item_type="task", status=status, created_by=None)

    response = auth_client.get("/api/search/?item_type=bug")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids == [bug.id]


@pytest.mark.django_db
def test_status_category_facet_filters_by_category_not_literal_status(auth_client, board, project):
    done_status = WorkItemStatus.objects.filter(project=project, category="done").first()
    item = WorkItem.objects.create(board=board, title="Finished thing", status=done_status, created_by=None)

    response = auth_client.get("/api/search/?status_category=done")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids == [item.id]


@pytest.mark.django_db
def test_priority_facet_filters(auth_client, board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    high = WorkItem.objects.create(board=board, title="Urgent", priority=3, status=status, created_by=None)
    WorkItem.objects.create(board=board, title="Normal", priority=2, status=status, created_by=None)

    response = auth_client.get("/api/search/?priority=3")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids == [high.id]


@pytest.mark.django_db
def test_assignee_facet_filters(auth_client, board, project, user):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    mine = WorkItem.objects.create(board=board, title="Mine", assignee=user, status=status, created_by=None)
    WorkItem.objects.create(board=board, title="Unassigned", status=status, created_by=None)

    response = auth_client.get(f"/api/search/?assignee={user.id}")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids == [mine.id]


@pytest.mark.django_db
def test_assignee_facet_with_unknown_id_is_rejected(auth_client):
    response = auth_client.get("/api/search/?assignee=999999")
    assert response.status_code == 400
    assert "assignee" in response.json()


@pytest.mark.django_db
def test_component_facet_filters(auth_client, board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    component = Component.objects.create(project=project, name="Backend")
    item = WorkItem.objects.create(board=board, title="Backend work", status=status, created_by=None)
    item.components.add(component)
    WorkItem.objects.create(board=board, title="Other work", status=status, created_by=None)

    response = auth_client.get(f"/api/search/?component={component.id}")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids == [item.id]


@pytest.mark.django_db
def test_component_facet_from_a_project_im_not_in_is_rejected(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")
    foreign_component = Component.objects.create(project=foreign, name="Foreign")

    response = auth_client.get(f"/api/search/?component={foreign_component.id}")
    assert response.status_code == 400
    assert "component" in response.json()


@pytest.mark.django_db
def test_label_facet_filters_by_id_and_by_name(auth_client, board, project):
    from boards.models import Label as LabelModel

    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    label = LabelModel.objects.create(name="urgent", color="#A32218", created_by=None)
    item = WorkItem.objects.create(board=board, title="Tagged", status=status, created_by=None)
    item.labels.add(label)

    by_id = auth_client.get(f"/api/search/?label={label.id}")
    by_name = auth_client.get("/api/search/?label=URGENT")
    assert [r["id"] for r in by_id.json()["results"]] == [item.id]
    assert [r["id"] for r in by_name.json()["results"]] == [item.id]


@pytest.mark.django_db
def test_label_facet_with_unknown_name_is_rejected(auth_client):
    response = auth_client.get("/api/search/?label=nonexistent")
    assert response.status_code == 400
    assert "label" in response.json()


@pytest.mark.django_db
def test_project_facet_narrows_to_one_project(auth_client, board, project, user):
    from projects.models import Project, ProjectMembership

    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    in_project = WorkItem.objects.create(board=board, title="Shared term", status=status, created_by=None)

    other = Project.objects.create(key="OTHER", name="Elsewhere")
    ProjectMembership.objects.create(project=other, user=user, role="owner")
    other_board = Board.objects.create(name="Other Board", created_by=user, project=other)
    other_status = WorkItemStatus.objects.filter(project=other, category="todo").first()
    WorkItem.objects.create(board=other_board, title="Shared term too", status=other_status, created_by=None)

    response = auth_client.get(f"/api/search/?q=shared&project={project.id}")
    ids = [r["id"] for r in response.json()["results"]]
    assert ids == [in_project.id]


@pytest.mark.django_db
def test_project_facet_for_a_project_im_not_in_is_rejected(auth_client, other_user):
    from projects.models import Project, ProjectMembership

    foreign = Project.objects.create(key="FOREIGN", name="Not Yours")
    ProjectMembership.objects.create(project=foreign, user=other_user, role="owner")

    response = auth_client.get(f"/api/search/?item_type=bug&project={foreign.id}")
    assert response.status_code == 400
    assert "project" in response.json()


@pytest.mark.django_db
def test_invalid_item_type_is_rejected(auth_client):
    response = auth_client.get("/api/search/?item_type=nonsense")
    assert response.status_code == 400


@pytest.mark.django_db
def test_invalid_status_category_is_rejected(auth_client):
    response = auth_client.get("/api/search/?status_category=nonsense")
    assert response.status_code == 400


@pytest.mark.django_db
def test_invalid_priority_is_rejected(auth_client):
    response = auth_client.get("/api/search/?priority=nonsense")
    assert response.status_code == 400


@pytest.mark.django_db
def test_no_matches_returns_an_empty_list_not_an_error(auth_client, epic):
    response = auth_client.get("/api/search/?q=zzzznonexistentzzzz")
    assert response.status_code == 200
    assert response.json()["results"] == []


@pytest.mark.django_db
def test_a_facet_only_search_needs_no_q(auth_client, board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    item = WorkItem.objects.create(board=board, title="Anything", item_type="bug", status=status, created_by=None)
    response = auth_client.get("/api/search/?item_type=bug")
    assert response.status_code == 200
    assert [r["id"] for r in response.json()["results"]] == [item.id]


@pytest.mark.django_db
def test_results_are_capped_at_50(auth_client, board, project):
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    for i in range(55):
        WorkItem.objects.create(board=board, title=f"Widget {i}", status=status, created_by=None)
    response = auth_client.get("/api/search/?q=widget")
    assert len(response.json()["results"]) == 50
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `docker compose run --rm web pytest boards/tests/test_search_api.py -v`
Expected: FAIL — `404 Not Found` on every request (no `/api/search/` route exists yet).

- [ ] **Step 3: Add `SearchResultSerializer`**

In `boards/serializers.py`, no import changes are needed (`WorkItem` is already imported). Add, after `WorkItemSummarySerializer`:

```python
class SearchResultSerializer(serializers.ModelSerializer):
    status_detail = WorkItemStatusSummarySerializer(source="status", read_only=True)
    assignee_detail = UserSerializer(source="assignee", read_only=True)
    priority_label = serializers.CharField(source="get_priority_display", read_only=True)
    project = serializers.SerializerMethodField()
    board = serializers.SerializerMethodField()

    class Meta:
        model = WorkItem
        fields = [
            "id", "key", "title", "item_type", "status_detail",
            "priority", "priority_label", "assignee_detail",
            "project", "board", "updated_at",
        ]

    def get_project(self, obj):
        return {"id": obj.board.project_id, "key": obj.board.project.key, "name": obj.board.project.name}

    def get_board(self, obj):
        return {"id": obj.board_id, "name": obj.board.name}
```

- [ ] **Step 4: Add `SearchView`**

In `boards/views.py`, `Component` and `Label` are already imported from `.models`; update the `.serializers import (...)` block to include `SearchResultSerializer`. `django.db.models` is already imported as `models` (the file's top line is `from django.db import models, transaction`) — use `models.Q(...)` below rather than adding a separate `Q` import. Add the view after `ProjectScreenAssignmentsView`:

```python
class SearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        params = request.query_params
        q = (params.get("q") or "").strip()
        facet_keys = ["item_type", "status_category", "priority", "assignee", "component", "label", "project"]
        has_facet = any(params.get(key) for key in facet_keys)
        if not q and not has_facet:
            raise ValidationError({"detail": "Provide a search term or at least one filter."})
        if q and len(q) < 2:
            raise ValidationError({"q": "Must be at least 2 characters."})

        my_project_ids = set(
            ProjectMembership.objects.filter(user=request.user).values_list("project_id", flat=True)
        )
        qs = WorkItem.objects.filter(board__project_id__in=my_project_ids).select_related(
            "board__project", "assignee", "status"
        )

        project_param = params.get("project")
        if project_param:
            project_id = self._as_int(project_param, "project")
            if project_id not in my_project_ids:
                raise ValidationError({"project": "Not a project you belong to."})
            qs = qs.filter(board__project_id=project_id)

        item_type = params.get("item_type")
        if item_type:
            if item_type not in WorkItem.ItemType.values:
                raise ValidationError({"item_type": "Invalid item type."})
            qs = qs.filter(item_type=item_type)

        status_category = params.get("status_category")
        if status_category:
            if status_category not in WorkItemStatus.Category.values:
                raise ValidationError({"status_category": "Invalid category."})
            qs = qs.filter(status__category=status_category)

        priority = params.get("priority")
        if priority:
            priority = self._as_int(priority, "priority")
            if priority not in (1, 2, 3):
                raise ValidationError({"priority": "Must be 1, 2, or 3."})
            qs = qs.filter(priority=priority)

        assignee = params.get("assignee")
        if assignee:
            assignee_id = self._as_int(assignee, "assignee")
            from django.contrib.auth import get_user_model

            if not get_user_model().objects.filter(pk=assignee_id).exists():
                raise ValidationError({"assignee": "User not found."})
            qs = qs.filter(assignee_id=assignee_id)

        component_param = params.get("component")
        if component_param:
            component_id = self._as_int(component_param, "component")
            component = Component.objects.filter(pk=component_id).first()
            if not component or component.project_id not in my_project_ids:
                raise ValidationError({"component": "Component not found."})
            qs = qs.filter(components__id=component_id)

        label_param = params.get("label")
        if label_param:
            if label_param.isdigit():
                label = Label.objects.filter(pk=int(label_param)).first()
            else:
                label = Label.objects.filter(name__iexact=label_param).first()
            if not label:
                raise ValidationError({"label": "Label not found."})
            qs = qs.filter(labels__id=label.id)

        qs = qs.distinct()

        if q:
            tier1 = qs.filter(models.Q(key__icontains=q) | models.Q(title__icontains=q))
            tier1_ids = list(tier1.order_by("-updated_at", "-id")[:50].values_list("id", flat=True))
            results = list(tier1.filter(id__in=tier1_ids))
            results.sort(key=lambda item: tier1_ids.index(item.id))
            remaining = 50 - len(results)
            if remaining > 0:
                tier2 = qs.filter(description__icontains=q).exclude(id__in=tier1_ids)
                results += list(tier2.order_by("-updated_at", "-id")[:remaining])
        else:
            results = list(qs.order_by("-updated_at", "-id")[:50])

        return Response({"results": SearchResultSerializer(results, many=True).data})

    def _as_int(self, value, field_name):
        try:
            return int(value)
        except (TypeError, ValueError):
            raise ValidationError({field_name: "Must be an integer."})
```

- [ ] **Step 5: Wire the URL**

In `boards/urls.py`, update the import to include `SearchView`, and add to the `urlpatterns` list (alongside the other non-router paths):

```python
    path("search/", SearchView.as_view(), name="search"),
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `docker compose run --rm web pytest boards/tests/test_search_api.py -v`
Expected: 24 passed.

Run: `docker compose run --rm web pytest -v`
Expected: all tests pass (387 total).

- [ ] **Step 7: Update API docs**

In `docs/api.md`, add a section documenting `GET /api/search/` — every query param from this task's Step 4, the response shape from `SearchResultSerializer`, the ranking rule (title/key match before description-only match, `-updated_at` tiebreak within each tier), the 50-result cap with no pagination, and the "at least one of `q` or a facet" requirement. Match the style of the existing endpoint sections.

- [ ] **Step 8: Commit**

```bash
git add boards/ docs/api.md
git commit -m "Add cross-project search endpoint"
```
