from django.db import transaction
from rest_framework import serializers

from accounts.serializers import UserSerializer

from .models import (
    Attachment,
    AutomationRule,
    Board,
    Comment,
    Component,
    CustomField,
    FieldOption,
    Label,
    Release,
    Screen,
    ScreenField,
    Sprint,
    WorkItem,
    WorkItemLink,
    WorkItemStatus,
)
from .services import (
    LABEL_PALETTE,
    apply_custom_fields,
    custom_fields_read_map,
    custom_fields_write_error,
    resolve_default_status,
    resolve_labels,
)

VALID_PARENT_TYPES = {
    WorkItem.ItemType.EPIC: [],
    WorkItem.ItemType.STORY: [WorkItem.ItemType.EPIC],
    WorkItem.ItemType.TASK: [WorkItem.ItemType.EPIC],
    WorkItem.ItemType.BUG: [WorkItem.ItemType.EPIC],
    WorkItem.ItemType.SUBTASK: [WorkItem.ItemType.STORY, WorkItem.ItemType.TASK, WorkItem.ItemType.BUG],
}


def hierarchy_error(item_type, parent):
    """None if valid, else an error message string. `parent` is a WorkItem
    instance or None. Mirrors design/js/store.js's hierarchyError exactly,
    so the prototype and the real API agree on every shape."""
    parent_type = parent.item_type if parent else None
    if parent_type is None:
        if item_type == WorkItem.ItemType.SUBTASK:
            return "A Subtask must have a parent Story, Task, or Bug."
        return None
    if parent_type not in VALID_PARENT_TYPES.get(item_type, []):
        label = dict(WorkItem.ItemType.choices)[item_type]
        article = "An" if label[0] in "AEIOU" else "A"
        return f"{article} {label} can't have that parent."
    return None


def can_manage_components(role):
    return role in ("owner", "admin")


def can_manage_releases(role):
    return role in ("owner", "admin")


def can_manage_statuses(role):
    return role in ("owner", "admin")


def can_manage_sprints(role):
    return role in ("owner", "admin")


def can_manage_screen_assignments(role):
    return role in ("owner", "admin")


def can_manage_automation(role):
    return role in ("owner", "admin")


def user_can_manage_definitions(user):
    from projects.models import ProjectMembership

    if user.is_staff:
        return True
    return ProjectMembership.objects.filter(user=user, role="owner").exists()


class BoardSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)

    class Meta:
        model = Board
        fields = ["id", "project", "name", "description", "created_by", "created_at", "updated_at"]

    def validate_project(self, value):
        request = self.context["request"]
        if not value.memberships.filter(user=request.user).exists():
            raise serializers.ValidationError("You must be a member of this project to create a board in it.")
        return value


class ComponentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Component
        fields = ["id", "project", "name"]
        read_only_fields = ["project"]

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("This field may not be blank.")
        return value.strip()


class ReleaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Release
        fields = ["id", "project", "name", "status", "release_date"]
        read_only_fields = ["project"]

    def validate_name(self, value):
        clean = value.strip()
        if not clean:
            raise serializers.ValidationError("This field may not be blank.")
        return clean


class AutomationRuleSerializer(serializers.ModelSerializer):
    created_by_detail = UserSerializer(source="created_by", read_only=True)

    class Meta:
        model = AutomationRule
        fields = [
            "id", "project", "name", "trigger_type", "trigger_filter",
            "action_type", "action_config", "position", "is_active",
            "created_by_detail", "created_at",
        ]
        read_only_fields = ["project", "position", "created_by_detail", "created_at"]


class LabelSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)

    class Meta:
        model = Label
        fields = ["id", "name", "color", "created_by", "created_at"]
        read_only_fields = ["created_by", "created_at"]

    def validate_color(self, value):
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


class WorkItemStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkItemStatus
        fields = ["id", "project", "name", "category", "position"]
        read_only_fields = ["project", "position"]

    def validate_name(self, value):
        clean = value.strip()
        if not clean:
            raise serializers.ValidationError("This field may not be blank.")
        return clean


class SprintSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)

    class Meta:
        model = Sprint
        fields = ["id", "board", "name", "goal", "state", "start_date", "end_date", "created_by", "created_at"]
        read_only_fields = ["board", "state", "start_date", "end_date", "created_by", "created_at"]

    def validate_name(self, value):
        clean = value.strip()
        if not clean:
            raise serializers.ValidationError("This field may not be blank.")
        return clean


class SprintSummarySerializer(serializers.ModelSerializer):
    """Embedded on a work item as `sprint_detail` — mirrors how
    `WorkItemStatusSummarySerializer` trims down `WorkItemStatusSerializer`
    for the same reason."""

    class Meta:
        model = Sprint
        fields = ["id", "name", "state", "start_date", "end_date"]


class FieldOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = FieldOption
        fields = ["id", "field", "label", "position"]
        read_only_fields = ["field", "position"]

    def validate_label(self, value):
        clean = value.strip()
        if not clean:
            raise serializers.ValidationError("This field may not be blank.")
        return clean


class CustomFieldSerializer(serializers.ModelSerializer):
    options = FieldOptionSerializer(many=True, read_only=True)
    created_by = UserSerializer(read_only=True)

    class Meta:
        model = CustomField
        fields = ["id", "name", "field_type", "options", "created_by", "created_at"]
        read_only_fields = ["created_by", "created_at"]

    def validate_name(self, value):
        clean = value.strip()
        if not clean:
            raise serializers.ValidationError("This field may not be blank.")
        qs = CustomField.objects.filter(name__iexact=clean)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f'"{clean}" already exists.')
        return clean


class ScreenFieldSerializer(serializers.ModelSerializer):
    field_detail = CustomFieldSerializer(source="field", read_only=True)

    class Meta:
        model = ScreenField
        fields = ["id", "field", "field_detail", "position", "required"]
        read_only_fields = ["position"]


class ScreenSerializer(serializers.ModelSerializer):
    fields = ScreenFieldSerializer(source="screen_fields", many=True, read_only=True)

    class Meta:
        model = Screen
        fields = ["id", "name", "fields"]

    def validate_name(self, value):
        clean = value.strip()
        if not clean:
            raise serializers.ValidationError("This field may not be blank.")
        qs = Screen.objects.filter(name__iexact=clean)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f'"{clean}" already exists.')
        return clean


class WorkItemStatusSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkItemStatus
        fields = ["id", "name", "category"]


class WorkItemSummarySerializer(serializers.ModelSerializer):
    """Enough to identify and link to another work item, without pulling
    its full field set — used for parent_detail and the children list."""

    status_detail = WorkItemStatusSummarySerializer(source="status", read_only=True)

    class Meta:
        model = WorkItem
        fields = ["id", "key", "title", "item_type", "status", "status_detail"]


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


