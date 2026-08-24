from django.conf import settings
from django.db import models, transaction


class Board(models.Model):
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="boards")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="boards_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name


class WorkItem(models.Model):
    class Priority(models.IntegerChoices):
        LOW = 1, "Low"
        MEDIUM = 2, "Medium"
        HIGH = 3, "High"

    class ItemType(models.TextChoices):
        EPIC = "epic", "Epic"
        STORY = "story", "Story"
        TASK = "task", "Task"
        BUG = "bug", "Bug"
        SUBTASK = "subtask", "Subtask"

    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="work_items")
    title = models.CharField(max_length=200)
    key = models.CharField(max_length=20, unique=True)
    description = models.TextField(blank=True)
    status = models.ForeignKey(
        "WorkItemStatus", on_delete=models.PROTECT, related_name="work_items_with_status",
    )
    priority = models.IntegerField(
        choices=Priority.choices, default=Priority.MEDIUM
    )
    item_type = models.CharField(max_length=10, choices=ItemType.choices, default=ItemType.TASK)
    due_date = models.DateField(null=True, blank=True)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_work_items",
    )
    parent = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="children"
    )
    components = models.ManyToManyField("Component", blank=True, related_name="work_items")
    labels = models.ManyToManyField("Label", blank=True, related_name="work_items")
    position = models.IntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="work_items_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "id"]
        indexes = [models.Index(fields=["board", "status", "position"])]

    def __str__(self) -> str:
        return self.title

    @property
    def project(self):
        return self.board.project

    def save(self, *args, **kwargs):
        # `key` is required+unique, so it must always be populated before the
        # row hits the database. A freshly instantiated WorkItem's `key` is
        # falsy (Django's CharField default, absent an explicit value) no
        # matter how it's created — via the API, a fixture, the admin, a
        # management command, or a data migration — so this is the single
        # place key generation happens; there is no separate copy of this
        # logic in the view. Unlike `services.next_position()`, which is
        # deliberately unlocked and self-healing because a collision there
        # just means a harmless re-sort, a duplicate `key` is a real
        # correctness bug — hence the real `select_for_update()` lock here,
        # not a lock-free retry. The lock, the counter increment, and the
        # INSERT itself all happen inside one atomic block, so a failure in
        # the INSERT rolls back the counter increment too instead of
        # permanently burning a key number.
        #
        # The same lock also guards a missing `status`, but ONLY for this
        # direct-ORM/self-healing path (every existing test fixture,
        # seed_demo, the admin, a project created without going through
        # ProjectViewSet.perform_create) — a project reached this way never
        # explicitly seeds its default statuses ahead of time, so the first
        # WorkItem.save() against it does that seeding itself, right here,
        # under this same `select_for_update()` on the project row. Two
        # concurrent first writes to such a project must not each seed
        # their own set of 3 defaults, so it rides along under the same
        # lock rather than getting a second, separate one.
        #
        # This is NOT what makes the API creation path race-safe. There,
        # `WorkItemSerializer.validate()` resolves the default status
        # BEFORE `save()` runs and outside any transaction (`ATOMIC_REQUESTS`
        # isn't set — see config/settings.py), so it never reaches this
        # lock at all. That path is race-free in practice for a different
        # reason: `ProjectViewSet.perform_create` seeds a project's 3
        # default statuses synchronously, in the same transaction as the
        # Project row itself, before any request can create a work item
        # against it — so by the time any API-created WorkItem asks for a
        # default status, the project's statuses already exist and there is
        # no first-seed race left to have.
        if not self.key or not self.status_id:
            from projects.models import Project

            with transaction.atomic():
                project = Project.objects.select_for_update().get(pk=self.board.project_id)
                if not self.status_id:
                    from .services import resolve_default_status

                    self.status = resolve_default_status(project)
                if not self.key:
                    self.key = f"{project.key}-{project.next_item_number}"
                    project.next_item_number += 1
                    project.save(update_fields=["next_item_number"])
                super().save(*args, **kwargs)
        else:
            super().save(*args, **kwargs)


