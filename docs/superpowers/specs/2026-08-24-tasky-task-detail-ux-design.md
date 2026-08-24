# Tasky — Task Detail UX (Sub-project 8 of 13)

**Status:** Fast-drafted 2026-08-24 by solo authorship (per user's explicit request to speed up
the remaining roadmap) — awaiting user review and sign-off. No `design/` prototype built yet;
per this repo's hard rule, prototype work begins only after this spec is reviewed and approved.

## Context

This is sub-project 8 in Tasky's expansion from a single-board Kanban tool toward a broader,
Jira-inspired feature set. The full roadmap (13 sub-projects, redrawn 2026-08-14) is:

1. Projects & Membership — shipped
2a. Work Item Hierarchy — shipped (backend + UI)
2b. Custom Fields & Screens — shipped (backend + `design/` prototype)
2c. Bulk Operations & Import — fast-drafted, pending review
3. Workflows — shipped
4. Labels — shipped
5. Search — fast-drafted, pending review
6. Backlog & Sprints — fast-drafted, pending review
7. Releases — fast-drafted, pending review
8. **Task Detail UX — this document**
9. Permissions & Admin — fast-drafted, pending review
10. Project Types & Setup — fast-drafted, pending review
11. Automation — fast-drafted, pending review
12. Notifications — fast-drafted, pending review
13. Reporting & Dashboards — fast-drafted, pending review

Unlike every other sub-project so far, this one wasn't handed a specific new data model to
build — it names an experience ("looking at and working within one task") rather than a
feature. Today, per the shipped `design/` prototype and production `ui/`, a work item's detail
view is a single modal: title, description, status, priority, due date, assignee, parent,
components, labels, custom fields, children, linked items (`WorkItemLink`), and a comment
thread — all already shipped. This document's job is to work out what a Jira-experienced user
would still find missing or clunky about that view, and to be honest about which of those gaps
are real, scoped work versus better left alone.

The conclusion below is narrower than the brief's list of candidates: the one piece of genuine,
concrete, backend-shaped scope is **attachments**. Everything else considered either already
exists under a different name, has no consumer yet, or is a UI concern with no new API surface.

## Judgment calls flagged for review

- **Scoping this entire sub-project down to attachments alone.** The brief listed five
  candidate areas (attachments, activity log, watchers, checklists, inline-editing polish); this
  draft concludes four of the five are out of scope for reasons given below. This is the single
  biggest call in this document and the one most likely to draw pushback — if any of the
  deferred items actually matter sooner than assumed, say so and this spec gets rewritten around
  a bigger scope.
- **Attachment delete permission is uploader-or-Owner/Admin, not uploader-or-nobody.** This
  deliberately diverges from `Comment`'s existing author-only-unless-the-author-account-is-gone
  rule. The reasoning (below, under Data model) is that a shared file is closer to project
  property than a personal remark — but it's a new permission shape introduced in this spec
  without a direct precedent, worth a second look.
- **Attachment downloads go through an authenticated Django view
  (`/api/attachments/{id}/download/`), not a raw `MEDIA_URL` link.** This adds an endpoint and a
  streaming response instead of the simpler "just link to the file" approach, purely to keep
  project-membership enforcement consistent with the rest of the API. It's more machinery than a
  first pass strictly needs for an internal tool — could be simplified to a plain static link if
  that inconsistency is judged acceptable.
- **Activity/history log is deferred with no assigned home on the current 13-item roadmap.**
  Unlike other deferred items in past specs, this one doesn't cleanly belong to a numbered
  sub-project still ahead of us — it might fold into 13 (Reporting & Dashboards) or might need a
  new entry. Flagging this now so it isn't quietly lost.
- **Local filesystem storage for attachment files**, not S3 or another object store. Justified
  below on cost/complexity grounds for an internal, single-box tool, but it's a storage decision
  that's expensive to reverse once files pile up on the box — worth confirming before it's built.
