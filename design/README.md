# Tasky — design prototype

Plain HTML, CSS and vanilla JavaScript. No framework, no build step, no
package manager — same rules as `../ui/`.

**This is Phase 1 of the redesign**, per this repo's hard rule: Phase 2
(production Django/DRF implementation) does not begin for a sub-project
until its prototype is signed off here, in the user's own words. This
directory grows as each sub-project's design is approved — it's a running
prototype of the whole product, not a one-off mockup.

| Sub-project | Spec | Status |
|---|---|---|
| 1 — Projects & Membership | `../docs/superpowers/specs/2026-08-13-tasky-projects-membership-design.md` | Signed off, **shipped to production** (`../ui/`, `../projects/`) |
| 2a — Work Item Hierarchy | `../docs/superpowers/specs/2026-08-14-tasky-work-item-hierarchy-design.md` | Signed off, **shipped to production** (`boards/models.py`, `../ui/`) |
| 2b — Custom Fields & Screens | `../docs/superpowers/specs/2026-08-18-tasky-custom-fields-screens-design.md` | Signed off, **shipped to production** (`boards/models.py`) |
| 3 — Workflows | `../docs/superpowers/specs/2026-08-18-tasky-workflows-design.md` | Signed off, **shipped to production** (`boards/models.py`) |
| 4 — Labels | `../docs/superpowers/specs/2026-08-18-tasky-labels-design.md` | Signed off, **shipped to production** (`boards/models.py`) |
| 2c — Bulk Operations & Import | `../docs/superpowers/specs/2026-08-24-tasky-bulk-import-design.md` | Signed off, **shipped to production** (`boards/views.py`, `boards/services.py`) |
| 5 — Search | `../docs/superpowers/specs/2026-08-24-tasky-search-design.md` | Signed off, **shipped to production** (`boards/views.py`) |
| 6 — Backlog & Sprints | `../docs/superpowers/specs/2026-08-24-tasky-backlog-sprints-design.md` | Signed off, **shipped to production** (`boards/models.py`, `boards/services.py`) |
| 7 — Releases | `../docs/superpowers/specs/2026-08-24-tasky-releases-design.md` | Signed off, **shipped to production** (`boards/models.py`, `boards/views.py`) |
| 8 — Task Detail UX | `../docs/superpowers/specs/2026-08-24-tasky-task-detail-ux-design.md` | Signed off, **shipped to production** (`boards/models.py`, `boards/views.py`) |
| 9 — Permissions & Admin | `../docs/superpowers/specs/2026-08-24-tasky-permissions-admin-design.md` | Signed off, **shipped to production** (`accounts/views.py`, `projects/models.py`) |

Because sub-projects 1, 2a, 2b, 3 and 4 already shipped, this whole prototype
is now a faithful *replica* of what's live in production — it exists here as
the reference implementation the next unreviewed sub-project's new screens
get built alongside, not because any of it still needs review.

## Run it

No server required — open `index.html` directly in a browser. There's no
backend to reach, so unlike `../ui/`, absolute `/static/...` paths aren't
needed.

Sign in as `asha`, `kabir`, `lena` or `priya` — any password works.

## Suggested walkthrough (as Asha)

1. **Sign in as `asha`.** The Projects page shows a pending invitation to
   "Marketing Launch" — Accept or Decline it. You're Owner of
   **Tasky Redesign (`TASKY`)** and Admin of **Website Refresh (`WEB`)**.
2. **Open Tasky Redesign, then open its Sprint Board.** Seeded with a
   realistic hierarchy: Epic `TASKY-1` "Redesign onboarding", with a Story
   and a Task under it, a Subtask under the Story, and a standalone Bug.
   Notice each card's key, type badge, and (for children) a chip pointing
   at its parent.
3. **Click a card to open it.** Try:
   - Changing its **Parent** — the dropdown only offers types the
     hierarchy actually allows (a Subtask only sees Stories/Tasks/Bugs on
     this board, an Epic sees no parent field at all).
   - Toggling **Components** — Frontend/Backend are pre-seeded; try
     adding one via the Components section back on the project page
     first, then apply it here.
   - **+ Link an item** — pick another item on the board, save, then
     remove it again from the "Related items" list.
   - Opening a **child** from the Epic's Children list — jumps straight
     to that item's own detail view.
