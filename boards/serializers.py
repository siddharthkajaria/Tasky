from rest_framework import serializers

from accounts.serializers import UserSerializer

from .models import Board, Comment, Component, CustomField, FieldOption, Screen, ScreenField, WorkItem, WorkItemLink, WorkItemStatus
from .services import apply_custom_fields, custom_fields_read_map, custom_fields_write_error

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


def can_manage_statuses(role):
    return role in ("owner", "admin")


def can_manage_screen_assignments(role):
    return role in ("owner", "admin")


def user_can_manage_definitions(user):
    from projects.models import ProjectMembership

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


class WorkItemSummarySerializer(serializers.ModelSerializer):
    """Enough to identify and link to another work item, without pulling
    its full field set — used for parent_detail and the children list."""

    class Meta:
        model = WorkItem
        fields = ["id", "key", "title", "item_type", "status"]


class WorkItemSerializer(serializers.ModelSerializer):
    assignee_detail = UserSerializer(source="assignee", read_only=True)
    created_by = UserSerializer(read_only=True)
    priority_label = serializers.CharField(source="get_priority_display", read_only=True)
    parent_detail = WorkItemSummarySerializer(source="parent", read_only=True)
    components_detail = ComponentSerializer(source="components", many=True, read_only=True)
    custom_fields = serializers.DictField(required=False, write_only=True)

    class Meta:
        model = WorkItem
        fields = [
            "id", "key", "board", "item_type", "title", "description",
            "status", "priority", "priority_label", "due_date",
            "assignee", "assignee_detail", "parent", "parent_detail",
            "components", "components_detail", "custom_fields",
            "position", "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["key", "position"]

    def validate_board(self, value):
        request = self.context["request"]
        if not value.project.memberships.filter(user=request.user).exists():
            raise serializers.ValidationError("You must be a member of this board's project.")
        return value

    def validate(self, attrs):
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
        instance = super().create(validated_data)
        if custom_fields:
            apply_custom_fields(instance, custom_fields)
        return instance

    def update(self, instance, validated_data):
        custom_fields = validated_data.pop("custom_fields", None)
        instance = super().update(instance, validated_data)
        if custom_fields is not None:
            apply_custom_fields(instance, custom_fields)
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
    status = serializers.ChoiceField(choices=WorkItem.Status.choices)
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
