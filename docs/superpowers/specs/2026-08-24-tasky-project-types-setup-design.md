# Tasky — Project Types & Setup (Sub-project 10 of 13)

**Status:** Fast-drafted 2026-08-24 by solo authorship (per user's explicit request to speed up
the remaining roadmap) — awaiting user review and sign-off. No `design/` prototype built yet; per
this repo's hard rule, prototype work begins only after this spec is reviewed and approved.

## Context

This is sub-project 10 in Tasky's expansion from a single-board Kanban tool toward a broader,
Jira-inspired feature set. The full roadmap (13 sub-projects, redrawn 2026-08-14) is:

1. Projects & Membership — shipped
2. Work Item Hierarchy — shipped (backend + UI)
   - 2b. Custom Fields & Screens — shipped (backend + `design/` prototype)
   - 2c. Bulk Operations & Import — fast-drafted, pending review
3. Workflows — shipped
4. Labels — shipped
5. Search — fast-drafted, pending review
6. Backlog & Sprints — fast-drafted, pending review
7. Releases — fast-drafted, pending review
8. Task Detail UX — fast-drafted, pending review
9. Permissions & Admin — fast-drafted, pending review
10. **Project Types & Setup — this document**
11. Automation — fast-drafted, pending review
12. Notifications — fast-drafted, pending review
13. Reporting & Dashboards — fast-drafted, pending review

Today, `ProjectViewSet.perform_create` does exactly one thing beyond creating the `Project` row
and its Owner membership: it calls `seed_default_statuses`, which gives every new project the
same 3 statuses (To Do/In Progress/Done) unconditionally. No components, no screen assignments,
no distinguishing "kind" of project — a brand-new Software project and a brand-new Marketing
project look identical the moment they're created, even though sub-projects 2a–4 have since given
Tasky real per-project configuration surface (statuses, components, screen assignments) worth
pre-filling. This sub-project is about giving project creation a small set of sensible starting
points instead of one fixed blank slate — a setup/onboarding mechanism, not a new kind of object
that lives on forever.

## Judgment calls flagged for review

No live Q&A happened for this draft, so these are the calls most likely to need a second look:

- **No persistent `project_type` field.** A template is applied once, at creation, and leaves no
  trace on the `Project` row afterward — see "Scope decisions" below for the reasoning. If you
  later want type-specific *behavior* (not just type-specific *defaults*) — e.g. a Marketing
  project hiding the Epic/Subtask item types — this data model doesn't support it and would need
  revisiting from scratch.
- **Screen assignment is left out of templates entirely** — not even a best-effort "look up a
  Screen by name convention" hook. I judged the complexity isn't worth it while a fresh Tasky
  instance has zero Screens to match against. Push back if you'd rather ship the name-convention
  lookup now, dormant, so it's ready the moment Screens exist in practice.
- **Only 3 built-in templates**, and I picked them myself: Blank, Software Project, Bug Tracking.
  I dropped the brief's "Marketing campaign" example — it doesn't fit Tasky's current internal
  engineering-tool usage as far as I can tell from the codebase, but it's a one-entry addition
  later if wanted.
- **The exact status names in the two presets (Simple vs Detailed) and the exact starter
  component lists (e.g. "Frontend"/"Backend"/"Infrastructure" for Software Project) are my
  invention**, not derived from any existing usage data — treat these as placeholders to edit,
  not as researched defaults.
- **`template` defaults silently to `"blank"` when omitted**, reproducing today's behavior exactly
  — chosen so every existing caller (tests, `seed_demo`, any API client written before this sub-
  project existed) keeps working without changes. An alternative — forcing an explicit choice —
  would be more "correct" onboarding UX but breaks backward compatibility for no strong reason.
- **A template cannot restrict which of the 5 `item_type`s a project uses** — `item_type` is a
  fixed global enum on `WorkItem`, not project-scoped (confirmed against `boards/models.py`), so
  a "Bug Tracking" project still has Epics/Stories/Subtasks available even though the template's
  point is bug workflow. This is a real limitation of the existing data model, not something this
  sub-project can fix without much larger scope.

## Scope decisions from brainstorming

These are my own judgment calls, made without live back-and-forth — flagged above where most
consequential.

