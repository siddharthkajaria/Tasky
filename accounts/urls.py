from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AdminUserViewSet, CsrfView, LoginView, LogoutView, MeView, UserListView

router = DefaultRouter()
router.register("admin/users", AdminUserViewSet, basename="admin-user")

urlpatterns = [
    path("auth/csrf/", CsrfView.as_view(), name="csrf"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("users/", UserListView.as_view(), name="user-list"),
] + router.urls
