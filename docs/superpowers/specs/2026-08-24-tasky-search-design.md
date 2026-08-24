# Tasky — Search (Sub-project 5 of 13)

**Status:** Fast-drafted 2026-08-24 by solo authorship (per user's explicit request to speed up the remaining roadmap) — awaiting user review and sign-off. No `design/` prototype built yet; per this repo's hard rule, prototype work begins only after this spec is reviewed and approved.

## Context

This is sub-project 5 in Tasky's expansion from a single-board Kanban tool toward a broader, Jira-inspired feature set. The full roadmap (13 sub-projects, redrawn 2026-08-14) is:

1. Projects & Membership — shipped
2. Work Item Hierarchy — shipped (backend + UI)
   - 2b. Custom Fields & Screens — shipped (backend + `design/` prototype)
   - 2c. Bulk Operations & Import — fast-drafted, pending review (drafted in this same batch)
3. Workflows — shipped (backend + `design/` prototype)
4. Labels — shipped (backend + `design/` prototype)
5. **Search — this document**
6. Backlog & Sprints — not yet designed
7. Releases — not yet designed
8. Task Detail UX — not yet designed
9. Permissions & Admin — not yet designed
10. Project Types & Setup — not yet designed
11. Automation — not yet designed
12. Notifications — not yet designed
13. Reporting & Dashboards — not yet designed

Today, finding a work item requires already knowing which project and board it lives on and browsing `/api/boards/{id}/work-items/`, or scanning `/api/me/tasks/` if it's assigned to you. There is no way to find something you didn't create, aren't assigned, or can't remember the board for. Labels (sub-project 4) explicitly named this as the reason it chose global scope over project scope — "sets up a shared vocabulary for cross-project search/reporting later (sub-projects 5 and 13)." This is that sub-project cashing in that decision.

## Judgment calls flagged for review

- **Cross-project scope, limited to the caller's own memberships.** The single biggest call in this doc — see Scope decisions below. If this is wrong, most of the rest of the design changes with it.
- **A dedicated `GET /api/search/` endpoint, not query params on `/api/work-items/`.** `/api/work-items/` is deliberately unpaginated today because it powers full board rendering; bolting a capped, ranked, cross-project search onto that same endpoint would either break that contract or require a parallel "mode" flag. A separate endpoint felt cleaner, but it does mean two ways to filter work items exist side by side.
- **Comment bodies and custom field values are excluded from search entirely**, this pass. This is the call most likely to disappoint someone on day one ("I know I typed that in a comment") — flagged explicitly, see Out of scope.
- **No relevance scoring, no full-text search engine.** Just `icontains` plus a simple 2-tier ordering (key/title match, then description-only match) and a recency tiebreaker. Explicitly a "good enough for ~dozens of projects and low four figures of work items" call — revisit if the corpus grows meaningfully or `LIKE '%...%'` starts showing up in slow query logs.
- **Hard result cap (50), no pagination.** A search that silently truncates at 50 with no "there are more" signal is a real usability gap if a common query matches hundreds of items. Chosen because the target scale doesn't need it yet, but this is the kind of thing a user request could invalidate immediately.
- **`q` requires 2+ characters, and at least one of `q` or a facet filter must be present.** Arbitrary guardrails to keep a bare `GET /api/search/` from being read as "list everything across every project I'm in" — worth a sanity check that they don't get in the way of a real workflow.

## Scope decisions from brainstorming

These are solo judgment calls made without live back-and-forth — flagged above, and reasoned through here.

- **Cross-project, scoped to the caller's memberships — not single-project.** Tasky is invite-only per project, so a user's membership set is already the exact boundary "things I'm allowed to see" needs. Searching only within one project at a time would just recreate the "which board was that on" problem one level up (now "which project was that in"). Cross-project search that never leaves the caller's own membership set is the value proposition Labels' global scope was built to enable, and it costs nothing extra in query terms — the same `ProjectMembership` filter every other list endpoint (`/api/boards/`, `/api/work-items/`) already applies.
- **Simplest implementation that actually works: multi-field `icontains`, no search engine.** This is an internal team tool, not web-scale. MySQL `FULLTEXT` indexing was considered and rejected for this pass — it needs `InnoDB` FULLTEXT setup, stopword tuning, and a different query syntax (`MATCH ... AGAINST`), all for a corpus this small. A plain `Q(title__icontains=q) | Q(description__icontains=q) | Q(key__icontains=q)` against a membership-filtered queryset, capped with `[:50]`, is the whole implementation. Revisit only if this measurably slows down or a team's corpus grows by an order of magnitude.
- **Searchable: title, description, key. Not comments, not custom field values.** Title/description/key are the fields every work item has, always structured the same way, and cheap to query directly on `WorkItem`. Comment bodies live on a separate, unbounded-growth table (`Comment`) and searching them changes both the query shape (a join or a second query) and the result shape (a comment match isn't a work item match — what would the result even show?). Custom field values (`WorkItemFieldValue`) are per-project-per-item-type and stored as opaque text regardless of `field_type`, so searching them means either a blind `icontains` over typed data (matching "5" from a date field on a search for the number 5) or type-aware search logic — real scope, not requested, deferred.
- **Facets: item_type, status *category* (not literal status), priority, assignee, component, label, project.** Status is filtered by category, not the underlying `WorkItemStatus` id, because status names and even category assignment vary per project (per the Workflows spec) — a literal status id filter would silently mean different things depending which project's row it pointed to, and wouldn't compose across projects at all. Category is the one status concept guaranteed to mean the same thing everywhere.
- **Ranking: two simple tiers, not a relevance score.** Tier 1 — `q` matches `key` or `title`. Tier 2 — `q` matches only `description`. Within each tier, most-recently-updated first. This mirrors what a person actually means by "the more relevant one first" (their search term being in the thing's name beats it being buried in a paragraph) without inventing a scoring formula nobody asked for. No ranking is applied when the request has no `q` (facet-only filtering) — results are just ordered by `updated_at` descending.
- **Dedicated endpoint (`GET /api/search/`), not query params on `/api/work-items/`.** `/api/work-items/` is unpaginated by design, returning every work item in a project's boards so the client can render a full board. Search is the opposite shape: a bounded, ranked, cross-project needle-in-a-haystack query. Overloading one endpoint with two incompatible contracts (unpaginated board feed vs. capped ranked search) was rejected in favor of a small new endpoint that composes the same membership-filtering logic already used elsewhere.

## Data model

**No new persisted model.** This is a read-only query feature over `WorkItem`, `Project`, `WorkItemStatus`, `Component`, and `Label` — all of which already exist. Nothing is stored as a result of a search.

The only implementation-level consideration, not a schema change: `title` and `key` are already indexed incidentally (`key` is `unique=True`; `title` is not currently indexed). A plain database index on `WorkItem.title` may be worth adding once this ships, since it's now a query path rather than just a display field — left as an implementation detail for whoever builds this, not a spec requirement.

## API surface

```
GET /api/search/    cross-project search, scoped to projects I'm a member of
```

Query parameters (all optional individually; see the "at least one" rule below):

| Param | Meaning |
|---|---|
| `q` | free text, matched against `title`, `description`, `key` (case-insensitive substring); minimum 2 characters if present |
| `item_type` | one of `epic`, `story`, `task`, `bug`, `subtask` |
| `status_category` | one of `todo`, `in_progress`, `done` |
| `priority` | `1`, `2`, or `3` |
| `assignee` | a user id |
| `component` | a `Component` id (naturally scoped to its own project, since components are project-scoped) |
| `label` | a `Label` id, or a label name (case-insensitive exact match) — either resolves to the same global `Label` |
| `project` | a `Project` id, to narrow an otherwise cross-project search to one project |

At least one of `q` or a facet filter must be present — a bare `GET /api/search/` is rejected with 400 rather than silently returning a recency-ordered dump of every work item across every project the caller is in. Each facet param accepts a single value in this pass (see Out of scope).

Results are capped at 50, ordered per the ranking rule above, and returned unpaginated up to that cap — no `next`/`previous`, no total count. Response shape mirrors the existing `parent_detail`/children summary style rather than the full `WorkItemSerializer`, since a search result is a pointer to jump from, not a full editing surface:

```json
{
  "results": [
    {
      "id": 42,
      "key": "TASKY-42",
      "title": "...",
      "item_type": "bug",
      "status_detail": {"id": 3, "name": "In Review", "category": "in_progress"},
      "priority": 3,
      "priority_label": "High",
      "assignee_detail": {"id": 7, "username": "...", "display_name": "..."},
      "project": {"id": 2, "key": "TASKY", "name": "Tasky Redesign"},
      "board": {"id": 5, "name": "..."},
      "updated_at": "..."
    }
  ]
}
```

## Error handling

| Case | Response |
|---|---|
| Unauthenticated request | 403, never 401 |
| Neither `q` nor any facet filter present | 400: `"Provide a search term or at least one filter."` |
| `q` shorter than 2 characters | 400, naming `q` |
| `project` param refers to a project I'm not a member of | 400, naming `project` (not 403 — same "reject the filter value" treatment as an invalid facet, not an access-control failure, since the search itself never touches that project's data) |
| `project`/`component`/`assignee`/`label` param refers to a genuinely nonexistent id | 400, naming the param (not 404 — this is a filter value on a list endpoint, not a resource lookup) |
| `item_type`, `status_category`, or `priority` has an invalid value | 400, naming the param |
| Valid request, zero matches | 200, `{"results": []}` |
| Valid request, more than 50 matches | 200, first 50 by ranking — no truncation indicator in this pass (see Out of scope) |

## Testing

- A search matching `title` and one matching only `description` come back in the right tiers, most-recently-updated first within each tier.
- A search term matching `key` (e.g. searching `"TASKY-42"` or just `"42"`) ranks in the top tier alongside title matches.
- Results never include a work item from a project the caller isn't a member of, even when `q` matches its title exactly — proves the membership scoping.
- `project` narrows an otherwise cross-project search to one project; omitting it searches every project I'm in.
- Each facet filter (`item_type`, `status_category`, `priority`, `assignee`, `component`, `label`) in isolation returns only matching work items; combined filters are AND'ed together.
- `status_category` filtering is genuinely category-based: two differently-named statuses in two different projects that share a category both match the same `status_category` filter.
- `label` accepts both a label id and a label name, resolving to the same results.
- A bare request with neither `q` nor any filter is rejected with 400; a `q` of 1 character is rejected with 400.
- A query matching more than 50 work items returns exactly 50, in ranked order.
- Comment bodies and custom field values are never matched by `q`, even when they contain the exact search term and nothing else does.

## Out of scope (deferred to later sub-projects)

- **Comment body and custom field value search.** Real scope creep for this pass — see Judgment calls and Scope decisions above. Revisit if it turns out to be a recurring complaint rather than a theoretical gap.
- **Pagination beyond the 50-result cap.** No `page`/`cursor`/`next`. If 50 stops being enough, this needs a real design pass (what does "page 2 of a ranked cross-project search" even mean once new work items land between page loads) rather than a quick bolt-on.
- **Multi-value facet filters** (e.g. `item_type=bug,task` or multiple labels in one query). Single-value only, for now — multi-select filtering is a UI/query-building question worth its own consideration.
- **Relevance scoring beyond the 2-tier match-location heuristic.** No term-frequency weighting, no fuzzy/typo-tolerant matching, no synonym handling. If `icontains` substring matching turns out to miss things people expect to find, that's the trigger to revisit — not before.
- **Search-as-you-type / autocomplete suggestions.** This is a submit-and-see-results search, not a live-filtering dropdown. A different interaction model with different performance requirements (every keystroke hitting the API) than what's specified here.
- **Saved searches / recent searches.** No persistence of what anyone searched for. Nothing here prevents adding it later as its own small model, but it's not requested.
- **Result highlighting/snippets** (showing the matched substring in context). The response returns full field values; the client can do its own highlighting client-side if wanted, but the API doesn't compute or return match offsets.
- **A full-text search engine (Elasticsearch, MySQL FULLTEXT, etc.).** Considered and explicitly rejected for this pass's scale — see Scope decisions.
