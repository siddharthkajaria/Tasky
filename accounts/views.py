from django.contrib.auth import authenticate, get_user_model, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import IsSiteAdmin, can_revoke_site_admin
from .serializers import (
    AdminUserCreateSerializer,
    AdminUserSerializer,
    AdminUserUpdateSerializer,
    LoginSerializer,
    UserSerializer,
)


@method_decorator(ensure_csrf_cookie, name="get")
class CsrfView(APIView):
    """The UI calls this once on load so the browser holds a CSRF cookie."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response(status=status.HTTP_204_NO_CONTENT)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = authenticate(
            request,
            username=serializer.validated_data["username"],
            password=serializer.validated_data["password"],
        )
        if user is None:
            # Deliberately identical for an unknown username and a wrong password:
            # a different message would let anyone enumerate who works here.
            return Response(
                {"detail": "Incorrect username or password."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        login(request, user)
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class UserListView(ListAPIView):
    """Names for the assignee dropdown. Never more than id, username and display name."""

    serializer_class = UserSerializer
    pagination_class = None
    queryset = get_user_model().objects.filter(is_active=True).order_by("username")


class AdminUserViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Deliberately no DELETE — is_active is the only disable primitive
    (see the spec's Error handling table): a hard delete would cascade
    through ProjectMembership and silently strip someone out of every
    project's member list."""

    queryset = get_user_model().objects.all().order_by("username")
    permission_classes = [IsAuthenticated, IsSiteAdmin]

    def get_serializer_class(self):
        if self.action == "create":
            return AdminUserCreateSerializer
        if self.action in ("update", "partial_update"):
            return AdminUserUpdateSerializer
        return AdminUserSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(AdminUserSerializer(user).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        target = serializer.instance
        touches_own_admin_or_active = (
            target.id == self.request.user.id
            and ("is_active" in self.request.data or "is_staff" in self.request.data)
        )
        if touches_own_admin_or_active:
            raise ValidationError({"detail": "You can't change your own admin or active status."})

        # Note: since touches_own_admin_or_active already rejects touching
        # your OWN is_staff, and the acting user must themselves be
        # is_staff to reach this method at all (IsSiteAdmin), the acting
        # user always counts toward other_staff_count for any OTHER row
        # they revoke — so this branch can't reject a single acting
        # admin's own request in practice. It's real protection against
        # two Site Admins' requests racing concurrently in production;
        # see can_revoke_site_admin's own comment for the same note.
        revoking_staff = (
            "is_staff" in self.request.data
            and serializer.validated_data.get("is_staff") is False
            and target.is_staff
        )
        if revoking_staff:
            other_staff_count = get_user_model().objects.filter(is_staff=True).exclude(id=target.id).count()
            if not can_revoke_site_admin(other_staff_count):
                raise ValidationError({"detail": "At least one Site Admin must remain."})

        serializer.save()

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        return Response(AdminUserSerializer(self.get_object()).data, status=response.status_code)
