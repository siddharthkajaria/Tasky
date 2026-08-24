# Tasky — Notifications (Sub-project 12 of 13)

**Status:** Fast-drafted 2026-08-24 by solo authorship (per user's explicit request to speed up the remaining roadmap) — awaiting user review and sign-off. No `design/` prototype built yet; per this repo's hard rule, prototype work begins only after this spec is reviewed and approved.

## Context

This is sub-project 12 in Tasky's expansion from a single-board Kanban tool toward a broader, Jira-inspired feature set. The full roadmap (13 sub-projects, redrawn 2026-08-14) is:

1. Projects & Membership — shipped
2. Work Item Hierarchy — shipped (backend + UI)
   - 2b. Custom Fields & Screens — shipped
   - 2c. Bulk Operations & Import — fast-drafted, pending review
3. Workflows — shipped
4. Labels — shipped
5. Search — fast-drafted, pending review
6. Backlog & Sprints — fast-drafted, pending review
7. Releases — fast-drafted, pending review
8. Task Detail UX — fast-drafted, pending review
9. Permissions & Admin — fast-drafted, pending review
10. Project Types & Setup — fast-drafted, pending review
11. Automation — fast-drafted, pending review
12. **Notifications — this document**
13. Reporting & Dashboards — fast-drafted, pending review

Everything a Tasky user might want to be told about already exists in the data model: `WorkItem.assignee`, `WorkItem.created_by`, `Comment` with authorship, and (as of Workflows) `WorkItemStatus` moves. What's missing is a place for "things happened, here's what" to accumulate for a person instead of requiring them to keep re-checking every board.

The closest existing precedent is `Invitation`: `GET /api/invitations/` returns a user's own pending items, and the `design/` prototype surfaces it as a dismissable "Pending invitations" list on the Projects page (`design/index.html`, `data-invitations` section) that the client fetches on page load. That's the shape this spec generalizes — a per-user, server-filtered list of things to look at, fetched by the client rather than pushed to it.

I checked `boards/models.py` and `config/settings.py` for delivery infrastructure before deciding anything: **there is no `EMAIL_BACKEND` configured in settings at all**, no Celery (no reference to it anywhere in the repo), no ASGI/channels setup (`WSGI_APPLICATION` only). This is the same gap the original v1 spec called out explicitly ("Email notifications — needs SES and a sending domain — revisit when the team doesn't check the board on its own") and it still holds. That fact drives the biggest decision below.

## Judgment calls flagged for review

These are the calls most likely to warrant pushback — read this section even if nothing else.

- **In-app only, no email, in this pass.** Confirmed via `config/settings.py` and repo-wide search: no email backend, no SES/sending domain, no Celery or any async task runner. Building real email delivery here would mean standing up all of that infrastructure first, which is a separate, heavier piece of work than "add a `Notification` model." I deferred it rather than build it. If the team's actual pain point is "people don't check the board," in-app notifications alone don't fully solve that — flag if this matters more urgently than I've assumed.
- **No @mentions in this pass.** Nothing in the codebase parses `@username` today (checked comment handling in `boards/models.py`/serializers — plain `TextField`). Adding it means new comment-input UI (autocomplete-as-you-type) and parsing/validation logic, not just a notification consumer. I scoped it out to keep this sub-project to "things the data model already produces." Worth reconsidering if mentions are a near-term expectation rather than a nice-to-have.
- **Auto-watch, Jira-style, rather than pure explicit opt-in.** I decided a work item's creator, its current assignee, and anyone who comments on it become watchers automatically (unwatchable at any time). This is a bet that "silence by default" would make the feature feel broken for the exact people most likely to care (you commented and never hear about replies). Explicit watching is layered on top for anyone else. If you'd rather ship the stricter "watch is only ever explicit" version, that's a small cut, not a redesign.
- **Plain polling, not real-time push.** No websockets/SSE. The client polls a lightweight unread-count endpoint and refetches the list on page load / navigation. Given the "no infra beyond what's already here" theme of this whole spec, I think this is the right call for a small internal tool, but it does mean a notification can sit unseen for up to a polling interval (I suggest ~30–60s) after it fires.
- **Event set is deliberately narrow: assigned, commented-on (as a watcher), status-changed (as a watcher).** I did not invent "sprint started" or anything tied to Backlog & Sprints, Releases, or Automation — those sub-projects' data models don't exist yet from where I'm sitting. Automation (11) will likely want to fire notifications as one of its actions eventually; I noted that as a forward-looking remark only, not something designed for here.
- **No retention/expiry policy.** Notifications accumulate indefinitely with pagination and a read/unread flag; nothing auto-deletes. Simple, but worth a look once real usage numbers exist.

## Scope decisions from brainstorming

These are my own judgment calls made without live back-and-forth — flagged above where most consequential, listed here for completeness.

- **Watchers are the single mechanism behind every notification event**, rather than three separately-coded "who cares about this" checks (assignee, reporter, commenters). A work item's watcher list is auto-populated (see below) and explicitly editable; every notification-generating action just fans out to "current watchers, minus the actor." This keeps the event logic small and gives the UI one thing to show ("Watching · 3") instead of three implicit rules a user can't see.
- **Auto-watch triggers: work item creation, becoming the assignee, posting a comment.** Each adds the acting/affected user to the watcher set if not already present; each is one line at the call site, not new infrastructure. Explicit `watch`/`unwatch` actions exist for anyone else (a PM interested in a work item they didn't create, aren't assigned, and haven't commented on) and can also *remove* an auto-added watch — nothing is permanently sticky.
- **A `Notification` row stores a pre-rendered `body` string at creation time**, not just foreign keys the client has to hydrate and format. If the actor renames their display name or the work item's title changes later, old notifications keep reading the way they did when they fired — matching how a `Comment.body` is a stored snapshot, not a live join. `work_item` is still kept as a real FK so the client can build a "go to it" link.
- **Notifications never fire for your own actions.** Assigning a work item to yourself, commenting on something you're the only watcher of, or moving a work item you're the sole watcher of, produces no `Notification` row (would just be noise) even though the underlying auto-watch step still runs.
- **`GET /api/notifications/` is paginated**, unlike most list endpoints in this codebase (`/api/labels/`, `/api/fields/`, `/api/screens/` are all deliberately unpaginated because they're small, bounded, admin-managed sets). A notification list is per-user and grows without bound over the life of the account, so it gets DRF's standard pagination — the first genuinely paginated list endpoint in the API.
- **A dedicated unread-count endpoint, separate from the list.** Polling every 30–60 seconds against the full paginated list just to render a badge number is wasteful; a tiny `{count}` endpoint is cheap enough to poll and is the thing a badge actually needs.

## Data model

**`WorkItem.watchers`** — new `ManyToManyField` to `settings.AUTH_USER_MODEL`, `related_name="watched_work_items"`, `blank=True`. No through-model — matches `WorkItem.labels`/`WorkItem.components`, no per-watcher metadata needed.

**`Notification`**
- `recipient` — FK to User, `on_delete=CASCADE`, `related_name="notifications"`. Who sees this.
- `actor` — FK to User, `on_delete=SET_NULL`, `null=True`, `related_name="notifications_caused"`. Who did the thing (nullable so a deleted account doesn't break history, matching `Comment.author`).
- `event_type` — `CharField` with choices: `assigned`, `comment`, `status_change`.
- `work_item` — FK to `WorkItem`, `on_delete=CASCADE`, `related_name="notifications"`. Deleting a work item deletes the notifications about it — nothing meaningful survives that.
- `comment` — FK to `Comment`, `on_delete=SET_NULL`, `null=True`, `blank=True`. Set only for `event_type="comment"`; if the comment is later deleted, the notification and its rendered `body` survive with a null reference.
- `body` — `CharField`, rendered once at creation (e.g. `"Priya assigned you TASKY-123: Fix the login redirect"`, `"Dev commented on TASKY-88: Refactor the queue"`, `"TASKY-41 moved to Done"`).
- `is_read` — `BooleanField(default=False)`.
- `created_at` — `auto_now_add`.

```
class Meta:
    ordering = ["-created_at", "-id"]
    indexes = [models.Index(fields=["recipient", "is_read", "created_at"])]
```

**Auto-watch, applied at the point of the underlying action** (not a separate scheduled job — no infrastructure exists for that, and none is needed):
- A work item's `created_by` is added to `watchers` at creation.
- A work item's new `assignee` is added to `watchers` when the assignment changes (create or `PATCH`), if not null.
- A `Comment`'s `author` is added to the work item's `watchers` when the comment is posted.

**Notification generation, applied in the same request as the triggering write, inside the same transaction:**
- Assignee changed (create or `PATCH` where `assignee` differs from before, and the new assignee isn't the actor) → one `Notification(event_type="assigned")` for the new assignee.
- Comment posted → one `Notification(event_type="comment")` for every watcher of that work item at that moment, excluding the comment's own author (who was just auto-watched but doesn't need telling about their own comment).
- `POST /api/work-items/{id}/move/` succeeds → one `Notification(event_type="status_change")` for every current watcher, excluding whoever performed the move.

## API surface

```
GET  /api/notifications/                    my notifications, newest first, paginated; ?unread=true filters to unread only
GET  /api/notifications/unread-count/        {count: <int>} — my unread count, for polling a badge
POST /api/notifications/{id}/read/           mark one of my notifications read; idempotent
POST /api/notifications/mark-all-read/       mark every one of my unread notifications read

GET  /api/work-items/{id}/watchers/          list current watchers ({id, username, display_name}[]); any project member
POST /api/work-items/{id}/watch/             add myself as a watcher; idempotent
POST /api/work-items/{id}/unwatch/           remove myself as a watcher (including an auto-added watch); idempotent
```

No `POST /api/notifications/`. Notifications are always server-generated as a side effect of an assignment change, a comment, or a move — never created directly, same pattern as `Label` having no direct `POST`.

`watch`/`unwatch` are self-only — there's no way to watch or unwatch a work item on someone else's behalf, matching the "leave" modeling already used for project membership (`DELETE /api/projects/{id}/members/{user_id}/` doubling as leave-your-own).

## Error handling

| Case | Response |
|---|---|
| Unauthenticated request | 403, never 401 |
| Non-member of a work item's project calls `watch`/`unwatch`/`watchers/` on it | 403 |
| `watch` when already watching | 200/204, no-op — not an error |
| `unwatch` when not currently watching | 200/204, no-op — not an error |
| `POST /api/notifications/{id}/read/` on another user's notification | 403 |
| `POST /api/notifications/{id}/read/` on a genuinely nonexistent id | 404 |
| `mark-all-read` with zero unread notifications | 200/204, no-op |
| Assigning a work item to yourself | No `Notification` created (not an error; documented behavior) |

## Testing

- Creating a work item adds its `created_by` as a watcher.
- Assigning a work item to a user adds them as a watcher and creates one `assigned` `Notification` for them; self-assignment creates no notification.
- Posting a comment adds the author as a watcher, then notifies every *other* current watcher with a `comment` notification — the author is excluded from their own notification.
- `move/`-ing a work item notifies every current watcher except whoever performed the move.
- Explicit `watch`/`unwatch` are idempotent, and `unwatch` successfully removes an auto-added watch (not just explicitly-added ones).
- A non-member of a work item's project gets 403 from `watch`, `unwatch`, and `watchers/` on it.
- `GET /api/notifications/` returns only the caller's own notifications, paginated, newest first; `?unread=true` filters correctly.
- `GET /api/notifications/unread-count/` matches the count of unread rows independent of the list endpoint's page size.
- `read/` on another user's notification is rejected with 403; on my own, it flips `is_read` and is safely repeatable.
- `mark-all-read` only touches the caller's own unread notifications and leaves other users' untouched.
- Deleting a work item cascades to delete its `Notification` rows without error.
- Deleting a comment nulls out `Notification.comment` on any notification that referenced it, but leaves the notification's stored `body` and visibility untouched.

## Out of scope (deferred to later sub-projects)

- **Real email delivery.** No `EMAIL_BACKEND`, SES, or sending domain configured anywhere in this repo today — building it means standing up that infrastructure first. This is exactly the deferral the original v1 spec made ("needs SES and a sending domain... revisit when the team doesn't check the board on its own") and it still applies. Revisit as its own, infrastructure-heavier follow-up if in-app polling proves insufficient.
- **@mentions in comments.** No mention parsing exists anywhere in the codebase today; introducing it means new comment-input UI (autocomplete) as well as parsing/validation, not just another notification trigger. A future comment-UX pass (plausibly folded into Task Detail UX, sub-project 8, or a Notifications v2) is a better home for it.
- **Real-time delivery (websockets/SSE).** Plain polling only, per the judgment call above — no ASGI/channels infrastructure exists, and none is justified for a small internal tool.
- **Notification preferences.** Per-project muting, per-event-type toggles, digest batching, snoozing — real scope nobody has asked for yet; the flat "everything a watcher would want" default is the whole feature for v1.
- **Retention/expiry policy.** Notifications accumulate with pagination; no auto-deletion or archiving. Fine at small scale, worth revisiting once real volume exists.
- **Due-date/overdue reminders.** These would need a scheduled job (nothing due "happens" via a request the way assignment/comment/move do), and there's no cron/Celery infrastructure in this repo to run one.
- **Automation-triggered notifications** (sub-project 11 firing a notification as one of its actions). A plausible future integration point once Automation exists, but not something this spec designs for — noted here only as a forward-looking remark.