class Component(models.Model):
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="components")
    name = models.CharField(max_length=80)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["project", "name"], name="unique_component_name_per_project"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.project})"


class Label(models.Model):
    name = models.CharField(max_length=80, unique=True)
    color = models.CharField(max_length=7)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="labels_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class WorkItemStatus(models.Model):
    class Category(models.TextChoices):
        TODO = "todo", "To Do"
        IN_PROGRESS = "in_progress", "In Progress"
        DONE = "done", "Done"

    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="statuses")
    name = models.CharField(max_length=80)
    category = models.CharField(max_length=20, choices=Category.choices)
    position = models.IntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["project", "name"], name="unique_status_name_per_project"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.project})"


class CustomField(models.Model):
    class FieldType(models.TextChoices):
        TEXT_SHORT = "text_short", "Short text"
        TEXT_LONG = "text_long", "Long text"
        NUMBER = "number", "Number"
        DATE = "date", "Date"
        SELECT = "select", "Select"
        MULTISELECT = "multiselect", "Multi-select"
        CHECKBOX = "checkbox", "Checkbox"
        USER_PICKER = "user_picker", "User picker"

    OPTION_TYPES = (FieldType.SELECT, FieldType.MULTISELECT)

    name = models.CharField(max_length=80, unique=True)
    field_type = models.CharField(max_length=20, choices=FieldType.choices)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="custom_fields_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    @property
    def has_options(self) -> bool:
        return self.field_type in self.OPTION_TYPES


class FieldOption(models.Model):
    field = models.ForeignKey(CustomField, on_delete=models.CASCADE, related_name="options")
    label = models.CharField(max_length=120)
    position = models.IntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["field", "label"], name="unique_option_label_per_field"),
        ]

    def __str__(self) -> str:
        return f"{self.label} ({self.field})"


class Screen(models.Model):
    name = models.CharField(max_length=80, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class ScreenField(models.Model):
    screen = models.ForeignKey(Screen, on_delete=models.CASCADE, related_name="screen_fields")
    field = models.ForeignKey(CustomField, on_delete=models.CASCADE, related_name="screen_fields")
    position = models.IntegerField(default=0)
    required = models.BooleanField(default=False)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["screen", "field"], name="unique_field_per_screen"),
        ]

    def __str__(self) -> str:
        return f"{self.field} on {self.screen}"


class ProjectScreenAssignment(models.Model):
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="screen_assignments")
    item_type = models.CharField(max_length=10, choices=WorkItem.ItemType.choices)
    screen = models.ForeignKey(Screen, on_delete=models.CASCADE, related_name="assignments")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project", "item_type"], name="unique_screen_assignment_per_item_type"),
        ]

    def __str__(self) -> str:
        return f"{self.project} {self.item_type} -> {self.screen}"


class WorkItemFieldValue(models.Model):
    work_item = models.ForeignKey(WorkItem, on_delete=models.CASCADE, related_name="field_values")
    field = models.ForeignKey(CustomField, on_delete=models.CASCADE, related_name="values")
    value = models.TextField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["work_item", "field", "value"], name="unique_work_item_field_value"),
        ]

    def __str__(self) -> str:
        return f"{self.field}={self.value!r} on {self.work_item}"


class WorkItemLink(models.Model):
    """Symmetric — there is no "from"/"to" direction. item_a always holds
    the lower id, so (A, B) and (B, A) are the same row; enforced by the
    UniqueConstraint below, not just convention."""

    item_a = models.ForeignKey(WorkItem, on_delete=models.CASCADE, related_name="links_as_a")
    item_b = models.ForeignKey(WorkItem, on_delete=models.CASCADE, related_name="links_as_b")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="work_item_links_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["item_a", "item_b"], name="unique_work_item_link"),
        ]

    def __str__(self) -> str:
        return f"{self.item_a} <-> {self.item_b}"


class Comment(models.Model):
    card = models.ForeignKey(WorkItem, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="comments",
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        return f"{self.author} on {self.card}"

    @property
    def project(self):
        return self.card.board.project