- **No malware/antivirus scanning on uploads.** The original v1 spec deferred attachments
  partly on "malware thinking" grounds; this draft accepts that risk for an internal-only tool
  rather than solving it. Revisit immediately if Tasky is ever exposed beyond the org network.

## Scope decisions from brainstorming

These are solo judgment calls made while fast-drafting, not live-brainstormed with the user —
flagged individually above where they're most likely to need a second look.

- **Attachments are the real, concrete scope here.** No file/image attachment capability exists
  on a work item today (confirmed against `boards/models.py` and `docs/api.md`) — it's a
  genuine, common gap a Jira-experienced user would hit immediately, and it's the one item from
  the brief that requires an actual new model and API surface rather than reframing something
  that already exists.
- **Activity/history log is deferred, not built here.** A real audit trail (status changes,
  assignee changes, every field edit) needs either signal-based change tracking across every
  mutable field on `WorkItem`, or explicit logging calls at every write site — meaningfully more
  design and implementation surface than "add a model and an endpoint." It's also a feature in
  its own right, not naturally part of "the detail view," and the original v1 spec already
  named it as a considered deferral ("nobody misses it early... revisit when an audit trail is
  needed"). That trigger hasn't clearly fired yet.
- **Watchers/subscribe are deferred to sub-project 12 (Notifications).** A watcher list with
  nothing to consume it — no notification to send when a watched item changes — is a stub
  feature: it stores data that goes nowhere. Building the watcher relationship now would mean
  either building it twice (once here, once properly wired to notifications later) or building
  it prematurely and having it sit unused. Sub-project 12 is the natural, and only sensible,
  place for this.
- **No lightweight checklist mechanism.** The existing Subtask item type (a full `WorkItem` with
  `item_type=subtask`, its own status, assignee, and hierarchy via `parent`) already covers "a
  todo that belongs under this task." A second, lighter-weight checklist-of-strings mechanism
  living alongside it would be redundant — two ways to express "smaller piece of this work,"
  with no clear rule for which one a user should reach for. Skip it; if Subtasks prove too heavy
  for genuinely trivial checklist items, that's its own future conversation, not solved by adding
  a parallel system now.
- **Quick actions / inline editing polish is a `design/`/`ui/` concern, not a backend one.**
  Things like editing the title in place without opening a separate edit mode, a status
  dropdown directly on the card, or keyboard shortcuts in the detail modal are pure client-side
  UX work against APIs that already exist (`PATCH /api/work-items/{id}/`, `POST
  /api/work-items/{id}/move/`). Nothing about it requires new backend surface, so it isn't part
  of this spec — it's implementation detail for whoever eventually builds the Phase 1 prototype
  for this sub-project.
- **Attachments live directly on the work item, not on a comment.** Jira supports both
  (attach-to-issue and attach-to-comment); this draft supports only the former; a comment that
  references a file just links to it in prose. Keeping attachments as one flat list per work
  item avoids a second parent-type branch in the model and matches the flat, simple shape of
  everything else on the detail view today.

## Data model

**`Attachment`**
- `work_item` (FK to `WorkItem`, `on_delete=CASCADE`, `related_name="attachments"`).
- `file` — a `FileField`, stored via Django's default `FileField` storage backend (local
  filesystem, under a new `MEDIA_ROOT`; see Storage note below). Not an S3/object-store backend.
- `filename` — the original client-supplied filename, captured at upload time. Kept as its own
  column (rather than derived from `file.name`) because Django's storage backend may rename the
  file on disk to avoid a collision (`report.pdf` → `report_aB3dK.pdf`); the UI should always
  show the user's original name, not the on-disk name.
- `content_type` — captured from the upload at write time (browser-supplied MIME type; not
  independently verified server-side beyond the size cap below).
- `size` — bytes, captured at upload time for cheap display in the attachment list without a
  storage stat call per row.
- `uploaded_by` (FK, `on_delete=SET_NULL`, `null=True`) — same "preserve the row if the account
  is later deleted" pattern used by `Comment.author`, `WorkItem.created_by`, etc.
