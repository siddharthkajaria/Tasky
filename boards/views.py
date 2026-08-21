from django.db import models, transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import ProjectMembership
from projects.permissions import IsProjectMember

from .models import Board, Comment, Component, CustomField, FieldOption, ProjectScreenAssignment, Screen, ScreenField, WorkItem, WorkItemLink, WorkItemStatus
from .serializers import (
    BoardSerializer,
    CommentSerializer,
    ComponentSerializer,
    CustomFieldSerializer,
    FieldOptionSerializer,
    MoveWorkItemSerializer,
    ScreenFieldSerializer,
    ScreenSerializer,
    WorkItemLinkSerializer,
    WorkItemSerializer,
    WorkItemSummarySerializer,
    WorkItemStatusSerializer,
    can_manage_components,
    can_manage_statuses,
    can_manage_screen_assignments,
    user_can_manage_definitions,
)
from .services import move_work_item, next_position


class BoardViewSet(viewsets.ModelViewSet):
    """Boards are scoped to the projects a person belongs to."""

    serializer_class = BoardSerializer
    pagination_class = None
    permission_classes = [IsAuthenticated, IsProjectMember]

    def get_queryset(self):
        qs = Board.objects.select_related("project", "created_by")
        if self.action == "list":
            qs = qs.filter(
                project_id__in=ProjectMembership.objects.filter(
                    user=self.request.user
                ).values_list("project_id", flat=True)
            )
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def update(self, request, *args, **kwargs):
        # Boards do not move between projects — same "echo-back-unchanged-is-
        # fine, a real change is rejected" rule WorkItem already applies to
        # status/board.
        if "project" in request.data:
            board = self.get_object()
            if str(request.data["project"]) != str(board.project_id):
                raise ValidationError({"project": "Boards cannot be moved between projects."})
        return super().update(request, *args, **kwargs)

    @action(detail=True, methods=["get"], url_path="work-items")
    def work_items(self, request, pk=None):
        board = self.get_object()
        items = board.work_items.select_related(
            "assignee", "created_by", "parent", "parent__status", "status"
        ).prefetch_related("components", "field_values__field")
        return Response(WorkItemSerializer(items, many=True).data)