- **A template is a one-time, creation-time input — not a stored attribute of `Project`.**
  Considered making `project_type` a persistent field (so future features could branch on "this is
  a Software project" forever), but rejected it: Tasky is a small internal tool, not a platform
  with genuinely different project *kinds* that need to keep behaving differently after creation.
  Every prior sub-project (statuses, components, screens) is *also* something a project can freely
  customize after creation — there's no principled reason "was created via the Software template"
  should outlive the moment those defaults were written. A template pre-fills; it doesn't classify.
- **Templates are a small, fixed, built-in set — not user-defined.** No sub-project so far has
  built a "definition" surface a user extends (Labels' palette is fixed and hashed, not chosen;
  Custom Fields/Screens are flat named things, not templates-of-templates). A "template builder"
  is real, non-trivial scope — a management UI, versioning of what happens to projects created
  from a template that's since edited, etc. — that nobody has asked for. v1 ships with the 3
  templates below, hardcoded in Python, editable only by changing code.
- **A template configures exactly two things: the status preset and starter components.** Both
  already exist as real per-project models (`WorkItemStatus`, `Component`) with an established
  seeding pattern (`seed_default_statuses` already does this for statuses, unconditionally, today)
  — a template is just parameterizing that existing mechanism, not inventing new state.
- **Screen assignment is explicitly not part of a template.** `Screen` rows are user-authored and
  globally named; a fresh Tasky instance — and most real ones for a good while — has none. A
  template that "assigns a Screen by name convention" would almost never fire in practice and
  would add real matching logic (case sensitivity, what happens on a near-miss, what happens when
  the named Screen already exists but is assigned to a different item type) for a payoff that's
  rare today. Assigning Screens to a new project stays exactly what it is now: a deliberate,
  manual step via the existing `PUT /api/projects/{id}/screen-assignments/`, the same for every
  project regardless of template.
- **No broader "getting started" checklist.** The brief raised whether this sub-project should
  also cover a wider onboarding flow ("invite your team," "create your first board"). It shouldn't
  — that's a UI/UX concern with no new backend surface of its own (inviting and creating boards
  are both already fully-featured endpoints), and bundling it here would blur this sub-project's
  actual scope, which is the template-selection mechanism at creation time.
- **Two status presets, matching the brief's own examples.** "Simple" is exactly today's 3
  defaults (To Do/In Progress/Done) so the Blank template is byte-for-byte what `POST
  /api/projects/` already does. "Detailed" adds two more (In Review, Blocked) as named in the
  brief. Presets are a separate, reusable concept from templates — both built-in templates below
  that want a "meatier" status list reference the same Detailed preset rather than each declaring
  their own copy.

## Data model

**No new database table.** Templates and status presets are a fixed, in-code registry — the same
pattern `boards/services.py` already uses for `LABEL_PALETTE` and `_DEFAULT_STATUSES` (module-
level constants, not model rows) — because they are, by design, not user-editable.

```python
# boards/services.py (extended)

STATUS_PRESETS = {
    "simple": [("To Do", "todo"), ("In Progress", "in_progress"), ("Done", "done")],
    "detailed": [
        ("To Do", "todo"),
        ("In Progress", "in_progress"),
        ("In Review", "in_progress"),
        ("Blocked", "in_progress"),
        ("Done", "done"),
    ],
}

PROJECT_TEMPLATES = {
    "blank": {
        "name": "Blank",
        "description": "Three statuses, no components — today's default. Good for anything "
                        "that doesn't fit a more specific template.",
        "status_preset": "simple",
        "components": [],
    },
    "software": {
        "name": "Software Project",
        "description": "An engineering-shaped workflow with room for review and blockers, "
                        "plus a starter set of components to tag work by.",
        "status_preset": "detailed",
        "components": ["Frontend", "Backend", "Infrastructure"],
    },
    "bugs": {
        "name": "Bug Tracking",
        "description": "For triaging and tracking defects through to verification.",
        "status_preset": "detailed",
        "components": [],
    },
}
```

`seed_default_statuses(project)` becomes `seed_statuses(project, preset_key="simple")`, keeping
its existing idempotent/top-up behavior (unaffected by this sub-project) but seeding from
`STATUS_PRESETS[preset_key]` instead of the hardcoded `_DEFAULT_STATUSES` list. `_DEFAULT_STATUSES`
is deleted; `STATUS_PRESETS["simple"]` is its exact replacement, so every existing caller that
doesn't pass a `template` gets identical output to today.

**`Project` gains no new field.** `key`, `name`, `description` are unaffected. Nothing on the
`Project` row records which template (if any) was used — see "Judgment calls" above.

**Starter components** are created as ordinary `Component` rows (`project` FK, `name`) via the
same path a project Owner/Admin would use by hand — no new model, no special "template component"
marker. A project created from the Software template ends up with 3 `Component` rows that are, in
every respect, indistinguishable from components an Admin typed in manually five minutes later.

## API surface

```
GET  /api/project-templates/   the fixed list of built-in templates (any authenticated user)
POST /api/projects/            gains an optional `template` field
```