4. **Add a new work item** via "+ Add work item" in any column — pick
   Subtask as the type before picking a parent, and notice the parent
   field requires one and only offers valid Story/Task/Bug candidates.
   Try picking Epic as the type — the parent field disables entirely.
5. **Delete the Epic** (open it, Delete). Its Story and Task survive on
   the board, just without a parent chip anymore — nothing cascades.
6. **Sign out, sign in as `lena` or `kabir`** to see the Projects &
   Membership flows from an Owner/Admin/Member angle other than Asha's —
   unchanged from sub-project 1's prototype, now shipped in `../ui/`.

## Sub-project 2b — Custom Fields & Screens

7. **Open Fields (top nav).** Only Owners of some project can manage
   these (Asha qualifies). Add a field of each type — try a Select or
   Multi-select and add a couple of options to it. Try changing a field's
   type after creation — it's blocked, per spec. Try deleting a field
   that's on a Screen — also blocked, until you remove it from the
   Screen first.
8. **Open Screens.** Create a screen, add a few of the fields you just
   made to it, reorder them, and toggle "required" on one.
9. **Back on the Tasky Redesign project page**, under "Field screens",
   point one or two item types (e.g. Task) at the screen you built. Try
   "None" — that item type goes back to built-in fields only.
10. **Open the Sprint Board and add or open a Task.** The screen's custom
    fields now render in the create form and the detail modal, in the
    screen's order, with the required ones marked. Leave a required one
    blank and save — the error lands under that specific field. Save
    successfully, then reopen the item to see the value persisted.
11. **Reassign that item type to a different screen (or "None")** back on
    the project page, then reopen the same work item — its old field's
    saved value still shows, under "Other saved values", read-only, per
    the spec's "orphaned values stay visible" rule.

## Sub-project 3 — Workflows

12. **Back on the Tasky Redesign project page**, find the new "Statuses"
    section. Every project starts with the same 3 defaults — To Do, In
    Progress, Done. Rename one (click its name, edit, click away), reorder
    with the ▲▼ buttons, and try recategorizing "In Progress" to Done via
    its dropdown — notice the board's column coloring follows the category,
    not the name.
13. **Add a 4th status** — e.g. "Blocked", category In Progress — then open
    the Sprint Board. It's now a 4-column board, and "Blocked" is colored
    the same as "In Progress" since they share a category.
14. **Try to delete a status that's holding a work item** (e.g. "To Do",
    which `TASKY-2`/`TASKY-3`/`TASKY-4` sit in) — rejected, naming how many
    items are in the way. Move those items off it first (open one, change
    its Status in the modal), then delete succeeds.
15. **Try to recategorize or delete the last status in a category** (e.g.
    if Done only has one status left) — rejected. Every project must always
    have at least one status in each of To Do / In Progress / Done.
16. **Open a work item and change its Status via the dropdown** — the
    board reflects the move on save. (There's no drag-and-drop in this
    prototype — status changes go through the detail modal, same as every
    other field here.)

## Sub-project 4 — Labels

17. **Open Labels (top nav).** Global, free-form list — seeded with
    `needs-design` and `urgent`. As Asha (Owner of some project), you can
    click a label's colour dot to cycle it, click its name to rename it in
    place, or delete it — deleting unassigns it from every work item, with
    no "in use" guard, same as Components.
18. **Open the Sprint Board.** `TASKY-2` and `TASKY-5` already carry a
    label chip on their cards. Open `TASKY-2` — its detail modal has a
    Labels section with `needs-design` already there.
19. **Type a brand-new label straight onto a work item** — in that same
    Labels section, type a name nobody's used yet and press Enter (or
    `,`). It becomes a chip immediately, no separate "create label" step
    anywhere. Save, then check it now shows up in the Labels admin list
    too.
20. **Try the same box's autocomplete** — start typing `urg` and the
    existing `urgent` label should offer itself; pick it rather than
    typing the whole thing, to reuse the label instead of minting a near-
    duplicate.
