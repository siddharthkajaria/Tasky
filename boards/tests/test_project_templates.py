import pytest

from boards.models import WorkItemStatus
from boards.services import PROJECT_TEMPLATES, STATUS_PRESETS, seed_default_statuses
from projects.models import Project


def test_every_status_preset_covers_all_three_categories():
    """Guards the invariant WorkItemStatus already enforces elsewhere —
    every project needs at least one status per category — against a
    future edit to STATUS_PRESETS breaking it silently."""
    for key, statuses in STATUS_PRESETS.items():
        categories = {category for _name, category in statuses}
        assert categories == {"todo", "in_progress", "done"}, key


def test_no_template_has_duplicate_component_names():
    """A duplicate name in one template's components list would hit
    Component's unique_together(project, name) constraint on creation and
    500 instead of 400 — this is a static property of the registry, not
    something that needs a live project to check."""
    for key, template in PROJECT_TEMPLATES.items():
        names = template["components"]
        assert len(names) == len(set(names)), key


@pytest.mark.django_db
def test_seed_default_statuses_with_no_preset_key_uses_simple():
    project = Project.objects.create(key="TST", name="Test")
    seeded = seed_default_statuses(project)
    statuses = list(WorkItemStatus.objects.filter(project=project).order_by("position"))
    assert [(s.name, s.category) for s in statuses] == STATUS_PRESETS["simple"]
    assert set(seeded.keys()) == {"todo", "in_progress", "done"}


@pytest.mark.django_db
def test_seed_default_statuses_with_detailed_preset():
    project = Project.objects.create(key="TST2", name="Test 2")
    seed_default_statuses(project, preset_key="detailed")
    statuses = list(WorkItemStatus.objects.filter(project=project).order_by("position"))
    assert [(s.name, s.category) for s in statuses] == STATUS_PRESETS["detailed"]