- `uploaded_at` — `auto_now_add`.

**Storage: local filesystem, not S3.** This repo already runs a single-box deployment (Docker
container, MySQL native on the same Mac locally / RDS on EC2, Apache reverse-proxying —
`config/settings.py` has no `MEDIA_ROOT`/`MEDIA_URL` today, only `STATIC_ROOT`/`STATIC_URL` for
the no-build-step UI). Introducing an object-store dependency (credentials, a bucket, a new
`django-storages`-style backend) is real added infrastructure for a small internal team's
attachment volume — Django's default `FileField` storage against a `MEDIA_ROOT` on the same
disk as everything else is simplest, costs nothing new to operate, and matches the tool's
existing "same box does everything" shape. Revisit if disk space on the box becomes a real
constraint, which is a config change (swap the storage backend) rather than a data-model change.
This needs `MEDIA_ROOT`/`MEDIA_URL` added to `config/settings.py`, and — like `STATIC_ROOT`
today — the production Apache config needs a location block for it (a deployment follow-up in
the shape of the existing `docs/follow-ups.md` items, not a code change beyond settings).

**Size cap:** a fixed, generous limit — 25 MB per file — enforced at the serializer level, not
chosen from any specific request but as a sane guard against an accidental huge upload (e.g. an
uncompressed screen recording) rather than a deliberate product decision. No per-work-item count
limit.

**No file-type allowlist or blocklist.** Any file type is accepted; the UI can suggest an icon
by `content_type` but nothing is rejected on type. Matches the "trust the internal team" posture
this tool already takes everywhere else (no login throttling, no CSRF on login — see
`docs/follow-ups.md`).

**No malware scanning.** Accepted risk for an internal-only tool with a small trusted user base;
the original v1 spec's "malware thinking" concern is real but disproportionate here. Revisit
immediately if Tasky is ever exposed outside the org.

**Deleting a `WorkItem` cascades to delete its `Attachment` rows** (standard `CASCADE`, matching
how `Comment` already cascades from `WorkItem`). The underlying files on disk are **not**
actively cleaned up as part of that cascade in this pass — an orphaned file left on disk after a
work item delete is accepted debt for now (see Out of scope).

**Delete permission diverges from `Comment`'s.** `Comment` is author-only-unless-the-author-
account-is-gone. For `Attachment`, this draft proposes: the uploader can delete their own
upload, **and** any Owner/Admin of the work item's project can delete any attachment — a wider
allowance than Comment gets. Reasoning: an attachment is closer to a shared project asset (a
screenshot everyone on the task needs, a spec doc) than a personal comment, and an Owner/Admin
plausibly needs to remove a wrong, oversized, or sensitive file without waiting on whoever
uploaded it. Flagged above as a judgment call worth confirming.

## API surface

```
GET/POST /api/work-items/{id}/attachments/   list this work item's attachments / upload a new one (any project member)
DELETE   /api/attachments/{id}/              uploader, or Owner/Admin of the work item's project
GET      /api/attachments/{id}/download/     streams the file (any project member)
```

- `POST /api/work-items/{id}/attachments/` is `multipart/form-data`, not JSON — the one endpoint
  in this API surface that isn't. Body: a single `file` field. `uploaded_by` is taken from the
  session, same as `Comment.author`.
- List/detail responses (everywhere except the download endpoint) return metadata only —
  `{id, work_item, filename, content_type, size, uploaded_by, uploaded_at}` — never the raw file
  bytes or a direct storage URL. `uploaded_by` is a nested `{id, username, display_name}` object,
  matching `assignee_detail`'s shape on `WorkItem`.