21. **Add a label via "+ Add work item"** on the board — the same chip
    input is there on the create form, so a label can be set the moment
    an item is made, not just after.
22. **Remove a chip** (click its ×) before saving, on either the create
    form or the detail modal, to confirm it's gone and never got applied.

## Sub-project 2c — Bulk Operations & Import

23. **Open the Sprint Board and click "Select"** (top right). Checkboxes
    appear on every card, and clicking a card now toggles its checkbox
    instead of opening the detail modal.
24. **Select 2–3 cards.** A bulk-action bar appears above the columns:
    move to a status, set assignee, set priority, add a label, add a
    component, delete, or clear the selection.
25. **Try each bulk action** — move a batch to a different status, apply
    a label to all of them (reopen one afterward to confirm it stuck),
    bump their priority. Each one shows a toast and updates the board
    live, no reload.
26. **Try bulk delete** — a confirm prompt names the count before
    anything is removed.
27. **Click "Select" again** to leave select mode — checkboxes disappear,
    clicking a card opens the detail modal again.
28. **Click "Import"** (top right) and paste a CSV with a header row —
    `title` is the only required column; try `item_type`, `status`,
    `priority`, `assignee`, `labels`, `components` too (see the modal's
    own column reference). Import succeeds per-row: a bad row (blank
    title, or `item_type: subtask`) is reported and skipped without
    blocking the rest of the file.

## Sub-project 5 — Search

29. **Open Search (top nav).** Notice the Project dropdown only lists
    projects you're actually a member of — as Asha, that's Tasky Redesign,
    Website Refresh and Client Portal, never Marketing Launch (she only
    has a pending invite there, not membership).
30. **Submit with nothing filled in** — rejected, asking for a search term
    or at least one filter. Try a 1-character term — rejected for being
    too short (2 characters minimum).
31. **Search a real term** — try "onboarding". Results show a key pill,
    type badge, title, and project/status meta; clicking one jumps to
    that item's board.
32. **Try a facet-only search** — pick a Type or Priority with no text
    and submit. Then combine a text term with a facet to narrow further.
33. **Search for something that matches nothing** — a clean "No matches"
    state, not an error.

## Sub-project 6 — Backlog & Sprints

34. **Open the Sprint Board and click "Backlog"** (top right). Sprint 14
    is seeded ACTIVE with TASKY-2 and TASKY-3 in it; Sprint 15 is
    PLANNED and empty; TASKY-1, TASKY-4 and TASKY-5 sit in the Backlog
    section below, unscheduled.
35. **Click one of Sprint 14's items** — the normal work item detail
    modal opens, same as from the board.
36. **Move a Backlog item into Sprint 15** via its "Move to" dropdown —
    it disappears from Backlog and appears under Sprint 15, whose item
    count updates.
37. **Try to Start Sprint 15 while Sprint 14 is still active** — rejected,
    naming Sprint 14 and asking you to complete it first. Only one
    active sprint per board at a time.
38. **Complete Sprint 14** — it's marked COMPLETED, its item list is
    replaced with a note that its items returned to the backlog, and
    TASKY-2/TASKY-3 reappear in the Backlog section.
39. **Now Start Sprint 15** — succeeds, since no sprint is active
    anymore; it's marked ACTIVE with a start date.
40. **Add a new sprint** via the "+ Add sprint" form — appears PLANNED
    with 0 items. **Try deleting a completed sprint** — no Delete button
    is offered (only a planned sprint can be deleted); delete the new
    empty planned one instead — it disappears.
41. **Sign in as a plain Member of a project** (not Owner/Admin) and open
    that project's Backlog page — the "+ Add sprint" form and every
    Start/Complete/Delete button are hidden, but the sprint list, the
    backlog list, and the "Move to" dropdown are all still fully usable —
    scheduling a work item is a plain edit, not a manage-tier action.

## Sub-project 7 — Releases

42. **Open the Tasky Redesign project page** and find the new "Releases"
    section, below Field screens. Seeded with three: **v2.3** (Released,
    dated 2026-07-15), **v2.4.0** (Unreleased, targeted 2026-09-01), and
    **Q2 Cleanup** (Archived, no date at all — a release that was abandoned
    straight from Unreleased, never shipped). `v2.3` lists `TASKY-5` as
    tagged — notice `TASKY-5` is still In Progress on the board even though
    its release already says Released: nothing here ties a release's status
    to its work items' statuses, by design.
