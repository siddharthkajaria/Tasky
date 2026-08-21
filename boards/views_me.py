from django.db.models import F
from rest_framework.generics import ListAPIView

from projects.models import ProjectMembership

from .models import WorkItem, WorkItemStatus
from .serializers import WorkItemSerializer


class MyTasksView(ListAPIView):
    """Everything assigned to me, in a project I still belong to, that is
    still open, soonest deadline first."""

    serializer_class = WorkItemSerializer
    pagination_class = None

    def get_queryset(self):
        member_project_ids = ProjectMembership.objects.filter(
            user=self.request.user
        ).values_list("project_id", flat=True)
        return (
            WorkItem.objects.filter(assignee=self.request.user, board__project_id__in=member_project_ids)
            .exclude(status__category=WorkItemStatus.Category.DONE)
            .select_related("board", "assignee", "created_by", "parent", "status")
            .prefetch_related("components", "field_values__field")
            .order_by(F("due_date").asc(nulls_last=True), "-priority", "id")
        )
