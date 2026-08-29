"""Site Admin gate — mirrors projects/permissions.py's IsProjectMember
shape. Unlike IsProjectMember, this is view-level only (has_permission,
not has_object_permission): every route under /api/admin/users/ needs the
same "is the caller a Site Admin" check regardless of which user id is
being looked at, so there's no per-object variation to layer on top."""

from rest_framework.permissions import BasePermission


class IsSiteAdmin(BasePermission):
    message = "Only a Site Admin can manage user accounts."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)


# Revoking someone else's is_staff is blocked once it would leave zero
# Site Admins. `other_staff_count` is how many *other* is_staff users
# exist besides the one being revoked — see the self-lockout note on
# AdminUserViewSet.perform_update for why this can never actually
# evaluate to False from a single acting admin's own request in practice,
# and why it's still real, load-bearing code for concurrent sessions.
def can_revoke_site_admin(other_staff_count):
    return other_staff_count > 0
