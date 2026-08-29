from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import InvitationViewSet, ProjectTemplateListView, ProjectViewSet

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("invitations", InvitationViewSet, basename="invitation")

urlpatterns = router.urls + [
    path("project-templates/", ProjectTemplateListView.as_view(), name="project-templates"),
]
