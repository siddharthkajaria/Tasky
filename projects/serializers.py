import re

from django.contrib.auth import get_user_model
from rest_framework import serializers

from accounts.serializers import UserSerializer

from .models import Invitation, Project, ProjectMembership

KEY_PATTERN = re.compile(r"^[A-Z]{2,10}$")


class ProjectSerializer(serializers.ModelSerializer):
    my_role = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    archived_by_detail = UserSerializer(source="archived_by", read_only=True)

    class Meta:
        model = Project
        fields = [
            "id", "key", "name", "description", "my_role", "member_count", "created_at",
            "is_archived", "archived_at", "archived_by_detail",
        ]
        read_only_fields = ["created_at", "is_archived", "archived_at"]

    def get_my_role(self, obj):
        membership = obj.memberships.filter(user=self.context["request"].user).first()
        return membership.role if membership else None

    def get_member_count(self, obj):
        return obj.memberships.count()

    def validate_key(self, value):
        value = value.strip().upper()
        if not KEY_PATTERN.match(value):
            raise serializers.ValidationError("Key must be 2–10 letters, e.g. TASKY.")
        if Project.objects.filter(key=value).exists():
            raise serializers.ValidationError(f'"{value}" is already taken.')
        return value


class ProjectMembershipSerializer(serializers.ModelSerializer):
    user_detail = UserSerializer(source="user", read_only=True)

    class Meta:
        model = ProjectMembership
        fields = ["id", "user_detail", "role", "joined_at"]


class ChangeRoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=[ProjectMembership.Role.ADMIN, ProjectMembership.Role.MEMBER])


class TransferOwnershipSerializer(serializers.Serializer):
    user_id = serializers.PrimaryKeyRelatedField(queryset=get_user_model().objects.all(), source="user")


class InviteSerializer(serializers.Serializer):
    user_id = serializers.PrimaryKeyRelatedField(
        queryset=get_user_model().objects.filter(is_active=True), source="user"
    )


class InvitationSerializer(serializers.ModelSerializer):
    project_detail = ProjectSerializer(source="project", read_only=True)
    invited_by_detail = UserSerializer(source="invited_by", read_only=True)

    class Meta:
        model = Invitation
        fields = ["id", "project_detail", "invited_by_detail", "status", "created_at"]
