from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Invitation, Project, ProjectMembership
from .permissions import (
    IsProjectMember,
    can_change_role,
    can_delete_project,
    can_invite,
    can_leave,
    can_manage_archive,
    can_remove,
    can_transfer_ownership,
)
from .serializers import (
    ChangeRoleSerializer,
    InvitationSerializer,
    InviteSerializer,
    ProjectMembershipSerializer,
    ProjectSerializer,
    TransferOwnershipSerializer,
)

ROLE_ORDER = {"owner": 0, "admin": 1, "member": 2}


class ProjectViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    pagination_class = None

    def get_queryset(self):
        qs = Project.objects.all()
        if self.action == "list":
            qs = qs.filter(memberships__user=self.request.user).distinct()
            if self.request.query_params.get("include_archived") != "true":
                qs = qs.filter(is_archived=False)
        return qs

    def perform_create(self, serializer):
        from boards.models import Component
        from boards.services import PROJECT_TEMPLATES, seed_default_statuses

        template_key = self.request.data.get("template") or "blank"
        template = PROJECT_TEMPLATES.get(template_key)
        if template is None:
            raise ValidationError({"template": f'"{template_key}" is not a valid template.'})

        # Per the Workflows design spec, a project's default statuses are
        # "created alongside the Project row itself, same transaction" —
        # wrap the membership + status-seeding + starter-component writes
        # in one atomic block so that guarantee actually holds (a failure
        # partway through never leaves a Project with an owner but no
        # statuses, or vice versa).
        with transaction.atomic():
            project = serializer.save()
            ProjectMembership.objects.create(
                project=project, user=self.request.user, role=ProjectMembership.Role.OWNER
            )
            seed_default_statuses(project, preset_key=template["status_preset"])
            for name in template["components"]:
                Component.objects.create(project=project, name=name)

    def perform_destroy(self, instance):
        membership = instance.memberships.get(user=self.request.user)
        if not can_delete_project(membership.role):
            raise PermissionDenied("Only the owner can delete a project.")
        instance.delete()

    @action(detail=True, methods=["get"], url_path="members")
    def members(self, request, pk=None):
        project = self.get_object()
        memberships = sorted(
            project.memberships.select_related("user"),
            key=lambda m: (ROLE_ORDER[m.role], m.id),
        )
        return Response(ProjectMembershipSerializer(memberships, many=True).data)

    @action(detail=True, methods=["delete"], url_path=r"members/(?P<user_id>\d+)")
    def remove_member(self, request, pk=None, user_id=None):
        """Doubles as "leave": removing your own membership is only ever
        blocked for the Owner (who must transfer ownership first). Removing
        someone else goes through the normal can_remove role matrix."""
        project = self.get_object()
        acting = project.memberships.get(user=request.user)
        target = get_object_or_404(ProjectMembership, project=project, user_id=user_id)

        if target.user_id == request.user.id:
            if not can_leave(acting.role):
                raise ValidationError(
                    {"detail": "Transfer ownership before leaving a project you own."}
                )
            target.delete()
            return Response(status=204)

        if not can_remove(acting.role, target.role):
            raise PermissionDenied("You don't have permission to remove this member.")

        target.delete()
        return Response(status=204)

    @action(detail=True, methods=["post"], url_path=r"members/(?P<user_id>\d+)/role")
    def change_role(self, request, pk=None, user_id=None):
        project = self.get_object()
        acting = project.memberships.get(user=request.user)
        if not can_change_role(acting.role):
            raise PermissionDenied("Only the owner can change member roles.")

        serializer = ChangeRoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        target = get_object_or_404(ProjectMembership, project=project, user_id=user_id)
        if target.role == ProjectMembership.Role.OWNER:
            raise PermissionDenied(
                "The owner's role can't be changed here — transfer ownership instead."
            )
        target.role = serializer.validated_data["role"]
        target.save()
        return Response(ProjectMembershipSerializer(target).data)

    @action(detail=True, methods=["post"], url_path="transfer-ownership")
    def transfer_ownership(self, request, pk=None):
        project = self.get_object()
        acting = project.memberships.get(user=request.user)
        if not can_transfer_ownership(acting.role):
            raise PermissionDenied("Only the owner can transfer ownership.")

        serializer = TransferOwnershipSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_owner = serializer.validated_data["user"]

        target = project.memberships.filter(user=new_owner, role=ProjectMembership.Role.ADMIN).first()
        if target is None:
            raise ValidationError(
                {"user_id": "Ownership can only be transferred to an existing Admin."}
            )

        with transaction.atomic():
            acting.role = ProjectMembership.Role.ADMIN
            acting.save()
            target.role = ProjectMembership.Role.OWNER
            target.save()
        return Response(status=204)

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        project = self.get_object()
        acting = project.memberships.get(user=request.user)
        if not can_manage_archive(acting.role):
            raise PermissionDenied("Only the owner can archive a project.")
        if project.is_archived:
            raise ValidationError({"detail": "This project is already archived."})

        project.is_archived = True
        project.archived_at = timezone.now()
        project.archived_by = request.user
        project.save()
        return Response(ProjectSerializer(project, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="unarchive")
    def unarchive(self, request, pk=None):
        project = self.get_object()
        acting = project.memberships.get(user=request.user)
        if not can_manage_archive(acting.role):
            raise PermissionDenied("Only the owner can unarchive a project.")
        if not project.is_archived:
            raise ValidationError({"detail": "This project is not archived."})

        project.is_archived = False
        project.archived_at = None
        project.archived_by = None
        project.save()
        return Response(ProjectSerializer(project, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="invite")
    def invite(self, request, pk=None):
        project = self.get_object()
        acting = project.memberships.get(user=request.user)
        if not can_invite(acting.role):
            raise PermissionDenied("You don't have permission to invite members.")

        serializer = InviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invited_user = serializer.validated_data["user"]

        if project.memberships.filter(user=invited_user).exists():
            raise ValidationError({"user_id": "Already a member of this project."})
        if Invitation.objects.filter(
            project=project, invited_user=invited_user, status=Invitation.Status.PENDING
        ).exists():
            raise ValidationError({"user_id": "Already invited — waiting on a response."})

        invitation = Invitation.objects.create(
            project=project, invited_user=invited_user, invited_by=request.user
        )
        return Response(
            InvitationSerializer(invitation, context={"request": request}).data, status=201
        )


class InvitationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = InvitationSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return Invitation.objects.filter(
            invited_user=self.request.user, status=Invitation.Status.PENDING
        ).select_related("project", "invited_by")

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        invitation = get_object_or_404(Invitation, pk=pk)
        if invitation.invited_user_id != request.user.id:
            raise PermissionDenied("You can only respond to your own invitations.")
        if invitation.status != Invitation.Status.PENDING:
            raise ValidationError({"detail": "This invitation has already been answered."})

        invitation.status = Invitation.Status.ACCEPTED
        invitation.responded_at = timezone.now()
        invitation.save()
        ProjectMembership.objects.get_or_create(
            project=invitation.project,
            user=request.user,
            defaults={"role": ProjectMembership.Role.MEMBER},
        )
        return Response(status=204)

    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        invitation = get_object_or_404(Invitation, pk=pk)
        if invitation.invited_user_id != request.user.id:
            raise PermissionDenied("You can only respond to your own invitations.")
        if invitation.status != Invitation.Status.PENDING:
            raise ValidationError({"detail": "This invitation has already been answered."})

        invitation.status = Invitation.Status.DECLINED
        invitation.responded_at = timezone.now()
        invitation.save()
        return Response(status=204)


class ProjectTemplateListView(APIView):
    """Read-only — the fixed, in-code PROJECT_TEMPLATES registry (sub-
    project 10), never a resource collection: every method but GET 405s
    automatically since none of them are defined here."""

    def get(self, request):
        from boards.services import PROJECT_TEMPLATES, STATUS_PRESETS

        data = [
            {
                "key": key,
                "name": template["name"],
                "description": template["description"],
                "statuses": [
                    {"name": name, "category": category}
                    for name, category in STATUS_PRESETS[template["status_preset"]]
                ],
                "components": template["components"],
            }
            for key, template in PROJECT_TEMPLATES.items()
        ]
        return Response(data)