43. **Try adding a release named `v2.4.0`** (any casing) — rejected, already
    taken in this project. **Switch to Website Refresh** (the project
    switcher) and look at its own Releases section — it already has its own
    `v2.4.0`, seeded independently. Same name, two different projects, both
    fine — releases are project-scoped, not global like Labels.
44. **Add a real release** via the form — name it, optionally give it a
    target date, submit. It appears Unreleased with 0 items, since `status`
    isn't offered on create — a release doesn't exist to be "released" yet.
45. **Rename it** (click the name, edit, click away), **change its status**
    via the dropdown — try jumping straight from Unreleased to Archived,
    skipping Released entirely — and **set or clear its date** at any time,
    regardless of status. No transition rules anywhere.
46. **Open a work item** (e.g. the Epic `TASKY-1`) and find the new
    **Release** field next to Due date — any project member can set this,
    no Owner/Admin check. Pick `v2.4.0`, save, and notice the board card
    now shows a small release chip. Reopen the item — the selection
    persisted. Set it back to "No release" — the chip disappears.
47. **Back on the project page**, `v2.4.0`'s card now lists `TASKY-1`
    alongside the seeded `TASKY-3`. Click either row to jump straight to
    that item's detail modal.
48. **Delete `v2.3`** (still holding `TASKY-5`) — succeeds with no "in use"
    guard, same as Components. Open `TASKY-5` afterward — its Release field
    is back to "No release"; the work item itself was untouched.
49. **Sign in as a plain Member of a project** (e.g. `asha` on Client
    Portal, `CLNT`) and open that project's page — the "+ Add release" form
    and every status/date/delete control are hidden, but the release list
    itself is still visible (Client Portal has none seeded yet, so it's a
    clean empty state), and tagging a work item with an existing release
    from the detail modal still works — an ordinary edit, not a manage-tier
    action.

All state is in memory — refreshing the page resets it to the seed above.

## Files

