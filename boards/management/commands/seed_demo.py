"""Seed demo boards, people and cards for developing the UI against.

⚠️  WARNING — LOCAL/DEV USE ONLY. NEVER RUN AGAINST A PRODUCTION DATABASE. ⚠️
This command creates demo accounts (`asha`, `kabir`, `lena`) that all share a
single, well-known, committed-to-the-repo password (`DEMO_PASSWORD` below).
Running this against any shared, staging or production database would create
real, working accounts with a publicly known password. It is safe only
because every environment it is meant for is a throwaway local/dev database.
"""

import datetime

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from boards.models import Board, WorkItem
from boards.services import seed_default_statuses
from projects.models import Project, ProjectMembership

DEMO_PASSWORD = "password"

# Hosts a throwaway development database can plausibly live on. Anything else —
# an RDS endpoint above all — is refused outright. Until .env.stage/.env.prod
# existed, "never run this against production" was only a warning in the
# docstring; now that a single ENV_FILE typo would reach RDS, it is enforced.
LOCAL_DB_HOSTS = {
    "",
    "localhost",
    "127.0.0.1",
    "::1",
    "host.docker.internal",
    "db",
    "mysql",
}

PEOPLE = [
    ("asha", "Asha", "Rao"),
    ("kabir", "Kabir", "Menon"),
    ("lena", "Lena", "Fischer"),
]

BOARDS = {
    "Website Redesign": [
        ("Audit the current pages", "todo", 2, None),
        ("Wireframe the new homepage", "todo", 3, 7),
        ("Pick a typeface", "todo", 1, None),
        ("Write the copy deck", "in_progress", 2, 3),
        ("Build the component library", "in_progress", 3, 14),
        ("Ship the staging build", "done", 2, None),
    ],
    "Internal Tools": [
        ("Replace the spreadsheet", "todo", 3, 10),
        ("Document the deploy steps", "todo", 1, None),
        ("Move CI to the new runner", "in_progress", 2, 5),
        ("Retire the old dashboard", "done", 1, None),
    ],
}


class Command(BaseCommand):
    help = (
        "Create demo boards, people and cards for developing the UI against. "
        "Creates demo accounts with a well-known, committed password "
        f"({DEMO_PASSWORD!r}) — LOCAL/DEV USE ONLY, NEVER run this against a "
        "production database."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help=(
                "Seed even though the database host does not look local. "
                "Never use this against staging or production."
            ),
        )

    def handle(self, *args, **options):
        db = connection.settings_dict
        host = (db.get("HOST") or "").strip().lower()
        if host not in LOCAL_DB_HOSTS and not options["force"]:
            raise CommandError(
                f"Refusing to seed: database host {host!r} does not look like a "
                "local development database. seed_demo creates accounts with a "
                "password committed to this repository. If this really is a "
                "throwaway database, re-run with --force."
            )
        self.stdout.write(
            self.style.WARNING(
                "seed_demo: about to write demo data (including accounts with "
                f"a well-known password) to database {db.get('NAME')!r} on "
                f"host {db.get('HOST') or 'localhost'!r}. "
                "This command must NEVER be run against a production database."
            )
        )

        User = get_user_model()
        today = datetime.date.today()

        people = []
        for username, first_name, last_name in PEOPLE:
            person, created = User.objects.get_or_create(
                username=username,
                defaults={"first_name": first_name, "last_name": last_name},
            )
            if created:
                person.set_password(DEMO_PASSWORD)
                person.save()
            people.append(person)

        project, _ = Project.objects.get_or_create(
            key="TASKY",
            defaults={"name": "Tasky Demo", "description": "Seeded demo project."},
        )
        statuses = seed_default_statuses(project)
        for index, person in enumerate(people):
            ProjectMembership.objects.get_or_create(
                project=project,
                user=person,
                defaults={"role": "owner" if index == 0 else "member"},
            )

        for index, (board_name, cards) in enumerate(BOARDS.items()):
            board, created = Board.objects.get_or_create(
                name=board_name,
                defaults={
                    "description": f"Demo board: {board_name}",
                    "created_by": people[0],
                    "project": project,
                },
            )
            if not created:
                continue

            counters = {"todo": 0, "in_progress": 0, "done": 0}
            for card_index, (title, status, priority, due_in_days) in enumerate(cards):
                WorkItem.objects.create(
                    board=board,
                    title=title,
                    description=f"Seeded card for {board_name}.",
                    status=statuses[status],
                    priority=priority,
                    due_date=None if due_in_days is None
                    else today + datetime.timedelta(days=due_in_days),
                    assignee=people[card_index % len(people)],
                    position=counters[status],
                    created_by=people[index % len(people)],
                )
                counters[status] += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {Board.objects.count()} boards, "
                f"{WorkItem.objects.count()} work items. "
                f"Demo logins use the password: {DEMO_PASSWORD}"
            )
        )
