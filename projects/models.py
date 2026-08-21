from django.conf import settings
from django.db import models, transaction


class Project(models.Model):
    key = models.CharField(max_length=10, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    next_item_number = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.key})"

    def delete(self, *args, **kwargs):
        """Project -> Board -> WorkItem is CASCADE, and Project ->
        WorkItemStatus is also CASCADE, but WorkItem.status (a FK to
        WorkItemStatus) is on_delete=PROTECT. Django's deletion collector
        evaluates PROTECT the moment it finds any WorkItem still pointing
        at a WorkItemStatus that is about to be deleted — it does not make
        an exception for "that WorkItem is also being deleted in this same
        operation." Left alone, deleting a Project with at least one work
        item raises an uncaught ProtectedError.

        So work items must already be gone before the cascade reaches
        their project's statuses: delete this project's work items (via
        its boards) explicitly first, in the same transaction, then let
        the rest of the cascade (boards, statuses, memberships,
        invitations, comments, links, field values, ...) proceed as
        normal. This lives on the model so every caller — the API, the
        admin, a management command, a test — gets a Project deletion that
        actually works, not just the one call site that happened to be
        exercised first."""
        from boards.models import WorkItem

        with transaction.atomic():
            WorkItem.objects.filter(board__project=self).delete()
            return super().delete(*args, **kwargs)


class ProjectMembership(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        ADMIN = "admin", "Admin"
        MEMBER = "member", "Member"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    # CASCADE, unlike Board.created_by's SET_NULL: a membership row for a
    # deleted user account is meaningless on its own, whereas a board whose
    # creator is unknown is still a perfectly usable board.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_memberships"
    )
    role = models.CharField(max_length=10, choices=Role.choices)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["joined_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["project", "user"], name="unique_project_member"),
        ]

    def __str__(self) -> str:
        return f"{self.user} as {self.role} on {self.project}"


class Invitation(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="invitations")
    invited_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_invitations_received"
    )
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="project_invitations_sent",
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"invite {self.invited_user} to {self.project} ({self.status})"