| File | What it is |
|---|---|
| `index.html` | Shell and every screen's markup, as `<template>` blocks |
| `css/app.css` | Visual system — same tokens and components as `../ui/`, extended for these new screens |
| `js/logic.js` | Pure rules — no DOM, no network. This file **is** the specs' permission matrix and hierarchy rules, executable |
| `js/store.js` | Mock data source. Enforces the same rules a real API would (see each spec's error table) |
| `js/app.js` | Views, hash routing, modals, and the interaction polish (skeleton loading, staggered row entrances, animated modal/toast lifecycle) |

## What to check when reviewing sub-project 3

- Is "custom statuses, no transition rules" (any status can move to any
  other) enough, or did you immediately want to restrict some moves (e.g.
  can't skip straight from To Do to Done)?
- Does the category system (To Do / In Progress / Done, many statuses per
  category) match how you'd actually want to organize a busier board, or
  does it feel like unnecessary structure for a small team?
- Is per-project the right scope, or did clicking through make you want
  different statuses for different item types (like 2b's Screens) or
  different boards within one project?
- Does "every category needs at least one status, always" read as a
  sensible guardrail or an annoying restriction once you hit it?
- Anything from the spec's data model or flows that reads wrong once
  you're actually clicking it, rather than reading it.

## What to check when reviewing sub-project 4

- Does free-text, self-serve label creation (anyone types a new one right
  on a work item, no approval step) feel right, or did you want it gated
  the way Statuses and Fields are?
- Is global (shared across every project) the right scope for a label, or
  did you want project-scoped labels instead, closer to how Components
  work?
- Does colour-coding by label help you scan a board, or is it just noise
  once there are more than a handful of labels in play?
- Is "rename/recolor/delete needs Owner of any project, but apply/create
  is open to any member" the right split, or should applying a label be
  restricted too?
- Anything from the spec's data model or flows that reads wrong once
  you're actually clicking it, rather than reading it.

## Sub-project 8 — Task Detail UX

50. **Open the Sprint Board and open `TASKY-1`** (the Epic). Scroll to the
    new **Attachments** section at the bottom of the modal — seeded with
    `spec.pdf`, uploaded by Asha. `TASKY-5` (the Bug) carries
    `screenshot.png` from Kabir, and `TASKY-3` (the Task) carries
    `design-notes.docx` from Lena — three different uploaders, on purpose,
    so every delete-permission case below is visible from the seed alone.
51. **Upload a file** via the picker at the bottom of the section, then
    Upload — it appears immediately with its real name, a human-readable
    size (e.g. "245 KB"), your name as uploader, and today's date, all read
    straight off the browser's own `File` object rather than typed in.
52. **Click Download on the file you just uploaded** — it's the real file,
    briefly downloadable again in this tab. **Click Download on a seeded
    example instead** (e.g. `spec.pdf`) — a toast explains there's no real
    file behind seed data in this prototype, since no bytes were ever
    actually picked for it.
53. **Sign in as `lena`** (a plain member of Tasky Redesign, not Owner or
    Admin) and open `TASKY-1` again — she can see `spec.pdf` but there's no
    Delete button on it, since she's neither its uploader (Asha) nor an
    Owner/Admin. Open `TASKY-3` instead, where she *is* the uploader
    (`design-notes.docx`) — Delete is there.
54. **Sign back in as `asha`** (Owner of Tasky Redesign) and open
    `TASKY-5` — `screenshot.png` was uploaded by Kabir, not Asha, but
    Delete still shows: an Owner/Admin can remove anyone's attachment, a
    deliberately wider rule than Comments get elsewhere in this tool.
    Delete it — gone immediately, with a confirmation toast.

## Sub-project 9 — Permissions & Admin

55. **Sign in as `kabir`** (a Site Admin, alongside his ordinary Admin/Owner
    project roles) and open **Admin** (top nav). All four seeded accounts
    are listed — including `priya`, a Site Admin with **no project
    memberships at all**, seeded specifically so the "is_staff widens
    management rights even with zero Owner roles" rule is visible without
    any setup. Notice kabir's own row has no Deactivate/Revoke-admin
    buttons — the self-lockout guard hides them before you can even try.
56. **Create an account** via the form — username, an initial password,
    optional name — then sign out and sign back in as that new username to
    confirm the account really works, no separate activation step.
57. **Deactivate the account you just created** from kabir's Admin list —
    it immediately shows an Inactive badge. Sign out and try logging in as
    that account — rejected with the same generic "Incorrect username or
    password" copy a wrong password gets, on purpose (a deactivated account
    shouldn't reveal it once existed). **Reactivate it** and confirm login
    works again.
58. **Revoke `priya`'s Site Admin status** from kabir's row for her — since
    kabir remains a Site Admin throughout, this is allowed (at least one
    always remains). Notice her Site Admin badge disappears immediately.
    **Grant it back** the same way.
59. **Sign in as `priya`** and open **Labels** — she can rename, recolor and
    delete labels despite owning zero projects, because Site Admin now
    satisfies the same "manage global resources" check Owners already had;
    nobody with an existing Owner role lost anything.
60. **Sign in as `asha`** (a plain user, not `is_staff`) and open **Admin**
    — a locked note, and nothing else: no partial user list, unlike
    Fields/Screens/Labels which stay readable for non-managers. This
    endpoint has no non-admin view at all.
61. **Open Tasky Redesign** (Asha is its Owner) and click **Archive
    project**. It's immediately tagged Archived on its own page. **Go back
    to Projects** — Tasky Redesign has dropped out of the default list.
    Tick **Show archived** — it reappears, still carrying its Archived
    badge in the list.
62. **Open the archived Tasky Redesign anyway** (from the "Show archived"
    list) and open one of its boards — everything is exactly as editable
    as before. Archiving is visibility-only here, not a write-block; full
    enforcement is flagged as a real, separate follow-up in the spec.
    **Unarchive it** from the project page to put it back.
63. **Sign in as `lena`** (a plain Member of Tasky Redesign, not Owner) and
    open that project — there's no Archive project button. Archiving is
    Owner-only, one tier stricter than the Owner/Admin split every other
    per-project manage action here uses.