class WorkItemSerializer(serializers.ModelSerializer):
    assignee_detail = UserSerializer(source="assignee", read_only=True)
    created_by = UserSerializer(read_only=True)
    priority_label = serializers.CharField(source="get_priority_display", read_only=True)
    parent_detail = WorkItemSummarySerializer(source="parent", read_only=True)
    components_detail = ComponentSerializer(source="components", many=True, read_only=True)
    release_detail = ReleaseSerializer(source="release", read_only=True)
    labels = serializers.ListField(child=serializers.CharField(allow_blank=True, max_length=80), required=False, write_only=True)
    labels_detail = LabelSummarySerializer(source="labels", many=True, read_only=True)
    status_detail = WorkItemStatusSummarySerializer(source="status", read_only=True)
    status = serializers.PrimaryKeyRelatedField(queryset=WorkItemStatus.objects.all(), required=False)
    sprint_detail = SprintSummarySerializer(source="sprint", read_only=True)
    custom_fields = serializers.DictField(required=False, write_only=True)

    class Meta:
        model = WorkItem
        fields = [
            "id", "key", "board", "item_type", "title", "description",
            "status", "status_detail", "sprint", "sprint_detail", "priority", "priority_label", "due_date",
            "assignee", "assignee_detail", "parent", "parent_detail",
            "components", "components_detail", "release", "release_detail", "labels", "labels_detail", "custom_fields",
            "position", "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["key", "position"]

    def validate_board(self, value):
        request = self.context["request"]
        if not value.project.memberships.filter(user=request.user).exists():
            raise serializers.ValidationError("You must be a member of this board's project.")
        return value

    def validate(self, attrs):  # noqa: C901 — one validator per writable field; splitting it would scatter the rules
        is_create = self.instance is None
        parent_touched = is_create or "parent" in attrs

        if parent_touched:
            # item_type mirrors the model default (Task) when omitted on
            # create, the same way the DB column would fill it in — the
            # field is required=False with no serializer-level default, so
            # a create request that leaves it out drops it from attrs
            # entirely. Falling back to None here (instead of the model
            # default) would feed hierarchy_error() a type that isn't a
            # valid dict key and crash with an uncaught KeyError -> 500.
            item_type = attrs.get("item_type") or (
                self.instance.item_type if self.instance else WorkItem.ItemType.TASK
            )
            parent = attrs.get("parent")
            board = attrs.get("board") or (self.instance.board if self.instance else None)

            if parent is not None:
                if board is not None and parent.board_id != board.id:
                    raise serializers.ValidationError({"parent": "Parent must be on the same board."})
                if not is_create and parent.id == self.instance.id:
                    raise serializers.ValidationError({"parent": "An item can't be its own parent."})

            error = hierarchy_error(item_type, parent)
            if error:
                raise serializers.ValidationError({"parent": error})

        if "components" in attrs:
            board = attrs.get("board") or (self.instance.board if self.instance else None)
            mismatched = [c for c in attrs["components"] if c.project_id != board.project_id]
            if mismatched:
                raise serializers.ValidationError(
                    {"components": "Components must belong to this item's project."}
                )

        if "labels" in attrs:
            if any(not name.strip() for name in attrs["labels"]):
                raise serializers.ValidationError({"labels": "A label name can't be blank."})

        board = attrs.get("board") or (self.instance.board if self.instance else None)
        if "status" in attrs:
            if attrs["status"].project_id != board.project_id:
                raise serializers.ValidationError({"status": "Status must belong to this item's project."})
        elif is_create:
            # No static model-level default is possible (the right default
            # depends on which project this item's board belongs to), so
            # inject a real one here rather than leaving it to WorkItem.save()'s
            # lazy fallback — perform_create needs the resolved status BEFORE
            # save() runs, to compute next_position() correctly.
            attrs["status"] = resolve_default_status(board.project)

        if attrs.get("sprint") is not None:
            # Same two rules /api/work-items/{id}/schedule/ enforces
            # (boards/views.py's `schedule` action) — applied here too so a
            # work item can't be created directly into another board's
            # sprint, or into one that's already completed, bypassing
            # schedule/ entirely.
            sprint = attrs["sprint"]
            if sprint.board_id != board.id:
                raise serializers.ValidationError({"sprint": "Sprint must belong to this item's board."})
            if sprint.state == Sprint.State.COMPLETED:
                raise serializers.ValidationError({"sprint": "Can't schedule into a completed sprint."})

        if attrs.get("release") is not None:
            release = attrs["release"]
            if release.project_id != board.project_id:
                raise serializers.ValidationError({"release": "Release must belong to this item's project."})

        if is_create or "custom_fields" in attrs:
            # On create, the check must run even when `custom_fields` is
            # omitted entirely (payload defaults to {}) — otherwise a
            # screen's required field could never be enforced against a
            # request that just doesn't mention custom fields at all. On
            # update, only re-validate when the client actually touches
            # `custom_fields`, so an unrelated PATCH (e.g. just `title`)
            # doesn't re-check fields it isn't changing.
            board = attrs.get("board") or (self.instance.board if self.instance else None)
            item_type = attrs.get("item_type") or (
                self.instance.item_type if self.instance else WorkItem.ItemType.TASK
            )
            error = custom_fields_write_error(
                board.project, item_type, attrs.get("custom_fields", {}), existing_item=self.instance
            )
            if error:
                raise serializers.ValidationError({"custom_fields": error})

        return attrs

    def create(self, validated_data):
        custom_fields = validated_data.pop("custom_fields", None)
        label_names = validated_data.pop("labels", None)
        with transaction.atomic():
            instance = super().create(validated_data)
            if custom_fields:
                apply_custom_fields(instance, custom_fields)
            if label_names is not None:
                instance.labels.set(resolve_labels(label_names, self.context["request"].user))
            from .automation import evaluate_work_item_created

            evaluate_work_item_created(instance, self.context["request"].user)
        return instance

    def update(self, instance, validated_data):
        custom_fields = validated_data.pop("custom_fields", None)
        label_names = validated_data.pop("labels", None)
        instance = super().update(instance, validated_data)
        if custom_fields is not None:
            apply_custom_fields(instance, custom_fields)
        if label_names is not None:
            instance.labels.set(resolve_labels(label_names, self.context["request"].user))
        return instance

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["custom_fields"] = custom_fields_read_map(instance)
        return data


class WorkItemLinkSerializer(serializers.ModelSerializer):
    item = serializers.PrimaryKeyRelatedField(queryset=WorkItem.objects.all(), write_only=True)
    item_detail = serializers.SerializerMethodField()

    class Meta:
        model = WorkItemLink
        fields = ["id", "item", "item_detail", "created_at"]

    def get_item_detail(self, obj):
        # "the other side" — resolved relative to whichever item this link
        # is being rendered for, stashed on the instance by the view.
        other = obj.item_b if obj.item_a_id == self.context["for_item_id"] else obj.item_a
        return WorkItemSummarySerializer(other).data


class MoveWorkItemSerializer(serializers.Serializer):
    status = serializers.PrimaryKeyRelatedField(queryset=WorkItemStatus.objects.all())
    position = serializers.IntegerField(min_value=0)


class CommentSerializer(serializers.ModelSerializer):
    author = UserSerializer(read_only=True)

    class Meta:
        model = Comment
        fields = ["id", "card", "author", "body", "created_at"]
        read_only_fields = ["card"]

    def validate_body(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("A comment cannot be empty.")
        return value


class AttachmentSerializer(serializers.ModelSerializer):
    uploaded_by = UserSerializer(read_only=True)

    class Meta:
        model = Attachment
        fields = ["id", "work_item", "filename", "content_type", "size", "uploaded_by", "uploaded_at"]
