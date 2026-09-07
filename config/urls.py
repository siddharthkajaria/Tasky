from django.contrib import admin
from django.templatetags.static import static
from django.urls import include, path, re_path
from django.views.generic import TemplateView
from django.views.generic.base import RedirectView

from boards.views_me import MyTasksView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("accounts.urls")),
    path("api/", include("boards.urls")),
    path("api/", include("projects.urls")),
    path("api/me/tasks/", MyTasksView.as_view(), name="my-tasks"),
    # Browsers ask for /favicon.ico regardless of the <link rel="icon"> tags —
    # notably on /admin/, which renders no template of ours. Without this the
    # catch-all below answers with the SPA shell, so the browser is handed HTML
    # where it expected an image. Must stay above the catch-all.
    path(
        "favicon.ico",
        RedirectView.as_view(url=static("img/favicon-150.png"), permanent=True),
        name="favicon",
    ),
    # Tasky is internal. Must stay above the catch-all: below it, /robots.txt
    # is answered with the SPA shell — a 200 of HTML, which a crawler parses as
    # no restrictions at all, the opposite of what this says.
    path(
        "robots.txt",
        TemplateView.as_view(template_name="robots.txt", content_type="text/plain"),
        name="robots",
    ),
    # Last on purpose. Registered any earlier this swallows /api/ and /admin/.
    # The negative lookahead is belt and braces — routing already tries the
    # patterns above first — but it keeps the intent explicit and makes the
    # shadowing test below meaningful.
    re_path(
        r"^(?!api/|admin/|static/).*$",
        TemplateView.as_view(template_name="index.html"),
        name="spa",
    ),
]
