"""Pure role-permission rules — mirrors the matrix in
docs/superpowers/specs/2026-08-13-tasky-projects-membership-design.md
and design/js/logic.js exactly, so the three stay in lockstep."""

from rest_framework.permissions import BasePermission

from .models import Project

OWNER = "owner"
ADMIN = "admin"
MEMBER = "member"


def can_invite(role):
    return role in (OWNER, ADMIN)


def can_remove(acting_role, target_role):
    return (acting_role == OWNER and target_role != OWNER) or (
        acting_role == ADMIN and target_role == MEMBER
    )


def can_change_role(acting_role):
    return acting_role == OWNER


def can_transfer_ownership(acting_role):
    return acting_role == OWNER


def can_delete_project(acting_role):
    return acting_role == OWNER


def can_leave(acting_role):
    return acting_role in (ADMIN, MEMBER)


def can_manage_archive(acting_role):
    return acting_role == OWNER


class IsProjectMember(BasePermission):
    """Object-level only — it only ever sees objects the queryset already
    found, so a genuinely missing id 404s before this runs. This is what
    turns "found, but not one of your projects" into 403 instead of a
    leaked 404."""

    message = "You don't have access to this project."

    def has_object_permission(self, request, view, obj):
        project = obj if isinstance(obj, Project) else obj.project
        return project.memberships.filter(user=request.user).exists()