- **Downloads are a separate, authenticated endpoint rather than a plain `MEDIA_URL` link.**
  Every other resource in this API enforces project membership before returning data (see
  `docs/api.md`'s "non-member gets 403" pattern throughout); a raw static-file URL under
  `/media/...` would bypass that entirely; anyone with the URL — not just project members —
  could fetch it once served directly by Apache in production. `GET
  /api/attachments/{id}/download/` re-checks membership the same way every other endpoint does,
  then streams the file with a `Content-Disposition` header carrying the original `filename`.
  Flagged above as possibly more machinery than a first pass needs.
- No `PATCH` on `Attachment`. An attachment is immutable once uploaded — replacing it means
  delete-and-reupload, same posture as `key`/`item_type`/`position` being immutable on
  `WorkItem`.

## Error handling

| Case | Response |
|---|---|
| Unauthenticated request | 403, never 401 |
| Non-member lists/uploads/downloads/deletes on a work item's attachments | 403 |
| `POST` with no `file` in the body, or an empty file | 400, naming `file` |
| `POST` exceeding the 25 MB cap | 400, naming the limit |
| `DELETE` by someone who isn't the uploader and isn't an Owner/Admin of the project | 403 |
| `GET`/`DELETE` a genuinely nonexistent attachment id | 404 |
| `GET .../download/` for an attachment whose work item's project the caller isn't a member of | 403 (not a leaked file) |
| `POST` to a work item in a project the caller isn't a member of | 403 |

## Testing

- Uploading a file to a work item creates an `Attachment` row with the correct `filename`,
  `content_type`, `size`, and `uploaded_by`, and it appears in that work item's attachment list.
- A non-member of the work item's project is rejected (403) on list, upload, download, and
  delete.
- The uploader can delete their own attachment; a different plain project member cannot (403);
  an Owner/Admin of the project can delete any attachment regardless of who uploaded it.
- A file over the size cap is rejected with 400 and no `Attachment` row is created.
- The download endpoint streams the correct bytes and `Content-Disposition` filename, and
  enforces the same membership check as the metadata endpoints — a raw guess at the storage path
  is not a valid way to fetch a file this API wouldn't otherwise serve to that caller.
- Deleting a work item cascades to delete its `Attachment` rows.
- Multiple attachments on one work item are all listed, ordered by `uploaded_at`.

## Out of scope (deferred to later sub-projects)

- **Activity/history log** (who changed what, when, beyond comments). A meaningfully bigger
  feature — needs either signal-based tracking across every mutable `WorkItem` field or explicit
  logging at every write site. Not assigned to a specific later sub-project on the current
  13-item roadmap; may need to fold into 13 (Reporting & Dashboards) or become a new roadmap
  entry. Flagged above for the user to place.
- **Watchers / subscribe to a task.** Deferred to sub-project 12 (Notifications) — a watcher
  list is inert without notifications to act on it, so building it before Notifications exists
  means building it twice.
- **Lightweight in-task checklists.** The existing Subtask item type already covers "smaller
  piece of this work with its own status/assignee"; a second, lighter mechanism would be
  redundant and would create an unclear choice between two ways to express the same thing.
- **Quick actions / inline editing polish** (in-place title edit, inline status change,
  keyboard shortcuts in the detail view). Pure `design/`/`ui/` implementation work against
  already-existing endpoints; no new backend surface, so no part of this spec.
- **Attachments on comments** (as opposed to on the work item directly). Not requested; keeping
  attachments as one flat list per work item is simpler and matches this tool's existing
  preference for flat, non-nested structures.
- **Malware/antivirus scanning, file-type allow/deny lists, image thumbnail generation, and
  attachment versioning** (replacing a file in place rather than delete-and-reupload). None
  requested; each is real added scope with no current demand.
- **Active cleanup of orphaned files on disk** after a work item (and its attachments) is
  deleted. `Attachment` rows cascade-delete correctly; the underlying files are left on disk in
  this pass. Accepted debt for an internal tool's likely attachment volume — revisit if disk
  usage on the box becomes a genuine problem.
- **Object storage (S3 or similar).** Local filesystem via Django's default `FileField` storage
  is the design for now; switching backends later is a settings/infrastructure change, not a
  data-model change, so this isn't a door being closed.