**`GET /api/project-templates/`** — unpaginated, no DB query (reads the in-code registry directly).
Returns:
```json
[
  {
    "key": "blank",
    "name": "Blank",
    "description": "...",
    "statuses": [{"name": "To Do", "category": "todo"}, ...],
    "components": []
  }
]
```
Enough for a UI to render a preview ("this template will create these statuses and these
components") before the user commits, without a second round-trip.

**`POST /api/projects/`** — body gains an optional `template`: one of `"blank"`, `"software"`,
`"bugs"`. Omitted (or explicitly `"blank"`) reproduces exactly today's behavior. When present and
valid, `perform_create` looks up the template, seeds statuses from its `status_preset`, and
creates its starter `Component` rows — all inside the same `transaction.atomic()` block that
already wraps membership creation and status seeding today, so a bad template never leaves a
half-seeded project behind.

No new permission tier: project creation is already open to any authenticated user (the creator
becomes Owner), and choosing among a fixed, read-only list of templates doesn't change that.

There is no `POST`/`PATCH`/`DELETE` for templates themselves — they are code, not data, per the
"fixed set, not user-defined" decision above.

## Error handling

| Case | Response |
|---|---|
| Unauthenticated request to either endpoint | 403, never 401 |
| `POST /api/projects/` with an unrecognized `template` value | 400, naming `template`: `"'foo' is not a valid template."` |
| `POST /api/projects/` with `template` omitted | Defaults to `"blank"` — identical to today's unconditioned 3-status seed |
| `POST`/`PATCH`/`DELETE` on `/api/project-templates/` | 405 — the list is read-only, not a resource collection |
| Template seeding fails partway (e.g. a future bug in `PROJECT_TEMPLATES`) | Whole `POST /api/projects/` fails and rolls back — no partially-seeded project, no orphaned statuses or components, same transaction guarantee `seed_default_statuses` already relies on today |

## Testing

- `POST /api/projects/` with no `template` produces the identical 3 statuses (name, category,
  position) as before this sub-project shipped — a direct regression check that `STATUS_PRESETS["simple"]`
  is byte-for-byte what `_DEFAULT_STATUSES` used to be.
- `POST /api/projects/ {"template": "software"}` creates a project with the 5-status Detailed
  preset and exactly the 3 named starter components, all scoped to the new project.
- `POST /api/projects/ {"template": "bugs"}` creates the Detailed status preset and zero
  components.
- `POST /api/projects/ {"template": "nonexistent"}` returns 400 naming `template`, and creates no
  `Project` row at all (nothing partially committed).
- `GET /api/project-templates/` returns all 3 built-in templates with stable ordering and doesn't
  touch the database.
- Every entry in `STATUS_PRESETS` covers all 3 categories (`todo`/`in_progress`/`done`) at least
  once — a cheap unit test guarding against a future edit to the registry breaking the "every
  project has at least one status per category" invariant `WorkItemStatus` already enforces
  elsewhere.
- No template's `components` list contains a duplicate name (would otherwise hit `Component`'s
  `unique_together(project, name)` constraint on creation and 500 instead of 400).
- A project created from any template behaves identically to a hand-configured project for every
  other endpoint afterward (statuses can be renamed/reordered/deleted, components can be added/
  removed) — the template leaves nothing special behind to break later sub-projects' assumptions.

## Out of scope (deferred to later sub-projects)

- **Persistent `project_type` on `Project`.** Deliberately not built — see "Judgment calls" and
  "Scope decisions" above. Revisit only if a future sub-project needs type-specific *behavior*,
  not just type-specific *defaults*.
- **User-defined / custom templates ("template builder").** No comparable "define your own X"
  surface exists anywhere else in Tasky yet; real scope (a management UI, and a decision on what
  happens to already-created projects when a template definition changes) that nobody has asked
  for.
- **Screen assignment as part of a template**, including a name-convention lookup. Deferred until
  Screens have enough of an install base in practice for the lookup to matter — see "Scope
  decisions."
- **Restricting which `item_type`s a project can use per template.** Not possible today without a
  larger change to `WorkItem.ItemType`, which is a fixed global enum, not project-scoped.
- **Re-applying or switching a project's template after creation.** A template runs once, at
  creation. There is no "reset this project's statuses/components back to the Software template"
  operation — customize by hand afterward, same as any project today.
- **A broader "getting started" checklist/wizard** (invite teammates, create a first board,
  create a first work item). Out of this sub-project's scope by design — see "Scope decisions."
  Inviting and board creation are already fully-featured; nothing new is needed on that front.
- **"Marketing campaign" or other non-engineering templates.** Dropped from the brief's example
  list for lack of a clear fit with Tasky's current internal usage; trivially a one-entry addition
  to `PROJECT_TEMPLATES` later.
- **Template icons/thumbnails or marketing-style presentation.** A plain named list with a
  description is enough for an internal tool's create-project dialog.
