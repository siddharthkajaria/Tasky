# Statuses Management UI + Board Edit UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire two already-signed-off, backend-complete features into `ui/`: (A) per-project Work Item Statuses management (create, rename, recategorize, reorder, delete) on the project detail page, and (B) board rename + description edit on the board page.

**Architecture:** Unchanged four-way front-end split — `logic.js` (pure additions: role predicate, category vocabulary), `store.js` (mock mutations that reproduce the server's real invariants), `api.js` (thin `request()` wrappers, same names/signatures as `store.js`), `app.js` (render functions + DOM wiring only). Both features require **zero backend changes** — `WorkItemStatusViewSet` (`boards/views.py:744-863`) and `BoardViewSet.update()` (`boards/views.py:93-101`) already implement and test everything needed.

**Tech Stack:** Vanilla JS, no build step, no framework, no npm. Django serves `ui/` static files as-is.

**Spec:** `docs/api.md:235-249` (Statuses contract), `docs/api.md:52-73` (Boards contract), `boards/models.py:203-221` (`WorkItemStatus`/`Category`), `docs/superpowers/specs/2026-08-18-tasky-workflows-design.md`, `design/README.md` (signed-off walkthrough, Statuses section), `design/js/app.js:486-578` (`renderStatuses`/`statusRow` reference), `design/index.html:124-133` (Statuses markup reference).

## Global Constraints

- **No JS test framework will be added** — this repo has none, deliberately (no build step, no npm). Each task's "test" step is a manual check: pure `logic.js` additions get an ad-hoc `node -e "$(cat ui/static/js/logic.js); ..."` assertion one-liner; `api.js`/`store.js` additions get exercised from the browser devtools console (`Api`/`Store` are globals); `app.js`/markup/CSS changes get a manual browser click-through checklist, run once in mock mode (`?data=store`) and once against the real backend.
- **`make lint` must stay clean.** No Python is touched by either feature — run it once at the end to confirm (should be a no-op).
- **Git workflow:** branch off `main`, prefix `feat/`, PR-only merge into `main` (`.claude/rules/common/git-workflow.md`). This plan already lives on its own branch/worktree `feat/statuses-and-board-edit-ui`, separate from the in-flight `wave1-ui-wiring` and `feat/comment-editing` branches.
- **Conventional commits**, one per task.
- Every task touching `app.js` must leave `viewProject`/`viewBoard` working after a full page reload — no dangling references to removed DOM.
- **Board edit permission finding (overrides initial assumption):** `BoardViewSet` (`boards/views.py:73-101`) is gated only by `IsProjectMember` — no `can_manage_*` role check, unlike Components/Statuses. `boards/tests/test_board_api.py::test_a_board_can_be_renamed` renames a board as a plain member and passes. **Any project member can rename/re-describe a board today, by design** — Tasks B2/B3 must NOT gate the UI to Owner/Admin, since that would remove a capability the API already grants (this app's rule is "hide controls that would 403," never "invent restrictions the server doesn't have").

---

## Feature A — Per-project Statuses management

### Task 1 (A1): `logic.js` — status role predicate + category vocabulary

**Files:**
- Modify: `ui/static/js/logic.js` (after the `canManageComponents` line, ~line 35)

**Interfaces:**
- Produces: `Logic.CATEGORIES` (`['todo', 'in_progress', 'done']`), `Logic.CATEGORY_LABELS` (`{todo: 'To Do', in_progress: 'In Progress', done: 'Done'}`), `Logic.canManageStatuses(role)` → `role === 'owner' || role === 'admin'`
- Consumes: none

- [ ] **Step 1: Write the manual check (documents expected failure first)**

```bash
node -e "$(cat ui/static/js/logic.js); console.assert(typeof Logic.canManageStatuses === 'undefined' ? true : (()=>{throw new Error('should not exist yet')})())"
```

Run it now — it should confirm `Logic.canManageStatuses` does not exist yet.

- [ ] **Step 2: Add the code**

In `ui/static/js/logic.js`, immediately after the `canManageComponents` line and before the next section comment, insert:

```js
/* ---- Work item statuses / categories (sub-project 3, Workflows) ------ */

// Fixed, three-value vocabulary every status (built-in or custom) is
// tagged with — this is what "done-ness" logic keys off, not the status's
// name. Many statuses can share a category.
const CATEGORIES = ['todo', 'in_progress', 'done'];
const CATEGORY_LABELS = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

const canManageStatuses = (role) => role === 'owner' || role === 'admin';
```

Add `CATEGORIES, CATEGORY_LABELS, canManageStatuses,` to the `return { ... }` block, near `canManageComponents,`.

- [ ] **Step 3: Run the real check**

```bash
node -e "$(cat ui/static/js/logic.js); console.assert(Logic.canManageStatuses('admin')===true); console.assert(Logic.canManageStatuses('member')===false); console.assert(JSON.stringify(Logic.CATEGORIES)===JSON.stringify(['todo','in_progress','done'])); console.log('OK')"
```

Expected: prints `OK`, no assertion errors.

- [ ] **Step 4: Commit**

```bash
git add ui/static/js/logic.js
git commit -m "feat(statuses): add category vocabulary and manage-statuses predicate to logic.js"
```

---

### Task 2 (A2): `api.js` — create/update/delete status

**Files:**
- Modify: `ui/static/js/api.js` (Work item statuses block, near existing `listStatuses`)

**Interfaces:**
- Produces: `Api.createStatus(projectId, fields)`, `Api.updateStatus(projectId, id, fields)`, `Api.deleteStatus(projectId, id)`
- Consumes: existing `request()` helper; `docs/api.md:235-249`

- [ ] **Step 1: Manual pre-check**

With Django running (real API mode, not `?data=store`), sign in, open devtools console:

```js
Api.createStatus(1, {name: 'Blocked', category: 'in_progress'})
```

Expected: `TypeError: Api.createStatus is not a function` — confirms the gap.

- [ ] **Step 2: Add the code**

In `ui/static/js/api.js`'s statuses block, add:

```js
/* Work item statuses. Per-project and configurable (sub-project 3,
   Workflows) — not the fixed three-value enum the board used to assume.
   `status` on a work item is one of these ids, never a string. */
listStatuses: (projectId) => request(`/api/projects/${projectId}/statuses/`),
createStatus: (projectId, fields) => request(`/api/projects/${projectId}/statuses/`, { method: 'POST', body: fields }),
// `position` is accepted here too — a single PATCH with a new `position`
// is enough to reorder; the server clamps and renumbers every sibling in
// one transaction (see WorkItemStatusViewSet._reposition).
updateStatus: (projectId, id, fields) => request(`/api/projects/${projectId}/statuses/${id}/`, { method: 'PATCH', body: fields }),
deleteStatus: (projectId, id) => request(`/api/projects/${projectId}/statuses/${id}/`, { method: 'DELETE' }),
```

(Keep the existing `listStatuses` line — just add the three new ones next to it; don't duplicate.)

- [ ] **Step 3: Re-run the console check**

```js
await Api.createStatus(1, {name: 'Blocked', category: 'in_progress'})
```

Expected: resolves with `{id, project, name: 'Blocked', category: 'in_progress', position}`. Also check `Api.updateStatus(1, <id>, {position: 0})` and `Api.deleteStatus(1, <id>)` resolve/reject as documented — try deleting the last status in a category and confirm a 400 surfaces with the expected message in `err.data`.

- [ ] **Step 4: Commit**

```bash
git add ui/static/js/api.js
git commit -m "feat(statuses): add status create/update/delete to api.js"
```

---

### Task 3 (A3): `store.js` — mock create/update/delete status, mirroring server invariants

**Files:**
- Modify: `ui/static/js/store.js` (after `listStatuses`, and the exported object)

**Interfaces:**
- Produces: `Store.createStatus(projectId, fields)`, `Store.updateStatus(projectId, id, fields)`, `Store.deleteStatus(projectId, id)` — same names/signatures as Task A2's `Api.*`
- Consumes: `Logic.canManageStatuses`, `Logic.CATEGORIES`, `Logic.CATEGORY_LABELS` (Task A1); existing `statuses`/`statusesForProject`/`myRole`/`denied`/`fail`/`wait`/`id` plumbing

Design note: the real `WorkItemStatusViewSet.perform_destroy` also blocks deletion when an `AutomationRule` references the status. This mock has no automation-rule modeling at all today and automation isn't wired into `ui/` yet, so that guard is **out of scope** here — only "in use by work items" and "last status in category" are reproduced, since those are the only two guards reachable through the current mock's feature set.

- [ ] **Step 1: Manual pre-check**

With `?data=store`, devtools console:

```js
Store.createStatus(1, {name: 'Blocked', category: 'in_progress'})
```

Expected: `TypeError: Store.createStatus is not a function`.

- [ ] **Step 2: Add the code**

Immediately after `listStatuses` in `ui/static/js/store.js`, add:

```js
function createStatus(projectId, fields) {
  if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
  const role = myRole(projectId);
  if (!role) return denied();
  if (!Logic.canManageStatuses(role)) {
    return fail(403, { detail: "You don't have permission to manage this project's statuses." });
  }
  const clean = (fields.name || '').trim();
  if (!clean) return fail(400, { name: 'This field may not be blank.' });
  if (!Logic.CATEGORIES.includes(fields.category)) return fail(400, { category: 'Pick a category.' });
  if (statuses.some(s => s.project === Number(projectId) && s.name.toLowerCase() === clean.toLowerCase())) {
    return fail(400, { name: `"${clean}" already exists.` });
  }
  const status = {
    id: id(), project: Number(projectId), name: clean, category: fields.category,
    position: statusesForProject(projectId).length,
  };
  statuses.push(status);
  return wait(status);
}

// `position`, when present, reproduces the server's _reposition: pull this
// status out of its project's position-ordered siblings, clamp the target
// index to the sibling count, reinsert, then renumber everyone 0..n-1.
// Same algorithm as boards/views.py's WorkItemStatusViewSet._reposition.
function updateStatus(projectId, statusId, fields) {
  const status = statuses.find(s => s.id === Number(statusId) && s.project === Number(projectId));
  if (!status) return fail(404, { detail: 'Not found.' });
  const role = myRole(status.project);
  if (!role) return denied();
  if (!Logic.canManageStatuses(role)) {
    return fail(403, { detail: "You don't have permission to manage this project's statuses." });
  }

  if (fields.name !== undefined) {
    const clean = (fields.name || '').trim();
    if (!clean) return fail(400, { name: 'This field may not be blank.' });
    if (statuses.some(s => s.project === status.project && s.id !== status.id && s.name.toLowerCase() === clean.toLowerCase())) {
      return fail(400, { name: `"${clean}" already exists.` });
    }
    status.name = clean;
  }

  if (fields.category !== undefined && fields.category !== status.category) {
    const remaining = statuses.filter(s => s.project === status.project && s.category === status.category && s.id !== status.id);
    if (!remaining.length) {
      return fail(400, { category: `${Logic.CATEGORY_LABELS[status.category]} needs at least one status — recategorize another one first.` });
    }
    status.category = fields.category;
  }

  if (fields.position !== undefined) {
    const target = Math.max(0, Number(fields.position) || 0);
    const siblings = statusesForProject(status.project).filter(s => s.id !== status.id);
    const clamped = Math.min(target, siblings.length);
    siblings.splice(clamped, 0, status);
    siblings.forEach((s, i) => { s.position = i; });
  }

  return wait(status);
}

// Automation-rule-reference guard is intentionally NOT modeled here — this
// mock has no automation-rule data at all yet; only the two guards below
// are reachable through the current UI.
function deleteStatus(projectId, statusId) {
  const status = statuses.find(s => s.id === Number(statusId) && s.project === Number(projectId));
  if (!status) return fail(404, { detail: 'Not found.' });
  const role = myRole(status.project);
  if (!role) return denied();
  if (!Logic.canManageStatuses(role)) {
    return fail(403, { detail: "You don't have permission to manage this project's statuses." });
  }
  const inUse = workItems.filter(w => w.status === status.id);
  if (inUse.length) {
    return fail(400, { detail: `"${status.name}" is still used by ${inUse.length} work item${inUse.length === 1 ? '' : 's'}. Move ${inUse.length === 1 ? 'it' : 'them'} first.` });
  }
  const remaining = statuses.filter(s => s.project === status.project && s.category === status.category && s.id !== status.id);
  if (!remaining.length) {
    return fail(400, { detail: `${Logic.CATEGORY_LABELS[status.category]} needs at least one status.` });
  }
  statuses = statuses.filter(s => s.id !== status.id);
  statusesForProject(status.project).forEach((s, i) => { s.position = i; });
  return wait(null);
}
```

Add `createStatus, updateStatus, deleteStatus` to the exported object, alongside `listStatuses`.

- [ ] **Step 3: Re-run the console check plus invariant checks**

Create two statuses, delete one that's unused (succeeds), try deleting the last status in a category (fails with the exact message), rename to a duplicate name (fails), reorder via `Store.updateStatus(1, <id>, {position: 0})` and confirm via a follow-up `Store.listStatuses(1)` that sibling positions renumber correctly.

- [ ] **Step 4: Commit**

```bash
git add ui/static/js/store.js
git commit -m "feat(statuses): add status create/update/delete to store.js mock"
```

---

### Task 4 (A4): `index.html` + `app.css` — Statuses section markup and styles

**Files:**
- Modify: `ui/index.html` (`tpl-project`, between the Components and Members `<section>`s)
- Modify: `ui/static/js/app.js` (`viewProject`, skeleton line only)
- Modify: `ui/static/css/app.css`

**Interfaces:**
- Produces: `[data-statuses]`, `[data-create-status]`, `[data-category-select]`, `[data-status-note]` DOM hooks; CSS classes `.cat-dot`, `.cat-dot.cat-in_progress`, `.cat-dot.cat-done`, `.order-list`, `.order-row`, `.order-handle`, `.icon-btn`
- Consumes: none yet (pure markup/CSS — Task A5 wires it)

- [ ] **Step 1: Manual pre-check**

Load `ui/index.html` in the browser — confirm there is no Statuses section between Components and Members on a project page today.

- [ ] **Step 2: Add the markup**

In `ui/index.html`, between the Components `</section>` and the Members `<section>`, insert:

```html
<section>
  <h2 class="section-label">Statuses</h2>
  <p class="page-sub section-note" data-status-note></p>
  <ul class="order-list" data-statuses></ul>
  <form class="create-status" data-create-status novalidate hidden>
    <input name="name" placeholder="Status name" aria-label="Status name" required>
    <select name="category" aria-label="Category" data-category-select></select>
    <button class="btn" type="submit">Add</button>
  </form>
</section>
```

- [ ] **Step 3: Add the skeleton line**

In `ui/static/js/app.js`'s `viewProject`, alongside the existing skeleton lines for boards/components/members, add:

```js
main.querySelector('[data-statuses]').innerHTML = skeletonList(2);
```

- [ ] **Step 4: Add the CSS**

In `ui/static/css/app.css`, near the `.component-row` rules, add:

```css
/* Workflow status categories (sub-project 3) — same three colours the
   board's columns use, pulled out as standalone dots for the Statuses
   management list. */
.cat-dot {
  display: inline-block;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--rule-2);
}
.cat-dot.cat-in_progress { background: var(--accent); }
.cat-dot.cat-done { background: var(--ink-3); }

/* An ordered list a human hand-sorts — the Statuses management list. */
.order-list { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 6px; }
.order-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--sunk);
  border-radius: var(--r);
  padding: 6px 8px 6px 4px;
  font-size: 12.5px;
  animation: row-in .18s var(--ease-out) both;
}
.order-row .label { flex: 1; }
.order-row .label[contenteditable] { border-radius: 2px; padding: 1px 4px; margin: -1px -4px; }
.order-row .label[contenteditable]:hover,
.order-row .label[contenteditable]:focus { background: var(--surface); outline: none; }
.order-row .btn-danger { padding: 2px 8px; font-size: 11px; }

.order-handle { display: flex; flex-direction: column; gap: 1px; }
.icon-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink-3);
  border-radius: 2px;
  line-height: 1;
  padding: 0 4px;
  font-size: 9px;
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.icon-btn:hover:not([disabled]) { background: var(--surface); color: var(--ink); }
.icon-btn[disabled] { opacity: .3; cursor: default; }
```

Before pasting, confirm `--rule-2`, `--accent`, `--ink-3`, `--sunk`, `--r`, `--ease-out`, `--surface` all already exist as custom properties in `ui/static/css/app.css` (verify by grep — most already do, per `componentRow`'s use of `--sunk`). Add any missing one, matching whatever value `design/css/app.css` defines for it, rather than inventing a new value.

- [ ] **Step 5: Visual check**

Confirm in the browser: the Statuses section renders (empty list, hidden form) with no console errors, sitting between Components and Members, no layout break.

- [ ] **Step 6: Commit**

```bash
git add ui/index.html ui/static/js/app.js ui/static/css/app.css
git commit -m "feat(statuses): add Statuses section markup and styles"
```

---

### Task 5 (A5): `app.js` — `renderStatuses` + `statusRow` (list, create, rename, recategorize, reorder, delete)

**Files:**
- Modify: `ui/static/js/app.js` (`viewProject` call site; new functions after `componentRow`)

**Interfaces:**
- Produces: `renderStatuses(main, project)`, `statusRow(status, i, all, main, project)`
- Consumes: `data.listStatuses`, `data.createStatus`, `data.updateStatus`, `data.deleteStatus` (Tasks A2/A3); `Logic.canManageStatuses`, `Logic.CATEGORIES`, `Logic.CATEGORY_LABELS` (Task A1); markup from Task A4; existing `esc`, `toast`, `handle`, `skeletonList`, `stagger`, `errorState` helpers

- [ ] **Step 1: Manual pre-check**

In the browser (mock mode), open a project page as an Owner — the Statuses section (from A4) is present but inert: no rows render, create form does nothing.

- [ ] **Step 2: Wire the call site**

In `viewProject`, add the call between `renderComponents` and `renderMembers`:

```js
renderComponents(main, project);
renderStatuses(main, project);
renderMembers(main, project);
```

- [ ] **Step 3: Add the code**

Immediately after `componentRow`'s closing `}`, add:

```js
/* Statuses (sub-project 3, Workflows) ----------------------------------
   These ARE the board's columns — an ordered, hand-sorted list so
   reordering, renaming and recategorizing all read as one idea. */

async function renderStatuses(main, project) {
  const list = main.querySelector('[data-statuses]');
  const form = main.querySelector('[data-create-status]');
  const note = main.querySelector('[data-status-note]');
  const canManage = Logic.canManageStatuses(project.my_role);

  note.textContent = canManage
    ? 'The board’s columns for this project, in order. Each of To Do, In Progress and Done needs at least one status.'
    : 'The board’s columns for this project, in order. Owner and Admins manage the list.';

  const categorySelect = form.querySelector('[data-category-select]');
  categorySelect.innerHTML = Logic.CATEGORIES.map(c =>
    `<option value="${c}">${Logic.CATEGORY_LABELS[c]}</option>`
  ).join('');

  if (!form.dataset.wired) {
    form.dataset.wired = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.querySelector('[name=name]');
      const btn = e.target.querySelector('button');
      if (!input.value.trim()) return;
      btn.disabled = true;
      try {
        await data.createStatus(project.id, { name: input.value, category: categorySelect.value });
        input.value = '';
        toast('Status added');
        await renderStatuses(main, project);
      } catch (err) {
        handle(err);
      } finally {
        btn.disabled = false;
      }
    });
  }
  form.hidden = !canManage;

  list.innerHTML = skeletonList(2);
  try {
    const statuses = await data.listStatuses(project.id);
    const rows = statuses.map((s, i) => statusRow(s, i, statuses, main, project));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, () => renderStatuses(main, project));
  }
}

function statusRow(status, i, all, main, project) {
  const canManage = Logic.canManageStatuses(project.my_role);
  const last = i === all.length - 1;
  const li = document.createElement('li');
  li.className = 'order-row';
  li.innerHTML =
    (canManage
      ? `<span class="order-handle">` +
          `<button class="icon-btn" type="button" data-up ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>` +
          `<button class="icon-btn" type="button" data-down ${last ? 'disabled' : ''} aria-label="Move down">▼</button>` +
        `</span>`
      : '') +
    `<span class="cat-dot cat-${esc(status.category)}"></span>` +
    `<span class="label"${canManage ? ' contenteditable="true" role="textbox" aria-label="Status name" data-rename' : ''}>${esc(status.name)}</span>` +
    (canManage
      ? `<select data-category aria-label="Category for ${esc(status.name)}">${Logic.CATEGORIES.map(c =>
          `<option value="${c}" ${c === status.category ? 'selected' : ''}>${Logic.CATEGORY_LABELS[c]}</option>`
        ).join('')}</select>`
      : `<span class="hint" style="margin:0">${Logic.CATEGORY_LABELS[status.category]}</span>`) +
    (canManage ? `<button class="btn btn-danger" type="button" data-remove>Delete</button>` : '');

  const run = async (fn) => {
    try {
      await fn();
      await renderStatuses(main, project);
    } catch (err) { handle(err); }
  };

  const up = li.querySelector('[data-up]');
  if (up) up.addEventListener('click', () => run(() => data.updateStatus(project.id, status.id, { position: i - 1 })));
  const down = li.querySelector('[data-down]');
  if (down) down.addEventListener('click', () => run(() => data.updateStatus(project.id, status.id, { position: i + 1 })));

  const remove = li.querySelector('[data-remove]');
  if (remove) remove.addEventListener('click', () => {
    if (!confirm(`Delete the "${status.name}" status? It must not be in use, and its category must keep at least one other status.`)) return;
    run(() => data.deleteStatus(project.id, status.id));
  });

  const categoryEl = li.querySelector('[data-category]');
  if (categoryEl) {
    categoryEl.addEventListener('change', () => run(() => data.updateStatus(project.id, status.id, { category: categoryEl.value })));
  }

  const nameEl = li.querySelector('[data-rename]');
  if (nameEl) {
    nameEl.addEventListener('blur', async () => {
      const value = nameEl.textContent.trim();
      if (!value || value === status.name) { nameEl.textContent = status.name; return; }
      try {
        await data.updateStatus(project.id, status.id, { name: value });
        status.name = value;
        toast('Status renamed');
      } catch (err) {
        nameEl.textContent = status.name;
        handle(err);
      }
    });
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
      if (e.key === 'Escape') { nameEl.textContent = status.name; nameEl.blur(); }
    });
  }
  return li;
}
```

**Reorder design note:** `boards/tests/test_work_item_statuses_api.py::test_reordering_a_status` proves a single `PATCH {position: n}` on the moved status is sufficient — the server pulls it out of the position-ordered sibling list, clamps `n`, reinserts, and renumbers everyone 0..n-1 in one transaction (`boards/views.py:806-824`, `_reposition`). So the up/down handlers above send one PATCH with `position: i - 1` / `position: i + 1` — no swap-via-two-PATCHes, no separate `moveStatus` function needed.

- [ ] **Step 4: Browser verification checklist**

Run once in mock mode (`?data=store`), once against the real backend:

- As Owner/Admin: Statuses section shows seeded statuses with dots colored by category; create form visible.
- Add a new status — appears at the end, dot color matches category.
- Rename via blur — persists; Escape reverts without saving; Enter commits.
- Change category via select — succeeds when another status remains in the old category; when it's the last one, the 400 message surfaces via toast.
- Click ▲/▼ — status moves; buttons disable correctly at both ends; order persists across reload.
- Delete an unused status — succeeds, list renumbers.
- Delete a status in use by a work item — blocked, exact "is still used by N work item(s)" message.
- Delete the last status in a category — blocked, exact "needs at least one status" message.
- As a plain Member: no ▲▼/rename/select/delete/create-form controls render; note text says "Owner and Admin manage the list."

- [ ] **Step 5: Commit**

```bash
git add ui/static/js/app.js
git commit -m "feat(statuses): render and wire Statuses management list in project detail"
```

---

## Feature B — Board edit (rename + description)

### Task 6 (B1): `api.js` + `store.js` — `updateBoard(id, fields)`

**Files:**
- Modify: `ui/static/js/api.js` (Boards block)
- Modify: `ui/static/js/store.js` (after `createBoard`, and the exported object)

**Interfaces:**
- Produces: `Api.updateBoard(id, fields)`, `Store.updateBoard(id, fields)` — same name/signature in both
- Consumes: `docs/api.md:52-73`; existing `boardById`/`myRole`/`denied`/`fail`/`wait`/`now`/`boardOut` plumbing in `store.js`

- [ ] **Step 1: Manual pre-check**

In both mock and real modes, devtools console: `Api.updateBoard` / `Store.updateBoard` are `undefined` today.

- [ ] **Step 2: Add to `api.js`**

In the Boards block, after `createBoard`, add:

```js
updateBoard: (id, fields) => request(`/api/boards/${id}/`, { method: 'PATCH', body: fields }),
```

- [ ] **Step 3: Add to `store.js`**

Immediately after `createBoard`, add:

```js
// `project` is never sent by this UI (rename/description are the only
// fields it writes) — if a caller ever did send it unchanged, the real
// API accepts that; only an actual attempted move is rejected, mirrored
// here for parity.
function updateBoard(boardId, fields) {
  const board = boardById(boardId);
  if (!board) return fail(404, { detail: 'Not found.' });
  if (!myRole(board.project)) return denied();
  if ('project' in fields && Number(fields.project) !== board.project) {
    return fail(400, { project: 'Boards cannot be moved between projects.' });
  }
  if (fields.name !== undefined) {
    if (!fields.name || !fields.name.trim()) return fail(400, { name: 'This field may not be blank.' });
    board.name = fields.name.trim();
  }
  if (fields.description !== undefined) {
    board.description = fields.description;
  }
  board.updated_at = now();
  return wait(boardOut(board));
}
```

Add `updateBoard` to the exported object, next to `createBoard`.

- [ ] **Step 4: Re-run the console check**

`Store.updateBoard(<id>, {name: 'Renamed'})` / `Api.updateBoard(<id>, {description: 'x'})` resolve with the updated board; blank name rejected with 400; renaming as a non-member of that board's project rejected with 403.

- [ ] **Step 5: Commit**

```bash
git add ui/static/js/api.js ui/static/js/store.js
git commit -m "feat(boards): add updateBoard to api.js and store.js"
```

---

### Task 7 (B2): `app.js` + `app.css` — board name contenteditable rename

**Files:**
- Modify: `ui/static/js/app.js` (`viewBoard`)
- Modify: `ui/static/css/app.css`

**Interfaces:**
- Produces: contenteditable behavior on `[data-board-name]`
- Consumes: `data.updateBoard` (Task B1); existing `handle`, `toast`, `esc` helpers

- [ ] **Step 1: Manual pre-check**

On a board page today, `[data-board-name]` is plain text — not focusable, not editable.

- [ ] **Step 2: Add the code**

In `viewBoard`, replace the line that sets `[data-board-name]`'s `textContent` with:

```js
const nameEl = main.querySelector('[data-board-name]');
nameEl.textContent = board.name;
// Any project member may rename a board — BoardViewSet has no
// can_manage_* role gate, unlike Components/Statuses (verified against
// boards/views.py and boards/tests/test_board_api.py). Reaching this
// page at all already proves membership, so no extra permission check.
nameEl.contentEditable = 'true';
nameEl.setAttribute('role', 'textbox');
nameEl.setAttribute('aria-label', 'Board name');
nameEl.addEventListener('blur', async () => {
  const value = nameEl.textContent.trim();
  if (!value || value === board.name) { nameEl.textContent = board.name; return; }
  try {
    const updated = await data.updateBoard(board.id, { name: value });
    board.name = updated.name;
    toast('Board renamed');
  } catch (err) {
    nameEl.textContent = board.name;
    handle(err);
  }
});
nameEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
  if (e.key === 'Escape') { nameEl.textContent = board.name; nameEl.blur(); }
});
```

No `dataset.wired` guard needed — `viewBoard` replaces the entire `tpl-board` clone on every navigation, so there is never a stale listener to double-bind.

In `ui/static/css/app.css`, near `.board-head`, add:

```css
.board-head [contenteditable] { border-radius: 2px; padding: 1px 4px; margin: -1px -4px; cursor: text; }
.board-head [contenteditable]:hover,
.board-head [contenteditable]:focus { background: var(--sunk); outline: none; }
```

- [ ] **Step 3: Browser verification**

As any project member (test a plain Member, not just Owner/Admin, given the permission finding above): click the board title, edit, blur — persists, toast shown. Escape reverts without a network call. Enter commits same as blur.

- [ ] **Step 4: Commit**

```bash
git add ui/static/js/app.js ui/static/css/app.css
git commit -m "feat(boards): make board name contenteditable, wired to updateBoard"
```

---

### Task 8 (B3): `app.js` + `app.css` — board description contenteditable edit

**Files:**
- Modify: `ui/static/js/app.js` (`viewBoard`)
- Modify: `ui/static/css/app.css`

**Interfaces:**
- Produces: contenteditable behavior on `[data-board-desc]`, including an empty-state placeholder
- Consumes: `data.updateBoard` (Task B1); same idiom as Task B2

- [ ] **Step 1: Manual pre-check**

Today, `[data-board-desc]` is removed entirely from the DOM when a board has no description, so there is no way to add one, and no way to edit an existing one.

- [ ] **Step 2: Add the code**

In `viewBoard`, replace the `if (board.description) desc.textContent = ...; else desc.remove();` block with:

```js
const descEl = main.querySelector('[data-board-desc]');
descEl.textContent = board.description || '';
descEl.dataset.placeholder = 'Add a description…';
descEl.contentEditable = 'true';
descEl.setAttribute('role', 'textbox');
descEl.setAttribute('aria-label', 'Board description');
descEl.addEventListener('blur', async () => {
  const value = descEl.textContent.trim();
  if (value === (board.description || '')) { descEl.textContent = board.description || ''; return; }
  try {
    const updated = await data.updateBoard(board.id, { description: value });
    board.description = updated.description;
    toast('Description updated');
  } catch (err) {
    descEl.textContent = board.description || '';
    handle(err);
  }
});
descEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); descEl.blur(); }
  if (e.key === 'Escape') { descEl.textContent = board.description || ''; descEl.blur(); }
});
```

Single-line commit-on-Enter, matching every other contenteditable field in this app (including the comment body).

In `ui/static/css/app.css`, add:

```css
.board-head [data-board-desc]:empty::before {
  content: attr(data-placeholder);
  color: var(--ink-3);
}
```

- [ ] **Step 3: Browser verification**

A board with an existing description shows it, editable. A board with no description shows the greyed "Add a description…" placeholder, is clickable/focusable, and typing + blur saves it. Deleting all text and blurring reverts to the placeholder (confirm the real API accepts an empty string for `description`, since it's `blank=True`).

- [ ] **Step 4: Commit**

```bash
git add ui/static/js/app.js ui/static/css/app.css
git commit -m "feat(boards): make board description contenteditable, wired to updateBoard"
```

---

## Final verification (both features)

- [ ] `make lint` — confirm clean (no Python touched; should be a no-op)
- [ ] Full manual regression pass on the project page and a board page, both as Owner/Admin and as a plain Member, in both `?data=store` mock mode and against a real backend session — covering every checklist item from A5, B2, B3 in one continuous pass
- [ ] `git log --oneline` on the branch — confirm each commit is independently revertable (Feature A's 5 commits don't depend on Feature B's 3, and vice versa)
- [ ] Push branch, open PR against `main`