class WorkItemViewSet(viewsets.ModelViewSet):
    serializer_class = WorkItemSerializer
    pagination_class = None
    permission_classes = [IsAuthenticated, IsProjectMember]

    def get_queryset(self):
        qs = WorkItem.objects.select_related(
            "board__project", "assignee", "created_by", "parent", "parent__status", "status"
        ).prefetch_related("components", "field_values__field")
        if self.action == "list":
            qs = qs.filter(
                board__project_id__in=ProjectMembership.objects.filter(
                    user=self.request.user
                ).values_list("project_id", flat=True)
            )
        return qs

    def perform_create(self, serializer):
        # No key-generation logic here: WorkItem.save() generates it (under
        # a real select_for_update() lock on the owning Project row) for
        # every creation path uniformly, API included, since a freshly
        # instantiated WorkItem's `key` is always falsy until save() sets
        # it. Keeping it there instead of duplicating it here avoids two
        # independent implementations of the same locked counter drifting
        # apart, and keeps the lock + increment + INSERT in one atomic block
        # instead of splitting them across two.
        board = serializer.validated_data["board"]
        status = serializer.validated_data["status"]
        serializer.save(
            created_by=self.request.user,
            position=next_position(board.id, status.id),
        )

    def update(self, request, *args, **kwargs):
        # Covers both PUT and PATCH: UpdateModelMixin.partial_update() just
        # calls this with partial=True. An actual status CHANGE here would
        # move the item between columns with NO renumbering — the source
        # keeps a gap, the destination gets a duplicate position — so that's
        # rejected in favour of the one route that renumbers correctly.
        # Only a real change is rejected: a UI that PATCHes back the full set
        # of fields it's holding (status included, unchanged, alongside a
        # genuine edit like title) must not have that legitimate edit 400'd
        # just because the status key was present in the body.
        # Same defect, same fix, for board: relocating an item to a different
        # board with a plain PATCH would leave a gap in the source column's
        # positions and a duplicate position in the destination column — no
        # renumbering happens either side. Work items do not move between
        # boards in this product at all, so unlike status there is no
        # endpoint to redirect to; a real change is just rejected outright.
        if "status" in request.data or "board" in request.data or "item_type" in request.data or "key" in request.data:
            item = self.get_object()
            if "status" in request.data and str(request.data["status"]) != str(item.status_id):
                raise ValidationError(
                    {
                        "status": (
                            "Status cannot be changed here — "
                            "POST to /api/work-items/{id}/move/ instead."
                        )
                    }
                )
            if "board" in request.data and str(request.data["board"]) != str(item.board_id):
                raise ValidationError(
                    {
                        "board": "Work items cannot be moved between boards."
                    }
                )
            if "item_type" in request.data and request.data["item_type"] != item.item_type:
                raise ValidationError({"item_type": "Type cannot be changed after creation."})
            if "key" in request.data and request.data["key"] != item.key:
                raise ValidationError({"key": "Key cannot be changed."})
        return super().update(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        item = self.get_object()

        serializer = MoveWorkItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_status = serializer.validated_data["status"]
        if target_status.project_id != item.board.project_id:
            raise ValidationError({"status": "Status must belong to this item's project."})

        try:
            move_work_item(
                item,
                target_status.id,
                serializer.validated_data["position"],
            )
        except WorkItem.DoesNotExist:
            # The item was deleted by another request between this request's
            # (unlocked) get_object() and move_work_item()'s row lock.
            # WorkItem.DoesNotExist is not converted to 404 by DRF's default
            # exception handler on its own (only django.http.Http404 and
            # PermissionDenied are) — it has to be translated explicitly, or
            # this would surface as a 500.
            raise Http404("Work item was deleted before the move could be applied.")
        item.refresh_from_db()
        return Response(WorkItemSerializer(item).data)

    @action(detail=True, methods=["get"])
    def children(self, request, pk=None):
        item = self.get_object()
        return Response(WorkItemSummarySerializer(item.children.all(), many=True).data)

    @action(detail=True, methods=["get", "post"])
    def links(self, request, pk=None):
        item = self.get_object()

        if request.method == "POST":
            serializer = WorkItemLinkSerializer(data=request.data, context={"for_item_id": item.id})
            serializer.is_valid(raise_exception=True)
            other = serializer.validated_data["item"]

            if other.id == item.id:
                raise ValidationError({"item": "An item can't be linked to itself."})
            # `other` is already the resolved WorkItem instance — the
            # PrimaryKeyRelatedField's queryset lookup during is_valid()
            # already proved it exists, so re-fetching it would be a
            # redundant query. Membership is the only thing left to check.
            self.check_object_permissions(request, other)

            if item.parent_id == other.id or other.parent_id == item.id:
                raise ValidationError({"item": "These items are already parent and child."})

            item_a, item_b = sorted([item, other], key=lambda w: w.id)
            if WorkItemLink.objects.filter(item_a=item_a, item_b=item_b).exists():
                raise ValidationError({"item": "These items are already linked."})

            link = WorkItemLink.objects.create(item_a=item_a, item_b=item_b, created_by=request.user)
            out = WorkItemLinkSerializer(link, context={"for_item_id": item.id})
            return Response(out.data, status=201)

        thread = WorkItemLink.objects.filter(
            models.Q(item_a=item) | models.Q(item_b=item)
        ).select_related("item_a", "item_b")
        return Response(
            WorkItemLinkSerializer(thread, many=True, context={"for_item_id": item.id}).data
        )

    @action(detail=True, methods=["get", "post"])
    def comments(self, request, pk=None):
        item = self.get_object()

        if request.method == "POST":
            serializer = CommentSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(card=item, author=request.user)
            return Response(serializer.data, status=201)

        thread = item.comments.select_related("author")
        return Response(CommentSerializer(thread, many=True).data)


class CommentViewSet(mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Deletion only — comments are created through the work item's own endpoint."""

    serializer_class = CommentSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]

    def get_queryset(self):
        return Comment.objects.select_related("author", "card__board__project")

    def perform_destroy(self, instance):
        # An authorless comment (its author's account was deleted, which
        # SET_NULLs this FK) must not become permanently undeletable.
        # `instance.author != self.request.user` is True for EVERY signed-in
        # user when author is None, which would brick deletion for good —
        # so ownership is only enforced when there is an owner to enforce.
        if instance.author_id is not None and instance.author != self.request.user:
            raise PermissionDenied("You can only delete your own comments.")
        instance.delete()


class WorkItemLinkViewSet(mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Deletion only — links are created through a work item's own /links/ endpoint."""

    serializer_class = WorkItemLinkSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return WorkItemLink.objects.select_related("item_a__board__project", "item_b__board__project")

    def check_object_permissions(self, request, obj):
        # Matches the AND semantics the create path already enforces: a
        # link can only be created between two items the caller can both
        # see (member of both items' projects), so removing it requires
        # the same — membership in only one side's project is not enough.
        # Reuses IsProjectMember.has_object_permission (same check
        # WorkItemViewSet.links() runs against `item` via get_object() and
        # against `other` via the explicit check_object_permissions call)
        # rather than hand-rolling the membership query twice here.
        is_member = IsProjectMember().has_object_permission
        if not (is_member(request, self, obj.item_a) and is_member(request, self, obj.item_b)):
            self.permission_denied(request, message="You don't have access to this project.")


class ComponentViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete"]
    serializer_class = ComponentSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    pagination_class = None

    def get_project(self):
        from projects.models import Project

        return get_object_or_404(Project, pk=self.kwargs["project_pk"])

    def get_queryset(self):
        return Component.objects.filter(project_id=self.kwargs["project_pk"])

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # IsProjectMember needs an object to check on list/create, where DRF
        # never calls check_object_permissions — the project itself stands
        # in. For patch/delete, DRF's own get_object() already calls
        # check_object_permissions() with the fetched Component instance —
        # Component.project is a real FK field, so IsProjectMember resolves
        # it correctly with no override needed there.
        if self.action in ("list", "create"):
            self.check_object_permissions(request, self.get_project())

    def perform_create(self, serializer):
        project = self.get_project()
        role = project.memberships.get(user=self.request.user).role
        if not can_manage_components(role):
            raise PermissionDenied("You don't have permission to manage components.")
        # `project` is a read-only field on ComponentSerializer (it comes from
        # the URL, not the body) and has no default, so DRF's automatic
        # UniqueTogetherValidator for the (project, name) constraint never
        # gets built — get_unique_together_validators() requires every
        # constrained field to be resolvable from the submitted data. Left
        # unchecked, a duplicate name would hit the DB constraint directly
        # and surface as an uncaught IntegrityError (500) instead of a 400.
        name = serializer.validated_data.get("name")
        if Component.objects.filter(project=project, name=name).exists():
            raise ValidationError({"name": "A component with this name already exists in this project."})
        serializer.save(project=project)

    def perform_update(self, serializer):
        role = serializer.instance.project.memberships.get(user=self.request.user).role
        if not can_manage_components(role):
            raise PermissionDenied("You don't have permission to manage components.")
        name = serializer.validated_data.get("name", serializer.instance.name)
        if (
            Component.objects.filter(project=serializer.instance.project, name=name)
            .exclude(pk=serializer.instance.pk)
            .exists()
        ):
            raise ValidationError({"name": "A component with this name already exists in this project."})
        serializer.save()

    def perform_destroy(self, instance):
        role = instance.project.memberships.get(user=self.request.user).role
        if not can_manage_components(role):
            raise PermissionDenied("You don't have permission to manage components.")
        instance.delete()


class WorkItemStatusViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete"]
    serializer_class = WorkItemStatusSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    pagination_class = None

    def get_project(self):
        from projects.models import Project

        return get_object_or_404(Project, pk=self.kwargs["project_pk"])

    def get_queryset(self):
        return WorkItemStatus.objects.filter(project_id=self.kwargs["project_pk"])

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if self.action in ("list", "create"):
            self.check_object_permissions(request, self.get_project())

    def perform_create(self, serializer):
        project = self.get_project()
        role = project.memberships.get(user=self.request.user).role
        if not can_manage_statuses(role):
            raise PermissionDenied("You don't have permission to manage this project's statuses.")
        name = serializer.validated_data.get("name")
        if WorkItemStatus.objects.filter(project=project, name__iexact=name).exists():
            raise ValidationError({"name": f'"{name}" already exists.'})
        position = WorkItemStatus.objects.filter(project=project).count()
        serializer.save(project=project, position=position)

    def perform_update(self, serializer):
        instance = serializer.instance
        role = instance.project.memberships.get(user=self.request.user).role
        if not can_manage_statuses(role):
            raise PermissionDenied("You don't have permission to manage this project's statuses.")

        name = serializer.validated_data.get("name")
        if name and WorkItemStatus.objects.filter(
            project=instance.project, name__iexact=name
        ).exclude(pk=instance.pk).exists():
            raise ValidationError({"name": f'"{name}" already exists.'})

        new_category = serializer.validated_data.get("category")
        if new_category and new_category != instance.category:
            remaining = WorkItemStatus.objects.filter(
                project=instance.project, category=instance.category
            ).exclude(pk=instance.pk)
            if not remaining.exists():
                raise ValidationError(
                    {"category": f"{instance.get_category_display()} needs at least one status — recategorize another one first."}
                )

        serializer.save()
        if "position" in self.request.data:
            self._reposition(instance)

    def _reposition(self, instance):
        try:
            target = max(0, int(self.request.data["position"]))
        except (TypeError, ValueError):
            raise ValidationError({"position": "Must be a whole number."})
        siblings = list(
            WorkItemStatus.objects.filter(project=instance.project)
            .exclude(pk=instance.pk)
            .order_by("position", "id")
        )
        target = min(target, len(siblings))
        siblings.insert(target, instance)
        for index, status in enumerate(siblings):
            if status.position != index:
                status.position = index
                status.save(update_fields=["position"])

    def perform_destroy(self, instance):
        role = instance.project.memberships.get(user=self.request.user).role
        if not can_manage_statuses(role):
            raise PermissionDenied("You don't have permission to manage this project's statuses.")

        in_use = instance.work_items_with_status.count()
        if in_use:
            raise ValidationError(
                {"detail": f'"{instance.name}" is still used by {in_use} work item{"" if in_use == 1 else "s"}. Move {"it" if in_use == 1 else "them"} first.'}
            )
        remaining = WorkItemStatus.objects.filter(
            project=instance.project, category=instance.category
        ).exclude(pk=instance.pk)
        if not remaining.exists():
            raise ValidationError({"detail": f"{instance.get_category_display()} needs at least one status."})

        project = instance.project
        instance.delete()
        siblings = list(WorkItemStatus.objects.filter(project=project).order_by("position", "id"))
        for index, status in enumerate(siblings):
            if status.position != index:
                status.position = index
                status.save(update_fields=["position"])


class ProjectScreenAssignmentsView(APIView):
    permission_classes = [IsAuthenticated, IsProjectMember]

    def get_project(self):
        from projects.models import Project

        project = get_object_or_404(Project, pk=self.kwargs["project_pk"])
        self.check_object_permissions(self.request, project)
        return project

    def _serialize(self, project):
        rows = dict(
            ProjectScreenAssignment.objects.filter(project=project).values_list("item_type", "screen_id")
        )
        return {item_type: rows.get(item_type) for item_type in WorkItem.ItemType.values}

    def get(self, request, project_pk=None):
        return Response(self._serialize(self.get_project()))

    def put(self, request, project_pk=None):
        project = self.get_project()
        role = project.memberships.get(user=request.user).role
        if not can_manage_screen_assignments(role):
            raise PermissionDenied("Only this project's Owner or Admins can change screen assignments.")

        if not isinstance(request.data, dict):
            raise ValidationError({"detail": "Expected an object mapping item types to screen ids."})

        updates = {}
        for item_type, screen_id in request.data.items():
            if item_type not in WorkItem.ItemType.values:
                raise ValidationError({item_type: "Invalid item type."})
            if screen_id is not None:
                if isinstance(screen_id, bool) or not isinstance(screen_id, int):
                    raise ValidationError({item_type: "Invalid screen id."})
                if not Screen.objects.filter(pk=screen_id).exists():
                    raise ValidationError({item_type: "That screen no longer exists."})
            updates[item_type] = screen_id

        with transaction.atomic():
            for item_type, screen_id in updates.items():
                if screen_id is None:
                    ProjectScreenAssignment.objects.filter(project=project, item_type=item_type).delete()
                else:
                    ProjectScreenAssignment.objects.update_or_create(
                        project=project, item_type=item_type, defaults={"screen_id": screen_id}
                    )

        return Response(self._serialize(project))


class CustomFieldViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete"]
    serializer_class = CustomFieldSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
    queryset = CustomField.objects.prefetch_related("options").all()

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if "field_type" in request.data and request.data["field_type"] != instance.field_type:
            raise ValidationError({"field_type": "A field's type can't be changed after it's created."})
        return super().update(request, *args, **kwargs)

    def perform_create(self, serializer):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage custom fields. You're not an Owner of any project."
            )
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage custom fields. You're not an Owner of any project."
            )
        serializer.save()

    def perform_destroy(self, instance):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage custom fields. You're not an Owner of any project."
            )
        screen_names = list(
            ScreenField.objects.filter(field=instance).values_list("screen__name", flat=True).distinct()
        )
        if screen_names:
            noun = "that screen" if len(screen_names) == 1 else "those screens"
            raise ValidationError(
                {"detail": f'"{instance.name}" is still on {", ".join(screen_names)}. Remove it from {noun} first.'}
            )
        instance.delete()


