"""Pure role-permission rules — mirrors the matrix in
docs/superpowers/specs/2026-08-13-tasky-projects-membership-design.md
and design/js/logic.js exactly, so the three stay in lockstep."""

from rest_framework.permissions import SAFE_METHODS, BasePermission

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


class ProjectNotArchived(BasePermission):
    """Blocks unsafe writes into an archived project's boards, work items,
    and everything else that hangs off one — reads are untouched. Add this
    to a viewset's `permission_classes` alongside IsProjectMember; never add
    it to ProjectViewSet itself, or `unarchive`/`invite`/`transfer-ownership`
    etc. would become unreachable the moment a project is archived, and an
    archived project could never be reversed. See boards/views.py for where
    each nested viewset's `initial()` override already resolves the right
    object (a Project, a Board, or the row itself) for this to check."""

    message = "This project is archived and read-only. Unarchive it first."

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        project = obj if isinstance(obj, Project) else obj.project
        return not project.is_archived
