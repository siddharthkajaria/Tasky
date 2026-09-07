from django.contrib import admin

from .models import (
    Board,
    Comment,
    CustomField,
    FieldOption,
    ProjectScreenAssignment,
    Screen,
    ScreenField,
    WorkItem,
    WorkItemFieldValue,
    WorkItemStatus,
)


@admin.register(Board)
class BoardAdmin(admin.ModelAdmin):
    list_display = ["name", "created_by", "created_at"]
    search_fields = ["name"]


@admin.register(WorkItem)
class WorkItemAdmin(admin.ModelAdmin):
    list_display = ["title", "board", "status", "priority", "assignee", "due_date"]
    list_filter = ["status", "priority", "board"]
    search_fields = ["title", "description"]
    readonly_fields = ["position"]


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ["card", "author", "created_at"]
    search_fields = ["body"]


class FieldOptionInline(admin.TabularInline):
    model = FieldOption
    extra = 0


@admin.register(CustomField)
class CustomFieldAdmin(admin.ModelAdmin):
    list_display = ["name", "field_type", "created_by", "created_at"]
    list_filter = ["field_type"]
    search_fields = ["name"]
    inlines = [FieldOptionInline]
    readonly_fields = ["field_type"]


class ScreenFieldInline(admin.TabularInline):
    model = ScreenField
    extra = 0


@admin.register(Screen)
class ScreenAdmin(admin.ModelAdmin):
    list_display = ["name"]
    search_fields = ["name"]
    inlines = [ScreenFieldInline]


@admin.register(ProjectScreenAssignment)
class ProjectScreenAssignmentAdmin(admin.ModelAdmin):
    list_display = ["project", "item_type", "screen"]
    list_filter = ["item_type"]


@admin.register(WorkItemFieldValue)
class WorkItemFieldValueAdmin(admin.ModelAdmin):
    list_display = ["work_item", "field", "value"]
    list_filter = ["field"]


@admin.register(WorkItemStatus)
class WorkItemStatusAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "project", "position"]
    list_filter = ["category"]
    search_fields = ["name"]