class FieldOptionViewSet(viewsets.ModelViewSet):
    http_method_names = ["post", "patch", "delete"]
    serializer_class = FieldOptionSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_field(self):
        return get_object_or_404(CustomField, pk=self.kwargs["field_pk"])

    def get_queryset(self):
        return FieldOption.objects.filter(field_id=self.kwargs["field_pk"])

    def perform_create(self, serializer):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage custom fields. You're not an Owner of any project."
            )
        field = self.get_field()
        if not field.has_options:
            raise ValidationError(
                {
                    "detail": (
                        f'Only Select and Multi-select fields have options — '
                        f'"{field.name}" is a {field.get_field_type_display()}.'
                    )
                }
            )
        label = serializer.validated_data["label"]
        if FieldOption.objects.filter(field=field, label__iexact=label).exists():
            raise ValidationError({"label": f'"{label}" is already an option.'})
        position = FieldOption.objects.filter(field=field).count()
        serializer.save(field=field, position=position)

    def perform_update(self, serializer):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage custom fields. You're not an Owner of any project."
            )
        instance = serializer.instance
        label = serializer.validated_data.get("label")
        if label and FieldOption.objects.filter(field=instance.field, label__iexact=label).exclude(pk=instance.pk).exists():
            raise ValidationError({"label": f'"{label}" is already an option.'})
        serializer.save()
        if "position" in self.request.data:
            self._reposition(instance)

    def _reposition(self, instance):
        try:
            target = max(0, int(self.request.data["position"]))
        except (TypeError, ValueError):
            raise ValidationError({"position": "Must be a whole number."})
        siblings = list(FieldOption.objects.filter(field=instance.field).exclude(pk=instance.pk).order_by("position", "id"))
        target = min(target, len(siblings))
        siblings.insert(target, instance)
        for index, option in enumerate(siblings):
            if option.position != index:
                option.position = index
                option.save(update_fields=["position"])

    def perform_destroy(self, instance):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage custom fields. You're not an Owner of any project."
            )
        from .models import WorkItemFieldValue

        if WorkItemFieldValue.objects.filter(field=instance.field, value=str(instance.pk)).exists():
            raise ValidationError(
                {"detail": f'"{instance.label}" is still chosen on a work item. Clear it there first.'}
            )
        field = instance.field
        instance.delete()
        siblings = list(FieldOption.objects.filter(field=field).order_by("position", "id"))
        for index, option in enumerate(siblings):
            if option.position != index:
                option.position = index
                option.save(update_fields=["position"])


class ScreenViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "delete"]
    serializer_class = ScreenSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
    queryset = Screen.objects.prefetch_related("screen_fields__field__options").all()

    def perform_create(self, serializer):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage custom fields. You're not an Owner of any project."
            )
        serializer.save()

    def perform_update(self, serializer):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage custom fields. You're not an Owner of any project."
            )
        serializer.save()

    def perform_destroy(self, instance):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage custom fields. You're not an Owner of any project."
            )
        assigned = list(
            ProjectScreenAssignment.objects.filter(screen=instance)
            .select_related("project")
            .values_list("project__key", "item_type")
        )
        if assigned:
            labels = [f"{key} · {item_type}" for key, item_type in assigned]
            raise ValidationError(
                {"detail": f'"{instance.name}" is still assigned to {", ".join(labels)}. Unassign it first.'}
            )
        instance.delete()


class ScreenFieldViewSet(viewsets.ModelViewSet):
    http_method_names = ["post", "patch", "delete"]
    serializer_class = ScreenFieldSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_screen(self):
        return get_object_or_404(Screen, pk=self.kwargs["screen_pk"])

    def get_queryset(self):
        return ScreenField.objects.filter(screen_id=self.kwargs["screen_pk"])

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if "field" in request.data and str(request.data["field"]) != str(instance.field_id):
            raise ValidationError(
                {"field": "The field on a screen can't be changed after it's added — remove it and add the new one instead."}
            )
        return super().update(request, *args, **kwargs)

    def perform_create(self, serializer):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage custom fields. You're not an Owner of any project."
            )
        screen = self.get_screen()
        field = serializer.validated_data["field"]
        if ScreenField.objects.filter(screen=screen, field=field).exists():
            raise ValidationError({"field": f'"{field.name}" is already on this screen.'})
        position = ScreenField.objects.filter(screen=screen).count()
        serializer.save(screen=screen, position=position)

    def perform_update(self, serializer):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage custom fields. You're not an Owner of any project."
            )
        serializer.save()
        if "position" in self.request.data:
            self._reposition(serializer.instance)

    def _reposition(self, instance):
        try:
            target = max(0, int(self.request.data["position"]))
        except (TypeError, ValueError):
            raise ValidationError({"position": "Must be a whole number."})
        siblings = list(
            ScreenField.objects.filter(screen=instance.screen).exclude(pk=instance.pk).order_by("position", "id")
        )
        target = min(target, len(siblings))
        siblings.insert(target, instance)
        for index, row in enumerate(siblings):
            if row.position != index:
                row.position = index
                row.save(update_fields=["position"])

    def perform_destroy(self, instance):
        if not user_can_manage_definitions(self.request.user):
            raise PermissionDenied(
                "Only a project Owner can manage custom fields. You're not an Owner of any project."
            )
        screen = instance.screen
        instance.delete()
        siblings = list(ScreenField.objects.filter(screen=screen).order_by("position", "id"))
        for index, row in enumerate(siblings):
            if row.position != index:
                row.position = index
                row.save(update_fields=["position"])
