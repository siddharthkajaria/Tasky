from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    BoardViewSet,
    CommentViewSet,
    ComponentViewSet,
    CustomFieldViewSet,
    FieldOptionViewSet,
    LabelViewSet,
    ProjectScreenAssignmentsView,
    ReleaseViewSet,
    ScreenFieldViewSet,
    ScreenViewSet,
    SearchView,
    SprintViewSet,
    WorkItemLinkViewSet,
    WorkItemStatusViewSet,
    WorkItemViewSet,
)

router = DefaultRouter()
router.register("boards", BoardViewSet, basename="board")
router.register("work-items", WorkItemViewSet, basename="work-item")
router.register("comments", CommentViewSet, basename="comment")
router.register("work-item-links", WorkItemLinkViewSet, basename="work-item-link")
router.register("fields", CustomFieldViewSet, basename="custom-field")
router.register("screens", ScreenViewSet, basename="screen")
router.register("labels", LabelViewSet, basename="label")

urlpatterns = router.urls + [
    path(
        "projects/<int:project_pk>/components/",
        ComponentViewSet.as_view({"get": "list", "post": "create"}),
        name="project-components",
    ),
    path(
        "projects/<int:project_pk>/components/<int:pk>/",
        ComponentViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="project-component-detail",
    ),
    path(
        "projects/<int:project_pk>/releases/",
        ReleaseViewSet.as_view({"get": "list", "post": "create"}),
        name="project-releases",
    ),
    path(
        "projects/<int:project_pk>/releases/<int:pk>/",
        ReleaseViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="project-release-detail",
    ),
    path(
        "projects/<int:project_pk>/releases/<int:pk>/work-items/",
        ReleaseViewSet.as_view({"get": "work_items"}),
        name="project-release-work-items",
    ),
    path(
        "projects/<int:project_pk>/statuses/",
        WorkItemStatusViewSet.as_view({"get": "list", "post": "create"}),
        name="project-statuses",
    ),
    path(
        "projects/<int:project_pk>/statuses/<int:pk>/",
        WorkItemStatusViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="project-status-detail",
    ),
    path(
        "boards/<int:board_pk>/sprints/",
        SprintViewSet.as_view({"get": "list", "post": "create"}),
        name="board-sprints",
    ),
    path(
        "sprints/<int:pk>/",
        SprintViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="sprint-detail",
    ),
    path(
        "sprints/<int:pk>/start/",
        SprintViewSet.as_view({"post": "start"}),
        name="sprint-start",
    ),
    path(
        "sprints/<int:pk>/complete/",
        SprintViewSet.as_view({"post": "complete"}),
        name="sprint-complete",
    ),
    path(
        "sprints/<int:pk>/work-items/",
        SprintViewSet.as_view({"get": "work_items"}),
        name="sprint-work-items",
    ),
    path(
        "fields/<int:field_pk>/options/",
        FieldOptionViewSet.as_view({"post": "create"}),
        name="field-options",
    ),
    path(
        "fields/<int:field_pk>/options/<int:pk>/",
        FieldOptionViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="field-option-detail",
    ),
    path(
        "screens/<int:screen_pk>/fields/",
        ScreenFieldViewSet.as_view({"post": "create"}),
        name="screen-fields",
    ),
    path(
        "screens/<int:screen_pk>/fields/<int:pk>/",
        ScreenFieldViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="screen-field-detail",
    ),
    path(
        "projects/<int:project_pk>/screen-assignments/",
        ProjectScreenAssignmentsView.as_view(),
        name="project-screen-assignments",
    ),
    path("search/", SearchView.as_view(), name="search"),
]
