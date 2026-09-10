# Tasky Wave 1 UI Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all 11 "Wave 1" backend features — already built, tested, and signed off in `design/` — into the production `ui/`, closing the gap where `ui/` implements 6 screens against a backend that supports 11.

**Architecture:** Each phase adds one feature end to end through the existing four-way split (`logic.js` pure rules → `store.js` mock, same interface → `api.js` real, same interface → `app.js` views/routing/wiring), following `design/`'s already-signed-off UX for that feature adapted to real API calls. No new files, no build step, no framework — new screens are new `<template>` blocks in `ui/index.html`, new routes in `app.js`'s `route()`, new styles in `ui/static/css/app.css` reusing the existing token set.

**Tech Stack:** Vanilla JS (ES2020+, no transpiler), vanilla CSS, Django template serving `ui/index.html`, DRF backend (already built — this plan does not add backend endpoints except Phase 3's one write-block fix).

**Spec:** This plan implements Wave 1 of `docs/superpowers/plans/2026-09-08-tasky-jira-parity-roadmap.md` (§3.1, §6) against the per-sub-project designs registered in `design/README.md` (specs for sub-projects 2b, 3, 4, 6, 7, 8, 9's archive rule, 10, 11 — see each phase). `docs/api.md` is the authoritative API contract; re-read the relevant section before implementing a phase if anything here seems to disagree with it — the live contract wins.

## Global Constraints

- **No npm, no build step, no framework.** Every file here is plain `.js`/`.css`/`.html`, loaded via `<script src>`/`<link>` tags. (`CLAUDE.md`)
- **Assets live under `ui/static/`, not `ui/`.** New CSS goes in `ui/static/css/app.css`; new JS in the existing `ui/static/js/*.js` files. Template markup goes in `ui/index.html` directly (it is not under `static/`). (`ui/README.md`)
- **The four-way split is load-bearing.** `logic.js` stays pure (no DOM, no network) — every new predicate/constant goes there. `store.js` and `api.js` must keep the exact same method names and return shapes; `app.js` never checks which one is active. (`.claude/rules/common/coding-style.md`)
- **CSS custom properties only** — reuse `var(--paper)`, `var(--surface)`, `var(--ink)`, `var(--ink-2)`, `var(--ink-3)`, `var(--rule)`, `var(--rule-2)`, `var(--accent)`, `var(--accent-w)`, `var(--danger)`, `var(--danger-w)`, `var(--mono)`, `var(--r)`. Never a raw hex value. (`brand-guidelines.md`)
- **No JS test framework exists in this repo** (confirmed: no `package.json`, no `jest.config.*`, nothing) and none is being added. Every task below is verified **manually**: run `make run`, open the exact URL/screen named in the step, perform the exact action, and confirm the result against `docs/api.md`'s documented response shape and against `design/`'s already-signed-off behavior for the same flow. The one exception is Phase 3's backend write-block fix, which is a Django/DRF change and gets a real `pytest` test per `.claude/rules/python/testing.md`.
- **Re-check `docs/api.md` before trusting this plan's description of an endpoint's shape.** The doc is the contract; this plan transcribes it as of 2026-09-09, but if a step's assumption turns out stale, the doc wins — fix the step, not the doc.
- **Branching:** work happens on one feature branch, `feat/wave1-ui-wiring`, off `main`, per `.claude/rules/common/git-workflow.md` — `main` takes merges only through a PR, and a single branch keeps the 11 phases' file-history readable as one linear story (later phases touch the same shared functions in `app.js` — e.g. `openWorkItemModal`, `workItemCard` — that earlier phases in this same plan already changed, which would be awkward to coordinate across separate branches/PRs). Commit after each task, exactly as this plan lists them; open the PR once all 11 phases are done and `make test` / `make lint` are clean.
- **Coverage floor:** `make test-coverage` must stay ≥ 98%. This plan's frontend work adds no Python, so it cannot regress this on its own; Phase 3's new backend code must carry its own test (see that phase).
- **`make lint` must stay clean** after every phase — it only touches Python, so JS-only phases are a no-op for it, but Phase 3 must pass it.

---

## Phase 1 — Status / workflow management UI

Closes Wave 1 item **W1.1** (roadmap §6, size S). Backend: `GET/POST /api/projects/{id}/statuses/`, `PATCH/DELETE /api/projects/{id}/statuses/{id}/` (`docs/api.md` "Work Item Statuses"). Design reference: `design/js/app.js` `renderStatuses`/`statusRow` (lines 486–578), `design/index.html` `tpl-project`'s Statuses section (lines 124–133), `design/css/app.css` `.order-list`/`.order-row`/`.icon-btn`/`.cat-dot` (lines 785–789, 1108–1142). Spec: `docs/superpowers/specs/2026-08-18-tasky-workflows-design.md` (sub-project 3, signed off — see `design/README.md`).

Every project already has statuses (the board already reads them via `Api.listStatuses`/`Store.listStatuses`, both of which already exist in production `ui/`) — what's missing is the ability to add, rename, reorder, recategorize, and delete one. This phase adds that as a new section on the project page, gated to Owner/Admin exactly like Components already is.

### Task 1.1: `logic.js` — categories and the manage predicate

**Files:**
- Modify: `ui/static/js/logic.js:1-11` (top of file, before the `Logic` IIFE's first section) and its `return` block at the end (`ui/static/js/logic.js:195-205`)

**Interfaces:**
- Produces: `Logic.CATEGORIES` (`string[]`, `['todo', 'in_progress', 'done']`), `Logic.CATEGORY_LABELS` (`{[category]: string}`), `Logic.canManageStatuses(role)` (`(string) => boolean`)

- [ ] **Step 1: Add the category constants and predicate**

Insert this new section right after the existing `/* ---- Priorities -------------------------------------------------------- */` block (after line 10, before the `/* ---- Project roles ... */` comment at line 12) in `ui/static/js/logic.js`:

```javascript
  /* ---- Workflow status categories (sub-project 3) ------------------------
     Fixed, three-value vocabulary every status (built-in or custom) is
     tagged with. Many statuses can share a category — "Blocked" and "In
     Review" might both be tagged in_progress alongside "In Progress"
     itself. The board's column styling already keys off `status.category`
     (see `columnEl` in app.js), never off a status's name. */
  const CATEGORIES = ['todo', 'in_progress', 'done'];
  const CATEGORY_LABELS = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

  const canManageStatuses = (role) => role === 'owner' || role === 'admin';

```

- [ ] **Step 2: Export the new names**

In the `return { ... }` block at the end of `ui/static/js/logic.js`, add `CATEGORIES, CATEGORY_LABELS, canManageStatuses,` on its own line right after the existing `ROLE_LABEL,` line, so the block reads:

```javascript
  return {
    PRIORITY_LABELS,
    ROLE_LABEL,
    CATEGORIES, CATEGORY_LABELS, canManageStatuses,
    canInvite, canRemove, canChangeRole,
    canTransferOwnership, canDeleteProject, canLeave, canManageComponents,
    ITEM_TYPES, ITEM_TYPE_LABEL, VALID_PARENT_TYPES,
    requiresParent, canHaveParent, isValidParent, parentCandidates,
    groupByStatus, findItem, applyMove, removeItem, moveWorkItem,
    isOverdue, dueLabel, today, editableWorkItemFields,
  };
```

- [ ] **Step 3: Manual verification**

Open the browser console on any page of the app (`make run`, sign in, open dev tools) and run:

```javascript
Logic.CATEGORIES              // ['todo', 'in_progress', 'done']
Logic.canManageStatuses('owner')   // true
Logic.canManageStatuses('member')  // false
```

Expected: no console errors, values match.

- [ ] **Step 4: Commit**

```bash
git add ui/static/js/logic.js
git commit -m "$(cat <<'EOF'
feat(ui): add status category constants and manage predicate to logic.js

Foundation for the Statuses admin section — mirrors design/js/logic.js's
CATEGORIES/canManageStatuses exactly, per sub-project 3's signed-off spec.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 1.2: `api.js` and `store.js` — status CRUD methods

**Files:**
- Modify: `ui/static/js/api.js:91-95` (the existing `listStatuses` comment/line)
- Modify: `ui/static/js/store.js:75-101` (status seed helpers) and its `return { ... }` block (`ui/static/js/store.js:765-777`)

**Interfaces:**
- Consumes: `Logic.canManageStatuses` (Task 1.1)
- Produces: `Api.createStatus(projectId, {name, category})`, `Api.updateStatus(projectId, id, fields)`, `Api.deleteStatus(projectId, id)` (all `Promise`); matching `Store.*` with the identical signatures and same-shaped rejections as every other mock method in the file (`fail(status, data)` / `wait(value)`). There is deliberately no `moveStatus` — see below.

- [ ] **Step 1: Add the three CRUD methods to `api.js`**

`docs/api.md`'s "Work Item Statuses" section only documents `POST`/`PATCH`/`DELETE` — there's no reorder action; reordering is a `PATCH {position}` per status. `updateStatus`/`deleteStatus` need both the *project* id and the *status* id, since the real path is `/api/projects/{project_id}/statuses/{status_id}/` (`boards/urls.py`'s `path("projects/<int:project_pk>/statuses/<int:pk>/", ...)`), not just the status id. Replace the existing single-line `listStatuses` entry in the returned object in `ui/static/js/api.js` (currently line 94) with this four-method block:

```javascript
    /* Work item statuses. Per-project and configurable (sub-project 3,
       Workflows) — not the fixed three-value enum the board used to assume.
       `status` on a work item is one of these ids, never a string. */
    listStatuses:  (projectId)             => request(`/api/projects/${projectId}/statuses/`),
    createStatus:  (projectId, fields)     => request(`/api/projects/${projectId}/statuses/`, { method: 'POST', body: fields }),
    updateStatus:  (projectId, id, fields) => request(`/api/projects/${projectId}/statuses/${id}/`, { method: 'PATCH', body: fields }),
    deleteStatus:  (projectId, id)         => request(`/api/projects/${projectId}/statuses/${id}/`, { method: 'DELETE' }),
```

Reordering has no dedicated endpoint — `PATCH {position}` is how the spec exposes it (`docs/api.md`: "PATCH accepts `{name, category, position}`"). `app.js` (Task 1.3) implements "move up/down" as two `updateStatus` calls swapping the adjacent pair's `position` values, so no separate `moveStatus` API method is needed — this differs from the `design/` prototype's mock-only `moveStatus(id, direction)` convenience method, which doesn't correspond to any real endpoint.

- [ ] **Step 2: Add matching mock methods to `store.js`**

In `ui/static/js/store.js`, the existing status helpers (around line 80-101: `seedDefaultStatuses`, `statusesForProject`, `statusById`, `defaultStatusId`) already give everything needed. Add these functions right after `listStatuses` (which currently ends at line 465, just before `/* ---- work items ------------------------------------------------------ */`):

```javascript
  function createStatus(projectId, fields) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(projectId);
    if (!role) return denied();
    if (!Logic.canManageStatuses(role)) return fail(403, { detail: "You don't have permission to manage statuses." });
    if (!fields.name || !fields.name.trim()) return fail(400, { name: 'This field may not be blank.' });
    if (!Logic.CATEGORIES.includes(fields.category)) {
      return fail(400, { category: `"${fields.category}" is not a valid choice.` });
    }
    const siblings = statusesForProject(projectId);
    const status = {
      // Reuses the single shared `nextStatusId` counter `seedDefaultStatuses`
      // already advances on every project creation — a second, forked
      // counter here would diverge from it over time (each project created
      // after this file loads bumps the real counter but not a snapshot
      // taken once at module load) and eventually assign a duplicate id.
      id: ++nextStatusId, project: Number(projectId),
      name: fields.name.trim(), category: fields.category, position: siblings.length,
    };
    statuses.push(status);
    return wait(status);
  }

  function updateStatus(projectId, statusId, fields) {
    const status = statusById(statusId);
    if (!status || status.project !== Number(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(status.project);
    if (!role) return denied();
    if (!Logic.canManageStatuses(role)) return fail(403, { detail: "You don't have permission to manage statuses." });

    if ('category' in fields && fields.category !== status.category) {
      if (!Logic.CATEGORIES.includes(fields.category)) {
        return fail(400, { category: `"${fields.category}" is not a valid choice.` });
      }
      const remainingInOldCategory = statusesForProject(status.project)
        .filter(s => s.id !== status.id && s.category === status.category);
      if (!remainingInOldCategory.length) {
        return fail(400, { category: `${Logic.CATEGORY_LABELS[status.category]} needs at least one status.` });
      }
    }
    if ('name' in fields) {
      if (!fields.name || !fields.name.trim()) return fail(400, { name: 'This field may not be blank.' });
      status.name = fields.name.trim();
    }
    if ('category' in fields) status.category = fields.category;
    if ('position' in fields) status.position = Number(fields.position);
    return wait(status);
  }

  function deleteStatus(projectId, statusId) {
    const status = statusById(statusId);
    if (!status || status.project !== Number(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(status.project);
    if (!role) return denied();
    if (!Logic.canManageStatuses(role)) return fail(403, { detail: "You don't have permission to manage statuses." });

    const inUse = workItems.filter(w => w.status === status.id).length;
    if (inUse) {
      return fail(400, { detail: `"${status.name}" is still used by ${inUse} work item(s). Move them first.` });
    }
    const remainingInCategory = statusesForProject(status.project)
      .filter(s => s.id !== status.id && s.category === status.category);
    if (!remainingInCategory.length) {
      return fail(400, { detail: `${Logic.CATEGORY_LABELS[status.category]} needs at least one status.` });
    }
    statuses = statuses.filter(s => s.id !== status.id);
    statusesForProject(status.project).forEach((s, i) => { s.position = i; });
    return wait(null);
  }
```

- [ ] **Step 3: Export the new mock methods**

In `ui/static/js/store.js`'s final `return { ... }` block, change the existing `listBoards, getBoard, createBoard, getBoardWorkItems, listStatuses,` line to:

```javascript
    listBoards, getBoard, createBoard, getBoardWorkItems,
    listStatuses, createStatus, updateStatus, deleteStatus,
```

- [ ] **Step 4: Manual verification**

With `make run` up, append `?data=store` to the URL, sign in as `asha` (any password). In the browser console:

```javascript
await Store.createStatus(1, { name: 'In Review', category: 'in_progress' })
// → {id: <n>, project: 1, name: 'In Review', category: 'in_progress', position: 3}
await Store.updateStatus(1, <that id>, { name: 'Reviewing' })
// → same object, name updated
await Store.deleteStatus(1, <that id>)
// → null (204-equivalent)
await Store.createStatus(1, { name: '', category: 'todo' })
// → rejects with {status: 400, data: {name: 'This field may not be blank.'}}
```

Then switch off mock mode (drop `?data=store`, reload, sign in for real) and repeat against the live API — same shapes, confirmed against `docs/api.md`.

- [ ] **Step 5: Commit**

```bash
git add ui/static/js/api.js ui/static/js/store.js
git commit -m "$(cat <<'EOF'
feat(ui): add status create/update/delete to the API and mock clients

Reorder has no dedicated endpoint — app.js will implement it as two
PATCH {position} calls swapping an adjacent pair, per docs/api.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 1.3: `index.html` template + `app.css` styles

**Files:**
- Modify: `ui/index.html:82-124` (the `tpl-project` template)
- Modify: `ui/static/css/app.css` (append new rules at the end of the file, before the `@media (prefers-reduced-motion: reduce)` block at line 872)

**Interfaces:**
- Produces: a `<section>` inside `tpl-project` with `data-statuses`, `data-create-status`, and a `data-category-select` inside the create form; CSS classes `.order-list`, `.order-row`, `.order-handle`, `.icon-btn`, `.cat-dot`, `.cat-dot.cat-todo`/`.cat-in_progress`/`.cat-done`.

- [ ] **Step 1: Add the Statuses section to `tpl-project`**

In `ui/index.html`, insert this new `<section>` right after the existing Components `</section>` (currently ending at line 117) and before the Members `<section>` (currently starting at line 119):

```html
    <section>
      <h2 class="section-label">Statuses</h2>
      <p class="page-sub section-note">The board's columns for this project, in order. Owner and Admins manage the list — each of To Do, In Progress and Done needs at least one status.</p>
      <ul class="order-list" data-statuses></ul>
      <form class="create-status" data-create-status novalidate hidden>
        <input name="name" placeholder="Status name" aria-label="Status name" required>
        <select name="category" aria-label="Category" data-category-select></select>
        <button class="btn" type="submit">Add</button>
      </form>
    </section>
```

- [ ] **Step 2: Add the CSS**

Append to `ui/static/css/app.css`, right before the `/* Responsive ---------------------------------------------------------- */` comment (currently at line 857):

```css
/* Statuses (sub-project 3) --------------------------------------------- */

.create-status[hidden] { display: none; }
.create-status { display: flex; gap: 8px; margin: 0 0 8px; }
.create-status input {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 7px 10px;
}
.create-status select {
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 7px 9px;
  cursor: pointer;
}

/* Ordered lists a human hand-sorts: this phase's statuses, and later
   phases' field options and screen fields (Phase 5) — one row shape so
   "reorder" reads as one idea everywhere it appears. */
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
.order-row select {
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 3px 6px;
  font-size: 11px;
}
.order-row .hint { margin: 0; font-size: 11px; color: var(--ink-3); }

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

/* Same three colours the board's own columns use (.column-active /
   .column-done), pulled out as standalone dots for this list. */
.cat-dot {
  display: inline-block;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--rule-2);
}
.cat-dot.cat-in_progress { background: var(--accent); }
.cat-dot.cat-done { background: var(--ink-3); }
```

- [ ] **Step 3: Manual verification**

Open `ui/index.html` in a text viewer (or `make run` + view-source) and confirm the new `<section>` sits between Components and Members, and that `ui/static/css/app.css`'s new block doesn't collide with any existing selector (`grep -c "\.order-list {" ui/static/css/app.css` must print `1`).

- [ ] **Step 4: Commit**

```bash
git add ui/index.html ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): add Statuses section markup and styles to the project page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 1.4: `app.js` — render the Statuses section

**Files:**
- Modify: `ui/static/js/app.js:363-366` (`viewProject`'s render call sequence)
- Modify: `ui/static/js/app.js` — new functions inserted after `renderComponents`/`componentRow` (after line 552, before the `/* Members -------------------------------------------------------------- */` comment at line 554)

**Interfaces:**
- Consumes: `Logic.CATEGORIES`, `Logic.CATEGORY_LABELS`, `Logic.canManageStatuses` (Task 1.1); `data.listStatuses`, `data.createStatus`, `data.updateStatus`, `data.deleteStatus` (Task 1.2); `skeletonList`, `stagger`, `esc`, `toast`, `handle` (existing `app.js` helpers)
- Produces: `renderStatuses(main, project)`, called from `viewProject`

- [ ] **Step 1: Wire the render call into `viewProject`**

In `ui/static/js/app.js`, change:

```javascript
  renderProjectActions(main, project);
  renderBoards(main, project);
  renderComponents(main, project);
  renderMembers(main, project);
}
```

to:

```javascript
  renderProjectActions(main, project);
  renderBoards(main, project);
  renderComponents(main, project);
  renderStatuses(main, project);
  renderMembers(main, project);
}
```

- [ ] **Step 2: Add `renderStatuses` and `statusRow`**

Insert after `componentRow`'s closing `}` (after line 552):

```javascript
/* Statuses (sub-project 3) ---------------------------------------------- */

async function renderStatuses(main, project) {
  const list = main.querySelector('[data-statuses]');
  const form = main.querySelector('[data-create-status]');
  const canManage = Logic.canManageStatuses(project.my_role);
  form.hidden = !canManage;
  list.innerHTML = skeletonList(3);

  const categorySelect = form.querySelector('[data-category-select]');
  categorySelect.replaceChildren(...Logic.CATEGORIES.map(c => new Option(Logic.CATEGORY_LABELS[c], c)));

  if (!form.dataset.wired) {
    form.dataset.wired = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = form.querySelector('[name=name]');
      const btn = form.querySelector('button');
      if (!nameInput.value.trim()) return;
      btn.disabled = true;
      try {
        await data.createStatus(project.id, { name: nameInput.value, category: categorySelect.value });
        nameInput.value = '';
        toast('Status added');
        await renderStatuses(main, project);
      } catch (err) {
        handle(err);
      } finally {
        btn.disabled = false;
      }
    });
  }

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
          `<button class="icon-btn" data-up ${i === 0 ? 'disabled' : ''} aria-label="Move up" type="button">▲</button>` +
          `<button class="icon-btn" data-down ${last ? 'disabled' : ''} aria-label="Move down" type="button">▼</button>` +
        `</span>`
      : '') +
    `<span class="cat-dot cat-${esc(status.category)}"></span>` +
    `<span class="label" ${canManage ? 'contenteditable="true" data-rename' : ''}>${esc(status.name)}</span>` +
    (canManage
      ? `<select data-category aria-label="Category for ${esc(status.name)}">${Logic.CATEGORIES.map(c =>
          `<option value="${c}" ${c === status.category ? 'selected' : ''}>${Logic.CATEGORY_LABELS[c]}</option>`
        ).join('')}</select>`
      : `<span class="hint">${Logic.CATEGORY_LABELS[status.category]}</span>`) +
    (canManage ? `<button class="btn btn-danger" data-remove type="button">Delete</button>` : '');

  const refresh = () => renderStatuses(main, project);

  const up = li.querySelector('[data-up]');
  if (up) up.addEventListener('click', async () => {
    const other = all[i - 1];
    try {
      await data.updateStatus(project.id, status.id, { position: other.position });
      await data.updateStatus(project.id, other.id, { position: status.position });
      await refresh();
    } catch (err) { handle(err); }
  });
  const down = li.querySelector('[data-down]');
  if (down) down.addEventListener('click', async () => {
    const other = all[i + 1];
    try {
      await data.updateStatus(project.id, status.id, { position: other.position });
      await data.updateStatus(project.id, other.id, { position: status.position });
      await refresh();
    } catch (err) { handle(err); }
  });
  const remove = li.querySelector('[data-remove]');
  if (remove) remove.addEventListener('click', async () => {
    if (!confirm(`Delete "${status.name}"?`)) return;
    try {
      await data.deleteStatus(project.id, status.id);
      toast('Status deleted');
      await refresh();
    } catch (err) { handle(err); }
  });

  const categoryEl = li.querySelector('[data-category]');
  if (categoryEl) {
    const previous = status.category;
    categoryEl.addEventListener('change', async () => {
      try {
        await data.updateStatus(project.id, status.id, { category: categoryEl.value });
        toast('Status recategorized');
        await refresh();
      } catch (err) {
        categoryEl.value = previous;
        handle(err);
      }
    });
  }

  const labelEl = li.querySelector('[data-rename]');
  if (labelEl) {
    labelEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); labelEl.blur(); }
      if (e.key === 'Escape') { labelEl.textContent = status.name; labelEl.blur(); }
    });
    labelEl.addEventListener('blur', async () => {
      const value = labelEl.textContent.trim();
      if (!value || value === status.name) { labelEl.textContent = status.name; return; }
      try {
        await data.updateStatus(project.id, status.id, { name: value });
        status.name = value;
        toast('Status renamed');
      } catch (err) {
        labelEl.textContent = status.name;
        handle(err);
      }
    });
  }
  return li;
}

```

Reordering swaps two statuses' `position` values via two sequential `updateStatus` calls (no dedicated reorder endpoint exists — see Task 1.2, Step 1). This mirrors the "lock before read" carefulness this codebase applies elsewhere only in spirit, not in a literal sense: worst case under a race, a concurrent reorder from another tab produces a visually-off order that a page reload corrects (the same class of eventual-consistency gap `position` gaps already tolerate elsewhere per `docs/api.md`).

- [ ] **Step 3: Manual verification**

`make run`, sign in, open a project you own (or admin). Confirm:
1. A "Statuses" section appears between Components and Members, showing the 3 seeded statuses (To Do / In Progress / Done) with coloured dots (grey / red / muted).
2. As a Member (not Owner/Admin) on a different project, the section shows the same list with no controls and no create form.
3. Add a status named "In Review" with category "In Progress" — it appears at the bottom of the list.
4. Click ▲ on it — it moves up one row; reload the page — the new order persists.
5. Rename it by clicking its name, typing, and pressing Enter — persists on reload.
6. Try deleting a status that's in use on the board (e.g. "To Do", if any seeded item sits in it) — a toast shows the exact `docs/api.md`-documented message ("... is still used by N work item(s). Move them first.").
7. Delete "In Review" (unused) — it disappears, and the remaining statuses' order is unaffected.
8. Try recategorizing the last remaining "Done"-category status to something else — rejected with the exact "Done needs at least one status." message.

- [ ] **Step 4: Commit**

```bash
git add ui/static/js/app.js
git commit -m "$(cat <<'EOF'
feat(ui): wire the Statuses admin section into the project page

Closes Wave 1 item W1.1 — status create/rename/reorder/recategorize/
delete, gated to Owner/Admin, matching design/'s signed-off sub-project 3
prototype.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

---

## Phase 2 — Labels administration UI

Closes Wave 1 item **W1.2** (roadmap §6, size S). Backend: `GET /api/labels/`, `GET/PATCH/DELETE /api/labels/{id}/`, plus the `labels` write-only field on `POST`/`PATCH /api/work-items/` (`docs/api.md` "Labels" and the `labels` paragraph under "Work Items"). Design reference: `design/js/app.js` `viewLabels`/`paintLabels`/`labelRow` (lines 1746–1840) and `labelChipInput` (lines 1848–1899), `design/index.html` `tpl-labels` (lines 266–276), `design/css/app.css` `.label-admin-list`/`.label-admin-row`/`.label-chip*`/`.label-input-block` (lines 691–758). Spec: `docs/superpowers/specs/2026-08-18-tasky-labels-design.md` (sub-project 4, signed off).

This phase is wider than "an admin CRUD screen" on its own: a Labels admin page that manages labels nobody can ever apply to a work item is not a usable feature. `docs/api.md` makes label *application* part of the ordinary work-item write path (`labels: ["urgent", ...]`, names not ids, invents-on-write) — so this phase also adds the labels block to the work item modal, matching what `design/`'s sub-project 4 prototype actually shipped as one feature.

### Task 2.1: `logic.js` — the label palette and color hashing

**Files:**
- Modify: `ui/static/js/logic.js` (new section + `return` block)

**Interfaces:**
- Produces: `Logic.LABEL_PALETTE` (`string[]`, 8 hex colors), `Logic.colorForLabelName(name)` (`(string) => string`, deterministic hash into the palette — used by the chip-input widget to preview a new label's color before the server assigns one on save)

- [ ] **Step 1: Add the palette and hash function**

`docs/api.md`: *"`color` must be one of the 8 hex colors in the fixed palette."* The actual 8 values aren't listed in the doc (server-side only) — use the same 8 the `design/` prototype ships, confirmed in `design/js/store.js`'s `LABEL_PALETTE` constant. Add this section to `ui/static/js/logic.js`, after the new Statuses section from Phase 1 and before `/* ---- Project roles ... */`:

```javascript
  /* ---- Labels (sub-project 4) --------------------------------------------
     The 8-color palette every Label's `color` must be one of, and a
     deterministic name→color hash so a brand-new label (not yet round-
     tripped through the server) still previews a plausible color in the
     chip-input widget before save. The server picks the real color the
     same deterministic way when a name is first invented on a work item
     write — this only needs to be *a* valid palette color, not necessarily
     the exact one the server will assign, since the chip re-reads the
     server's `labels_detail` on the next load either way. */
  const LABEL_PALETTE = [
    '#E4362C', '#D97C1F', '#C9A227', '#4E9A51',
    '#2E8B8B', '#3B6FB6', '#7C5CBF', '#B23D82',
  ];
  function colorForLabelName(name) {
    let hash = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return LABEL_PALETTE[hash % LABEL_PALETTE.length];
  }

```

- [ ] **Step 2: Export**

Add `LABEL_PALETTE, colorForLabelName,` to the `return { ... }` block, after the `CATEGORIES, CATEGORY_LABELS, canManageStatuses,` line added in Phase 1.

- [ ] **Step 3: Manual verification**

Console: `Logic.LABEL_PALETTE.length === 8` → `true`. `Logic.colorForLabelName('urgent')` returns one of the 8 hex strings, and calling it twice with the same name returns the same color both times.

- [ ] **Step 4: Commit**

```bash
git add ui/static/js/logic.js
git commit -m "$(cat <<'EOF'
feat(ui): add label palette and deterministic color hash to logic.js

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 2.2: `api.js` and `store.js` — label admin methods

**Files:**
- Modify: `ui/static/js/api.js` (append to the returned object, after `listUsers`/`myTasks`)
- Modify: `ui/static/js/store.js` — new module-level `labels` array + seed, new functions, `return` block

**Interfaces:**
- Consumes: `Logic.LABEL_PALETTE`, `Logic.colorForLabelName` (Task 2.1)
- Produces: `Api.listLabels()`, `Api.renameLabel(id, name)`, `Api.recolorLabel(id, color)`, `Api.deleteLabel(id)`; matching `Store.*`. Also extends the existing `Store.createWorkItem`/`Store.updateWorkItem` to accept and resolve a `labels: string[]` field (names, matching the real API), and adds `Store.listLabels`'s backing seed data.

- [ ] **Step 1: `api.js`**

Add to the returned object, right after the existing `listUsers: () => request('/api/users/'),` line:

```javascript

    /* Labels ------------------------------------------------------------- */
    listLabels:   ()             => request('/api/labels/'),
    renameLabel:  (id, name)     => request(`/api/labels/${id}/`, { method: 'PATCH', body: { name } }),
    recolorLabel: (id, color)    => request(`/api/labels/${id}/`, { method: 'PATCH', body: { color } }),
    deleteLabel:  (id)           => request(`/api/labels/${id}/`, { method: 'DELETE' }),
```

There is deliberately no `Api.createLabel` — per `docs/api.md`, labels are only ever created implicitly by naming one in a work item's `labels` write; `renameLabel`/`recolorLabel` send whichever of `name`/`color` changed, matching the existing pattern elsewhere in this file (e.g. `renameComponent`) of one PATCH call per concern rather than one combined "updateLabel(fields)".

- [ ] **Step 2: `store.js` — seed data and label CRUD**

Add a `labels` seed array near the top of `ui/static/js/store.js`, right after the `let components = [...]` block (currently ending at line 73):

```javascript

  let labels = [
    { id: id(), name: 'urgent', color: Logic.colorForLabelName('urgent') },
    { id: id(), name: 'needs-design', color: Logic.colorForLabelName('needs-design') },
  ];
  const labelById = (lid) => labels.find(l => l.id === Number(lid)) || null;
  /* Case-insensitive, matching the real API's resolve-or-create rule for
     the `labels` field on a work item write. */
  const labelByName = (name) => labels.find(l => l.name.toLowerCase() === String(name).trim().toLowerCase()) || null;

  /* Resolves a list of label NAMES (as the `labels` work-item field takes)
     into Label rows, creating any that don't exist yet — same behavior
     `docs/api.md` documents for the real endpoint, including the "two
     names differing only by case collapse to one" and "blank name fails
     the whole write" rules. Returns `{ ids, error }`; `error` is set (and
     `ids` is empty) if any name in the list is blank.

     Blank-checked in its own pass, before any label is created — creating
     labels while scanning in one pass would let a genuinely-new name
     earlier in the array get permanently created even when a later blank
     name in that same array correctly fails the whole write. */
  function resolveLabelNames(names) {
    const list = names || [];
    if (list.some(raw => !String(raw).trim())) {
      return { ids: [], error: { labels: "A label name can't be blank." } };
    }
    const seen = new Set();
    const ids = [];
    for (const raw of list) {
      const trimmed = String(raw).trim();
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let label = labelByName(trimmed);
      if (!label) {
        label = { id: id(), name: trimmed, color: Logic.colorForLabelName(trimmed) };
        labels.push(label);
      }
      ids.push(label.id);
    }
    return { ids, error: null };
  }
```

Then add the CRUD functions right after `listUsers`/before `myTasks` (currently `ui/static/js/store.js` lines 746-763):

```javascript

  /* ---- labels ------------------------------------------------------------ */

  const listLabels = () => wait(labels.slice().sort((a, b) => a.name.localeCompare(b.name)));

  /* Governance is deliberately NOT project-scoped — the caller only needs to
     be an Owner of *some* project, matching docs/api.md exactly (labels are
     global, and renaming/recoloring/deleting is a wider-blast-radius action
     gated separately from ordinary label use). */
  function isOwnerOfAnyProject() {
    return memberships.some(m => m.user === me.id && m.role === 'owner');
  }

  function renameLabel(labelId, name) {
    const label = labelById(labelId);
    if (!label) return fail(404, { detail: 'Not found.' });
    if (!isOwnerOfAnyProject()) return fail(403, { detail: "You don't have access to this project." });
    if (!name || !name.trim()) return fail(400, { name: 'This field may not be blank.' });
    const trimmed = name.trim();
    if (labels.some(l => l.id !== label.id && l.name.toLowerCase() === trimmed.toLowerCase())) {
      return fail(400, { name: `"${trimmed}" already exists.` });
    }
    label.name = trimmed;
    return wait(label);
  }

  function recolorLabel(labelId, color) {
    const label = labelById(labelId);
    if (!label) return fail(404, { detail: 'Not found.' });
    if (!isOwnerOfAnyProject()) return fail(403, { detail: "You don't have access to this project." });
    if (!Logic.LABEL_PALETTE.includes(color)) {
      return fail(400, { color: `"${color}" is not one of the available colors.` });
    }
    label.color = color;
    return wait(label);
  }

  function deleteLabel(labelId) {
    const label = labelById(labelId);
    if (!label) return fail(404, { detail: 'Not found.' });
    if (!isOwnerOfAnyProject()) return fail(403, { detail: "You don't have access to this project." });
    labels = labels.filter(l => l.id !== label.id);
    workItems.forEach(w => { w.labels = (w.labels || []).filter(lid => lid !== label.id); });
    return wait(null);
  }
```

- [ ] **Step 3: Thread `labels` through work item create/update/output**

`itemOut` (the work-item serializer) needs a `labels_detail` field, matching `docs/api.md`'s "the full nested `{id, name, color}` `Label` objects." Change `itemOut` (currently `ui/static/js/store.js` lines 220-229) from:

```javascript
  function itemOut(w) {
    return Object.assign({}, w, {
      assignee_detail: w.assignee ? userById(w.assignee) : null,
      created_by: userById(w.created_by),
      priority_label: Logic.PRIORITY_LABELS[w.priority],
      parent_detail: w.parent ? summaryOut(itemById(w.parent)) : null,
      components_detail: components.filter(c => w.components.includes(c.id)),
      status_detail: statusById(w.status),
    });
  }
```

to:

```javascript
  function itemOut(w) {
    return Object.assign({}, w, {
      assignee_detail: w.assignee ? userById(w.assignee) : null,
      created_by: userById(w.created_by),
      priority_label: Logic.PRIORITY_LABELS[w.priority],
      parent_detail: w.parent ? summaryOut(itemById(w.parent)) : null,
      components_detail: components.filter(c => w.components.includes(c.id)),
      labels_detail: labels.filter(l => (w.labels || []).includes(l.id)),
      status_detail: statusById(w.status),
    });
  }
```

The `seed()` helper (used by every seeded work item) already spreads `Object.assign({ ... }, o)` with a fixed set of defaults; add `labels: [],` to that default object (`ui/static/js/store.js`, in `function seed(o) { const item = Object.assign({ ... }, o); ... }`, currently:

```javascript
    const item = Object.assign({
      description: '', status: P1_TODO, priority: 2, due_date: null, assignee: null,
      parent: null, position: 0, components: [], created_by: 1,
      created_at: now(), updated_at: now(),
    }, o);
```

becomes:

```javascript
    const item = Object.assign({
      description: '', status: P1_TODO, priority: 2, due_date: null, assignee: null,
      parent: null, position: 0, components: [], labels: [], created_by: 1,
      created_at: now(), updated_at: now(),
    }, o);
```

In `createWorkItem` (`ui/static/js/store.js`, currently lines 485-517), add label resolution right before the final `seed({...})` call — change:

```javascript
    const siblings = workItems.filter(w => w.board === board.id && w.status === status);
    const item = seed({
      id: id(), key: `${projectById(board.project).key}-${itemCounters[board.project]++}`,
      board: board.id, item_type: itemType, title: fields.title.trim(),
      description: fields.description || '', status, position: siblings.length,
      priority: fields.priority || 2, due_date: fields.due_date || null,
      assignee: fields.assignee || null, parent: parent ? parent.id : null,
      components: fields.components || [], created_by: me.id,
    });
    return wait(itemOut(item));
```

to:

```javascript
    let labelIds = [];
    if (fields.labels && fields.labels.length) {
      const resolved = resolveLabelNames(fields.labels);
      if (resolved.error) return fail(400, resolved.error);
      labelIds = resolved.ids;
    }
    const siblings = workItems.filter(w => w.board === board.id && w.status === status);
    const item = seed({
      id: id(), key: `${projectById(board.project).key}-${itemCounters[board.project]++}`,
      board: board.id, item_type: itemType, title: fields.title.trim(),
      description: fields.description || '', status, position: siblings.length,
      priority: fields.priority || 2, due_date: fields.due_date || null,
      assignee: fields.assignee || null, parent: parent ? parent.id : null,
      components: fields.components || [], labels: labelIds, created_by: me.id,
    });
    return wait(itemOut(item));
```

In `updateWorkItem` (`ui/static/js/store.js`, currently lines 519-571), add label handling right before the final `item.updated_at = now();` line — change:

```javascript
    if ('title' in fields) item.title = String(fields.title).trim();
    ['description', 'priority', 'due_date'].forEach(f => { if (f in fields) item[f] = fields[f]; });
    if ('assignee' in fields) item.assignee = fields.assignee ? Number(fields.assignee) : null;
    if ('priority' in fields) item.priority = Number(fields.priority);
    if (newParent !== undefined) item.parent = newParent ? newParent.id : null;
    item.updated_at = now();
```

to:

```javascript
    if ('title' in fields) item.title = String(fields.title).trim();
    ['description', 'priority', 'due_date'].forEach(f => { if (f in fields) item[f] = fields[f]; });
    if ('assignee' in fields) item.assignee = fields.assignee ? Number(fields.assignee) : null;
    if ('priority' in fields) item.priority = Number(fields.priority);
    if (newParent !== undefined) item.parent = newParent ? newParent.id : null;
    if ('labels' in fields) {
      // PATCH replaces the full label set — matching docs/api.md exactly,
      // unlike `components` which the UI always sends in full anyway.
      const resolved = resolveLabelNames(fields.labels);
      if (resolved.error) return fail(400, resolved.error);
      item.labels = resolved.ids;
    }
    item.updated_at = now();
```

- [ ] **Step 4: Export**

In the final `return { ... }` block, add `listLabels, renameLabel, recolorLabel, deleteLabel,` on its own line, right after `listLinks, createLink, deleteLink,`.

- [ ] **Step 5: Manual verification**

`?data=store`, console:

```javascript
await Store.listLabels()   // 2 seeded labels, sorted by name
await Store.createWorkItem({ board: 11, item_type: 'task', title: 'x', labels: ['urgent', 'Urgent', 'new-one'] })
// labels_detail has exactly 2 entries: "urgent" (reused, case-insensitive) and "new-one" (created)
await Store.renameLabel(<urgent's id>, '')
// rejects 400 {name: 'This field may not be blank.'}
await Store.deleteLabel(<new-one's id>)
// null; re-fetching that same work item's labels_detail now has 1 entry
```

Repeat the read-only checks (`listLabels`, and label display on an existing item) against the live API once Task 2.4 wires the UI, since `renameLabel`/`recolorLabel`/`deleteLabel` require being an Owner of a real seeded project — use an account that is (per `ui/README.md`, create teammates via `/admin/` locally, or use the `make run` dev flow's superuser).

- [ ] **Step 6: Commit**

```bash
git add ui/static/js/api.js ui/static/js/store.js
git commit -m "$(cat <<'EOF'
feat(ui): add label admin methods and thread labels through work items

Labels are global and created implicitly on a work-item write, per
docs/api.md — no createLabel exists on purpose.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 2.3: Nav link, route, and the standalone Labels admin screen

**Files:**
- Modify: `ui/index.html:44-56` (`tpl-shell` nav) — add the Labels link, and append a new `tpl-labels` template after `tpl-my-tasks` (currently ending at line 159, before the `<script>` tags at line 161)
- Modify: `ui/static/js/app.js:184-201` (`route()`)
- Modify: `ui/static/js/app.js` — new `viewLabels`/`paintLabels`/`labelRow` functions, inserted after `viewMyTasks`/`taskRow` (after line 1462, before `boot();`)
- Modify: `ui/static/css/app.css` — append label admin + chip styles

**Interfaces:**
- Consumes: `data.listLabels`, `data.renameLabel`, `data.recolorLabel`, `data.deleteLabel` (Task 2.2); `Logic.LABEL_PALETTE` (Task 2.1); `me` (existing global — used to check `me.id` against project ownerships, via a new helper)
- Produces: `viewLabels()`, reachable at `#/labels`

- [ ] **Step 1: Nav link**

In `ui/index.html`'s `tpl-shell`, change:

```html
    <nav class="nav">
      <a href="#/projects" data-nav="projects">Projects</a>
      <a href="#/my-tasks" data-nav="my-tasks">My tasks</a>
    </nav>
```

to:

```html
    <nav class="nav">
      <a href="#/projects" data-nav="projects">Projects</a>
      <a href="#/my-tasks" data-nav="my-tasks">My tasks</a>
      <a href="#/labels" data-nav="labels">Labels</a>
    </nav>
```

- [ ] **Step 2: `tpl-labels` template**

Append right after `tpl-my-tasks`'s closing `</template>` (currently line 159) and before the `<script src="/static/js/logic.js">` line:

```html

<template id="tpl-labels">
  <div class="page page-narrow">
    <div class="page-head">
      <h1>Labels</h1>
      <p class="page-sub">Global — the same list, shared and reused across every project. Anyone tags a work item with a new label right on the item; there's no "create" button here. Owners of any project can rename, recolor, or delete one from this list.</p>
    </div>
    <p class="locked-note" data-locked hidden></p>

    <ul class="label-admin-list" data-list></ul>
  </div>
</template>
```

- [ ] **Step 3: Route**

In `route()`, add the `/labels` branch right before the final `setActiveNav('projects'); viewProjects();` fallback:

```javascript
  if (hash === '/labels') { setActiveNav('labels'); return viewLabels(); }

  setActiveNav('projects');
  viewProjects();
```

(replacing the existing bare `setActiveNav('projects'); viewProjects();` two-line tail).

- [ ] **Step 4: `viewLabels`/`paintLabels`/`labelRow`**

Append after `taskRow`'s closing `}` (after line 1462, before `boot();`):

```javascript
/* Labels admin (sub-project 4) ------------------------------------------ */

function isOwnerOfAnyProject(projects) {
  return (projects || []).some(p => p.my_role === 'owner');
}

async function viewLabels() {
  const main = outlet();
  main.replaceChildren(tpl('tpl-labels'));

  const list = main.querySelector('[data-list]');
  const locked = main.querySelector('[data-locked]');
  list.innerHTML = skeletonList(3);

  let projects;
  try { projects = await data.listProjects(); } catch (err) { list.innerHTML = ''; return handle(err); }
  const canManage = isOwnerOfAnyProject(projects);

  if (!canManage) {
    locked.hidden = false;
    locked.textContent =
      'Only a project Owner can rename, recolor or delete a label — Owner of any project counts. ' +
      'Anyone can still apply an existing label, or create a new one, right on a work item.';
  }

  await paintLabels(list, canManage);
}

async function paintLabels(list, canManage) {
  list.innerHTML = skeletonList(3);
  try {
    const labels = await data.listLabels();
    if (!labels.length) {
      list.innerHTML = '<li class="empty">No labels yet. Type one onto a work item to create it.</li>';
      return;
    }
    const rows = labels.map(l => labelRow(l, list, canManage));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, () => paintLabels(list, canManage));
  }
}

function labelRow(label, list, canManage) {
  const li = document.createElement('li');
  li.className = 'label-admin-row';

  li.innerHTML =
    (canManage
      ? `<button class="swatch-btn" data-swatch style="background:${esc(label.color)}" aria-label="Change color" type="button"></button>`
      : `<span class="swatch" style="background:${esc(label.color)}"></span>`) +
    `<span class="name" ${canManage ? 'contenteditable="true" data-rename' : ''}>${esc(label.name)}</span>` +
    (canManage ? `<span class="actions"><button class="btn btn-danger" data-delete>Delete</button></span>` : '');

  const nameEl = li.querySelector('[data-rename]');
  if (nameEl) {
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
      if (e.key === 'Escape') { nameEl.textContent = label.name; nameEl.blur(); }
    });
    nameEl.addEventListener('blur', async () => {
      const value = nameEl.textContent.trim();
      if (!value || value === label.name) { nameEl.textContent = label.name; return; }
      try {
        await data.renameLabel(label.id, value);
        label.name = value;
        toast('Label renamed');
      } catch (err) {
        nameEl.textContent = label.name;
        handle(err);
      }
    });
  }

  const swatchBtn = li.querySelector('[data-swatch]');
  if (swatchBtn) {
    swatchBtn.addEventListener('click', async () => {
      const options = Logic.LABEL_PALETTE;
      const next = options[(options.indexOf(label.color) + 1) % options.length];
      try {
        await data.recolorLabel(label.id, next);
        label.color = next;
        swatchBtn.style.background = next;
      } catch (err) { handle(err); }
    });
  }

  const deleteBtn = li.querySelector('[data-delete]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete "${label.name}"? It comes off every work item using it.`)) return;
      try {
        await data.deleteLabel(label.id);
        toast(`"${label.name}" deleted`);
        await paintLabels(list, true);
      } catch (err) { handle(err); }
    });
  }

  return li;
}

/* Label chip-input — a reusable widget for the work item create form and
   detail modal (wired into both in Task 2.4). Free-text: press Enter or
   "," to turn the current input value into a chip, backed by a
   <datalist> of existing label names for autocomplete. Names, not ids —
   the server resolves each one to a Label (creating it if new) on save. */
function labelChipInput(initialNames, allLabels) {
  const names = (initialNames || []).slice();
  const wrap = document.createElement('div');
  wrap.className = 'label-input-block';

  const datalistId = `label-options-${Math.random().toString(36).slice(2)}`;
  wrap.innerHTML =
    `<div class="label-chip-list" data-chips></div>` +
    `<input type="text" class="label-input" list="${datalistId}" placeholder="Add a label…" aria-label="Add a label">` +
    `<datalist id="${datalistId}">${
      (allLabels || []).map(l => `<option value="${esc(l.name)}">`).join('')
    }</datalist>`;

  const chipList = wrap.querySelector('[data-chips]');
  const input = wrap.querySelector('.label-input');

  function colorFor(name) {
    const match = (allLabels || []).find(l => l.name.toLowerCase() === name.toLowerCase());
    return match ? match.color : Logic.colorForLabelName(name);
  }

  function paintChips() {
    chipList.replaceChildren(...names.map(name => {
      const chip = document.createElement('span');
      chip.className = 'label-chip';
      chip.style.background = colorFor(name);
      chip.innerHTML = `${esc(name)}<button type="button" data-remove aria-label="Remove ${esc(name)}">×</button>`;
      chip.querySelector('[data-remove]').addEventListener('click', () => {
        const i = names.indexOf(name);
        if (i !== -1) names.splice(i, 1);
        paintChips();
      });
      return chip;
    }));
  }

  function addFromInput() {
    const clean = input.value.trim();
    input.value = '';
    if (!clean) return;
    if (!names.some(n => n.toLowerCase() === clean.toLowerCase())) names.push(clean);
    paintChips();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addFromInput(); }
  });
  input.addEventListener('blur', addFromInput);

  paintChips();
  return { el: wrap, getNames: () => names.slice() };
}

```

- [ ] **Step 5: CSS**

Append to `ui/static/css/app.css`, after Phase 1's Statuses block:

```css
/* Labels (sub-project 4) ------------------------------------------------- */

.label-admin-list { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 7px; }
.label-admin-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: var(--r);
  padding: 9px 14px;
  animation: row-in .22s var(--ease-out) both;
}
.label-admin-row .swatch,
.label-admin-row .swatch-btn {
  width: 16px; height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
  border: none;
  padding: 0;
}
.label-admin-row .swatch-btn { cursor: pointer; }
.label-admin-row .swatch-btn:hover { outline: 2px solid var(--rule-2); outline-offset: 2px; }
.label-admin-row .name { flex: 1; font-weight: 500; }
.label-admin-row .name[contenteditable] { border-radius: 2px; padding: 1px 4px; margin: -1px -4px; }
.label-admin-row .name[contenteditable]:hover,
.label-admin-row .name[contenteditable]:focus { background: var(--sunk); outline: none; }
.label-admin-row .actions { display: flex; align-items: center; gap: 6px; }
.label-admin-row .btn { padding: 4px 9px; font-size: 12px; }

/* Label chips — free-text tags, colour-coded, distinct from the
   checkbox-style .chip-check used for Components (a fixed list to toggle
   on/off) since a label chip is typed and can be removed outright. */
.label-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 999px;
  padding: 3px 5px 3px 10px;
  font-size: 12px;
  color: #fff;
}
.label-chip button {
  all: unset;
  cursor: pointer;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 50%;
  opacity: .85;
}
.label-chip button:hover { opacity: 1; background: rgba(255, 255, 255, .2); }
.label-chip-sm { padding: 1px 8px; font-size: 10px; }

.card-labels { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }

.label-input-block { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.label-chip-list { display: flex; flex-wrap: wrap; gap: 6px; }
.label-input-block .label-input {
  width: auto;
  border: 1px solid var(--rule-2);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  background: var(--surface);
  min-width: 120px;
}
.label-input-block .label-input:focus { border-color: var(--accent); outline: none; }

.locked-note {
  color: var(--ink-2);
  background: var(--sunk);
  border-radius: var(--r);
  padding: 9px 12px;
  margin-bottom: 12px;
  font-size: 12.5px;
}
```

- [ ] **Step 6: Manual verification**

`make run`, sign in. Click "Labels" in the top nav — lands on `#/labels`, list shows any labels already invented via work items, or the empty state if none exist yet. As an Owner of at least one project: click a swatch to cycle its color, click a name to rename it, delete one. As a plain Member everywhere: the page shows the same list with no controls and the locked-note explaining why.

- [ ] **Step 7: Commit**

```bash
git add ui/index.html ui/static/js/app.js ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): add the standalone Labels admin screen and chip-input widget

Reachable at #/labels. The chip-input widget is wired into the work item
modal in the next task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 2.4: Wire labels into the work item card and detail modal

**Files:**
- Modify: `ui/static/js/app.js` — `workItemCard` (lines 887-930), `openWorkItemModal` (lines 1075-1252)

**Interfaces:**
- Consumes: `labelChipInput`, `data.listLabels` (Task 2.3)
- Produces: label chips visible on every board card; a Labels block in the work item modal that saves alongside every other field

- [ ] **Step 1: Show label chips on the card**

In `workItemCard`, change:

```javascript
  const components = (item.components_detail || []).length
    ? `<span class="comp-chips">${item.components_detail.map(c => `<span class="comp-chip">${esc(c.name)}</span>`).join('')}</span>`
    : '';

  el.innerHTML =
    `<div class="wi-top">` +
      `<span class="key-pill">${esc(item.key)}</span>` +
      `<span class="type-badge type-${esc(item.item_type)}">${esc(Logic.ITEM_TYPE_LABEL[item.item_type] || item.item_type)}</span>` +
    `</div>` +
    `<p class="card-title">${esc(item.title)}</p>` +
    components +
    (parent || due || who ? `<div class="card-meta">${parent}${due}${who}</div>` : '');
```

to:

```javascript
  const components = (item.components_detail || []).length
    ? `<span class="comp-chips">${item.components_detail.map(c => `<span class="comp-chip">${esc(c.name)}</span>`).join('')}</span>`
    : '';
  const labelChips = (item.labels_detail || []).length
    ? `<div class="card-labels">${item.labels_detail.map(l =>
        `<span class="label-chip label-chip-sm" style="background:${esc(l.color)}">${esc(l.name)}</span>`
      ).join('')}</div>`
    : '';

  el.innerHTML =
    `<div class="wi-top">` +
      `<span class="key-pill">${esc(item.key)}</span>` +
      `<span class="type-badge type-${esc(item.item_type)}">${esc(Logic.ITEM_TYPE_LABEL[item.item_type] || item.item_type)}</span>` +
    `</div>` +
    `<p class="card-title">${esc(item.title)}</p>` +
    components +
    labelChips +
    (parent || due || who ? `<div class="card-meta">${parent}${due}${who}</div>` : '');
```

- [ ] **Step 2: Load `allLabels` alongside the modal's other data**

At the top of `openWorkItemModal`, change:

```javascript
async function openWorkItemModal(itemId) {
  let item;
  try {
    item = await data.getWorkItem(itemId);
  } catch (err) { return handle(err); }

  const users = await cachedUsers();
```

to:

```javascript
async function openWorkItemModal(itemId) {
  let item, allLabels;
  try {
    item = await data.getWorkItem(itemId);
  } catch (err) { return handle(err); }

  try { allLabels = await data.listLabels(); } catch { allLabels = []; }
  const users = await cachedUsers();
```

- [ ] **Step 3: Add the Labels block to the modal body**

In the modal body template string, right after the Components block and before the `canHaveChildren ? ... : ''` Children block, insert a new Labels block. Change:

```javascript
    `<div class="block">` +
      `<h2>Components</h2>` +
      `<div class="chip-check-list">${
        componentChips || '<p class="empty-inline">No components on this project yet. Add them on the project page.</p>'
      }</div>` +
    `</div>` +

    (canHaveChildren
```

to:

```javascript
    `<div class="block">` +
      `<h2>Components</h2>` +
      `<div class="chip-check-list">${
        componentChips || '<p class="empty-inline">No components on this project yet. Add them on the project page.</p>'
      }</div>` +
    `</div>` +

    `<div class="block">` +
      `<h2>Labels</h2>` +
      `<div data-labels-container></div>` +
    `</div>` +

    (canHaveChildren
```

- [ ] **Step 4: Mount the chip-input and thread its value into save**

Right after `const { modal, close } = openModal(body, { wide: true });` and the existing `const errorEl = modal.querySelector('[data-error]');` line, add:

```javascript
  const labelInput = labelChipInput((item.labels_detail || []).map(l => l.name), allLabels);
  modal.querySelector('[data-labels-container]').replaceChildren(labelInput.el);
```

Then in the save handler, change `Logic.editableWorkItemFields`'s call site. Currently:

```javascript
    const fields = Logic.editableWorkItemFields({
      title: modal.querySelector('[name=title]').value,
      description: modal.querySelector('[name=description]').value,
      priority: modal.querySelector('[name=priority]').value,
      due_date: modal.querySelector('[name=due_date]').value,
      assignee: modal.querySelector('[name=assignee]').value,
      parent: parentSelect ? parentSelect.value : '',
      components: Array.from(modal.querySelectorAll('.chip-check input:checked')).map(i => i.value),
    }, item.item_type);
```

`editableWorkItemFields` (in `logic.js`) builds the PATCH payload — `labels` needs to ride along. Rather than growing that pure function's signature for one caller, add `labels` directly to the object it returns, right where the fields are sent:

```javascript
    const fields = Logic.editableWorkItemFields({
      title: modal.querySelector('[name=title]').value,
      description: modal.querySelector('[name=description]').value,
      priority: modal.querySelector('[name=priority]').value,
      due_date: modal.querySelector('[name=due_date]').value,
      assignee: modal.querySelector('[name=assignee]').value,
      parent: parentSelect ? parentSelect.value : '',
      components: Array.from(modal.querySelectorAll('.chip-check input:checked')).map(i => i.value),
    }, item.item_type);
    fields.labels = labelInput.getNames();
```

- [ ] **Step 5: Manual verification**

Open any work item's card on a board — label chips (if any) show under the components row. Open its detail modal — a Labels block appears with existing labels as removable chips and an input with autocomplete against every label in the system. Type a brand-new name and press Enter — it becomes a chip. Save — reload the board, reopen the item: the new label persists and now shows on the card too. Remove a chip and save — it's gone on reload.

- [ ] **Step 6: Commit**

```bash
git add ui/static/js/app.js
git commit -m "$(cat <<'EOF'
feat(ui): show label chips on cards and wire label editing into the modal

Closes Wave 1 item W1.2 end to end — the admin screen plus actual
application, matching design/'s sub-project 4 scope.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

---

## Phase 3 — Project archive UI + a real write-block

Closes Wave 1 item **W1.3** (roadmap §6, size S) and fixes roadmap defect **X2**: *"Project archiving is visibility-only. An archived project stays fully writable... The word 'archive' promises a write-block and does not deliver one."* Backend: `POST /api/projects/{id}/archive/`, `POST /api/projects/{id}/unarchive/` already exist and already work (`docs/api.md` "Projects"); `is_archived`/`archived_at`/`archived_by_detail` are **already** on `ProjectSerializer` (`projects/serializers.py:16-24`) even though `docs/api.md` doesn't list them yet (Task 3.2 fixes that doc gap). What's missing is (a) the actual write-block, and (b) any UI for any of it. Design reference: `design/js/app.js` `renderProjectActions`'s archive button (lines 1006-1022), `paintProjectList`'s "Show archived" toggle (lines 174, 221-224, 247-264), `projectRow`'s Archived badge (line 303), `design/index.html`'s `data-archived-badge`/`data-include-archived` (lines 81, 95). Spec: `docs/superpowers/specs/2026-08-24-tasky-permissions-admin-design.md` (sub-project 9, signed off) plus roadmap §3.3 item X2 for the write-block fix's rationale.

This phase is the one exception in this plan that touches the backend — it's a small, contained defect fix (roadmap categorizes X2 as bundled into W1.3, not gated), and per this repo's own workflow it gets a real `pytest` test rather than manual verification.

### Task 3.1: Backend — a real write-block for archived projects

**Files:**
- Modify: `projects/permissions.py` (new `ProjectNotArchived` permission class)
- Modify: `boards/views.py` — add `ProjectNotArchived` to `permission_classes` on `BoardViewSet`, `WorkItemViewSet`, `CommentViewSet`, `AttachmentViewSet`, `ComponentViewSet`, `ReleaseViewSet`, `WorkItemStatusViewSet`, `AutomationRuleViewSet`, `SprintViewSet`, `ProjectScreenAssignmentsView`; add explicit `is_archived` guards to `BoardViewSet.perform_create` and `WorkItemViewSet.perform_create` (the two flat, non-nested collections where no `check_object_permissions` call ever fires on create); extend `WorkItemLinkViewSet.check_object_permissions`'s override
- Test: `projects/tests/test_project_archiving.py` (inverts the one existing test that pins the old, buggy behavior; adds new tests for the create-path guards)

**Interfaces:**
- Produces: `projects.permissions.ProjectNotArchived` (a `BasePermission`)

Why this shape, not a change to the existing `IsProjectMember`: every nested-under-a-project viewset here (`Component`, `Release`, `WorkItemStatus`, `AutomationRule`, `Sprint`, `ProjectScreenAssignmentsView`) already has an `initial()` override that calls `self.check_object_permissions(request, self.get_project())` (or `self.get_board().project`) for `list`/`create`, passing the **Project instance itself** as `obj` — the exact same shape `ProjectViewSet`'s own `retrieve`/`destroy`/`archive`/`unarchive`/`invite`/etc. actions pass when *they* call `check_object_permissions` on themselves. If the archived check lived inside `IsProjectMember`, there would be no way to tell "a Component create against an archived project" (must be blocked) apart from "the `unarchive` action against an archived project" (must never be blocked, or a project could never be unarchived) — both are "unsafe method against a Project object." Keeping the check in a **second, additive** permission class that every viewset except `ProjectViewSet` opts into removes that ambiguity: `ProjectViewSet` simply never carries `ProjectNotArchived` in its `permission_classes`, so its own actions are never subject to it, no matter what object they resolve.

- [ ] **Step 1: Add `ProjectNotArchived` to `projects/permissions.py`**

Change the import line:

```python
from rest_framework.permissions import BasePermission
```

to:

```python
from rest_framework.permissions import SAFE_METHODS, BasePermission
```

Then add this class right after `IsProjectMember`'s closing (end of file):

```python


class ProjectNotArchived(BasePermission):
    """Blocks unsafe writes into an archived project's boards, work items,
    and everything else that hangs off one — reads are untouched. Add this
    to a viewset's `permission_classes` alongside IsProjectMember; never add
    it to ProjectViewSet itself, or `unarchive`/`invite`/`transfer-ownership`
    etc. would become unreachable the moment a project is archived, and an
    archived project could never be reversed. See boards/views.py for where
    each nested viewset's `initial()` override already resolves the right
    object (a Project, a Board, or the row itself) for this to check.

    Object-level only: it never fires for a flat POST whose parent comes
    from the request body rather than the URL (no object exists yet for
    DRF to resolve), so BoardViewSet.perform_create and
    WorkItemViewSet.perform_create each carry their own explicit guard
    instead. Adding this class to a future flat-collection viewset's
    permission_classes is not enough on its own — check whether its
    create path needs the same explicit guard."""

    message = "This project is archived and read-only. Unarchive it first."

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        project = obj if isinstance(obj, Project) else obj.project
        return not project.is_archived
```

- [ ] **Step 2: Wire it into `boards/views.py`'s imports and every relevant viewset**

Change:

```python
from projects.permissions import IsProjectMember
```

to:

```python
from projects.permissions import IsProjectMember, ProjectNotArchived
```

Then, in each of these viewsets, change `permission_classes = [IsAuthenticated, IsProjectMember]` to `permission_classes = [IsAuthenticated, IsProjectMember, ProjectNotArchived]`:

- `BoardViewSet` (currently line 78)
- `WorkItemViewSet` (currently line 135)
- `CommentViewSet` (currently line 530)
- `AttachmentViewSet` (currently line 551)
- `ComponentViewSet` (currently line 598)
- `ReleaseViewSet` (currently line 660)
- `WorkItemStatusViewSet` (currently line 738)
- `AutomationRuleViewSet` (currently line 855)
- `SprintViewSet` (currently line 949)
- `ProjectScreenAssignmentsView` (currently line 1061)

Leave `LabelViewSet`, `WorkItemLinkViewSet` (handled separately in Step 4), `CustomFieldViewSet`, `FieldOptionViewSet`, `ScreenViewSet`, `ScreenFieldViewSet` untouched — labels, custom fields and screens are global resources, not scoped to one project's archived state.

- [ ] **Step 3: Guard the two flat (non-nested) create paths**

Neither `POST /api/boards/` nor `POST /api/work-items/` ever calls `get_object()`/`check_object_permissions` on create — both take their parent (`project`, `board`) from the request body via a `PrimaryKeyRelatedField`, so `has_object_permission` never fires for these two `perform_create` methods. Add an explicit guard to each.

In `BoardViewSet.perform_create`, change:

```python
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
```

to:

```python
    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if project.is_archived:
            raise PermissionDenied("This project is archived and read-only. Unarchive it first.")
        serializer.save(created_by=self.request.user)
```

In `WorkItemViewSet.perform_create`, change:

```python
    def perform_create(self, serializer):
        # No key-generation logic here: WorkItem.save() generates it (under
        # a real select_for_update() lock on the owning Project row) for
        # every creation path uniformly, API included, since a freshly
        # instantiated WorkItem's `key` is always falsy until save() sets
        # it. Keeping it there instead of duplicating it here avoids two
        # independent implementations of the same locked counter drifting
        # apart, and keeps the lock + increment + INSERT in one atomic block
        # instead of splitting them across two.
        board = serializer.validated_data["board"]
        status = serializer.validated_data["status"]
```

to:

```python
    def perform_create(self, serializer):
        # No key-generation logic here: WorkItem.save() generates it (under
        # a real select_for_update() lock on the owning Project row) for
        # every creation path uniformly, API included, since a freshly
        # instantiated WorkItem's `key` is always falsy until save() sets
        # it. Keeping it there instead of duplicating it here avoids two
        # independent implementations of the same locked counter drifting
        # apart, and keeps the lock + increment + INSERT in one atomic block
        # instead of splitting them across two.
        board = serializer.validated_data["board"]
        if board.project.is_archived:
            raise PermissionDenied("This project is archived and read-only. Unarchive it first.")
        status = serializer.validated_data["status"]
```

- [ ] **Step 4: `WorkItemLinkViewSet` — extend its custom `check_object_permissions` override**

This viewset already bypasses the normal `permission_classes` iteration for its destroy path with a hand-written override (it needs membership in *both* linked items' projects). Add the same archived check, in the same AND-across-both-sides shape. Change:

```python
    def check_object_permissions(self, request, obj):
        # Matches the AND semantics the create path already enforces: a
        # link can only be created between two items the caller can both
        # see (member of both items' projects), so removing it requires
        # the same — membership in only one side's project is not enough.
        # Reuses IsProjectMember.has_object_permission (same check
        # WorkItemViewSet.links() runs against `item` via get_object() and
        # against `other` via the explicit check_object_permissions call)
        # rather than hand-rolling the membership query twice here.
        is_member = IsProjectMember().has_object_permission
        if not (is_member(request, self, obj.item_a) and is_member(request, self, obj.item_b)):
            self.permission_denied(request, message="You don't have access to this project.")
```

to:

```python
    def check_object_permissions(self, request, obj):
        # Matches the AND semantics the create path already enforces: a
        # link can only be created between two items the caller can both
        # see (member of both items' projects), so removing it requires
        # the same — membership in only one side's project is not enough.
        # Reuses IsProjectMember.has_object_permission (same check
        # WorkItemViewSet.links() runs against `item` via get_object() and
        # against `other` via the explicit check_object_permissions call)
        # rather than hand-rolling the membership query twice here.
        is_member = IsProjectMember().has_object_permission
        if not (is_member(request, self, obj.item_a) and is_member(request, self, obj.item_b)):
            self.permission_denied(request, message="You don't have access to this project.")
        not_archived = ProjectNotArchived().has_object_permission
        if not (not_archived(request, self, obj.item_a) and not_archived(request, self, obj.item_b)):
            self.permission_denied(
                request, message="This project is archived and read-only. Unarchive it first."
            )
```

- [ ] **Step 5: Write the failing tests first**

In `projects/tests/test_project_archiving.py`, replace the test that currently pins the old (buggy) behavior:

```python
@pytest.mark.django_db
def test_archived_projects_boards_and_work_items_remain_fully_writable(auth_client, project, user):
    board = Board.objects.create(name="Board", created_by=user, project=project)
    seed_default_statuses(project)
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    item = WorkItem.objects.create(board=board, title="Still editable", status=status)

    auth_client.post(f"/api/projects/{project.id}/archive/")

    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"title": "Edited after archive"}, content_type="application/json"
    )
    assert response.status_code == 200
    item.refresh_from_db()
    assert item.title == "Edited after archive"
```

with:

```python
@pytest.mark.django_db
def test_archived_project_blocks_work_item_edits(auth_client, project, user):
    """Was 'remain_fully_writable' — inverted per roadmap defect X2: an
    archived project is now genuinely read-only, not just hidden from the
    default list."""
    board = Board.objects.create(name="Board", created_by=user, project=project)
    seed_default_statuses(project)
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    item = WorkItem.objects.create(board=board, title="Not editable once archived", status=status)

    auth_client.post(f"/api/projects/{project.id}/archive/")

    response = auth_client.patch(
        f"/api/work-items/{item.id}/", {"title": "Edited after archive"}, content_type="application/json"
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "This project is archived and read-only. Unarchive it first."
    item.refresh_from_db()
    assert item.title == "Not editable once archived"


@pytest.mark.django_db
def test_archived_project_still_allows_reads(auth_client, project, user):
    board = Board.objects.create(name="Board", created_by=user, project=project)
    seed_default_statuses(project)
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    item = WorkItem.objects.create(board=board, title="Readable", status=status)

    auth_client.post(f"/api/projects/{project.id}/archive/")

    response = auth_client.get(f"/api/work-items/{item.id}/")
    assert response.status_code == 200
    assert response.json()["title"] == "Readable"


@pytest.mark.django_db
def test_archived_project_blocks_new_boards(auth_client, project):
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.post("/api/boards/", {"project": project.id, "name": "New board"})
    assert response.status_code == 403
    assert response.json()["detail"] == "This project is archived and read-only. Unarchive it first."


@pytest.mark.django_db
def test_archived_project_blocks_new_work_items(auth_client, project, user):
    board = Board.objects.create(name="Board", created_by=user, project=project)
    seed_default_statuses(project)
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.post("/api/work-items/", {"board": board.id, "item_type": "task", "title": "x"})
    assert response.status_code == 403
    assert response.json()["detail"] == "This project is archived and read-only. Unarchive it first."


@pytest.mark.django_db
def test_archived_project_blocks_new_components(auth_client, project):
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.post(f"/api/projects/{project.id}/components/", {"name": "Backend"})
    assert response.status_code == 403
    assert response.json()["detail"] == "This project is archived and read-only. Unarchive it first."


@pytest.mark.django_db
def test_unarchiving_still_works_once_a_project_is_archived(auth_client, project):
    """The write-block must not lock the owner out of reversing it."""
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.post(f"/api/projects/{project.id}/unarchive/")
    assert response.status_code == 200
    assert response.json()["is_archived"] is False


@pytest.mark.django_db
def test_removing_a_member_still_works_once_a_project_is_archived(auth_client, project, other_user):
    """Project-level membership management (an owner cleaning up before
    archiving finishes, or reorganizing an archived project) must not be
    blocked by the same write-lock that protects its boards/work items."""
    ProjectMembership.objects.create(project=project, user=other_user, role="member")
    auth_client.post(f"/api/projects/{project.id}/archive/")
    response = auth_client.delete(f"/api/projects/{project.id}/members/{other_user.id}/")
    assert response.status_code == 204
    assert not ProjectMembership.objects.filter(project=project, user=other_user).exists()


@pytest.mark.django_db
def test_deleting_a_work_item_link_is_blocked_once_the_project_is_archived(auth_client, project, user):
    """The one hand-written (non-declarative) enforcement point in this
    change — WorkItemLinkViewSet.check_object_permissions — needs its own
    test; nothing else exercises it."""
    board = Board.objects.create(name="Board", created_by=user, project=project)
    seed_default_statuses(project)
    status = WorkItemStatus.objects.filter(project=project, category="todo").first()
    item_a = WorkItem.objects.create(board=board, title="A", status=status)
    item_b = WorkItem.objects.create(board=board, title="B", status=status)
    link_response = auth_client.post(f"/api/work-items/{item_a.id}/links/", {"item": item_b.id})
    link_id = link_response.json()["id"]

    auth_client.post(f"/api/projects/{project.id}/archive/")

    response = auth_client.delete(f"/api/work-item-links/{link_id}/")
    assert response.status_code == 403
    assert response.json()["detail"] == "This project is archived and read-only. Unarchive it first."
```

- [ ] **Step 6: Run the tests, confirm the new ones fail and the old suite still passes elsewhere**

```bash
make test-fast ARGS="projects/tests/test_project_archiving.py -v"
```

Expected before Steps 1-4: `test_archived_project_blocks_work_item_edits`, `test_archived_project_blocks_new_boards`, `test_archived_project_blocks_new_work_items`, `test_archived_project_blocks_new_components` all **FAIL** (200/201 instead of 403). `test_archived_project_still_allows_reads`, `test_unarchiving_still_works_once_a_project_is_archived`, `test_removing_a_member_still_works_once_a_project_is_archived` should already **PASS** (nothing in the current code blocks them yet).

- [ ] **Step 7: Apply Steps 1-4's implementation, then re-run**

```bash
make test-fast ARGS="projects/tests/test_project_archiving.py -v"
```

Expected: all tests pass, including the three that were already green (confirming the fix doesn't over-block reads or the project's own management actions).

- [ ] **Step 8: Run the full suite and lint**

```bash
make test
make lint
```

Expected: all 554+ tests pass (the new tests add to the count), coverage stays ≥ 98%, lint is clean. Pay particular attention to any other test file that (like the one just inverted) might have been asserting the old "archived = still writable" behavior for a *different* endpoint — search for it first:

```bash
grep -rln "archive" boards/tests/ projects/tests/
```

If any other test asserts a 200/201 for a write against an archived project, it is pinning the same bug this phase fixes — invert it the same way, with the same explanatory comment pattern, rather than leaving it red.

- [ ] **Step 9: Commit**

```bash
git add projects/permissions.py boards/views.py projects/tests/test_project_archiving.py
git commit -m "$(cat <<'EOF'
fix(api): make an archived project's boards and work items read-only

Closes roadmap defect X2 — archiving was visibility-only; a write to any
child of an archived project now 403s with a clear message, while the
project's own management actions (archive/unarchive/membership) and all
reads stay reachable.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 3.2: Update `docs/api.md`

**Files:**
- Modify: `docs/api.md` (the "Projects" section, lines 75-105)

**Interfaces:**
- Produces: an accurate, current contract — no code interface, documentation only

- [ ] **Step 1: Document the now-exposed archive fields and the write-block**

Change the `Project` response-shape paragraph. Currently:

```
Every project role is one of `owner`, `admin`, `member`. There is exactly one Owner at
all times; the Owner cannot leave a project without transferring ownership to an
existing Admin first (there is no "leave" endpoint of its own — the client models
"leave" as removing your own membership, subject to the same owner restriction as any
other removal).

**Archiving is visibility-only.** An archived project drops out of the default `GET
/api/projects/` list but stays exactly as writable as before for its existing members — no
other endpoint treats an archived project's boards, work items, or anything else as read-only.
`Project.delete()` (hard delete, cascading, irreversible) is unrelated and untouched.
```

to:

```
Every project role is one of `owner`, `admin`, `member`. There is exactly one Owner at
all times; the Owner cannot leave a project without transferring ownership to an
existing Admin first (there is no "leave" endpoint of its own — the client models
"leave" as removing your own membership, subject to the same owner restriction as any
other removal).

Every project response also carries `is_archived` (bool), `archived_at` (ISO datetime or
`null`), and `archived_by_detail` (a nested user object, or `null`) — all three are
read-only; only `POST .../archive/` and `POST .../unarchive/` change them.

**Archiving makes a project's boards, work items and everything else that hangs off it
read-only.** A `GET` still works on any of it; any unsafe method (`POST`/`PATCH`/`PUT`/
`DELETE`) against a board, work item, component, release, status, automation rule, sprint,
comment, attachment, work-item link, or screen assignment belonging to an archived project
is rejected with `403: {"detail": "This project is archived and read-only. Unarchive it
first."}`. The project's own management endpoints — `archive`/`unarchive`/`invite`/
`transfer-ownership`/`members`/`{id}` (`DELETE`) — are exempt, so an archived project can
always be unarchived or have its membership cleaned up. `Project.delete()` (hard delete,
cascading, irreversible) is unrelated and untouched.
```

- [ ] **Step 2: Manual verification**

`grep -n "Archiving" docs/api.md` shows the updated paragraph; read it once more against `projects/permissions.py`'s `ProjectNotArchived` docstring (Task 3.1) to confirm they describe the same exemption list.

- [ ] **Step 3: Commit**

```bash
git add docs/api.md
git commit -m "$(cat <<'EOF'
docs(api): document is_archived/archived_at/archived_by and the write-block

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 3.3: `logic.js`/`api.js`/`store.js` — archive plumbing

**Files:**
- Modify: `ui/static/js/logic.js` (new predicate + export)
- Modify: `ui/static/js/api.js` (`archiveProject`/`unarchiveProject`, and `listProjects` gains an `includeArchived` parameter)
- Modify: `ui/static/js/store.js` (matching mock methods, `is_archived` on seeded projects)

**Interfaces:**
- Produces: `Logic.canManageProjectArchive(role)`; `Api.archiveProject(id)`, `Api.unarchiveProject(id)`, `Api.listProjects(includeArchived)`; matching `Store.*`

- [ ] **Step 1: `logic.js`**

Add, in the new Labels section's neighborhood (after the `Logic.LABEL_PALETTE`/`colorForLabelName` block from Phase 2):

```javascript
  /* ---- Project archive (sub-project 9) ------------------------------------
     Archiving is Owner-only — one tier stricter than the Owner/Admin split
     every other per-project manage-tier predicate in this file uses. */
  const canManageProjectArchive = (role) => role === 'owner';

```

Export: add `canManageProjectArchive,` to the `return { ... }` block, after `LABEL_PALETTE, colorForLabelName,`.

- [ ] **Step 2: `api.js`**

`docs/api.md`'s `GET /api/projects/` already supports `?include_archived=true`. Change the existing:

```javascript
    listProjects:  ()          => request('/api/projects/'),
```

to:

```javascript
    listProjects:  (includeArchived) => request(`/api/projects/${includeArchived ? '?include_archived=true' : ''}`),
```

Add these two methods right after `deleteProject`:

```javascript
    archiveProject:   (id) => request(`/api/projects/${id}/archive/`,   { method: 'POST' }),
    unarchiveProject: (id) => request(`/api/projects/${id}/unarchive/`, { method: 'POST' }),
```

Every existing caller of `data.listProjects()` (in `viewProjects` and `viewProject`) keeps working unchanged — `includeArchived` is optional and defaults to excluding them, matching the API's own default.

- [ ] **Step 3: `store.js`**

Add `is_archived: false, archived_at: null, archived_by: null,` to each of the four seeded `projects` entries (`ui/static/js/store.js`, currently lines 40-45):

```javascript
  let projects = [
    { id: 1, key: 'TASKY', name: 'Tasky Redesign',   description: 'The multi-project expansion itself', created_at: now(), is_archived: false, archived_at: null, archived_by: null },
    { id: 2, key: 'WEB',   name: 'Website Refresh',  description: '', created_at: now(), is_archived: false, archived_at: null, archived_by: null },
    { id: 3, key: 'CLNT',  name: 'Client Portal',    description: '', created_at: now(), is_archived: false, archived_at: null, archived_by: null },
    { id: 4, key: 'MKT',   name: 'Marketing Launch', description: '', created_at: now(), is_archived: false, archived_at: null, archived_by: null },
  ];
```

Change `projectOut` (currently lines 196-199) to surface the fields:

```javascript
  const projectOut = (p) => Object.assign({}, p, {
    my_role: myRole(p.id),
    member_count: memberships.filter(m => m.project === p.id).length,
    archived_by_detail: p.archived_by ? userById(p.archived_by) : null,
  });
```

Change `listProjects` (currently lines 264-268) to filter on the new parameter:

```javascript
  const listProjects = (includeArchived) => wait(
    projects.filter(p => membershipFor(p.id, me.id) && (includeArchived || !p.is_archived))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(projectOut)
  );
```

Add `archiveProject`/`unarchiveProject` right after `deleteProject`:

```javascript

  function archiveProject(projectId) {
    const project = projectById(projectId);
    if (!project) return fail(404, { detail: 'Not found.' });
    const role = myRole(projectId);
    if (!role) return denied();
    if (!Logic.canManageProjectArchive(role)) return fail(403, { detail: 'Only the owner can archive a project.' });
    if (project.is_archived) return fail(400, { detail: 'This project is already archived.' });
    project.is_archived = true;
    project.archived_at = now();
    project.archived_by = me.id;
    return wait(projectOut(project));
  }

  function unarchiveProject(projectId) {
    const project = projectById(projectId);
    if (!project) return fail(404, { detail: 'Not found.' });
    const role = myRole(projectId);
    if (!role) return denied();
    if (!Logic.canManageProjectArchive(role)) return fail(403, { detail: 'Only the owner can unarchive a project.' });
    if (!project.is_archived) return fail(400, { detail: 'This project is not archived.' });
    project.is_archived = false;
    project.archived_at = null;
    project.archived_by = null;
    return wait(projectOut(project));
  }
```

For fidelity with the backend fix in Task 3.1, also add the same write-block to every mock mutation function that already resolves a project (`createBoard`, `createWorkItem`, `updateWorkItem`, `deleteWorkItem`, `postMove`, `createComponent`, `renameComponent`, `deleteComponent`, `createComment`, `deleteComment`, `createLink`, `deleteLink`, and Phase 1's `createStatus`, `updateStatus`, `deleteStatus`) — each already has a line of the shape `if (!myRole(...)) return denied();`; add immediately after every one of those lines, in the same function:

```javascript
    if (projectById(<that function's resolved project id>).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }
```

using whichever project-id expression that function already has in scope (e.g. `boardProject(item.board)` for work-item functions, `component.project`/`Number(projectId)` for component functions). This keeps mock mode an honest model of the real API rather than a picture of it, matching this file's own stated design goal (`store.js`'s header comment). Every later phase's mock methods (Phases 5-11 add several more project-scoped mutations) must carry the same guard — call this out again at the start of each later phase's `store.js` task rather than assuming it's obvious.

- [ ] **Step 4: Export**

Add `archiveProject, unarchiveProject,` to `store.js`'s final `return { ... }` block, right after `listMembers, removeMember, changeRole, transferOwnership, inviteMember,`.

- [ ] **Step 5: Manual verification**

`?data=store`, console:

```javascript
await Store.listProjects()               // 4 projects, none archived
await Store.archiveProject(1)            // {..., is_archived: true, archived_at: '...', archived_by_detail: {...}}
await Store.listProjects()               // 3 projects (1 excluded)
await Store.listProjects(true)           // 4 projects, #1 has is_archived: true
await Store.createBoard({ project: 1, name: 'x' })
// rejects 403 {detail: 'This project is archived and read-only. Unarchive it first.'}
await Store.unarchiveProject(1)
await Store.listProjects()               // 4 projects again
```

Then repeat the read-only checks against the live API (`archiveProject`/`unarchiveProject`/`listProjects(true)`), confirming the 403 body text matches Task 3.1's fix exactly.

- [ ] **Step 6: Commit**

```bash
git add ui/static/js/logic.js ui/static/js/api.js ui/static/js/store.js
git commit -m "$(cat <<'EOF'
feat(ui): add archive/unarchive/includeArchived to the API and mock clients

Mock mode's mutation functions also gain the same archived-project write
guard the backend now enforces, so ?data=store stays an honest model.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 3.4: `app.js`/`index.html`/`app.css` — the archive UI

**Files:**
- Modify: `ui/index.html` — `tpl-projects` (add "Show archived" toggle), `tpl-project` (add the Archived badge)
- Modify: `ui/static/js/app.js` — `viewProjects` (wire the toggle), `projectRow` (Archived badge), `viewProject` (show the badge), `renderProjectActions` (Archive/Unarchive button)
- Modify: `ui/static/css/app.css` — `.archived-toggle`, `.role-badge.is-inactive`

**Interfaces:**
- Consumes: `data.listProjects(includeArchived)`, `data.archiveProject`, `data.unarchiveProject` (Task 3.3); `Logic.canManageProjectArchive` (Task 3.3)

- [ ] **Step 1: `index.html`**

In `tpl-projects`, change:

```html
    <ul class="project-list" data-list></ul>
```

to:

```html
    <label class="archived-toggle"><input type="checkbox" data-include-archived> Show archived</label>
    <ul class="project-list" data-list></ul>
```

In `tpl-project`, change:

```html
          <span class="role-badge" data-my-role></span>
        </div>
```

to:

```html
          <span class="role-badge" data-my-role></span>
          <span class="role-badge is-inactive" data-archived-badge hidden>Archived</span>
        </div>
```

- [ ] **Step 2: CSS**

Append:

```css
/* Project archive (sub-project 9) ---------------------------------------- */

.archived-toggle { display: flex; align-items: center; gap: 6px; margin: 14px 0 4px; font-size: 13px; color: var(--ink-2); }

.role-badge.is-inactive { color: var(--danger); border-color: var(--danger); background: var(--danger-w); }
```

- [ ] **Step 3: `app.js` — `viewProjects` and `projectRow`**

Change `viewProjects` to read the toggle and pass it through. Currently:

```javascript
async function viewProjects() {
  const main = outlet();
  main.replaceChildren(tpl('tpl-projects'));

  const invSection = main.querySelector('[data-invitations]');
  const invList = main.querySelector('[data-invite-list]');
  const list = main.querySelector('[data-list]');
  list.innerHTML = skeletonList(3);
```

becomes:

```javascript
async function viewProjects() {
  const main = outlet();
  main.replaceChildren(tpl('tpl-projects'));

  const invSection = main.querySelector('[data-invitations]');
  const invList = main.querySelector('[data-invite-list]');
  const list = main.querySelector('[data-list]');
  const includeArchived = main.querySelector('[data-include-archived]');
  list.innerHTML = skeletonList(3);

  includeArchived.addEventListener('change', async () => {
    list.innerHTML = skeletonList(3);
    try {
      const projects = await data.listProjects(includeArchived.checked);
      paintProjectRows(list, projects);
    } catch (err) {
      if (err && err.sessionExpired) return handle(err);
      errorState(list, err, () => includeArchived.dispatchEvent(new Event('change')));
    }
  });
```

Extract the existing project-list-painting logic (currently inline in the `try` block below) into a small shared helper, `paintProjectRows`, so both the initial load and the toggle's `change` handler use it. Change the rest of `viewProjects` from:

```javascript
  try {
    const [invitations, projects] = await Promise.all([
      data.listMyInvitations(),
      data.listProjects(),
    ]);

    if (invitations.length) {
      invSection.hidden = false;
      const rows = invitations.map(invitationRow);
      invList.replaceChildren(...rows);
      stagger(rows);
    }

    if (!projects.length) {
      list.innerHTML =
        '<li class="empty">No projects yet. Create one above, or wait for an invitation.</li>';
      return;
    }
    const rows = projects.map(projectRow);
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, viewProjects);
  }
}
```

to:

```javascript
  try {
    const [invitations, projects] = await Promise.all([
      data.listMyInvitations(),
      data.listProjects(),
    ]);

    if (invitations.length) {
      invSection.hidden = false;
      const rows = invitations.map(invitationRow);
      invList.replaceChildren(...rows);
      stagger(rows);
    }

    paintProjectRows(list, projects);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, viewProjects);
  }
}

function paintProjectRows(list, projects) {
  if (!projects.length) {
    list.innerHTML =
      '<li class="empty">No projects yet. Create one above, or wait for an invitation.</li>';
    return;
  }
  const rows = projects.map(projectRow);
  list.replaceChildren(...rows);
  stagger(rows);
}
```

Change `projectRow` to show the Archived badge. Currently:

```javascript
function projectRow(project) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.className = 'project-row';
  a.href = `#/projects/${project.id}`;
  a.innerHTML =
    `<span class="name">${esc(project.name)}</span>` +
    `<span class="key-pill">${esc(project.key)}</span>` +
    `<span class="desc">${esc(project.description)}</span>` +
    `<span class="role-badge role-${esc(project.my_role)}">${esc(Logic.ROLE_LABEL[project.my_role] || '—')}</span>` +
    `<span class="tally mono">${project.member_count} member${project.member_count === 1 ? '' : 's'}</span>`;
  li.appendChild(a);
  return li;
}
```

to:

```javascript
function projectRow(project) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.className = 'project-row';
  a.href = `#/projects/${project.id}`;
  a.innerHTML =
    `<span class="name">${esc(project.name)}</span>` +
    `<span class="key-pill">${esc(project.key)}</span>` +
    `<span class="desc">${esc(project.description)}</span>` +
    `<span class="role-badge role-${esc(project.my_role)}">${esc(Logic.ROLE_LABEL[project.my_role] || '—')}</span>` +
    (project.is_archived ? `<span class="role-badge is-inactive">Archived</span>` : '') +
    `<span class="tally mono">${project.member_count} member${project.member_count === 1 ? '' : 's'}</span>`;
  li.appendChild(a);
  return li;
}
```

- [ ] **Step 4: `app.js` — `viewProject` shows the badge, and reaches an archived project by id**

`viewProject` currently fetches `myProjects` via `data.listProjects()` for the project switcher — if the project being viewed is itself archived, it must still appear in that switcher (matching `design/`'s `Store.listMyProjects(true)` call at this exact spot). Change:

```javascript
  let project, myProjects;
  try {
    [project, myProjects] = await Promise.all([
      data.getProject(projectId),
      data.listProjects(),
    ]);
```

to:

```javascript
  let project, myProjects;
  try {
    [project, myProjects] = await Promise.all([
      data.getProject(projectId),
      data.listProjects(true),
    ]);
```

Change:

```javascript
  const roleBadge = main.querySelector('[data-my-role]');
  roleBadge.textContent = Logic.ROLE_LABEL[project.my_role] || '—';
  roleBadge.classList.add(`role-${project.my_role}`);
```

to:

```javascript
  const roleBadge = main.querySelector('[data-my-role]');
  roleBadge.textContent = Logic.ROLE_LABEL[project.my_role] || '—';
  roleBadge.classList.add(`role-${project.my_role}`);
  main.querySelector('[data-archived-badge]').hidden = !project.is_archived;
```

- [ ] **Step 5: `app.js` — the Archive/Unarchive button**

In `renderProjectActions`, add a new `if` block right after the `canTransferOwnership` block and before the `canLeave` block. Currently:

```javascript
  if (Logic.canInvite(role)) add('Invite', 'btn', () => openInviteModal(project));
  if (Logic.canTransferOwnership(role)) add('Transfer ownership', 'btn', () => openTransferModal(project));

  /* No "Leave" for the Owner: ...
```

becomes:

```javascript
  if (Logic.canInvite(role)) add('Invite', 'btn', () => openInviteModal(project));
  if (Logic.canTransferOwnership(role)) add('Transfer ownership', 'btn', () => openTransferModal(project));

  if (Logic.canManageProjectArchive(role)) {
    add(project.is_archived ? 'Unarchive project' : 'Archive project', 'btn btn-quiet', async () => {
      try {
        const updated = project.is_archived
          ? await data.unarchiveProject(project.id)
          : await data.archiveProject(project.id);
        toast(project.is_archived ? 'Project unarchived' : 'Project archived');
        project.is_archived = updated.is_archived;
        main.querySelector('[data-archived-badge]').hidden = !project.is_archived;
        renderProjectActions(main, project);
      } catch (err) { handle(err); }
    });
  }

  /* No "Leave" for the Owner: ...
```

- [ ] **Step 6: Manual verification**

`make run`, sign in as a project's Owner. On its project page, click "Archive project" — a toast confirms, the button flips to "Unarchive project", and the "Archived" badge appears next to the role badge. Go to `#/projects` — the project is gone from the list. Check "Show archived" — it reappears, with its own Archived badge. Open it directly by URL — it loads fine (reads still work) but its role badge row shows Archived, and its project-switcher dropdown still lists it correctly. Try adding a board on it — the create form's error area shows the exact 403 message from Task 3.1. Click "Unarchive project" — everything above reverses. As an Admin (not Owner) on some project, confirm no Archive button is offered at all.

- [ ] **Step 7: Commit**

```bash
git add ui/index.html ui/static/js/app.js ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): add the archive/unarchive UI and a Show-archived toggle

Closes Wave 1 item W1.3.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

---

## Phase 4 — Project templates in the create-project flow

Closes Wave 1 item **W1.11** (roadmap §6, size S) — reordered ahead of its roadmap position because it's small and fully independent of every other phase (it only touches project *creation*). Backend: `GET /api/project-templates/` (read-only, no `POST`), and `POST /api/projects/` gains an optional `template` field — both already shipped (`docs/api.md` "Project Templates"). Design reference: `design/js/app.js` `viewProjects`'s template-select wiring (lines 183-184, 194-214), `design/index.html`'s `data-template-select`/`data-template-preview` (lines 75, 78). Spec: `docs/superpowers/specs/2026-08-24-tasky-project-types-setup-design.md` (sub-project 10, signed off).

The three built-in templates and their exact status/component presets, for reference while writing the mock (`boards/services.py:186-218`):

| `key` | `name` | statuses (`name`, `category`) | starter components |
|---|---|---|---|
| `blank` | Blank | To Do/todo, In Progress/in_progress, Done/done | — |
| `software` | Software Project | To Do/todo, In Progress/in_progress, In Review/in_progress, Blocked/in_progress, Done/done | Frontend, Backend, Infrastructure |
| `bugs` | Bug Tracking | same 5 statuses as `software` | — |

### Task 4.1: `api.js` and `store.js`

**Files:**
- Modify: `ui/static/js/api.js` (new `listProjectTemplates`)
- Modify: `ui/static/js/store.js` (new `listProjectTemplates`; `createProject` and `seedDefaultStatuses` gain template awareness)

**Interfaces:**
- Produces: `Api.listProjectTemplates()` (`Promise<{key, name, description, statuses: [{name, category}], components: string[]}[]>`); matching `Store.listProjectTemplates()`; `Store.createProject`/`Api.createProject` (already generic) now honor an optional `template` field in their existing `fields` argument

- [ ] **Step 1: `api.js`**

Add right after the existing `createProject`/`deleteProject` lines:

```javascript
    listProjectTemplates: () => request('/api/project-templates/'),
```

`Api.createProject(fields)` already forwards whatever object it's given as the POST body, so no change is needed there — a caller that includes `template: 'software'` in `fields` already sends it through.

- [ ] **Step 2: `store.js` — template data and template-aware seeding**

Add a `PROJECT_TEMPLATES` constant near the top of `ui/static/js/store.js`, right before `seedDefaultStatuses` (currently line 82):

```javascript
  const PROJECT_TEMPLATES = [
    {
      key: 'blank', name: 'Blank',
      description: "Three statuses, no components — today's default. Good for anything that doesn't fit a more specific template.",
      statuses: [{ name: 'To Do', category: 'todo' }, { name: 'In Progress', category: 'in_progress' }, { name: 'Done', category: 'done' }],
      components: [],
    },
    {
      key: 'software', name: 'Software Project',
      description: 'An engineering-shaped workflow with room for review and blockers, plus a starter set of components to tag work by.',
      statuses: [
        { name: 'To Do', category: 'todo' }, { name: 'In Progress', category: 'in_progress' },
        { name: 'In Review', category: 'in_progress' }, { name: 'Blocked', category: 'in_progress' },
        { name: 'Done', category: 'done' },
      ],
      components: ['Frontend', 'Backend', 'Infrastructure'],
    },
    {
      key: 'bugs', name: 'Bug Tracking',
      description: 'For triaging and tracking defects through to verification.',
      statuses: [
        { name: 'To Do', category: 'todo' }, { name: 'In Progress', category: 'in_progress' },
        { name: 'In Review', category: 'in_progress' }, { name: 'Blocked', category: 'in_progress' },
        { name: 'Done', category: 'done' },
      ],
      components: [],
    },
  ];
  const listProjectTemplates = () => wait(PROJECT_TEMPLATES);
```

Change `seedDefaultStatuses` to take a status list instead of being hardcoded to the 3-status "simple" set. Currently (`ui/static/js/store.js`, lines 82-90):

```javascript
  function seedDefaultStatuses(projectId) {
    const made = [
      { id: ++nextStatusId, project: projectId, name: 'To Do', category: 'todo', position: 0 },
      { id: ++nextStatusId, project: projectId, name: 'In Progress', category: 'in_progress', position: 1 },
      { id: ++nextStatusId, project: projectId, name: 'Done', category: 'done', position: 2 },
    ];
    statuses.push(...made);
    return made;
  }
```

becomes (the `PROJECT_TEMPLATES` constant this references was just added in Step 1, immediately above `seedDefaultStatuses` in the file, so it's already in scope here):

```javascript
  function seedDefaultStatuses(projectId, statusPreset) {
    const preset = statusPreset || PROJECT_TEMPLATES[0].statuses;   // 'blank''s 3-status preset
    const made = preset.map((s, i) => ({ id: ++nextStatusId, project: projectId, name: s.name, category: s.category, position: i }));
    statuses.push(...made);
    return made;
  }
```

Every existing call site (`seedDefaultStatuses(1)`, `seedDefaultStatuses(2)`, `seedDefaultStatuses(3)`, `seedDefaultStatuses(4)` in the module's seed block, and the one inside `createProject`) keeps working with no second argument — `statusPreset` defaults to `blank`'s preset, byte-for-byte the same 3 statuses the old hardcoded version produced, matching `boards/services.py`'s own "defaults to 'simple', byte-for-byte what the old hardcoded list produced" guarantee.

- [ ] **Step 2: `store.js` — `createProject` honors `template`**

Change `createProject` (currently lines 277-289):

```javascript
  function createProject(fields) {
    if (!fields.name || !fields.name.trim()) return fail(400, { name: 'This field may not be blank.' });
    const key = String(fields.key || '').trim().toUpperCase();
    if (!/^[A-Z]{2,10}$/.test(key)) return fail(400, { key: 'Key must be 2–10 letters, e.g. TASKY.' });
    if (projects.some(p => p.key === key)) return fail(400, { key: `"${key}" is already taken.` });

    const project = { id: id(), key, name: fields.name.trim(), description: fields.description || '', created_at: now() };
    projects.push(project);
    memberships.push({ id: id(), project: project.id, user: me.id, role: 'owner', joined_at: now() });
    itemCounters[project.id] = 1;
    seedDefaultStatuses(project.id);
    return wait(projectOut(project));
  }
```

to:

```javascript
  function createProject(fields) {
    if (!fields.name || !fields.name.trim()) return fail(400, { name: 'This field may not be blank.' });
    const key = String(fields.key || '').trim().toUpperCase();
    if (!/^[A-Z]{2,10}$/.test(key)) return fail(400, { key: 'Key must be 2–10 letters, e.g. TASKY.' });
    if (projects.some(p => p.key === key)) return fail(400, { key: `"${key}" is already taken.` });

    const templateKey = fields.template || 'blank';
    const template = PROJECT_TEMPLATES.find(t => t.key === templateKey);
    if (!template) return fail(400, { template: `"${templateKey}" is not a valid template.` });

    const project = {
      id: id(), key, name: fields.name.trim(), description: fields.description || '', created_at: now(),
      is_archived: false, archived_at: null, archived_by: null,
    };
    projects.push(project);
    memberships.push({ id: id(), project: project.id, user: me.id, role: 'owner', joined_at: now() });
    itemCounters[project.id] = 1;
    seedDefaultStatuses(project.id, template.statuses);
    template.components.forEach(name => { components.push({ id: id(), project: project.id, name }); });
    return wait(projectOut(project));
  }
```

(This folds in Task 3.3's `is_archived`/`archived_at`/`archived_by` fields on the created project — if Phase 3 landed first per this plan's ordering, `createProject` already had them; this diff shows the merged result so either execution order produces the same file.)

- [ ] **Step 3: Export**

Add `listProjectTemplates,` to `store.js`'s final `return { ... }` block, right after `listProjects, getProject, createProject, deleteProject,`.

- [ ] **Step 4: Manual verification**

`?data=store`, console:

```javascript
await Store.listProjectTemplates()   // 3 templates, shapes matching the table above
await Store.createProject({ name: 'Bugs Test', key: 'BUGT', template: 'bugs' })
await Store.listStatuses(<new project id>)   // 5 statuses: To Do, In Progress, In Review, Blocked, Done
await Store.listComponents(<new project id>) // []
await Store.createProject({ name: 'Soft Test', key: 'SOFT', template: 'software' })
await Store.listComponents(<new project id>) // Frontend, Backend, Infrastructure
await Store.createProject({ name: 'Bad', key: 'BAD1', template: 'nope' })
// rejects 400 {template: '"nope" is not a valid template.'}
```

Then repeat against the live API once Task 4.2 wires the UI.

- [ ] **Step 5: Commit**

```bash
git add ui/static/js/api.js ui/static/js/store.js
git commit -m "$(cat <<'EOF'
feat(ui): add project templates to the API and mock clients

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 4.2: `index.html`/`app.js` — the template picker

**Files:**
- Modify: `ui/index.html` (`tpl-projects`'s `create-project` form)
- Modify: `ui/static/js/app.js` (`viewProjects`)

**Interfaces:**
- Consumes: `data.listProjectTemplates` (Task 4.1)

- [ ] **Step 1: `index.html`**

Change the `create-project` form. Currently:

```html
    <form class="create-project" data-create-project novalidate>
      <input name="name" placeholder="Project name" aria-label="Project name" required>
      <input name="key" placeholder="KEY" aria-label="Project key" maxlength="10" class="key-input" required>
      <button class="btn btn-primary" type="submit">Create project</button>
    </form>
    <p class="form-error" data-create-error hidden></p>
```

to:

```html
    <form class="create-project" data-create-project novalidate>
      <input name="name" placeholder="Project name" aria-label="Project name" required>
      <input name="key" placeholder="KEY" aria-label="Project key" maxlength="10" class="key-input" required>
      <select name="template" aria-label="Template" data-template-select></select>
      <button class="btn btn-primary" type="submit">Create project</button>
    </form>
    <p class="page-sub" data-template-preview></p>
    <p class="form-error" data-create-error hidden></p>
```

- [ ] **Step 2: `app.js`**

In `viewProjects`, populate the select and preview, and thread `template` into the create call. Change:

```javascript
  main.querySelector('[data-create-project]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = main.querySelector('[data-create-error]');
    const btn = e.target.querySelector('button');
    errorEl.hidden = true;
    const name = e.target.querySelector('[name=name]').value;
    const key = e.target.querySelector('[name=key]').value;
    if (!name.trim() || !key.trim()) return;

    btn.disabled = true;
    try {
      const project = await data.createProject({ name, key });
      toast('Project created');
      location.hash = `#/projects/${project.id}`;
    } catch (err) {
      if (err && err.sessionExpired) return handle(err);
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });
```

to:

```javascript
  main.querySelector('[data-create-project]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = main.querySelector('[data-create-error]');
    const btn = e.target.querySelector('button');
    errorEl.hidden = true;
    const name = e.target.querySelector('[name=name]').value;
    const key = e.target.querySelector('[name=key]').value;
    const template = e.target.querySelector('[name=template]').value;
    if (!name.trim() || !key.trim()) return;

    btn.disabled = true;
    try {
      const project = await data.createProject({ name, key, template });
      toast('Project created');
      location.hash = `#/projects/${project.id}`;
    } catch (err) {
      if (err && err.sessionExpired) return handle(err);
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });

  const templateSelect = main.querySelector('[data-template-select]');
  const templatePreview = main.querySelector('[data-template-preview]');
  function paintTemplatePreview(templates) {
    const chosen = templates.find(t => t.key === templateSelect.value) || templates[0];
    if (!chosen) { templatePreview.textContent = ''; return; }
    const statusNames = chosen.statuses.map(s => s.name).join(', ');
    const componentNote = chosen.components.length
      ? `, and starter components: ${chosen.components.join(', ')}`
      : ', no starter components';
    templatePreview.textContent = `${chosen.description} Creates statuses: ${statusNames}${componentNote}.`;
  }
  try {
    const templates = await data.listProjectTemplates();
    templateSelect.replaceChildren(...templates.map(t => new Option(t.name, t.key)));
    paintTemplatePreview(templates);
    templateSelect.addEventListener('change', () => paintTemplatePreview(templates));
  } catch (err) { /* the form still works with the server's own default template */ }
```

This is inserted right after the existing `main.querySelector('[data-create-project]').addEventListener(...)` block and before the `let paintToken` / invitations-and-projects `Promise.all` block that already exists further down `viewProjects` — it doesn't touch that block. If Phase 3 already landed, `viewProjects` also has an `includeArchived`-related `change` listener nearby; this template block is independent of it and can sit either before or after — place it directly after the create-project submit handler as shown, matching `design/`'s own ordering.

- [ ] **Step 3: Manual verification**

`make run`, sign in, go to `#/projects`. The template `<select>` shows "Blank", "Software Project", "Bug Tracking"; the preview text below updates as you change the selection. Create a project with "Software Project" selected, name "Test Soft", key "TSFT" — open it, confirm its Statuses section (Phase 1) shows all 5 statuses and its Components section shows Frontend/Backend/Infrastructure already present. Create another with "Blank" — 3 statuses, no components, matching today's existing behavior exactly (regression check: this must not change what a plain, template-less create produces).

- [ ] **Step 4: Commit**

```bash
git add ui/index.html ui/static/js/app.js
git commit -m "$(cat <<'EOF'
feat(ui): add the project template picker to project creation

Closes Wave 1 item W1.11.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

---

## Phase 5 — Custom fields, screens, and screen assignments

Closes Wave 1 item **W1.9** (roadmap §6, size L). This is the largest phase and, per the dependency-ordering rationale in this plan's brainstorm, is placed before Releases/Attachments/Search/Bulk-ops/Backlog so that once it lands, work item create/edit forms already know how to render and validate custom fields — later phases that touch those same forms (none of the remaining ones actually add new work-item-form fields, so this is mostly about landing the admin screens and the modal wiring once rather than needing to revisit it).

Backend: `GET/POST /api/fields/`, `GET/PATCH/DELETE /api/fields/{id}/`, `POST /api/fields/{field_pk}/options/`, `PATCH/DELETE /api/fields/{field_pk}/options/{id}/`, `GET/POST /api/screens/`, `GET/PATCH/DELETE /api/screens/{id}/`, `POST /api/screens/{screen_pk}/fields/`, `PATCH/DELETE /api/screens/{screen_pk}/fields/{id}/`, `GET/PUT /api/projects/{id}/screen-assignments/`, plus the `custom_fields` field on work item read/write (`docs/api.md` "Custom Fields" through "Work Items — `custom_fields`"). Design reference: `design/js/app.js` `viewFields`/`paintFields`/`fieldRow` (1244-1383), `openFieldOptionsModal` (1388-1495), `viewScreens`/`paintScreens`/`screenRow` (1499-1615), `openScreenFieldsModal` (1619-1738), `renderScreenAssignments`/`assignmentRow` (584-650), `customFieldControl`/`customFieldControls`/`readCustomFieldInputs`/`bindChipChecks`/`clearCustomFieldErrors`/`applyCustomFieldErrors` (1974-2107). `design/js/logic.js` `FIELD_TYPES` through `screenValueErrors` (96-240). Spec: `docs/superpowers/specs/2026-08-18-tasky-custom-fields-screens-design.md` (sub-project 2b, signed off).

**Scope note:** `design/js/logic.js`'s `canManageDefinitions(roles, isStaff)` OR-s in a Site Admin (`is_staff`) bypass — Site Admin console (roadmap item U1) is **not** one of this plan's 11 phases, so this plan's `canManageDefinitions` only checks "Owner of any project," matching every other cross-project governance check this codebase already has (Labels in Phase 2 uses the identical rule). If Site Admin ships later, add the `is_staff` OR then.

**Real API shapes differ from `design/`'s mock in one way worth flagging up front:** the real `CustomField`/`Screen` serializers (`boards/serializers.py`) do **not** carry `has_options`/`type_label`/`screen_names`/`value_count`/`assigned_to` convenience fields the way `design/js/store.js`'s mock does — those are derived client-side below from `Logic.fieldHasOptions`/`Logic.FIELD_TYPE_LABEL`/etc., not sent by the server. A field row does not show which screens use it (computing that needs every project's screen-assignments, not just this field) — it shows name, type, and option/usage counts only; "used by" detail lives on the Screens page, one level down, where a screen's own `assigned_to`... **also doesn't exist server-side**, so that text is dropped entirely from this port. The Field-screens section (Task 5.5) is where "what's assigned" is genuinely visible, per project.

### Task 5.1: `logic.js` — field types, validation, and the manage predicates

**Files:**
- Modify: `ui/static/js/logic.js` (new section + export)

**Interfaces:**
- Produces: `Logic.FIELD_TYPES`, `Logic.FIELD_TYPE_LABEL`, `Logic.FIELD_TYPE_HINT`, `Logic.fieldHasOptions(fieldType)`, `Logic.isMultiValue(fieldType)`, `Logic.canManageDefinitions(roles)`, `Logic.canManageScreenAssignments(role)`, `Logic.isIsoDate(value)`, `Logic.isBlankValue(fieldType, value)`, `Logic.fieldValueError(field, value, ctx)`, `Logic.screenValueErrors(rows, values, contextFor)`

- [ ] **Step 1: Add the section**

Insert after the Phase 3 archive section (or, if phases are executed strictly in this plan's order, right after `canManageProjectArchive`) in `ui/static/js/logic.js`:

```javascript
  /* ---- Custom fields & screens (sub-project 2b) --------------------------
     The spec's fixed set. No custom types, and a field's type is immutable
     once created, so this list is only ever consulted at creation time. */
  const FIELD_TYPES = [
    'text_short', 'text_long', 'number', 'date',
    'select', 'multiselect', 'checkbox', 'user_picker',
  ];
  const FIELD_TYPE_LABEL = {
    text_short: 'Short text', text_long: 'Long text', number: 'Number', date: 'Date',
    select: 'Select', multiselect: 'Multi-select', checkbox: 'Checkbox', user_picker: 'User picker',
  };
  const FIELD_TYPE_HINT = {
    text_short: 'A single line of text.',
    text_long: 'A paragraph — notes, steps to reproduce.',
    number: 'Any number, whole or decimal.',
    date: 'A calendar date.',
    select: 'Pick exactly one from a list you define.',
    multiselect: 'Pick any number from a list you define.',
    checkbox: 'A yes / no tick.',
    user_picker: "A member of the work item's project.",
  };
  const fieldHasOptions = (fieldType) => fieldType === 'select' || fieldType === 'multiselect';
  const isMultiValue = (fieldType) => fieldType === 'multiselect';

  /* Global CustomField/Screen management: Owner of ANY project — not
     necessarily the one in front of you. `roles` is every role this
     person holds, across every project they're a member of; derive it
     from `data.listProjects()`'s `my_role` field per project (see the
     `isOwnerOfAnyProject` helper in app.js, shared with Labels). */
  const canManageDefinitions = (roles) => (roles || []).includes('owner');

  // Per-project screen assignment — same Owner/Admin tier already used for
  // Components, Statuses, Releases, Automation, Sprints.
  const canManageScreenAssignments = (role) => role === 'owner' || role === 'admin';

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  function isIsoDate(value) {
    const s = String(value);
    if (!ISO_DATE.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  /* "Blank" is deliberately per-type: multiselect is an empty list,
     checkbox is unticked (so "required" on a checkbox means "must be
     ticked"), everything else is null/undefined/whitespace. Blankness is
     the required-check's business — fieldValueError never complains about
     a blank value. */
  function isBlankValue(fieldType, value) {
    if (isMultiValue(fieldType)) return !Array.isArray(value) || value.length === 0;
    if (fieldType === 'checkbox') return !(value === true || value === 'true');
    return value === null || value === undefined || String(value).trim() === '';
  }

  /* Client-side pre-check only — mirrors docs/api.md's server-side
     coercion/validation exactly so the UI shows the same message before
     the round trip, but the server re-validates independently on every
     write regardless of what this returns. `ctx.optionIds` is the
     field's current option ids; `ctx.memberIds` is the work item's
     project's member user ids. Returns a message, or null when fine. */
  function fieldValueError(field, value, ctx) {
    ctx = ctx || {};
    const type = field.field_type;
    if (isBlankValue(type, value)) return null;

    const optionIds = (ctx.optionIds || []).map(Number);
    const memberIds = (ctx.memberIds || []).map(Number);

    switch (type) {
      case 'text_short':
        return String(value).length > 255 ? `"${field.name}" must be 255 characters or fewer.` : null;
      case 'text_long':
        return null;
      case 'number': {
        const n = Number(String(value).trim());
        return Number.isFinite(n) ? null : `"${field.name}" must be a number.`;
      }
      case 'date':
        return isIsoDate(value) ? null : `"${field.name}" must be a date (YYYY-MM-DD).`;
      case 'checkbox':
        return null;
      case 'select':
        return optionIds.includes(Number(value)) ? null : `"${field.name}" must be one of its current options.`;
      case 'multiselect': {
        const bad = value.filter(v => !optionIds.includes(Number(v)));
        return bad.length ? `"${field.name}" must only use its current options.` : null;
      }
      case 'user_picker':
        return memberIds.includes(Number(value)) ? null : `"${field.name}" must be a member of this project.`;
      default:
        return `"${field.name}" has an unknown field type.`;
    }
  }

  /* Validates a whole submission against a Screen's field list.
     `rows` is [{ field, required }] in screen order; `values` is
     { fieldId: value }; `contextFor(field)` supplies optionIds/memberIds.
     Returns { fieldId: message } — empty when everything passes. */
  function screenValueErrors(rows, values, contextFor) {
    const errors = {};
    (rows || []).forEach(row => {
      const field = row.field;
      const value = values ? values[field.id] : undefined;
      if (isBlankValue(field.field_type, value)) {
        if (row.required) errors[field.id] = `"${field.name}" is required.`;
        return;
      }
      const err = fieldValueError(field, value, contextFor ? contextFor(field) : {});
      if (err) errors[field.id] = err;
    });
    return errors;
  }

```

- [ ] **Step 2: Export**

Add these names to the `return { ... }` block, after `canManageProjectArchive,`:

```javascript
    FIELD_TYPES, FIELD_TYPE_LABEL, FIELD_TYPE_HINT, fieldHasOptions, isMultiValue,
    canManageDefinitions, canManageScreenAssignments,
    isIsoDate, isBlankValue, fieldValueError, screenValueErrors,
```

- [ ] **Step 3: Manual verification**

Console: `Logic.FIELD_TYPES.length === 8`; `Logic.fieldHasOptions('select') === true`; `Logic.fieldHasOptions('number') === false`; `Logic.isBlankValue('checkbox', false) === true`; `Logic.fieldValueError({name: 'X', field_type: 'number'}, 'abc', {}) === '"X" must be a number.'`.

- [ ] **Step 4: Commit**

```bash
git add ui/static/js/logic.js
git commit -m "$(cat <<'EOF'
feat(ui): add custom field types, validation, and manage predicates

Mirrors design/js/logic.js's sub-project 2b rules, with the Site Admin
bypass on canManageDefinitions dropped — that console isn't in this
plan's scope. See Phase 5's intro note.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 5.2: `api.js` and `store.js` — fields, options, screens, screen fields, and screen assignments

**Files:**
- Modify: `ui/static/js/api.js` (append)
- Modify: `ui/static/js/store.js` (new module state + functions + export)

**Interfaces:**
- Produces: `Api.listFields()`, `Api.createField({name, field_type})`, `Api.getField(id)`, `Api.renameField(id, name)`, `Api.deleteField(id)`, `Api.addFieldOption(fieldId, label)`, `Api.renameFieldOption(fieldId, optionId, label)`, `Api.moveFieldOption(fieldId, optionId, direction)`, `Api.deleteFieldOption(fieldId, optionId)`, `Api.listScreens()`, `Api.createScreen(name)`, `Api.getScreen(id)`, `Api.renameScreen(id, name)`, `Api.deleteScreen(id)`, `Api.addScreenField(screenId, fieldId)`, `Api.setScreenFieldRequired(screenId, rowId, required)`, `Api.moveScreenField(screenId, rowId, direction)`, `Api.removeScreenField(screenId, rowId)`, `Api.listScreenAssignments(projectId)`, `Api.setScreenAssignments(projectId, assignments)`; matching `Store.*`.

- [ ] **Step 1: `api.js` — fields and field options**

Add, after the existing `listUsers`/`myTasks` block (after Phase 2's Labels additions):

```javascript

    /* Custom fields --------------------------------------------------------- */
    listFields:  ()             => request('/api/fields/'),
    createField: (fields)       => request('/api/fields/', { method: 'POST', body: fields }),
    getField:    (id)           => request(`/api/fields/${id}/`),
    renameField: (id, name)     => request(`/api/fields/${id}/`, { method: 'PATCH', body: { name } }),
    deleteField: (id)           => request(`/api/fields/${id}/`, { method: 'DELETE' }),

    addFieldOption:    (fieldId, label)            => request(`/api/fields/${fieldId}/options/`, { method: 'POST', body: { label } }),
    renameFieldOption: (fieldId, optionId, label)  => request(`/api/fields/${fieldId}/options/${optionId}/`, { method: 'PATCH', body: { label } }),
    moveFieldOption:   (fieldId, optionId, fields) => request(`/api/fields/${fieldId}/options/${optionId}/`, { method: 'PATCH', body: fields }),
    deleteFieldOption: (fieldId, optionId)         => request(`/api/fields/${fieldId}/options/${optionId}/`, { method: 'DELETE' }),

    /* Screens ----------------------------------------------------------- */
    listScreens:  ()          => request('/api/screens/'),
    createScreen: (name)      => request('/api/screens/', { method: 'POST', body: { name } }),
    getScreen:    (id)        => request(`/api/screens/${id}/`),
    renameScreen: (id, name)  => request(`/api/screens/${id}/`, { method: 'PATCH', body: { name } }),
    deleteScreen: (id)        => request(`/api/screens/${id}/`, { method: 'DELETE' }),

    addScreenField:         (screenId, fieldId, required) => request(`/api/screens/${screenId}/fields/`, { method: 'POST', body: { field: fieldId, required: !!required } }),
    setScreenFieldRequired: (screenId, rowId, required)   => request(`/api/screens/${screenId}/fields/${rowId}/`, { method: 'PATCH', body: { required } }),
    moveScreenField:        (screenId, rowId, fields)     => request(`/api/screens/${screenId}/fields/${rowId}/`, { method: 'PATCH', body: fields }),
    removeScreenField:      (screenId, rowId)             => request(`/api/screens/${screenId}/fields/${rowId}/`, { method: 'DELETE' }),

    /* Per-project screen assignments ------------------------------------ */
    listScreenAssignments: (projectId)              => request(`/api/projects/${projectId}/screen-assignments/`),
    setScreenAssignments:  (projectId, assignments) => request(`/api/projects/${projectId}/screen-assignments/`, { method: 'PUT', body: assignments }),
```

`moveFieldOption`/`moveScreenField` take a `fields` object (`{position}`) rather than a bare direction, matching how Phase 1's status reorder works — the caller in `app.js` (Task 5.3/5.4) computes the swapped `position` pair itself, the same pattern already established.

- [ ] **Step 2: `store.js` — module state**

Add, right after the `labels`/`labelById`/`labelByName`/`resolveLabelNames` block from Phase 2:

```javascript

  let customFields = [];
  let nextFieldId = 5000;
  const fieldById = (fid) => customFields.find(f => f.id === Number(fid)) || null;

  let fieldOptions = [];
  let nextOptionId = 6000;
  const optionsForField = (fieldId) =>
    fieldOptions.filter(o => o.field === Number(fieldId)).sort((a, b) => a.position - b.position);

  let screens = [];
  let nextScreenId = 7000;
  const screenById = (sid) => screens.find(s => s.id === Number(sid)) || null;

  let screenFields = [];
  let nextScreenFieldId = 8000;
  const screenFieldsFor = (screenId) =>
    screenFields.filter(r => r.screen === Number(screenId)).sort((a, b) => a.position - b.position);

  // { [projectId]: { epic: screenId|null, story: ..., task: ..., bug: ..., subtask: ... } }
  const screenAssignments = {};
  function assignmentsForProject(projectId) {
    if (!screenAssignments[projectId]) {
      screenAssignments[projectId] = { epic: null, story: null, task: null, bug: null, subtask: null };
    }
    return screenAssignments[projectId];
  }

  const fieldOut = (f) => Object.assign({}, f, {
    options: optionsForField(f.id),
    created_by: userById(f.created_by),
  });
  const screenFieldOut = (r) => Object.assign({}, r, { field_detail: fieldOut(fieldById(r.field)) });
  const screenOut = (s) => Object.assign({}, s, { fields: screenFieldsFor(s.id).map(screenFieldOut) });
```

- [ ] **Step 3: `store.js` — field CRUD and options**

Add, right after the Labels functions block's closing (before `/* ---- me -------------------------------------------------------------- */`):

```javascript

  /* ---- custom fields ----------------------------------------------------- */

  function myRoles() {
    return memberships.filter(m => m.user === me.id).map(m => m.role);
  }

  function listFields() { return wait(customFields.map(fieldOut)); }

  function createField(fields) {
    if (!Logic.canManageDefinitions(myRoles())) {
      return fail(403, { detail: "You don't have permission to manage custom fields." });
    }
    const name = (fields.name || '').trim();
    if (!name) return fail(400, { name: 'This field may not be blank.' });
    if (customFields.some(f => f.name.toLowerCase() === name.toLowerCase())) {
      return fail(400, { name: `"${name}" already exists.` });
    }
    if (!Logic.FIELD_TYPES.includes(fields.field_type)) {
      return fail(400, { field_type: `"${fields.field_type}" is not a valid choice.` });
    }
    const field = { id: ++nextFieldId, name, field_type: fields.field_type, created_by: me.id, created_at: now() };
    customFields.push(field);
    return wait(fieldOut(field));
  }

  function getField(fieldId) {
    const field = fieldById(fieldId);
    return field ? wait(fieldOut(field)) : fail(404, { detail: 'Not found.' });
  }

  function renameField(fieldId, name) {
    const field = fieldById(fieldId);
    if (!field) return fail(404, { detail: 'Not found.' });
    if (!Logic.canManageDefinitions(myRoles())) {
      return fail(403, { detail: "You don't have permission to manage custom fields." });
    }
    const trimmed = (name || '').trim();
    if (!trimmed) return fail(400, { name: 'This field may not be blank.' });
    if (customFields.some(f => f.id !== field.id && f.name.toLowerCase() === trimmed.toLowerCase())) {
      return fail(400, { name: `"${trimmed}" already exists.` });
    }
    field.name = trimmed;
    return wait(fieldOut(field));
  }

  function deleteField(fieldId) {
    const field = fieldById(fieldId);
    if (!field) return fail(404, { detail: 'Not found.' });
    if (!Logic.canManageDefinitions(myRoles())) {
      return fail(403, { detail: "You don't have permission to manage custom fields." });
    }
    const onAScreen = screenFields.some(r => r.field === field.id);
    if (onAScreen) return fail(400, { detail: 'This field is still assigned to a screen. Remove it from every screen first.' });
    customFields = customFields.filter(f => f.id !== field.id);
    fieldOptions = fieldOptions.filter(o => o.field !== field.id);
    return wait(null);
  }

  function addFieldOption(fieldId, label) {
    const field = fieldById(fieldId);
    if (!field) return fail(404, { detail: 'Not found.' });
    if (!Logic.fieldHasOptions(field.field_type)) {
      return fail(400, { detail: 'Only Select and Multi-select fields have options.' });
    }
    if (!isOwnerOfAnyProject()) return fail(403, { detail: "You don't have permission to manage this field's options." });
    const trimmed = (label || '').trim();
    if (!trimmed) return fail(400, { label: 'This field may not be blank.' });
    const siblings = optionsForField(field.id);
    if (siblings.some(o => o.label.toLowerCase() === trimmed.toLowerCase())) {
      return fail(400, { label: `"${trimmed}" already exists for this field.` });
    }
    fieldOptions.push({ id: ++nextOptionId, field: field.id, label: trimmed, position: siblings.length });
    return wait(fieldOut(field));
  }

  function renameFieldOption(fieldId, optionId, label) {
    const field = fieldById(fieldId);
    const option = fieldOptions.find(o => o.id === Number(optionId) && o.field === Number(fieldId));
    if (!field || !option) return fail(404, { detail: 'Not found.' });
    if (!isOwnerOfAnyProject()) return fail(403, { detail: "You don't have permission to manage this field's options." });
    const trimmed = (label || '').trim();
    if (!trimmed) return fail(400, { label: 'This field may not be blank.' });
    if (optionsForField(field.id).some(o => o.id !== option.id && o.label.toLowerCase() === trimmed.toLowerCase())) {
      return fail(400, { label: `"${trimmed}" already exists for this field.` });
    }
    option.label = trimmed;
    return wait(fieldOut(field));
  }

  function moveFieldOption(fieldId, optionId, fields) {
    const field = fieldById(fieldId);
    const option = fieldOptions.find(o => o.id === Number(optionId) && o.field === Number(fieldId));
    if (!field || !option) return fail(404, { detail: 'Not found.' });
    if (!isOwnerOfAnyProject()) return fail(403, { detail: "You don't have permission to manage this field's options." });
    if ('position' in fields) option.position = Number(fields.position);
    return wait(fieldOut(field));
  }

  function deleteFieldOption(fieldId, optionId) {
    const field = fieldById(fieldId);
    const option = fieldOptions.find(o => o.id === Number(optionId) && o.field === Number(fieldId));
    if (!field || !option) return fail(404, { detail: 'Not found.' });
    if (!isOwnerOfAnyProject()) return fail(403, { detail: "You don't have permission to manage this field's options." });
    const chosen = workItems.some(w => {
      const v = (w.custom_fields || {})[field.id];
      return Logic.isMultiValue(field.field_type) ? (v || []).map(Number).includes(option.id) : Number(v) === option.id;
    });
    if (chosen) return fail(400, { detail: 'This option is still chosen on a work item.' });
    fieldOptions = fieldOptions.filter(o => o.id !== option.id);
    optionsForField(field.id).forEach((o, i) => { o.position = i; });
    return wait(fieldOut(field));
  }

  /* ---- screens ------------------------------------------------------------ */

  function listScreens() { return wait(screens.map(screenOut)); }

  function createScreen(name) {
    if (!Logic.canManageDefinitions(myRoles())) {
      return fail(403, { detail: "You don't have permission to manage screens." });
    }
    const trimmed = (name || '').trim();
    if (!trimmed) return fail(400, { name: 'This field may not be blank.' });
    if (screens.some(s => s.name.toLowerCase() === trimmed.toLowerCase())) {
      return fail(400, { name: `"${trimmed}" already exists.` });
    }
    const screen = { id: ++nextScreenId, name: trimmed };
    screens.push(screen);
    return wait(screenOut(screen));
  }

  function getScreen(screenId) {
    const screen = screenById(screenId);
    return screen ? wait(screenOut(screen)) : fail(404, { detail: 'Not found.' });
  }

  function renameScreen(screenId, name) {
    const screen = screenById(screenId);
    if (!screen) return fail(404, { detail: 'Not found.' });
    if (!Logic.canManageDefinitions(myRoles())) {
      return fail(403, { detail: "You don't have permission to manage screens." });
    }
    const trimmed = (name || '').trim();
    if (!trimmed) return fail(400, { name: 'This field may not be blank.' });
    if (screens.some(s => s.id !== screen.id && s.name.toLowerCase() === trimmed.toLowerCase())) {
      return fail(400, { name: `"${trimmed}" already exists.` });
    }
    screen.name = trimmed;
    return wait(screenOut(screen));
  }

  function deleteScreen(screenId) {
    const screen = screenById(screenId);
    if (!screen) return fail(404, { detail: 'Not found.' });
    if (!Logic.canManageDefinitions(myRoles())) {
      return fail(403, { detail: "You don't have permission to manage screens." });
    }
    const assignedSomewhere = Object.values(screenAssignments).some(a => Object.values(a).includes(screen.id));
    if (assignedSomewhere) return fail(400, { detail: 'This screen is still assigned to a project. Unassign it first.' });
    screens = screens.filter(s => s.id !== screen.id);
    screenFields = screenFields.filter(r => r.screen !== screen.id);
    return wait(null);
  }

  function addScreenField(screenId, fieldId, required) {
    const screen = screenById(screenId);
    const field = fieldById(fieldId);
    if (!screen || !field) return fail(404, { detail: 'Not found.' });
    if (!Logic.canManageDefinitions(myRoles())) {
      return fail(403, { detail: "You don't have permission to manage screens." });
    }
    if (screenFields.some(r => r.screen === screen.id && r.field === field.id)) {
      return fail(400, { field: 'This field is already on this screen.' });
    }
    const siblings = screenFieldsFor(screen.id);
    screenFields.push({
      id: ++nextScreenFieldId, screen: screen.id, field: field.id,
      required: !!required, position: siblings.length,
    });
    return wait(screenOut(screen));
  }

  function setScreenFieldRequired(screenId, rowId, required) {
    const screen = screenById(screenId);
    const row = screenFields.find(r => r.id === Number(rowId) && r.screen === Number(screenId));
    if (!screen || !row) return fail(404, { detail: 'Not found.' });
    if (!Logic.canManageDefinitions(myRoles())) {
      return fail(403, { detail: "You don't have permission to manage screens." });
    }
    row.required = !!required;
    return wait(screenOut(screen));
  }

  function moveScreenField(screenId, rowId, fields) {
    const screen = screenById(screenId);
    const row = screenFields.find(r => r.id === Number(rowId) && r.screen === Number(screenId));
    if (!screen || !row) return fail(404, { detail: 'Not found.' });
    if (!Logic.canManageDefinitions(myRoles())) {
      return fail(403, { detail: "You don't have permission to manage screens." });
    }
    if ('position' in fields) row.position = Number(fields.position);
    return wait(screenOut(screen));
  }

  function removeScreenField(screenId, rowId) {
    const screen = screenById(screenId);
    const row = screenFields.find(r => r.id === Number(rowId) && r.screen === Number(screenId));
    if (!screen || !row) return fail(404, { detail: 'Not found.' });
    if (!Logic.canManageDefinitions(myRoles())) {
      return fail(403, { detail: "You don't have permission to manage screens." });
    }
    screenFields = screenFields.filter(r => r.id !== row.id);
    screenFieldsFor(screen.id).forEach((r, i) => { r.position = i; });
    return wait(screenOut(screen));
  }

  /* ---- screen assignments -------------------------------------------------- */

  function listScreenAssignments(projectId) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    if (!myRole(projectId)) return denied();
    return wait(Object.assign({}, assignmentsForProject(projectId)));
  }

  function setScreenAssignments(projectId, assignments) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(projectId);
    if (!role) return denied();
    if (projectById(projectId).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageScreenAssignments(role)) {
      return fail(403, { detail: "You don't have permission to manage this project's field screens." });
    }
    const current = assignmentsForProject(projectId);
    for (const itemType of Object.keys(assignments)) {
      const screenId = assignments[itemType];
      if (screenId !== null && !screenById(screenId)) {
        return fail(400, { detail: `Screen ${screenId} does not exist.` });
      }
      current[itemType] = screenId;
    }
    return wait(Object.assign({}, current));
  }
```

- [ ] **Step 4: Export**

Add these lines to `store.js`'s final `return { ... }` block, right after `listLabels, renameLabel, recolorLabel, deleteLabel,` (Phase 2):

```javascript
    listFields, createField, getField, renameField, deleteField,
    addFieldOption, renameFieldOption, moveFieldOption, deleteFieldOption,
    listScreens, createScreen, getScreen, renameScreen, deleteScreen,
    addScreenField, setScreenFieldRequired, moveScreenField, removeScreenField,
    listScreenAssignments, setScreenAssignments,
```

- [ ] **Step 5: Thread `custom_fields` through `itemOut`/`createWorkItem`/`updateWorkItem`**

Per `docs/api.md`'s "Work Items — `custom_fields`" section, this is validated against the *assigned screen for the item's type in its project*, with per-value type coercion via `Logic.fieldValueError`/`screenValueErrors` from Task 5.1. Change `itemOut` (already modified once in Phase 2) from:

```javascript
  function itemOut(w) {
    return Object.assign({}, w, {
      assignee_detail: w.assignee ? userById(w.assignee) : null,
      created_by: userById(w.created_by),
      priority_label: Logic.PRIORITY_LABELS[w.priority],
      parent_detail: w.parent ? summaryOut(itemById(w.parent)) : null,
      components_detail: components.filter(c => w.components.includes(c.id)),
      labels_detail: labels.filter(l => (w.labels || []).includes(l.id)),
      status_detail: statusById(w.status),
    });
  }
```

to:

```javascript
  function itemOut(w) {
    return Object.assign({}, w, {
      assignee_detail: w.assignee ? userById(w.assignee) : null,
      created_by: userById(w.created_by),
      priority_label: Logic.PRIORITY_LABELS[w.priority],
      parent_detail: w.parent ? summaryOut(itemById(w.parent)) : null,
      components_detail: components.filter(c => w.components.includes(c.id)),
      labels_detail: labels.filter(l => (w.labels || []).includes(l.id)),
      status_detail: statusById(w.status),
      custom_fields: w.custom_fields || {},
    });
  }
```

Add `custom_fields: {},` to `seed()`'s default object, alongside `labels: [],` from Phase 2.

Add a shared validator, right above `createWorkItem` (before its current definition):

```javascript
  /* Validates `payload.custom_fields` against the assigned screen for
     `itemType` in `projectId`. Returns `{ value, error }` — `error` is
     `{ custom_fields: <message-or-per-field-object> }` on failure, matching
     the shape docs/api.md documents for the real endpoint's 400 body. */
  function validateCustomFields(projectId, itemType, rawValues, currentValues) {
    const assignments = assignmentsForProject(projectId);
    const screenId = assignments[itemType];
    if (!screenId) {
      if (rawValues && Object.keys(rawValues).length) {
        const label = Logic.ITEM_TYPE_LABEL[itemType];
        return { error: { custom_fields: `${label} items in this project have no screen assigned, so custom fields can't be set on them.` } };
      }
      return { value: currentValues || {} };
    }
    const screen = screenById(screenId);
    const rows = screenFieldsFor(screen.id).map(r => ({ field: fieldById(r.field), required: r.required }));
    const onScreenIds = new Set(rows.map(r => r.field.id));

    for (const key of Object.keys(rawValues || {})) {
      if (!onScreenIds.has(Number(key))) {
        const field = fieldById(key);
        return { error: { custom_fields: `"${field ? field.name : key}" isn't on the "${screen.name}" screen.` } };
      }
    }

    const contextFor = (field) => ({
      optionIds: optionsForField(field.id).map(o => o.id),
      memberIds: memberships.filter(m => m.project === Number(projectId)).map(m => m.user),
    });
    const errors = Logic.screenValueErrors(rows, rawValues, contextFor);
    if (Object.keys(errors).length) {
      const firstFieldId = Object.keys(errors)[0];
      return { error: { custom_fields: errors[firstFieldId] } };
    }

    const merged = Object.assign({}, currentValues || {});
    rows.forEach(r => {
      if (rawValues && r.field.id in rawValues) merged[r.field.id] = rawValues[r.field.id];
    });
    return { value: merged };
  }
```

In `createWorkItem`, right before the final `seed({...})` call (after the labels resolution added in Phase 2), add:

```javascript
    let customFieldsValue = {};
    if (fields.custom_fields) {
      const result = validateCustomFields(board.project, itemType, fields.custom_fields, {});
      if (result.error) return fail(400, result.error);
      customFieldsValue = result.value;
    }
```

and add `custom_fields: customFieldsValue,` to the `seed({...})` call's object literal (alongside `labels: labelIds,`).

In `updateWorkItem`, right before `item.updated_at = now();` (after the labels handling added in Phase 2), add:

```javascript
    if ('custom_fields' in fields) {
      const result = validateCustomFields(boardProject(item.board), item.item_type, fields.custom_fields, item.custom_fields);
      if (result.error) return fail(400, result.error);
      item.custom_fields = result.value;
    }
```

- [ ] **Step 6: Manual verification**

`?data=store`, console (as `asha`, Owner of project 1):

```javascript
const f = await Store.createField({ name: 'Story Points', field_type: 'number' })
const sel = await Store.createField({ name: 'Severity', field_type: 'select' })
await Store.addFieldOption(sel.id, 'Low'); await Store.addFieldOption(sel.id, 'High')
const scr = await Store.createScreen('Task Screen')
await Store.addScreenField(scr.id, f.id, true)     // required
await Store.addScreenField(scr.id, sel.id, false)
await Store.setScreenAssignments(1, { task: scr.id })
await Store.createWorkItem({ board: 11, item_type: 'task', title: 'x', custom_fields: {} })
// rejects 400: {custom_fields: '"Story Points" is required.'}
const item = await Store.createWorkItem({ board: 11, item_type: 'task', title: 'x', custom_fields: { [f.id]: 5 } })
item.custom_fields   // { [f.id]: 5 }
await Store.updateWorkItem(item.id, { custom_fields: { [f.id]: 'not a number' } })
// rejects 400: {custom_fields: '"Story Points" must be a number.'}
```

- [ ] **Step 7: Commit**

```bash
git add ui/static/js/api.js ui/static/js/store.js
git commit -m "$(cat <<'EOF'
feat(ui): add custom fields, screens, and screen-assignment plumbing

Threads custom_fields validation through work item create/update in the
mock, matching docs/api.md's per-field type coercion exactly.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 5.3: The Fields admin screen

**Files:**
- Modify: `ui/index.html` — nav link, new `tpl-fields` template
- Modify: `ui/static/js/app.js` — route, `viewFields`/`paintFields`/`fieldRow`/`openFieldOptionsModal`
- Modify: `ui/static/css/app.css` — admin-list/admin-row/hint/req-toggle-adjacent styles reused, plus field-specific bits

**Interfaces:**
- Consumes: `Api`/`Store` field methods (Task 5.2), `Logic.FIELD_TYPES`/`FIELD_TYPE_LABEL`/`FIELD_TYPE_HINT`/`fieldHasOptions`/`canManageDefinitions` (Task 5.1), `isOwnerOfAnyProject` (Task 2.3, adapted here to take the already-fetched `projects` list — see Step 3)
- Produces: `viewFields()`, reachable at `#/fields`

- [ ] **Step 1: Nav link and route**

In `ui/index.html`'s `tpl-shell` nav, add after the Labels link (Phase 2):

```html
      <a href="#/fields" data-nav="fields">Fields</a>
```

In `app.js`'s `route()`, add above the `/labels` branch (Phase 2):

```javascript
  if (hash === '/fields') { setActiveNav('fields'); return viewFields(); }
```

- [ ] **Step 2: `tpl-fields` template**

Append to `ui/index.html`, after `tpl-labels`'s closing `</template>` (Phase 2) and before the `<script>` tags:

```html

<template id="tpl-fields">
  <div class="page page-narrow">
    <div class="page-head">
      <h1>Custom fields</h1>
      <p class="page-sub">Global — one list, shared by every project. Put them on a Screen to make them appear on a work item.</p>
    </div>

    <form class="create-field" data-create-field novalidate hidden>
      <input name="name" placeholder="Field name" aria-label="Field name" required>
      <select name="field_type" aria-label="Field type" data-type-select></select>
      <button class="btn btn-primary" type="submit">Add field</button>
    </form>
    <p class="hint" data-type-hint hidden></p>
    <p class="form-error" data-create-error hidden></p>
    <p class="locked-note" data-locked hidden></p>

    <ul class="admin-list" data-list></ul>
  </div>
</template>
```

- [ ] **Step 3: `app.js` — `viewFields`/`paintFields`/`fieldRow`/`openFieldOptionsModal`**

Append after `labelChipInput`'s closing (end of Phase 2's addition, before `/* Project detail ... */` — or, more robustly, search for the end of the Labels admin section and insert right after it, before whatever function currently follows):

```javascript
/* Custom fields admin (sub-project 2b) ----------------------------------- */

async function viewFields() {
  const main = outlet();
  main.replaceChildren(tpl('tpl-fields'));

  const list = main.querySelector('[data-list]');
  const form = main.querySelector('[data-create-field]');
  const typeSelect = form.querySelector('[data-type-select]');
  const hint = main.querySelector('[data-type-hint]');
  const errorEl = main.querySelector('[data-create-error]');
  const locked = main.querySelector('[data-locked]');
  list.innerHTML = skeletonList(4);

  let projects;
  try { projects = await data.listProjects(); } catch (err) { list.innerHTML = ''; return handle(err); }
  const canManage = isOwnerOfAnyProject(projects);

  if (canManage) {
    form.hidden = false;
    typeSelect.replaceChildren(...Logic.FIELD_TYPES.map(t => new Option(Logic.FIELD_TYPE_LABEL[t], t)));
    const showHint = () => {
      hint.textContent = `${Logic.FIELD_TYPE_HINT[typeSelect.value]} A field's type is fixed once it's created.`;
      hint.hidden = false;
    };
    typeSelect.addEventListener('change', showHint);
    showHint();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      const nameInput = form.querySelector('[name=name]');
      try {
        const field = await data.createField({ name: nameInput.value, field_type: typeSelect.value });
        nameInput.value = '';
        nameInput.focus();
        toast(`"${field.name}" added`);
        await paintFields(list, true);
        if (Logic.fieldHasOptions(field.field_type)) openFieldOptionsModal(field.id, true, () => paintFields(list, true));
      } catch (err) {
        errorEl.textContent = errorText(err);
        errorEl.hidden = false;
      }
    });
  } else {
    locked.hidden = false;
    locked.textContent =
      'Only a project Owner can add or change custom fields — Owner of any project counts. ' +
      'You can see the whole list, and use these fields on any work item whose screen includes them.';
  }

  await paintFields(list, canManage);
}

async function paintFields(list, canManage) {
  list.innerHTML = skeletonList(4);
  try {
    const fields = await data.listFields();
    if (!fields.length) {
      list.innerHTML = canManage
        ? '<li class="empty">No custom fields yet. Name one above and pick its type.</li>'
        : '<li class="empty">No custom fields have been created yet.</li>';
      return;
    }
    const rows = fields.map(f => fieldRow(f, list, canManage));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, () => paintFields(list, canManage));
  }
}

function fieldRow(field, list, canManage) {
  const li = document.createElement('li');
  li.className = 'admin-row';
  const hasOptions = Logic.fieldHasOptions(field.field_type);

  const bits = [];
  if (hasOptions) bits.push(`${field.options.length} option${field.options.length === 1 ? '' : 's'}`);

  li.innerHTML =
    `<span class="name" ${canManage ? 'contenteditable="true" data-rename' : ''}>${esc(field.name)}</span>` +
    `<span class="type-badge ft">${esc(Logic.FIELD_TYPE_LABEL[field.field_type])}</span>` +
    (bits.length ? `<span class="row-meta">${esc(bits.join(' · '))}</span>` : '') +
    `<span class="actions">` +
      (hasOptions ? `<button class="btn" data-options>Options</button>` : '') +
      (canManage ? `<button class="btn btn-danger" data-delete>Delete</button>` : '') +
    `</span>`;

  const nameEl = li.querySelector('[data-rename]');
  if (nameEl) {
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
      if (e.key === 'Escape') { nameEl.textContent = field.name; nameEl.blur(); }
    });
    nameEl.addEventListener('blur', async () => {
      const value = nameEl.textContent.trim();
      if (!value || value === field.name) { nameEl.textContent = field.name; return; }
      try {
        await data.renameField(field.id, value);
        field.name = value;
        toast('Field renamed');
      } catch (err) {
        nameEl.textContent = field.name;
        handle(err);
      }
    });
  }

  const optionsBtn = li.querySelector('[data-options]');
  if (optionsBtn) {
    optionsBtn.addEventListener('click', () => openFieldOptionsModal(field.id, canManage, () => paintFields(list, canManage)));
  }

  const deleteBtn = li.querySelector('[data-delete]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      try {
        await data.deleteField(field.id);
        toast(`"${field.name}" deleted`);
        await paintFields(list, canManage);
      } catch (err) { handle(err); }
    });
  }

  return li;
}

/* Field options — an ordered list, edited in place. Reordering swaps an
   adjacent pair's `position` via two sequential PATCH calls, same pattern
   as Phase 1's status reorder. */
async function openFieldOptionsModal(fieldId, canManage, onChange) {
  let field;
  try { field = await data.getField(fieldId); } catch (err) { return handle(err); }
  if (!Logic.fieldHasOptions(field.field_type)) {
    return toast(`"${field.name}" is a ${Logic.FIELD_TYPE_LABEL[field.field_type]} — only Select and Multi-select have options.`, true);
  }

  const body =
    `<div class="modal-head">` +
      `<p class="eyebrow">${esc(field.name)} · <span class="type-badge ft">${esc(Logic.FIELD_TYPE_LABEL[field.field_type])}</span></p>` +
      `<button class="btn btn-quiet" type="button" data-close>Close</button>` +
    `</div>` +
    `<p class="hint">This order is the order they appear in the picker. Saved values store an option's id, never its label, so renaming one never changes what a work item already picked.</p>` +
    `<ul class="order-list" data-options></ul>` +
    `<p class="form-error" data-error hidden></p>` +
    (canManage
      ? `<form class="add-row" data-add novalidate>` +
          `<input name="label" placeholder="New option" aria-label="New option" autocomplete="off">` +
          `<button class="btn" type="submit">Add option</button>` +
        `</form>`
      : `<p class="hint">Only a project Owner can change these.</p>`);

  const { modal } = openModal(body);
  const listEl = modal.querySelector('[data-options]');
  const errorEl = modal.querySelector('[data-error]');
  const clearError = () => { errorEl.hidden = true; };
  const showError = (err) => { errorEl.textContent = errorText(err); errorEl.hidden = false; };

  function paint() {
    if (!field.options.length) {
      listEl.innerHTML = '<li class="empty-inline">No options yet — add the first one below.</li>';
      return;
    }
    listEl.replaceChildren(...field.options.map(optionRow));
  }

  function optionRow(option, i) {
    const last = i === field.options.length - 1;
    const li = document.createElement('li');
    li.className = 'order-row';
    li.innerHTML =
      (canManage
        ? `<span class="order-handle">` +
            `<button class="icon-btn" data-up ${i === 0 ? 'disabled' : ''} aria-label="Move up" type="button">▲</button>` +
            `<button class="icon-btn" data-down ${last ? 'disabled' : ''} aria-label="Move down" type="button">▼</button>` +
          `</span>`
        : '') +
      `<span class="pos-index">${i + 1}</span>` +
      `<span class="label" ${canManage ? 'contenteditable="true" data-rename' : ''}>${esc(option.label)}</span>` +
      (canManage ? `<button class="btn btn-danger" data-remove type="button">Remove</button>` : '');

    const run = async (fn) => {
      clearError();
      try {
        field = await fn();
        paint();
        if (onChange) onChange();
      } catch (err) { showError(err); }
    };

    const up = li.querySelector('[data-up]');
    if (up) up.addEventListener('click', () => run(() => data.moveFieldOption(field.id, option.id, { position: field.options[i - 1].position })
      .then(() => data.moveFieldOption(field.id, field.options[i - 1].id, { position: option.position }))
      .then(() => data.getField(field.id))));
    const down = li.querySelector('[data-down]');
    if (down) down.addEventListener('click', () => run(() => data.moveFieldOption(field.id, option.id, { position: field.options[i + 1].position })
      .then(() => data.moveFieldOption(field.id, field.options[i + 1].id, { position: option.position }))
      .then(() => data.getField(field.id))));
    const remove = li.querySelector('[data-remove]');
    if (remove) remove.addEventListener('click', () => run(() => data.deleteFieldOption(field.id, option.id)));

    const labelEl = li.querySelector('[data-rename]');
    if (labelEl) {
      labelEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); labelEl.blur(); }
        if (e.key === 'Escape') { labelEl.textContent = option.label; labelEl.blur(); }
      });
      labelEl.addEventListener('blur', async () => {
        const value = labelEl.textContent.trim();
        if (!value || value === option.label) { labelEl.textContent = option.label; return; }
        clearError();
        try {
          field = await data.renameFieldOption(field.id, option.id, value);
          paint();
          if (onChange) onChange();
        } catch (err) {
          labelEl.textContent = option.label;
          showError(err);
        }
      });
    }
    return li;
  }

  const addForm = modal.querySelector('[data-add]');
  if (addForm) {
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = addForm.querySelector('[name=label]');
      if (!input.value.trim()) return;
      clearError();
      try {
        field = await data.addFieldOption(field.id, input.value);
        input.value = '';
        input.focus();
        paint();
        if (onChange) onChange();
      } catch (err) { showError(err); }
    });
  }

  paint();
}

```

`moveFieldOption`'s up/down handlers chain three calls (`PATCH` the moving option to the neighbor's position, `PATCH` the neighbor to the moving option's old position, then re-`GET` the field for a consistent `options` array) rather than trying to reconcile two independent partial responses — simpler to read, and reordering options is not a hot path worth micro-optimizing.

- [ ] **Step 4: CSS**

Append to `ui/static/css/app.css`:

```css
/* Custom fields & screens (sub-project 2b) -------------------------------
   Deliberately built from pieces already here — the same row shell as
   Components/Statuses, the same pill geometry as work item type badges. */

.create-field[hidden] { display: none; }
.create-field { display: flex; gap: 8px; margin: 0 0 8px; }
.create-field input {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 7px 10px;
}
.create-field select {
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 7px 9px;
  cursor: pointer;
}

.hint { color: var(--ink-3); font-size: 12px; margin-bottom: 10px; }

/* A neutral sibling of .type-badge: same pill, no work-item colour, since
   a field's type isn't part of the Epic/Story/Task colour language. */
.type-badge.ft { color: var(--ink-3); }

.admin-list { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 7px; }
.admin-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: var(--r);
  padding: 10px 14px;
  animation: row-in .22s var(--ease-out) both;
  transition: border-color .12s ease;
}
.admin-row:hover { border-color: var(--rule-2); }
.admin-row .name { font-weight: 500; }
.admin-row .name[contenteditable] { border-radius: 2px; padding: 1px 4px; margin: -1px -4px; }
.admin-row .name[contenteditable]:hover,
.admin-row .name[contenteditable]:focus { background: var(--sunk); outline: none; }
.admin-row .row-meta {
  margin-left: auto;
  color: var(--ink-3);
  font-size: 11px;
  text-align: right;
  white-space: nowrap;
}
.admin-row .actions { display: flex; align-items: center; gap: 6px; }
.admin-row .btn { padding: 4px 9px; font-size: 12px; }

.pos-index { font-family: var(--mono); font-size: 10px; color: var(--ink-3); width: 14px; text-align: right; }

.add-row { display: flex; gap: 8px; margin-top: 10px; }
.add-row input, .add-row select {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 6px 9px;
}
```

(`.order-list`/`.order-row`/`.order-handle`/`.icon-btn`/`.locked-note` already exist from Phases 1-2 — this block does not redefine them.)

- [ ] **Step 5: Manual verification**

`make run`, sign in, click "Fields" in the nav. As an Owner: add a "Story Points" (Number) field and a "Severity" (Select) field — creating the Select one auto-opens its Options modal; add "Low"/"Medium"/"High", reorder them, rename one, delete one, close. Back on the list, click "Options" on Severity again — the order persisted. Delete "Story Points" — succeeds (unused). As a plain Member: the page shows the same fields, no create form, no rename/delete, and the locked-note.

- [ ] **Step 6: Commit**

```bash
git add ui/index.html ui/static/js/app.js ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): add the Fields admin screen with an options-reorder modal

Reachable at #/fields.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 5.4: The Screens admin screen

**Files:**
- Modify: `ui/index.html` — nav link, new `tpl-screens` template
- Modify: `ui/static/js/app.js` — route, `viewScreens`/`paintScreens`/`screenRow`/`openScreenFieldsModal`

**Interfaces:**
- Consumes: `Api`/`Store` screen methods (Task 5.2), `Logic.canManageDefinitions` (Task 5.1)
- Produces: `viewScreens()`, reachable at `#/screens`

- [ ] **Step 1: Nav link and route**

In `tpl-shell`, add right after the Fields link:

```html
      <a href="#/screens" data-nav="screens">Screens</a>
```

In `route()`, add above the `/fields` branch:

```javascript
  if (hash === '/screens') { setActiveNav('screens'); return viewScreens(); }
```

- [ ] **Step 2: `tpl-screens` template**

Append after `tpl-fields`:

```html

<template id="tpl-screens">
  <div class="page page-narrow">
    <div class="page-head">
      <h1>Screens</h1>
      <p class="page-sub">An ordered set of custom fields. A project points each work item type at one of these.</p>
    </div>

    <form class="create-screen" data-create-screen novalidate hidden>
      <input name="name" placeholder="Screen name" aria-label="Screen name" required>
      <button class="btn btn-primary" type="submit">Add screen</button>
    </form>
    <p class="form-error" data-create-error hidden></p>
    <p class="locked-note" data-locked hidden></p>

    <ul class="admin-list" data-list></ul>
  </div>
</template>
```

- [ ] **Step 3: `app.js`**

Append right after Task 5.3's `openFieldOptionsModal`:

```javascript
/* Screens admin (sub-project 2b) ------------------------------------------ */

async function viewScreens() {
  const main = outlet();
  main.replaceChildren(tpl('tpl-screens'));

  const list = main.querySelector('[data-list]');
  const form = main.querySelector('[data-create-screen]');
  const errorEl = main.querySelector('[data-create-error]');
  const locked = main.querySelector('[data-locked]');
  list.innerHTML = skeletonList(2);

  let projects;
  try { projects = await data.listProjects(); } catch (err) { list.innerHTML = ''; return handle(err); }
  const canManage = isOwnerOfAnyProject(projects);

  if (canManage) {
    form.hidden = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      const input = form.querySelector('[name=name]');
      try {
        const screen = await data.createScreen(input.value);
        input.value = '';
        toast(`"${screen.name}" added`);
        await paintScreens(list, true);
        openScreenFieldsModal(screen.id, true, () => paintScreens(list, true));
      } catch (err) {
        errorEl.textContent = errorText(err);
        errorEl.hidden = false;
      }
    });
  } else {
    locked.hidden = false;
    locked.textContent =
      'Only a project Owner can add or change screens — Owner of any project counts. ' +
      'Assigning one of these to a work item type is a per-project job, done on the project page.';
  }

  await paintScreens(list, canManage);
}

async function paintScreens(list, canManage) {
  list.innerHTML = skeletonList(2);
  try {
    const screens = await data.listScreens();
    if (!screens.length) {
      list.innerHTML = canManage
        ? '<li class="empty">No screens yet. Name one above, then add fields to it.</li>'
        : '<li class="empty">No screens have been created yet.</li>';
      return;
    }
    const rows = screens.map(s => screenRow(s, list, canManage));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, () => paintScreens(list, canManage));
  }
}

function screenRow(screen, list, canManage) {
  const li = document.createElement('li');
  li.className = 'admin-row';
  const required = screen.fields.filter(f => f.required).length;
  const meta = `${screen.fields.length} field${screen.fields.length === 1 ? '' : 's'}${required ? `, ${required} required` : ''}`;

  li.innerHTML =
    `<span class="name" ${canManage ? 'contenteditable="true" data-rename' : ''}>${esc(screen.name)}</span>` +
    `<span class="row-meta">${esc(meta)}</span>` +
    `<span class="actions">` +
      `<button class="btn" data-fields>Fields</button>` +
      (canManage ? `<button class="btn btn-danger" data-delete>Delete</button>` : '') +
    `</span>`;

  const nameEl = li.querySelector('[data-rename]');
  if (nameEl) {
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
      if (e.key === 'Escape') { nameEl.textContent = screen.name; nameEl.blur(); }
    });
    nameEl.addEventListener('blur', async () => {
      const value = nameEl.textContent.trim();
      if (!value || value === screen.name) { nameEl.textContent = screen.name; return; }
      try {
        await data.renameScreen(screen.id, value);
        screen.name = value;
        toast('Screen renamed');
        await paintScreens(list, canManage);
      } catch (err) {
        nameEl.textContent = screen.name;
        handle(err);
      }
    });
  }

  li.querySelector('[data-fields]').addEventListener('click', () => openScreenFieldsModal(screen.id, canManage, () => paintScreens(list, canManage)));

  const deleteBtn = li.querySelector('[data-delete]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      try {
        await data.deleteScreen(screen.id);
        toast(`"${screen.name}" deleted`);
        await paintScreens(list, canManage);
      } catch (err) { handle(err); }
    });
  }

  return li;
}

/* A screen's ordered field list, with the per-screen `required` toggle. */
async function openScreenFieldsModal(screenId, canManage, onChange) {
  let screen, allFields;
  try {
    [screen, allFields] = await Promise.all([data.getScreen(screenId), data.listFields()]);
  } catch (err) { return handle(err); }

  const body =
    `<div class="modal-head">` +
      `<p class="eyebrow">Screen · ${esc(screen.name)}</p>` +
      `<button class="btn btn-quiet" type="button" data-close>Close</button>` +
    `</div>` +
    `<p class="hint">This order is the order the fields appear on the work item form. <strong>Required</strong> is per screen — the same field can be required here and optional on another screen.</p>` +
    `<ul class="order-list" data-fields></ul>` +
    `<p class="form-error" data-error hidden></p>` +
    (canManage
      ? `<form class="add-row" data-add novalidate>` +
          `<select name="field" aria-label="Field to add" data-add-select></select>` +
          `<button class="btn" type="submit">Add field</button>` +
        `</form>`
      : `<p class="hint">Only a project Owner can change these.</p>`);

  const { modal } = openModal(body);
  const listEl = modal.querySelector('[data-fields]');
  const errorEl = modal.querySelector('[data-error]');
  const addForm = modal.querySelector('[data-add]');
  const addSelect = modal.querySelector('[data-add-select]');
  const clearError = () => { errorEl.hidden = true; };
  const showError = (err) => { errorEl.textContent = errorText(err); errorEl.hidden = false; };

  function paint() {
    if (!screen.fields.length) {
      listEl.innerHTML = '<li class="empty-inline">No fields on this screen yet. Until there are, assigning it to a work item type changes nothing.</li>';
    } else {
      listEl.replaceChildren(...screen.fields.map(screenFieldRow));
    }

    if (addSelect) {
      const onScreen = new Set(screen.fields.map(r => r.field.id));
      const available = allFields.filter(f => !onScreen.has(f.id));
      addSelect.replaceChildren(...available.map(f => new Option(`${f.name} · ${Logic.FIELD_TYPE_LABEL[f.field_type]}`, f.id)));
      const none = !available.length;
      addSelect.disabled = none;
      addForm.querySelector('button').disabled = none;
      if (none) addSelect.replaceChildren(new Option('Every custom field is already on this screen'));
    }
  }

  function screenFieldRow(row, i) {
    const last = i === screen.fields.length - 1;
    const li = document.createElement('li');
    li.className = 'order-row';
    li.innerHTML =
      (canManage
        ? `<span class="order-handle">` +
            `<button class="icon-btn" data-up ${i === 0 ? 'disabled' : ''} aria-label="Move up" type="button">▲</button>` +
            `<button class="icon-btn" data-down ${last ? 'disabled' : ''} aria-label="Move down" type="button">▼</button>` +
          `</span>`
        : '') +
      `<span class="pos-index">${i + 1}</span>` +
      `<span class="label">${esc(row.field_detail.name)}</span>` +
      `<span class="type-badge ft">${esc(Logic.FIELD_TYPE_LABEL[row.field_detail.field_type])}</span>` +
      (canManage
        ? `<label class="req-toggle ${row.required ? 'is-on' : ''}" data-required>` +
            `<input type="checkbox" ${row.required ? 'checked' : ''}>Required</label>`
        : `<span class="req-toggle ${row.required ? 'is-on' : ''}">${row.required ? 'Required' : 'Optional'}</span>`) +
      (canManage ? `<button class="btn btn-danger" data-remove type="button">Remove</button>` : '');

    const run = async (fn) => {
      clearError();
      try {
        screen = await fn();
        paint();
        if (onChange) onChange();
      } catch (err) { showError(err); }
    };

    const up = li.querySelector('[data-up]');
    if (up) up.addEventListener('click', () => run(() => data.moveScreenField(screen.id, row.id, { position: screen.fields[i - 1].position })
      .then(() => data.moveScreenField(screen.id, screen.fields[i - 1].id, { position: row.position }))
      .then(() => data.getScreen(screen.id))));
    const down = li.querySelector('[data-down]');
    if (down) down.addEventListener('click', () => run(() => data.moveScreenField(screen.id, row.id, { position: screen.fields[i + 1].position })
      .then(() => data.moveScreenField(screen.id, screen.fields[i + 1].id, { position: row.position }))
      .then(() => data.getScreen(screen.id))));
    const remove = li.querySelector('[data-remove]');
    if (remove) remove.addEventListener('click', () => run(() => data.removeScreenField(screen.id, row.id)));

    const toggle = li.querySelector('[data-required] input');
    if (toggle) toggle.addEventListener('change', () => run(() => data.setScreenFieldRequired(screen.id, row.id, toggle.checked)));
    return li;
  }

  if (addForm) {
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!addSelect.value) return;
      clearError();
      try {
        screen = await data.addScreenField(screen.id, Number(addSelect.value));
        paint();
        if (onChange) onChange();
      } catch (err) { showError(err); }
    });
  }

  paint();
}

```

- [ ] **Step 4: CSS**

Append:

```css
.req-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--rule-2);
  background: var(--surface);
  border-radius: 999px;
  padding: 2px 9px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: .07em;
  text-transform: uppercase;
  color: var(--ink-3);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color .12s ease, background .12s ease, color .12s ease;
}
.req-toggle:hover { border-color: var(--ink-3); }
.req-toggle.is-on { border-color: var(--accent); background: var(--accent-w); color: var(--accent); }
.req-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
```

- [ ] **Step 5: Manual verification**

`make run`, click "Screens" in the nav. Create a screen — its Fields modal auto-opens. Add both fields created in Task 5.3, mark "Story Points" required, reorder them, remove one, close. Reopen "Fields" from the list — the change persisted. Delete the screen — succeeds only if not assigned anywhere yet (Task 5.5 tests the "assigned, so blocked" path).

- [ ] **Step 6: Commit**

```bash
git add ui/index.html ui/static/js/app.js ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): add the Screens admin screen with a fields-reorder modal

Reachable at #/screens.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 5.5: Per-project Field screens section

**Files:**
- Modify: `ui/index.html` — `tpl-project` gains a "Field screens" section
- Modify: `ui/static/js/app.js` — `viewProject`'s render sequence, new `renderScreenAssignments`/`assignmentRow`

**Interfaces:**
- Consumes: `data.listScreenAssignments`, `data.setScreenAssignments`, `data.listScreens` (Task 5.2), `Logic.canManageScreenAssignments` (Task 5.1)
- Produces: `renderScreenAssignments(main, project)`, called from `viewProject`

- [ ] **Step 1: `index.html`**

In `tpl-project`, add this section right after the Statuses section (Phase 1) and before Members:

```html
    <section>
      <h2 class="section-label">Field screens</h2>
      <p class="page-sub section-note">Which screen each work item type uses in this project. Owner and Admins choose; "None" means built-in fields only.</p>
      <ul class="assign-list" data-assignments></ul>
    </section>
```

- [ ] **Step 2: CSS**

Append:

```css
.assign-list { list-style: none; margin: 0 0 20px; padding: 0; display: grid; gap: 6px; }
.assign-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: var(--r);
  padding: 9px 14px;
  animation: row-in .22s var(--ease-out) both;
  transition: border-color .12s ease;
}
.assign-row:hover { border-color: var(--rule-2); }
.assign-row .type-badge { width: 66px; text-align: center; }
.assign-row .assign-meta { color: var(--ink-3); font-size: 11px; flex: 1; }
.assign-row .assign-value { font-weight: 500; }
.assign-row .assign-value.is-none { font-weight: 400; color: var(--ink-3); }
.assign-select {
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 5px 8px;
  font-size: 12px;
  min-width: 190px;
  cursor: pointer;
  transition: border-color .12s ease, background .12s ease;
}
.assign-select:hover { border-color: var(--ink-3); background: var(--sunk); }
```

- [ ] **Step 3: `app.js`**

Wire the render call into `viewProject`, right after Phase 1's `renderStatuses(main, project);`:

```javascript
  renderScreenAssignments(main, project);
```

Add the functions, right after Phase 1's `statusRow` (before `/* Members ... */`):

```javascript
/* Per-project screen assignment (sub-project 2b) --------------------------
   One row per work item type. "None" is a real, common answer — it means
   the type keeps exactly the built-in fields it had before 2b existed. */

async function renderScreenAssignments(main, project) {
  const list = main.querySelector('[data-assignments]');
  if (!list) return;
  list.innerHTML = skeletonList(5);
  const canEdit = Logic.canManageScreenAssignments(project.my_role);

  try {
    const [assignments, allScreens] = await Promise.all([
      data.listScreenAssignments(project.id),
      data.listScreens(),
    ]);

    if (!allScreens.length) {
      list.innerHTML = '<li class="empty">No screens exist yet. Build one under <a href="#/screens">Screens</a> and every work item type here can point at it.</li>';
      return;
    }

    const rows = Logic.ITEM_TYPES.map(t => assignmentRow(t, assignments[t], allScreens, project, canEdit, main));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, () => renderScreenAssignments(main, project));
  }
}

function assignmentRow(itemType, screenId, allScreens, project, canEdit, main) {
  const li = document.createElement('li');
  li.className = 'assign-row';
  const screenName = screenId ? (allScreens.find(s => s.id === screenId) || {}).name : null;

  li.innerHTML =
    `<span class="type-badge type-${itemType}">${esc(Logic.ITEM_TYPE_LABEL[itemType])}</span>` +
    (canEdit
      ? `<select class="assign-select" data-screen aria-label="Screen for ${esc(Logic.ITEM_TYPE_LABEL[itemType])}">` +
          `<option value="">None — built-in fields only</option>` +
          allScreens.map(s => `<option value="${s.id}" ${screenId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('') +
        `</select>`
      : `<span class="assign-value ${screenId ? '' : 'is-none'}">${esc(screenName || 'None')}</span>`);

  const select = li.querySelector('[data-screen]');
  if (select) {
    const previous = screenId ? String(screenId) : '';
    select.addEventListener('change', async () => {
      const chosenName = select.options[select.selectedIndex].textContent;
      try {
        await data.setScreenAssignments(project.id, { [itemType]: select.value ? Number(select.value) : null });
        toast(select.value ? `${Logic.ITEM_TYPE_LABEL[itemType]}s now use "${chosenName}"` : `${Logic.ITEM_TYPE_LABEL[itemType]}s use built-in fields only`);
        await renderScreenAssignments(main, project);
      } catch (err) {
        select.value = previous;
        handle(err);
      }
    });
  }
  return li;
}

```

- [ ] **Step 4: Manual verification**

Open a project you own. The "Field screens" section lists all 5 item types, each with a screen `<select>`. Assign "Task Screen" (from Task 5.4) to Task — save (auto on change), reload the page — persists. Try deleting that screen from `#/screens` now — rejected with the "still assigned to a project" message from Task 5.2.

- [ ] **Step 5: Commit**

```bash
git add ui/index.html ui/static/js/app.js ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): add the per-project Field screens assignment section

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 5.6: Custom fields on the work item create form and detail modal

**Files:**
- Modify: `ui/static/js/app.js` — new `customFieldControl`/`customFieldControls`/`readCustomFieldInputs`/`bindChipChecks`/`clearCustomFieldErrors`/`applyCustomFieldErrors` helpers; `addWorkItemControl`; `openWorkItemModal`
- Modify: `ui/static/css/app.css` — `.cf-grid`/`.cf-field`/`.cf-wide`/`.req`/`.field-error`

**Interfaces:**
- Consumes: `data.listScreenAssignments` (needs a per-item-type lookup — add `Api.getScreenForItemType`/`Store.getScreenForItemType` convenience, see Step 1), `data.listMembers`, `Logic.fieldValueError` family (Task 5.1)
- Produces: rendered, validated custom field controls in both the board's inline "+ Add work item" form and the work item detail modal

- [ ] **Step 1: A convenience lookup — `getScreenForItemType`**

Add to `ui/static/js/api.js`, right after `listScreenAssignments`/`setScreenAssignments`:

```javascript
    getScreenForItemType: async (projectId, itemType) => {
      const [assignments, screens] = await Promise.all([request(`/api/projects/${projectId}/screen-assignments/`), request('/api/screens/')]);
      const screenId = assignments[itemType];
      return screenId ? screens.find(s => s.id === screenId) || null : null;
    },
```

Add to `ui/static/js/store.js`, right after `setScreenAssignments`:

```javascript
  async function getScreenForItemType(projectId, itemType) {
    const assignments = await listScreenAssignments(projectId);
    const screenId = assignments[itemType];
    return screenId ? screenOut(screenById(screenId)) : null;
  }
```

Export `getScreenForItemType,` in `store.js`'s `return { ... }` block, right after `listScreenAssignments, setScreenAssignments,`.

- [ ] **Step 2: The rendering/reading helpers**

Add to `ui/static/js/app.js`, right after Task 5.5's `assignmentRow` (before `/* Members ... */`):

```javascript
/* Custom field controls on a work item form ------------------------------
   One renderer, used by both the inline "add work item" form and the
   detail modal, so a field looks and behaves the same wherever it is
   filled in. */

const CF_WIDE_TYPES = ['text_long', 'multiselect'];

function customFieldControl(row, value, members) {
  const field = row.field_detail;
  const name = `cf-${field.id}`;
  const req = row.required ? '<em class="req">required</em>' : '';
  const wide = CF_WIDE_TYPES.includes(field.field_type);
  let control;
  let tag = 'label';

  switch (field.field_type) {
    case 'text_long':
      control = `<textarea name="${name}" data-cf="${field.id}" rows="3">${esc(value || '')}</textarea>`;
      break;
    case 'number':
      control = `<input type="number" step="any" name="${name}" data-cf="${field.id}" value="${esc(value == null ? '' : value)}">`;
      break;
    case 'date':
      control = `<input type="date" name="${name}" data-cf="${field.id}" value="${esc(value || '')}">`;
      break;
    case 'select':
      control =
        `<select name="${name}" data-cf="${field.id}"><option value="">—</option>` +
        field.options.map(o => `<option value="${o.id}" ${String(value) === String(o.id) ? 'selected' : ''}>${esc(o.label)}</option>`).join('') +
        `</select>`;
      break;
    case 'multiselect': {
      tag = 'div';
      const chosen = (value || []).map(String);
      control =
        `<div class="chip-check-list" data-cf="${field.id}">` +
        (field.options.length
          ? field.options.map(o => {
              const on = chosen.includes(String(o.id));
              return `<label class="chip-check ${on ? 'is-checked' : ''}"><input type="checkbox" value="${o.id}" ${on ? 'checked' : ''}>${esc(o.label)}</label>`;
            }).join('')
          : `<p class="empty-inline">No options defined yet — add some under Fields.</p>`) +
        `</div>`;
      break;
    }
    case 'checkbox': {
      tag = 'div';
      const on = value === true;
      control = `<div class="chip-check-list" data-cf="${field.id}"><label class="chip-check ${on ? 'is-checked' : ''}"><input type="checkbox" ${on ? 'checked' : ''}>Yes</label></div>`;
      break;
    }
    case 'user_picker':
      control =
        `<select name="${name}" data-cf="${field.id}"><option value="">—</option>` +
        members.map(m => `<option value="${m.user_detail.id}" ${String(value) === String(m.user_detail.id) ? 'selected' : ''}>${esc(m.user_detail.display_name || m.user_detail.username)}</option>`).join('') +
        `</select>`;
      break;
    default:
      control = `<input type="text" name="${name}" data-cf="${field.id}" value="${esc(value == null ? '' : value)}">`;
  }

  return `<${tag} class="field cf-field${wide ? ' cf-wide' : ''}" data-cf-wrap="${field.id}">` +
    `<span>${esc(field.name)}${req}</span>${control}` +
    `<span class="field-error" data-cf-error="${field.id}" hidden></span>` +
    `</${tag}>`;
}

function customFieldControls(rows, values, members) {
  return rows.map(row => customFieldControl(row, values ? values[row.field_detail.id] : undefined, members)).join('');
}

function readCustomFieldInputs(scope, rows) {
  const out = {};
  rows.forEach(row => {
    const field = row.field_detail;
    const el = scope.querySelector(`[data-cf="${field.id}"]`);
    if (!el) return;
    if (field.field_type === 'multiselect') {
      out[field.id] = Array.from(el.querySelectorAll('input:checked')).map(i => Number(i.value));
    } else if (field.field_type === 'checkbox') {
      const box = el.querySelector('input');
      out[field.id] = !!(box && box.checked);
    } else if (field.field_type === 'select' || field.field_type === 'user_picker') {
      out[field.id] = el.value ? Number(el.value) : null;
    } else {
      out[field.id] = el.value;
    }
  });
  return out;
}

function bindChipChecks(scope) {
  scope.querySelectorAll('.chip-check').forEach(chip => {
    const input = chip.querySelector('input');
    if (!input || chip.dataset.bound) return;
    chip.dataset.bound = '1';
    input.addEventListener('change', () => chip.classList.toggle('is-checked', input.checked));
  });
}

function clearCustomFieldErrors(scope) {
  scope.querySelectorAll('[data-cf-error]').forEach(el => { el.hidden = true; el.textContent = ''; });
  scope.querySelectorAll('.cf-field.has-error').forEach(el => el.classList.remove('has-error'));
}

function applyCustomFieldErrors(scope, message) {
  clearCustomFieldErrors(scope);
  // The server (and the mock, mirroring it) returns one message under
  // `custom_fields` for the FIRST problem found, not a per-field map — see
  // docs/api.md's `{"custom_fields": <message>}` shape. Shown as a form-
  // level error rather than pinned under one control, since we don't
  // reliably know which field id it names without parsing the message.
  const errorEl = scope.querySelector('[data-error]') || scope.querySelector('.form-error');
  if (errorEl) { errorEl.textContent = message; errorEl.hidden = false; }
}

```

- [ ] **Step 3: Wire into the inline "+ Add work item" form**

In `addWorkItemControl`, the click handler currently builds a static form. Change it to fetch the type's screen and re-render its custom fields whenever the type changes. Change:

```javascript
  btn.addEventListener('click', () => {
    const form = document.createElement('form');
    form.className = 'add-wi-form';
    form.innerHTML =
      `<select name="item_type" aria-label="Type">${
        Logic.ITEM_TYPES.map(t => `<option value="${t}"${t === 'task' ? ' selected' : ''}>${Logic.ITEM_TYPE_LABEL[t]}</option>`).join('')
      }</select>` +
      `<input name="title" placeholder="What needs doing?" aria-label="Title">` +
      `<label class="add-wi-parent" data-parent-wrap><span class="add-wi-label" data-parent-label>Parent</span>` +
      `<select name="parent" aria-label="Parent"><option value="">No parent</option></select></label>` +
      `<p class="form-error" data-error hidden></p>` +
      `<div class="add-wi-actions"><button class="btn btn-primary" type="submit">Add</button>` +
      `<button class="btn btn-quiet" type="button" data-cancel>Cancel</button></div>`;
    wrap.replaceChildren(form);
```

to:

```javascript
  btn.addEventListener('click', async () => {
    let members = [];
    try { members = await data.listMembers(boardState.projectId); } catch { /* proceed without user_picker options */ }

    const form = document.createElement('form');
    form.className = 'add-wi-form';
    form.innerHTML =
      `<select name="item_type" aria-label="Type">${
        Logic.ITEM_TYPES.map(t => `<option value="${t}"${t === 'task' ? ' selected' : ''}>${Logic.ITEM_TYPE_LABEL[t]}</option>`).join('')
      }</select>` +
      `<input name="title" placeholder="What needs doing?" aria-label="Title">` +
      `<label class="add-wi-parent" data-parent-wrap><span class="add-wi-label" data-parent-label>Parent</span>` +
      `<select name="parent" aria-label="Parent"><option value="">No parent</option></select></label>` +
      `<div class="cf-grid" data-cf-container></div>` +
      `<p class="form-error" data-error hidden></p>` +
      `<div class="add-wi-actions"><button class="btn btn-primary" type="submit">Add</button>` +
      `<button class="btn btn-quiet" type="button" data-cancel>Cancel</button></div>`;
    wrap.replaceChildren(form);
```

Then, right after the existing `typeSelect.addEventListener('change', refreshParent); refreshParent();` lines (still inside the same click handler), add:

```javascript
    const cfContainer = form.querySelector('[data-cf-container]');
    let currentScreen = null;
    async function refreshCustomFields() {
      try { currentScreen = await data.getScreenForItemType(boardState.projectId, typeSelect.value); }
      catch { currentScreen = null; }
      const rows = currentScreen ? currentScreen.fields : [];
      cfContainer.innerHTML = rows.length ? customFieldControls(rows, null, members) : '';
      bindChipChecks(cfContainer);
    }
    typeSelect.addEventListener('change', refreshCustomFields);
    await refreshCustomFields();
```

Finally, thread `custom_fields` into the submit handler's payload. Change:

```javascript
      try {
        await data.createWorkItem({
          board: boardState.boardId,
          item_type: typeSelect.value,
          title: titleInput.value,
          parent: (Logic.canHaveParent(typeSelect.value) && parentSelect.value) ? Number(parentSelect.value) : null,
          status,
        });
        await reloadBoard();
        toast('Work item created');
      } catch (err) {
        if (err && err.sessionExpired) return handle(err);
        errorEl.textContent = errorText(err);
        errorEl.hidden = false;
        submitBtn.disabled = false;
      }
```

to:

```javascript
      clearCustomFieldErrors(form);
      const payload = {
        board: boardState.boardId,
        item_type: typeSelect.value,
        title: titleInput.value,
        parent: (Logic.canHaveParent(typeSelect.value) && parentSelect.value) ? Number(parentSelect.value) : null,
        status,
      };
      if (currentScreen && currentScreen.fields.length) payload.custom_fields = readCustomFieldInputs(form, currentScreen.fields);
      try {
        await data.createWorkItem(payload);
        await reloadBoard();
        toast('Work item created');
      } catch (err) {
        if (err && err.sessionExpired) return handle(err);
        if (err && err.data && err.data.custom_fields) {
          applyCustomFieldErrors(form, err.data.custom_fields);
        } else {
          errorEl.textContent = errorText(err);
          errorEl.hidden = false;
        }
        submitBtn.disabled = false;
      }
```

- [ ] **Step 4: Wire into the work item detail modal**

Load the type's screen alongside the modal's other data. At the top of `openWorkItemModal`, change (building on Phase 2's `allLabels` addition):

```javascript
  try { allLabels = await data.listLabels(); } catch { allLabels = []; }
  const users = await cachedUsers();
```

to:

```javascript
  try { allLabels = await data.listLabels(); } catch { allLabels = []; }
  let members = [], screen = null;
  try { members = await data.listMembers(boardState.projectId); } catch { /* proceed without user_picker options */ }
  try { screen = await data.getScreenForItemType(boardState.projectId, item.item_type); } catch { screen = null; }
  const screenRows = screen ? screen.fields : [];
  const users = await cachedUsers();
```

Add the custom-fields block to the modal body. Right after the `<div class="grid-2">...</div>` block (the Due/Parent row) and before the `<p class="form-error" data-error hidden></p>` line, insert:

```javascript
    (screenRows.length ? `<div class="cf-block"><h2>Custom fields</h2><div class="cf-grid">${customFieldControls(screenRows, item.custom_fields, members)}</div></div>` : '') +
```

Handle orphaned values — a saved `custom_fields` entry whose field id is no longer on the assigned screen must still show, read-only, per `docs/api.md`'s implicit contract (it's never dropped on write unless explicitly overwritten) and this codebase's existing "nothing is silently discarded" ethos. Right after that line, insert:

```javascript
    (() => {
      const onScreenIds = new Set(screenRows.map(r => r.field_detail.id));
      const orphaned = Object.keys(item.custom_fields || {}).filter(fid => !onScreenIds.has(Number(fid)));
      if (!orphaned.length) return '';
      return `<div class="cf-block"><h2>Other saved values</h2>` +
        orphaned.map(fid => `<p class="orphan-note">Field ${esc(fid)}: ${esc(JSON.stringify(item.custom_fields[fid]))} (no longer on this item's screen)</p>`).join('') +
        `</div>`;
    })() +
```

Bind the chip-checks and thread `custom_fields` into the save payload. Right after the existing `modal.querySelectorAll('.chip-check').forEach(...)` block (which already binds the Components checkboxes), add:

```javascript
  bindChipChecks(modal);
```

In the save handler, right after `fields.labels = labelInput.getNames();` (Phase 2), add:

```javascript
  if (screenRows.length) fields.custom_fields = readCustomFieldInputs(modal, screenRows);
```

and in that same handler's `catch` block, change:

```javascript
    } catch (err) {
      if (err && err.sessionExpired) { close(); return handle(err); }
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
      saveBtn.disabled = false;
      reloadBoard().catch(() => {});
    }
```

to:

```javascript
    } catch (err) {
      if (err && err.sessionExpired) { close(); return handle(err); }
      if (err && err.data && err.data.custom_fields) {
        applyCustomFieldErrors(modal, err.data.custom_fields);
      } else {
        errorEl.textContent = errorText(err);
        errorEl.hidden = false;
      }
      saveBtn.disabled = false;
      reloadBoard().catch(() => {});
    }
```

- [ ] **Step 5: CSS**

Append:

```css
/* Custom fields on a work item -------------------------------------------- */

.cf-block { margin-top: 18px; border-top: 1px solid var(--rule); padding-top: 14px; }
.cf-block h2 {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--ink-3);
  font-weight: 400;
  margin: 0 0 10px;
}

.cf-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.cf-grid .cf-wide { grid-column: 1 / -1; }
.cf-field { margin-bottom: 0; }

.req {
  font-family: var(--mono);
  font-style: normal;
  font-size: 9px;
  letter-spacing: .07em;
  color: var(--accent);
  margin-left: 4px;
}

.field-error[hidden] { display: none; }
.field-error { display: block; color: var(--danger); font-size: 11.5px; margin-top: 4px; }
.cf-field.has-error input,
.cf-field.has-error textarea,
.cf-field.has-error select { border-color: var(--danger); }

.orphan-note { color: var(--ink-3); font-size: 11.5px; margin-bottom: 8px; }
```

- [ ] **Step 6: Manual verification**

On the project where Task 5.5 assigned "Task Screen" to Task: use "+ Add work item", pick type Task — the Story Points/Severity controls appear inline; leave Story Points blank and submit — the exact `"Story Points" is required.` message shows in the form's error area. Fill it in, submit — the item is created; open it — the same controls show with the saved values, editable and re-saveable. Switch the project's Task assignment to "None" (Task 5.5) and reopen the same item — a "Other saved values" block shows the old field's value, read-only, per the orphaned-values rule.

- [ ] **Step 7: Commit**

```bash
git add ui/static/js/api.js ui/static/js/store.js ui/static/js/app.js ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): wire custom fields into the work item create form and modal

Closes Wave 1 item W1.9 end to end — admin screens (Tasks 5.3-5.5) plus
actual rendering/validation/orphaned-value display on work items.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

---

## Phase 6 — Releases

Closes Wave 1 item **W1.5** (roadmap §6, size M). Backend: `GET/POST /api/projects/{id}/releases/`, `GET/PATCH/DELETE /api/projects/{id}/releases/{id}/`, `GET /api/projects/{id}/releases/{id}/work-items/`, plus `release`/`release_detail` on work item read/write (`docs/api.md` "Releases" and the `release` paragraph under "Work Items"). Design reference: `design/js/app.js` `renderReleases`/`releaseCard`/`releaseItemRow` (658-790), the release select/chip additions inside `openWorkItemModal`/`workItemCard` (visible in the read excerpts already captured from `design/js/app.js` around lines 2390-2391 and 2820-2821). `design/js/logic.js` `RELEASE_STATUSES`/`RELEASE_STATUS_LABEL`/`canManageReleases` (69-77). Spec: `docs/superpowers/specs/2026-08-24-tasky-releases-design.md` (sub-project 7, signed off).

Unlike `status`/`board`/`sprint`, **`release` has no immutability restriction** — `docs/api.md` is explicit that any project member can set or clear it via a plain `PATCH`, alongside any other edit, in one request. That makes this phase simpler than it might look: no dedicated "release action" endpoint to call from the modal, just one more field in the existing save payload.

### Task 6.1: `logic.js`

**Files:**
- Modify: `ui/static/js/logic.js`

**Interfaces:**
- Produces: `Logic.RELEASE_STATUSES`, `Logic.RELEASE_STATUS_LABEL`, `Logic.canManageReleases(role)`

- [ ] **Step 1: Add and export**

Insert after Phase 5's Custom Fields section:

```javascript
  /* ---- Releases (sub-project 7) --------------------------------------------
     Same governance tier as Components/Statuses: Owner/Admin manage the
     release itself; any project member can tag a work item with an
     existing one — an ordinary edit, no separate check. Flat status, no
     transition rules, same simplification Workflows itself uses. */
  const RELEASE_STATUSES = ['unreleased', 'released', 'archived'];
  const RELEASE_STATUS_LABEL = { unreleased: 'Unreleased', released: 'Released', archived: 'Archived' };
  const canManageReleases = (role) => role === 'owner' || role === 'admin';

```

Export: add `RELEASE_STATUSES, RELEASE_STATUS_LABEL, canManageReleases,` to the `return { ... }` block.

- [ ] **Step 2: Manual verification**

Console: `Logic.RELEASE_STATUSES.length === 3`; `Logic.canManageReleases('member') === false`.

- [ ] **Step 3: Commit**

```bash
git add ui/static/js/logic.js
git commit -m "$(cat <<'EOF'
feat(ui): add release status constants and manage predicate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 6.2: `api.js` and `store.js`

**Files:**
- Modify: `ui/static/js/api.js`
- Modify: `ui/static/js/store.js` — new `releases` seed array, CRUD functions, `release`/`release_detail` threaded through work items

**Interfaces:**
- Produces: `Api.listReleases(projectId)`, `Api.createRelease(projectId, {name, release_date})`, `Api.updateRelease(projectId, id, fields)`, `Api.deleteRelease(projectId, id)`, `Api.listReleaseWorkItems(projectId, id)`; matching `Store.*`

- [ ] **Step 1: `api.js`**

Add after the screen-assignment methods (Phase 5):

```javascript

    /* Releases ------------------------------------------------------------ */
    listReleases:  (projectId)          => request(`/api/projects/${projectId}/releases/`),
    createRelease: (projectId, fields)  => request(`/api/projects/${projectId}/releases/`, { method: 'POST', body: fields }),
    updateRelease: (projectId, id, fields) => request(`/api/projects/${projectId}/releases/${id}/`, { method: 'PATCH', body: fields }),
    deleteRelease: (projectId, id)      => request(`/api/projects/${projectId}/releases/${id}/`, { method: 'DELETE' }),
    listReleaseWorkItems: (projectId, id) => request(`/api/projects/${projectId}/releases/${id}/work-items/`),
```

- [ ] **Step 2: `store.js` — seed state and CRUD**

Add near the top, after the `screenAssignments` block from Phase 5:

```javascript

  let releases = [];
  let nextReleaseId = 9000;
  const releaseById = (rid) => releases.find(r => r.id === Number(rid)) || null;
  const releaseOut = (r) => Object.assign({}, r);
```

Add the CRUD functions, right after Phase 5's screen-assignment functions (before `/* ---- me ... */`):

```javascript

  /* ---- releases ------------------------------------------------------------ */

  function listReleases(projectId) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    if (!myRole(projectId)) return denied();
    return wait(
      releases.filter(r => r.project === Number(projectId))
              .sort((a, b) => (a.release_date || '￿').localeCompare(b.release_date || '￿') || a.name.localeCompare(b.name))
              .map(releaseOut)
    );
  }

  function createRelease(projectId, fields) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(projectId);
    if (!role) return denied();
    if (projectById(projectId).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageReleases(role)) return fail(403, { detail: "You don't have permission to manage releases." });
    const name = (fields.name || '').trim();
    if (!name) return fail(400, { name: 'This field may not be blank.' });
    if (releases.some(r => r.project === Number(projectId) && r.name.toLowerCase() === name.toLowerCase())) {
      return fail(400, { name: `"${name}" already exists.` });
    }
    const release = {
      id: ++nextReleaseId, project: Number(projectId), name,
      status: 'unreleased', release_date: fields.release_date || null,
    };
    releases.push(release);
    return wait(releaseOut(release));
  }

  function updateRelease(projectId, releaseId, fields) {
    const release = releaseById(releaseId);
    if (!release || release.project !== Number(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(release.project);
    if (!role) return denied();
    if (projectById(release.project).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageReleases(role)) return fail(403, { detail: "You don't have permission to manage releases." });
    if ('name' in fields) {
      const trimmed = (fields.name || '').trim();
      if (!trimmed) return fail(400, { name: 'This field may not be blank.' });
      if (releases.some(r => r.id !== release.id && r.project === release.project && r.name.toLowerCase() === trimmed.toLowerCase())) {
        return fail(400, { name: `"${trimmed}" already exists.` });
      }
      release.name = trimmed;
    }
    if ('status' in fields) {
      if (!Logic.RELEASE_STATUSES.includes(fields.status)) return fail(400, { status: `"${fields.status}" is not a valid choice.` });
      release.status = fields.status;
    }
    if ('release_date' in fields) release.release_date = fields.release_date || null;
    return wait(releaseOut(release));
  }

  function deleteRelease(projectId, releaseId) {
    const release = releaseById(releaseId);
    if (!release || release.project !== Number(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(release.project);
    if (!role) return denied();
    if (projectById(release.project).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageReleases(role)) return fail(403, { detail: "You don't have permission to manage releases." });
    releases = releases.filter(r => r.id !== release.id);
    workItems.forEach(w => { if (w.release === release.id) w.release = null; });
    return wait(null);
  }

  function listReleaseWorkItems(projectId, releaseId) {
    const release = releaseById(releaseId);
    if (!release || release.project !== Number(projectId)) return fail(404, { detail: 'Not found.' });
    if (!myRole(release.project)) return denied();
    return wait(workItems.filter(w => w.release === release.id).map(itemOut));
  }
```

- [ ] **Step 3: Export**

Add `listReleases, createRelease, updateRelease, deleteRelease, listReleaseWorkItems,` to `store.js`'s final `return { ... }` block, after Phase 5's screen-assignment exports.

- [ ] **Step 4: Thread `release`/`release_detail` through work items**

Change `itemOut` (last touched in Phase 5) to add `release_detail`:

```javascript
      status_detail: statusById(w.status),
      custom_fields: w.custom_fields || {},
```

becomes:

```javascript
      status_detail: statusById(w.status),
      custom_fields: w.custom_fields || {},
      release_detail: w.release ? releaseOut(releaseById(w.release)) : null,
```

Add `release: null,` to `seed()`'s default object, alongside `labels: [], custom_fields: {},`.

In `createWorkItem`, add `release: fields.release ? Number(fields.release) : null,` to the `seed({...})` call's object literal — but first validate it belongs to the same project, right before that call:

```javascript
    if (fields.release) {
      const release = releaseById(fields.release);
      if (!release || release.project !== board.project) {
        return fail(400, { release: "Release must belong to this item's project." });
      }
    }
```

In `updateWorkItem`, add release handling right before `item.updated_at = now();` (after Phase 5's custom_fields block):

```javascript
    if ('release' in fields) {
      if (fields.release) {
        const release = releaseById(fields.release);
        if (!release || release.project !== boardProject(item.board)) {
          return fail(400, { release: "Release must belong to this item's project." });
        }
        item.release = release.id;
      } else {
        item.release = null;
      }
    }
```

- [ ] **Step 5: Manual verification**

`?data=store`, console:

```javascript
const rel = await Store.createRelease(1, { name: 'v2.5.0', release_date: '2026-10-01' })
await Store.updateWorkItem(32, { release: rel.id })
await Store.getWorkItem(32)          // release_detail: {id, project:1, name:'v2.5.0', status:'unreleased', release_date:'2026-10-01'}
await Store.listReleaseWorkItems(1, rel.id)   // includes item 32
await Store.updateRelease(1, rel.id, { status: 'released' })
await Store.deleteRelease(1, rel.id)
await Store.getWorkItem(32)          // release_detail: null (cleared, item untouched otherwise)
```

- [ ] **Step 6: Commit**

```bash
git add ui/static/js/api.js ui/static/js/store.js
git commit -m "$(cat <<'EOF'
feat(ui): add release CRUD and thread release/release_detail through work items

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 6.3: The project page's Releases section

**Files:**
- Modify: `ui/index.html` — `tpl-project` gains a Releases section
- Modify: `ui/static/js/app.js` — `viewProject`'s render sequence, new `renderReleases`/`releaseCard`/`releaseItemRow`
- Modify: `ui/static/css/app.css`

**Interfaces:**
- Consumes: `data.listReleases`, `data.createRelease`, `data.updateRelease`, `data.deleteRelease`, `data.listReleaseWorkItems` (Task 6.2), `Logic.RELEASE_STATUSES`/`RELEASE_STATUS_LABEL`/`canManageReleases` (Task 6.1)

- [ ] **Step 1: `index.html`**

Add this section to `tpl-project`, right after the Field screens section (Phase 5) and before Members:

```html
    <section>
      <h2 class="section-label">Releases</h2>
      <p class="page-sub section-note">Named shippable milestones work items get tagged with — a separate axis from Sprints, which track iterations, not versions. Owner and Admins manage the list; any member can tag a work item with an existing one.</p>
      <div class="release-list" data-releases></div>
      <form class="create-release" data-create-release novalidate hidden>
        <input name="name" placeholder="Release name, e.g. v2.5.0" aria-label="Release name" required>
        <input type="date" name="release_date" aria-label="Target date">
        <button class="btn" type="submit">Add release</button>
      </form>
    </section>
```

- [ ] **Step 2: CSS**

Append:

```css
/* Releases (sub-project 7) ------------------------------------------------
   Same card shell as a Sprint (Phase 10) — a named container with a
   lifecycle whose items show inline — colour-coded by its own three
   states instead of active/completed, since a release's state is a
   status, not a timeline position. */

.create-release[hidden] { display: none; }
.create-release { display: flex; gap: 8px; margin: 10px 0 16px; }
.create-release input {
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 7px 10px;
  font-size: 13px;
}
.create-release input[name="name"] { flex: 1; }
.create-release input[type="date"] { flex: 0 0 160px; }

.release-list { display: grid; gap: 12px; margin-bottom: 10px; }
.release-card {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-left: 3px solid var(--rule-2);
  border-radius: var(--r);
  padding: 12px 16px;
}
.release-card.status-released { border-left-color: var(--accent); }
.release-card.status-archived { opacity: .7; }

.release-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.release-name { font-weight: 600; font-size: 14px; }
.release-name[contenteditable] { border-radius: 2px; padding: 1px 4px; margin: -1px -4px; }
.release-name[contenteditable]:hover,
.release-name[contenteditable]:focus { background: var(--sunk); outline: none; }

.release-status-select, .release-date-input {
  background: var(--sunk);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 3px 7px;
  font-size: 11px;
}

.release-status-badge {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: .07em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--sunk);
  color: var(--ink-3);
}
.release-status-badge.state-released { background: var(--accent-w); color: var(--accent); }

.release-items { list-style: none; margin: 10px 0 0; padding: 10px 0 0; border-top: 1px solid var(--rule); display: grid; gap: 6px; }
.release-item-row a {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--sunk);
  border-radius: var(--r);
  padding: 7px 10px;
  font-size: 12.5px;
  text-decoration: none;
  color: inherit;
}
.release-item-row a:hover { color: var(--accent); }
.release-item-row .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* The board card's small release tag — same pill geometry as the parent
   chip, colour-coded like the admin badge above. */
.release-chip-sm {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-3);
  background: var(--sunk);
  border-radius: 999px;
  padding: 1px 7px;
}
.release-chip-sm.state-released { background: var(--accent-w); color: var(--accent); }
```

- [ ] **Step 3: `app.js`**

Wire into `viewProject`, right after Phase 5's `renderScreenAssignments(main, project);`:

```javascript
  renderReleases(main, project);
```

Add the functions right after Phase 5's `assignmentRow` (before `/* Custom field controls ... */`, which Phase 5 also added — either order is fine, this plan places it right before that section):

```javascript
/* Releases (sub-project 7) ------------------------------------------------ */

async function renderReleases(main, project) {
  const list = main.querySelector('[data-releases]');
  const form = main.querySelector('[data-create-release]');
  if (!list || !form) return;
  const canManage = Logic.canManageReleases(project.my_role);
  form.hidden = !canManage;
  list.innerHTML = skeletonList(2);

  if (!form.dataset.wired) {
    form.dataset.wired = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = form.querySelector('[name=name]');
      const dateInput = form.querySelector('[name=release_date]');
      if (!nameInput.value.trim()) return;
      try {
        await data.createRelease(project.id, { name: nameInput.value, release_date: dateInput.value || null });
        nameInput.value = '';
        dateInput.value = '';
        await renderReleases(main, project);
      } catch (err) { handle(err); }
    });
  }

  try {
    const items = await data.listReleases(project.id);
    if (!items.length) {
      list.innerHTML = '<p class="empty">No releases yet.</p>';
      return;
    }
    const cards = await Promise.all(items.map(r => releaseCard(r, main, project, canManage)));
    list.replaceChildren(...cards);
    stagger(cards);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, () => renderReleases(main, project));
  }
}

async function releaseCard(release, main, project, canManage) {
  const card = document.createElement('div');
  card.className = `release-card status-${release.status}`;

  card.innerHTML =
    `<div class="release-head">` +
      `<span class="release-name" ${canManage ? 'contenteditable="true" data-rename' : ''}>${esc(release.name)}</span>` +
      (canManage
        ? `<select class="release-status-select" data-status aria-label="Status for ${esc(release.name)}">${
            Logic.RELEASE_STATUSES.map(s => `<option value="${s}" ${s === release.status ? 'selected' : ''}>${Logic.RELEASE_STATUS_LABEL[s]}</option>`).join('')
          }</select>`
        : `<span class="release-status-badge state-${release.status}">${Logic.RELEASE_STATUS_LABEL[release.status]}</span>`) +
      (canManage
        ? `<input type="date" class="release-date-input" data-date value="${esc(release.release_date || '')}" aria-label="Date for ${esc(release.name)}">`
        : `<span class="row-meta">${release.release_date ? esc(release.release_date) : 'No date set'}</span>`) +
      (canManage ? `<button class="btn btn-danger" type="button" data-delete>Delete</button>` : '') +
    `</div>` +
    `<ul class="release-items" data-items></ul>`;

  const itemsEl = card.querySelector('[data-items]');
  try {
    const items = await data.listReleaseWorkItems(project.id, release.id);
    itemsEl.innerHTML = items.length
      ? ''
      : '<li class="empty-inline">Nothing tagged with this release yet.</li>';
    if (items.length) itemsEl.replaceChildren(...items.map(item => releaseItemRow(item, project.id)));
  } catch (err) { handle(err); }

  const run = async (fn) => {
    try { await fn(); await renderReleases(main, project); } catch (err) { handle(err); }
  };

  const nameEl = card.querySelector('[data-rename]');
  if (nameEl) {
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
      if (e.key === 'Escape') { nameEl.textContent = release.name; nameEl.blur(); }
    });
    nameEl.addEventListener('blur', async () => {
      const value = nameEl.textContent.trim();
      if (!value || value === release.name) { nameEl.textContent = release.name; return; }
      try {
        await data.updateRelease(project.id, release.id, { name: value });
        toast('Release renamed');
      } catch (err) {
        nameEl.textContent = release.name;
        handle(err);
      }
    });
  }
  const statusEl = card.querySelector('[data-status]');
  if (statusEl) statusEl.addEventListener('change', () => run(() => data.updateRelease(project.id, release.id, { status: statusEl.value })));
  const dateEl = card.querySelector('[data-date]');
  if (dateEl) dateEl.addEventListener('change', () => run(() => data.updateRelease(project.id, release.id, { release_date: dateEl.value || null })));
  const deleteBtn = card.querySelector('[data-delete]');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete "${release.name}"? Any tagged work items will be un-tagged, not deleted.`)) return;
    await run(() => data.deleteRelease(project.id, release.id));
  });

  return card;
}

/* Reached from the project page, not a board — boardState isn't already
   pointed at this item's board, so it's set explicitly before opening the
   modal (which reads boardState.projectId/boardId to load components,
   members and sibling items for the parent picker). */
function releaseItemRow(item, projectId) {
  const li = document.createElement('li');
  li.className = 'release-item-row';
  li.innerHTML =
    `<a href="#" data-open-item>` +
      `<span class="key-pill">${esc(item.key)}</span>` +
      `<span class="type-badge type-${esc(item.item_type)}">${esc(Logic.ITEM_TYPE_LABEL[item.item_type])}</span>` +
      `<span class="title">${esc(item.title)}</span>` +
      `<span class="status-tag">${item.status_detail ? esc(item.status_detail.name) : ''}</span>` +
    `</a>`;
  li.querySelector('[data-open-item]').addEventListener('click', async (e) => {
    e.preventDefault();
    boardState.projectId = projectId;
    boardState.boardId = item.board;
    try { boardState.statuses = await data.listStatuses(projectId); } catch { /* modal shows what it can */ }
    openWorkItemModal(item.id);
  });
  return li;
}

```

- [ ] **Step 4: Wire the release select and card chip into the work item modal**

In `openWorkItemModal`, fetch the project's releases alongside its other loads. Change the `try { members = ... }`/`try { screen = ... }` block from Task 5.6 to also fetch releases:

```javascript
  let members = [], screen = null;
  try { members = await data.listMembers(boardState.projectId); } catch { /* proceed without user_picker options */ }
  try { screen = await data.getScreenForItemType(boardState.projectId, item.item_type); } catch { screen = null; }
  const screenRows = screen ? screen.fields : [];
  const users = await cachedUsers();
```

becomes:

```javascript
  let members = [], screen = null, projectReleases = [];
  try { members = await data.listMembers(boardState.projectId); } catch { /* proceed without user_picker options */ }
  try { screen = await data.getScreenForItemType(boardState.projectId, item.item_type); } catch { screen = null; }
  try { projectReleases = await data.listReleases(boardState.projectId); } catch { projectReleases = []; }
  const screenRows = screen ? screen.fields : [];
  const users = await cachedUsers();
```

Add a Release field to the modal's `<div class="grid-2">` (Due date / Parent row) by widening it to a three-column layout for this one row. Change:

```javascript
    `<div class="grid-2">` +
      `<label class="field"><span>Due</span><input type="date" name="due_date" value="${esc(item.due_date || '')}"></label>` +
      (showParent
```

to:

```javascript
    `<div class="grid-3">` +
      `<label class="field"><span>Due</span><input type="date" name="due_date" value="${esc(item.due_date || '')}"></label>` +
      `<label class="field"><span>Release</span><select name="release"><option value="">No release</option>${
        projectReleases.map(r => `<option value="${r.id}" ${item.release === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')
      }</select></label>` +
      (showParent
```

and change the matching closing `</div>` reference's neighboring markup below it — the block's final line, currently:

```javascript
        : `<div class="field field-note"><span>Parent</span><p class="empty-inline">An Epic sits at the top — it never has one.</p></div>`) +
    `</div>` +
```

stays exactly as-is (the wrapping `</div>` now closes the renamed `grid-3` instead of `grid-2` — no separate edit needed there, since the class name lives only on the opening tag). Add a `.grid-3 { grid-template-columns: repeat(3, 1fr); }` rule reuse — `ui/static/css/app.css` already defines `.grid-3` (used elsewhere for Status/Priority/Assignee), so no new CSS is needed here.

Thread `release` into the save payload — in the save handler, right after `fields.labels = labelInput.getNames();` (Phase 2) and the `custom_fields` line (Task 5.6), add:

```javascript
  fields.release = modal.querySelector('[name=release]').value || null;
```

Add the release chip to `workItemCard` — change (building on Phase 2's `labelChips` addition):

```javascript
  const labelChips = (item.labels_detail || []).length
    ? `<div class="card-labels">${item.labels_detail.map(l =>
        `<span class="label-chip label-chip-sm" style="background:${esc(l.color)}">${esc(l.name)}</span>`
      ).join('')}</div>`
    : '';
```

to:

```javascript
  const labelChips = (item.labels_detail || []).length
    ? `<div class="card-labels">${item.labels_detail.map(l =>
        `<span class="label-chip label-chip-sm" style="background:${esc(l.color)}">${esc(l.name)}</span>`
      ).join('')}</div>`
    : '';
  const releaseChip = item.release_detail
    ? `<span class="release-chip-sm state-${esc(item.release_detail.status)}">${esc(item.release_detail.name)}</span>`
    : '';
```

and add `releaseChip` into the `card-meta` line, right before `${who}`:

```javascript
    (parent || due || who ? `<div class="card-meta">${parent}${due}${who}</div>` : '');
```

becomes:

```javascript
    (parent || due || releaseChip || who ? `<div class="card-meta">${parent}${due}${releaseChip}${who}</div>` : '');
```

- [ ] **Step 5: Manual verification**

Open a project you own — the Releases section appears. Add "v2.5.0" with a target date — it appears as a card with an inline "Unreleased" status select and date. Open a work item on that project's board, pick "v2.5.0" from the new Release dropdown, save — the card now shows a release chip, and the release's card on the project page lists that item under it. Change the release's status to "Released" — the chip and card both pick up the accent color. Delete the release — the item's chip disappears, the item itself is untouched.

- [ ] **Step 6: Commit**

```bash
git add ui/index.html ui/static/js/app.js ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): add Releases section and wire release tagging into work items

Closes Wave 1 item W1.5.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

---

## Phase 7 — Attachments on work items

Closes Wave 1 item **W1.4** (roadmap §6, size M). Backend: `GET/POST /api/work-items/{id}/attachments/` (`POST` is `multipart/form-data`), `DELETE /api/attachments/{id}/`, `GET /api/attachments/{id}/download/` (`docs/api.md` "Attachments"). Design reference: `design/js/app.js`'s attachments block inside `openWorkItemModal` (2859-2867, 2934-3026) — `loadAttachments`/`attachmentRow`/the upload form handler. `design/js/logic.js` `canDeleteAttachment` (79-94). Spec: `docs/superpowers/specs/2026-08-24-tasky-task-detail-ux-design.md` (sub-project 8, signed off).

**Two real differences from the `design/` prototype**, both because `design/` has no backend to actually store bytes in:

1. **Upload is real multipart, not a `{filename, content_type, size}` stand-in.** `ui/static/js/api.js`'s shared `request()` helper always JSON-encodes its body — attachments need their own fetch call using `FormData`, with the browser setting `Content-Type: multipart/form-data; boundary=...` itself (never set that header by hand on a `FormData` body, or the boundary gets lost and the server can't parse it).
2. **Download is a plain link, not a blob URL.** `GET /api/attachments/{id}/download/` is a same-origin, cookie-authenticated `GET` that streams real bytes with `Content-Disposition: attachment` already set — an `<a href="...">` with the browser's native download behavior is simpler and more correct than fetching it in JS.

### Task 7.1: `logic.js`

**Files:**
- Modify: `ui/static/js/logic.js`

**Interfaces:**
- Produces: `Logic.canDeleteAttachment(uploadedBy, actingUserId, actingRole)`

- [ ] **Step 1: Add and export**

Insert after Phase 6's Releases section:

```javascript
  /* ---- Attachments (sub-project 8) ----------------------------------------
     Wider than a comment's author-only-unless-account-gone rule: the
     uploader can always delete their own upload, AND an Owner/Admin of the
     work item's project can delete anyone's — an attachment reads as
     shared project property rather than a personal remark. */
  function canDeleteAttachment(uploadedBy, actingUserId, actingRole) {
    if (uploadedBy !== null && uploadedBy !== undefined && Number(uploadedBy) === Number(actingUserId)) {
      return true;
    }
    return actingRole === 'owner' || actingRole === 'admin';
  }

```

Export: add `canDeleteAttachment,` to the `return { ... }` block.

- [ ] **Step 2: Manual verification**

Console: `Logic.canDeleteAttachment(2, 2, 'member') === true` (uploader); `Logic.canDeleteAttachment(3, 2, 'member') === false`; `Logic.canDeleteAttachment(3, 2, 'admin') === true`.

- [ ] **Step 3: Commit**

```bash
git add ui/static/js/logic.js
git commit -m "$(cat <<'EOF'
feat(ui): add the attachment delete-permission predicate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 7.2: `api.js` and `store.js`

**Files:**
- Modify: `ui/static/js/api.js` — `uploadAttachment` (raw `fetch`, not `request()`), `listAttachments`, `deleteAttachment`, `downloadUrl`
- Modify: `ui/static/js/store.js` — new `attachments` seed array + CRUD, using real `Blob`/`URL.createObjectURL` since a browser environment (unlike `design/`'s standalone mock) can genuinely hold file bytes in memory for the session

**Interfaces:**
- Produces: `Api.listAttachments(itemId)`, `Api.uploadAttachment(itemId, file)` (`file` a native `File`), `Api.deleteAttachment(id)`, `Api.downloadUrl(id)` (`(id) => string`, not a network call — just builds the URL for an `<a href>`); matching `Store.*`, where `Store.downloadUrl` returns an object-URL for the in-memory `Blob` instead of a server path

- [ ] **Step 1: `api.js`**

Add after the Releases methods:

```javascript

    /* Attachments --------------------------------------------------------- */
    listAttachments: (itemId) => request(`/api/work-items/${itemId}/attachments/`),
    uploadAttachment: async (itemId, file) => {
      const form = new FormData();
      form.append('file', file);
      const token = getCookie('csrftoken');
      const res = await fetch(`/api/work-items/${itemId}/attachments/`, {
        method: 'POST',
        headers: token ? { 'X-CSRFToken': token } : {},
        credentials: 'same-origin',
        body: form,
      });
      if (res.ok) return parseBody(res);
      const data = await parseBody(res);
      if (res.status === 403) {
        const me = await fetch('/api/auth/me/', { credentials: 'same-origin' });
        const err = Object.assign(new Error('Forbidden'), { status: 403, data });
        err.sessionExpired = (me.status === 403);
        throw err;
      }
      throw Object.assign(new Error('API ' + res.status), { status: res.status, data });
    },
    deleteAttachment: (id) => request(`/api/attachments/${id}/`, { method: 'DELETE' }),
    downloadUrl: (id) => `/api/attachments/${id}/download/`,
```

`uploadAttachment` deliberately duplicates `request()`'s CSRF-header and 403-disambiguation logic rather than reusing it, since `request()` always sets `Content-Type: application/json` and always `JSON.stringify`s its body whenever `body !== undefined` — neither is compatible with a `FormData` payload. Two similar-but-incompatible bodies (JSON vs. multipart) is the one place in this file that genuinely needs its own path rather than a shared helper.

- [ ] **Step 2: `store.js` — seed state and CRUD**

Add near the top, after the `releases` block from Phase 6:

```javascript

  let attachments = [];
  let nextAttachmentId = 10000;
  const attachmentById = (aid) => attachments.find(a => a.id === Number(aid)) || null;
  const attachmentOut = (a) => ({
    id: a.id, work_item: a.work_item, filename: a.filename, size: a.size,
    uploaded_by_detail: a.uploaded_by ? userById(a.uploaded_by) : null,
    uploaded_at: a.uploaded_at,
  });
```

Add the CRUD functions, right after Phase 6's release functions (before `/* ---- me ... */`):

```javascript

  /* ---- attachments ---------------------------------------------------------
     Real bytes: `file` is a genuine File from an <input type=file>, kept as
     a Blob in memory for the tab's lifetime (never sent anywhere — this is
     the mock) and served back out via a fresh object URL on download, so
     "download" in mock mode round-trips the actual bytes the user picked. */

  const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

  function listAttachments(itemId) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();
    return wait(attachments.filter(a => a.work_item === item.id).map(attachmentOut));
  }

  function uploadAttachment(itemId, file) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();
    if (projectById(boardProject(item.board)).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }
    if (!file) return fail(400, { file: 'This field is required.' });
    if (file.size > MAX_ATTACHMENT_SIZE) return fail(400, { file: 'File exceeds the 25 MB limit.' });
    const attachment = {
      id: ++nextAttachmentId, work_item: item.id, filename: file.name, size: file.size,
      uploaded_by: me.id, uploaded_at: now(), blob: file,
    };
    attachments.push(attachment);
    return wait(attachmentOut(attachment));
  }

  function deleteAttachment(attachmentId) {
    const attachment = attachmentById(attachmentId);
    if (!attachment) return fail(404, { detail: 'Not found.' });
    const item = itemById(attachment.work_item);
    const role = myRole(boardProject(item.board));
    if (!role) return denied();
    if (projectById(boardProject(item.board)).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }
    if (!Logic.canDeleteAttachment(attachment.uploaded_by, me.id, role)) {
      return fail(403, { detail: 'Only the uploader or an Owner/Admin can delete this attachment.' });
    }
    attachments = attachments.filter(a => a.id !== attachment.id);
    return wait(null);
  }

  // Not async, not a network call — matches Api.downloadUrl's synchronous
  // shape. A fresh object URL every call, since the previous one may have
  // already been revoked by the browser tab navigating away.
  function downloadUrl(attachmentId) {
    const attachment = attachmentById(attachmentId);
    return attachment ? URL.createObjectURL(attachment.blob) : '#';
  }
```

- [ ] **Step 3: Export**

Add `listAttachments, uploadAttachment, deleteAttachment, downloadUrl,` to `store.js`'s final `return { ... }` block.

- [ ] **Step 4: Manual verification**

`?data=store`, console (a `File` can be constructed directly for this test):

```javascript
const f = new File(['hello world'], 'notes.txt', { type: 'text/plain' })
const a = await Store.uploadAttachment(32, f)
await Store.listAttachments(32)      // [{..., filename: 'notes.txt', size: 11, uploaded_by_detail: {...}}]
Store.downloadUrl(a.id)              // a blob: URL
await Store.deleteAttachment(a.id)
await Store.listAttachments(32)      // []
const big = new File([new Uint8Array(26 * 1024 * 1024)], 'big.bin')
await Store.uploadAttachment(32, big)
// rejects 400 {file: 'File exceeds the 25 MB limit.'}
```

- [ ] **Step 5: Commit**

```bash
git add ui/static/js/api.js ui/static/js/store.js
git commit -m "$(cat <<'EOF'
feat(ui): add attachment upload/list/delete/download to both clients

uploadAttachment bypasses the shared JSON request() helper for a real
multipart/form-data body; downloadUrl is synchronous, matching the real
endpoint's plain-GET, cookie-authenticated download link.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 7.3: Attachments block in the work item modal

**Files:**
- Modify: `ui/static/js/app.js` — `openWorkItemModal` (new block + upload form wiring), new `loadAttachments`/`attachmentRow`/`fileExtBadge`/`formatBytes` helpers
- Modify: `ui/static/css/app.css`

**Interfaces:**
- Consumes: `data.listAttachments`, `data.uploadAttachment`, `data.deleteAttachment`, `data.downloadUrl` (Task 7.2), `Logic.canDeleteAttachment` (Task 7.1), `members` (already loaded in the modal by Task 5.6, for the caller's own role)

- [ ] **Step 1: Add the block to the modal body**

In `openWorkItemModal`'s body template, insert an Attachments block right after the Comments block (the modal's last existing block). Change the tail of the body string from:

```javascript
    `<div class="block">` +
      `<h2>Comments</h2>` +
      `<ul class="comment-list" data-comments><li class="loading">Loading…</li></ul>` +
      `<form class="comment-form" data-comment-form>` +
        `<input name="body" placeholder="Add a comment" aria-label="Comment">` +
        `<button class="btn" type="submit">Post</button>` +
      `</form>` +
    `</div>`;
```

to:

```javascript
    `<div class="block">` +
      `<h2>Comments</h2>` +
      `<ul class="comment-list" data-comments><li class="loading">Loading…</li></ul>` +
      `<form class="comment-form" data-comment-form>` +
        `<input name="body" placeholder="Add a comment" aria-label="Comment">` +
        `<button class="btn" type="submit">Post</button>` +
      `</form>` +
    `</div>` +

    `<div class="block">` +
      `<h2>Attachments</h2>` +
      `<ul class="attachment-list" data-attachments><li class="loading">Loading…</li></ul>` +
      `<form class="attachment-form" data-attachment-form>` +
        `<input type="file" name="file" data-attachment-file aria-label="Choose a file to upload">` +
        `<button class="btn" type="submit">Upload</button>` +
      `</form>` +
      `<p class="form-error" data-attachment-error hidden></p>` +
    `</div>`;
```

- [ ] **Step 2: Wire it up after the modal opens**

Right after the existing `modal.querySelector('[data-comment-form]').addEventListener(...)` block (the modal's last piece of wiring), add:

```javascript
  // Delete permission is per-attachment (uploader OR Owner/Admin), not a
  // single section-wide flag — needs "my role on this item's project",
  // which `members` (already fetched for the custom-field user_picker,
  // Task 5.6) already carries with no second network call.
  const myMembership = members.find(m => m.user_detail && m.user_detail.id === me.id);
  const myRoleHere = myMembership ? myMembership.role : null;

  loadAttachments(item, modal, myRoleHere);

  const attachmentForm = modal.querySelector('[data-attachment-form]');
  attachmentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = modal.querySelector('[data-attachment-file]');
    const attachmentError = modal.querySelector('[data-attachment-error]');
    attachmentError.hidden = true;
    const file = fileInput.files[0];
    if (!file) {
      attachmentError.textContent = 'Choose a file first.';
      attachmentError.hidden = false;
      return;
    }
    const submitBtn = attachmentForm.querySelector('button');
    submitBtn.disabled = true;
    try {
      await data.uploadAttachment(item.id, file);
      attachmentForm.reset();
      toast('Uploaded');
      loadAttachments(item, modal, myRoleHere);
    } catch (err) {
      if (err && err.sessionExpired) { close(); return handle(err); }
      attachmentError.textContent = errorText(err);
      attachmentError.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
```

- [ ] **Step 3: The loader/row functions and small formatting helpers**

Add, right after Task 6.3's `releaseItemRow` (before `/* Custom field controls ... */`):

```javascript
/* Attachments (sub-project 8) --------------------------------------------- */

function fileExtBadge(filename) {
  const dot = String(filename).lastIndexOf('.');
  return dot === -1 ? 'FILE' : filename.slice(dot + 1).toUpperCase().slice(0, 4);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadAttachments(item, modal, myRoleHere) {
  const list = modal.querySelector('[data-attachments]');
  if (!list) return;
  try {
    const rows = await data.listAttachments(item.id);
    if (!rows.length) {
      list.innerHTML = '<li class="empty-inline">No attachments yet.</li>';
      return;
    }
    list.replaceChildren(...rows.map(a => attachmentRow(a, item, modal, myRoleHere)));
  } catch (err) {
    list.innerHTML = '';
    errorState(list, err, () => loadAttachments(item, modal, myRoleHere));
  }
}

function attachmentRow(a, item, modal, myRoleHere) {
  const li = document.createElement('li');
  li.className = 'attachment-row';
  const uploader = a.uploaded_by_detail
    ? esc(a.uploaded_by_detail.display_name || a.uploaded_by_detail.username)
    : 'Deleted user';
  const canDelete = Logic.canDeleteAttachment(a.uploaded_by_detail ? a.uploaded_by_detail.id : null, me.id, myRoleHere);

  li.innerHTML =
    `<span class="attachment-ext">${esc(fileExtBadge(a.filename))}</span>` +
    `<span class="attachment-name">${esc(a.filename)}</span>` +
    `<span class="attachment-meta">${esc(formatBytes(a.size))} · ${uploader} · ${esc(String(a.uploaded_at).slice(0, 10))}</span>` +
    `<a class="btn btn-quiet" href="${esc(data.downloadUrl(a.id))}" download="${esc(a.filename)}">Download</a>` +
    (canDelete ? `<button class="btn btn-danger" type="button" data-delete-attachment>Delete</button>` : '');

  const delBtn = li.querySelector('[data-delete-attachment]');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      try {
        await data.deleteAttachment(a.id);
        toast('Attachment deleted');
        loadAttachments(item, modal, myRoleHere);
      } catch (err) { handle(err); }
    });
  }
  return li;
}

```

Against the real API, the `<a download>` attribute is advisory only — the server already sends `Content-Disposition: attachment`, so the browser downloads regardless of whether the attribute is honored; it's kept for the (harmless) case of a browser that ignores the header.

- [ ] **Step 4: CSS**

Append:

```css
/* Attachments (sub-project 8) --------------------------------------------- */

.attachment-list { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 6px; }
.attachment-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--sunk);
  border-radius: var(--r);
  padding: 7px 10px;
  font-size: 12.5px;
}
.attachment-ext {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: .05em;
  color: var(--ink-3);
  border: 1px solid var(--rule-2);
  border-radius: 4px;
  padding: 2px 5px;
  white-space: nowrap;
}
.attachment-name { font-weight: 500; }
.attachment-meta { margin-left: auto; color: var(--ink-3); font-size: 11px; white-space: nowrap; }
.attachment-row .btn-quiet, .attachment-row .btn-danger { padding: 2px 8px; font-size: 11px; }

.attachment-form { display: flex; gap: 8px; align-items: center; }
.attachment-form input[type=file] { flex: 1; font-size: 12px; color: var(--ink-2); }
```

- [ ] **Step 5: Manual verification**

Open any work item's detail modal. Confirm an Attachments block appears at the bottom, below Comments. Pick a small file and click Upload — it appears in the list with its extension badge, size, uploader and date. Click Download — the file downloads with its original name. As the uploader (or as an Owner/Admin), a Delete button is offered; as a plain member on someone else's upload, it is not. Delete it — confirms via toast, list updates. Try uploading a file over 25 MB — the exact `docs/api.md` message shows in the form's own error area, not a global toast.

- [ ] **Step 6: Commit**

```bash
git add ui/static/js/app.js ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): add the Attachments block to the work item detail modal

Closes Wave 1 item W1.4.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

---

## Phase 8 — Cross-project search

Closes Wave 1 item **W1.6** (roadmap §6, size M; the roadmap also bundles pagination — M41 — into this item, but `docs/api.md` is explicit that `GET /api/search/` is capped at 50 results with **no pagination today**, so that half stays a backend gap out of scope for this UI-only plan; note it, don't silently "fix" it). Backend: `GET /api/search/` (`docs/api.md` "Search"). Design reference: `design/js/app.js` `viewSearch`/`searchResultRow` (1907-1972). This is a fully standalone screen — no shared function in `app.js` is touched by this phase.

### Task 8.1: `api.js` and `store.js`

**Files:**
- Modify: `ui/static/js/api.js`
- Modify: `ui/static/js/store.js`

**Interfaces:**
- Produces: `Api.search(params)` (`params` a plain object of query params, only truthy ones sent); matching `Store.search(params)`

- [ ] **Step 1: `api.js`**

Add after the attachments methods (Phase 7):

```javascript

    /* Search --------------------------------------------------------------- */
    search: (params) => {
      const qs = new URLSearchParams();
      Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, v); });
      return request(`/api/search/?${qs.toString()}`);
    },
```

- [ ] **Step 2: `store.js`**

Add, right after Phase 7's attachment functions (before `/* ---- me ... */`):

```javascript

  /* ---- search --------------------------------------------------------------
     Cross-project, scoped to the caller's own memberships first, before any
     facet narrows further — a forged component/label/project value from a
     project the caller isn't in can never surface a result from it. */

  function search(params) {
    params = params || {};
    const q = (params.q || '').trim();
    if (!q && !params.item_type && !params.status_category && !params.priority && !params.assignee && !params.component && !params.label && !params.project) {
      return fail(400, { detail: 'Provide a search term or at least one filter.' });
    }
    if (q && q.length < 2) return fail(400, { q: 'Must be at least 2 characters.' });

    const myProjectIds = new Set(memberships.filter(m => m.user === me.id).map(m => m.project));
    let pool = workItems.filter(w => myProjectIds.has(boardProject(w.board)));

    if (params.project) {
      const pid = Number(params.project);
      if (!myProjectIds.has(pid)) return fail(400, { project: "You're not a member of this project." });
      pool = pool.filter(w => boardProject(w.board) === pid);
    }
    if (params.item_type) pool = pool.filter(w => w.item_type === params.item_type);
    if (params.status_category) pool = pool.filter(w => (statusById(w.status) || {}).category === params.status_category);
    if (params.priority) pool = pool.filter(w => w.priority === Number(params.priority));
    if (params.assignee) {
      const uid = Number(params.assignee);
      if (!userById(uid)) return fail(400, { assignee: 'User not found.' });
      pool = pool.filter(w => w.assignee === uid);
    }
    if (params.component) {
      const cid = Number(params.component);
      const component = components.find(c => c.id === cid);
      if (!component || !myProjectIds.has(component.project)) return fail(400, { component: 'Component not found.' });
      pool = pool.filter(w => (w.components || []).includes(cid));
    }
    if (params.label) {
      let label = /^\d+$/.test(String(params.label)) ? labelById(params.label) : null;
      if (!label) label = labelByName(params.label);
      if (!label) return fail(400, { label: 'Label not found.' });
      pool = pool.filter(w => (w.labels || []).includes(label.id));
    }

    let tier1 = [], tier2 = [];
    if (q) {
      const lower = q.toLowerCase();
      pool.forEach(w => {
        if (w.key.toLowerCase().includes(lower) || w.title.toLowerCase().includes(lower)) tier1.push(w);
        else if ((w.description || '').toLowerCase().includes(lower)) tier2.push(w);
      });
    } else {
      tier1 = pool;
    }
    const byRecency = (a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id;
    const ranked = tier1.sort(byRecency).concat(tier2.sort(byRecency)).slice(0, 50);

    const results = ranked.map(w => {
      const board = boardById(w.board);
      const project = projectById(board.project);
      return {
        id: w.id, key: w.key, title: w.title, item_type: w.item_type,
        status_detail: statusById(w.status), priority: w.priority, priority_label: Logic.PRIORITY_LABELS[w.priority],
        assignee_detail: w.assignee ? userById(w.assignee) : null,
        project: { id: project.id, key: project.key, name: project.name },
        board: { id: board.id, name: board.name },
        updated_at: w.updated_at,
      };
    });
    return wait({ results });
  }
```

- [ ] **Step 3: Export**

Add `search,` to `store.js`'s final `return { ... }` block.

- [ ] **Step 4: Manual verification**

`?data=store`, console:

```javascript
await Store.search({})                     // rejects 400 {detail: 'Provide a search term or at least one filter.'}
await Store.search({ q: 'a' })              // rejects 400 {q: 'Must be at least 2 characters.'}
await Store.search({ q: 'onboarding' })     // {results: [{key: 'TASKY-1', title: 'Redesign onboarding', ...}]}
await Store.search({ item_type: 'bug' })    // every seeded bug across every project asha is in
await Store.search({ project: 3 })          // 400 if asha isn't a member — she is (per the seed), so this returns CLNT's items only
```

- [ ] **Step 5: Commit**

```bash
git add ui/static/js/api.js ui/static/js/store.js
git commit -m "$(cat <<'EOF'
feat(ui): add cross-project search to the API and mock clients

Pagination (roadmap M41) stays a backend gap, out of scope for this
UI-only phase — results are capped at 50, same as the real endpoint.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 8.2: The Search screen

**Files:**
- Modify: `ui/index.html` — nav link, new `tpl-search` template
- Modify: `ui/static/js/app.js` — route, `viewSearch`/`searchResultRow`
- Modify: `ui/static/css/app.css`

**Interfaces:**
- Consumes: `data.search`, `data.listUsers`, `data.listProjects`, `data.listLabels` (Task 8.1 and earlier phases)
- Produces: `viewSearch()`, reachable at `#/search`

- [ ] **Step 1: Nav link and route**

In `tpl-shell`, add after the Screens link (Phase 5):

```html
      <a href="#/search" data-nav="search">Search</a>
```

In `route()`, add above the `/screens` branch:

```javascript
  if (hash === '/search') { setActiveNav('search'); return viewSearch(); }
```

- [ ] **Step 2: `tpl-search` template**

Append after `tpl-screens` (Phase 5):

```html

<template id="tpl-search">
  <div class="page page-narrow">
    <div class="page-head">
      <h1>Search</h1>
      <p class="page-sub">Across every project you're a member of — never one you're not.</p>
    </div>

    <form class="search-form" data-search-form novalidate>
      <input type="text" name="q" placeholder="Search title, description, key…" aria-label="Search text">
      <div class="search-facets">
        <select name="item_type" aria-label="Type"><option value="">Any type</option></select>
        <select name="status_category" aria-label="Status"><option value="">Any status</option></select>
        <select name="priority" aria-label="Priority"><option value="">Any priority</option></select>
        <select name="assignee" aria-label="Assignee"><option value="">Any assignee</option></select>
        <select name="project" aria-label="Project"><option value="">Any project</option></select>
        <select name="label" aria-label="Label"><option value="">Any label</option></select>
      </div>
      <button class="btn btn-primary" type="submit">Search</button>
    </form>
    <p class="form-error" data-error hidden></p>

    <ul class="search-results" data-results></ul>
  </div>
</template>
```

- [ ] **Step 3: `app.js`**

Append after Phase 7's `attachmentRow` (before `/* Custom field controls ... */`):

```javascript
/* Search (sub-project 5) --------------------------------------------------- */

async function viewSearch() {
  const main = outlet();
  main.replaceChildren(tpl('tpl-search'));

  const form = main.querySelector('[data-search-form]');
  const errorEl = main.querySelector('[data-error]');
  const resultsEl = main.querySelector('[data-results]');

  form.querySelector('[name=item_type]').append(...Logic.ITEM_TYPES.map(t => new Option(Logic.ITEM_TYPE_LABEL[t], t)));
  form.querySelector('[name=status_category]').append(...Logic.CATEGORIES.map(c => new Option(Logic.CATEGORY_LABELS[c], c)));
  form.querySelector('[name=priority]').append(new Option('Low', '1'), new Option('Medium', '2'), new Option('High', '3'));

  try {
    const [users, myProjects, allLabels] = await Promise.all([data.listUsers(), data.listProjects(), data.listLabels()]);
    form.querySelector('[name=assignee]').append(...users.map(u => new Option(u.display_name || u.username, u.id)));
    form.querySelector('[name=project]').append(...myProjects.map(p => new Option(`${p.key} — ${p.name}`, p.id)));
    form.querySelector('[name=label]').append(...allLabels.map(l => new Option(l.name, l.id)));
  } catch { /* facets are a nice-to-have; a plain text search still works without them */ }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const formData = new FormData(form);
    const params = {};
    for (const [key, value] of formData.entries()) { if (value) params[key] = value; }

    resultsEl.innerHTML = skeletonList(4);
    try {
      const { results } = await data.search(params);
      if (!results.length) {
        resultsEl.innerHTML = '<li class="empty">No matches.</li>';
        return;
      }
      const rows = results.map(searchResultRow);
      resultsEl.replaceChildren(...rows);
      stagger(rows);
    } catch (err) {
      if (err && err.sessionExpired) return handle(err);
      resultsEl.innerHTML = '';
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
    }
  });
}

function searchResultRow(item) {
  const li = document.createElement('li');
  li.className = 'search-result-row';
  const who = item.assignee_detail
    ? `<span class="who-chip">${esc(item.assignee_detail.display_name || item.assignee_detail.username)}</span>`
    : '';
  li.innerHTML =
    `<a href="#/projects/${item.project.id}/boards/${item.board.id}">` +
      `<span class="key-pill">${esc(item.key)}</span>` +
      `<span class="type-badge type-${esc(item.item_type)}">${esc(Logic.ITEM_TYPE_LABEL[item.item_type])}</span>` +
      `<span class="search-title">${esc(item.title)}</span>` +
      `<span class="search-meta">${esc(item.project.key)} · ${item.status_detail ? esc(item.status_detail.name) : ''}</span>` +
      who +
    `</a>`;
  return li;
}

```

- [ ] **Step 4: CSS**

Append:

```css
/* Search (sub-project 5) -------------------------------------------------- */

.search-form { display: grid; gap: 10px; margin-bottom: 6px; }
.search-form input[type="text"] {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 9px 12px;
  font-size: 14px;
}
.search-form input[type="text"]:focus { border-color: var(--accent); outline: none; }
.search-facets { display: flex; flex-wrap: wrap; gap: 8px; }
.search-facets select {
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 6px 9px;
  font-size: 12px;
}
.search-form .btn { justify-self: start; }

.search-results { list-style: none; margin: 18px 0 0; padding: 0; display: grid; gap: 7px; }
.search-result-row a {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: var(--r);
  padding: 9px 14px;
  text-decoration: none;
  color: var(--ink);
  animation: row-in .22s var(--ease-out) both;
}
.search-result-row a:hover { border-color: var(--rule-2); }
.search-title { flex: 1; font-size: 13px; }
.search-meta { font-size: 11px; color: var(--ink-3); }
```

- [ ] **Step 5: Manual verification**

`make run`, click "Search" in the nav. Type "onboarding" — matching items appear ranked with key/title matches above description-only matches. Clear the text and pick "Bug" from the Type facet — every bug across every project you're a member of appears. Combine text + a facet. Click a result — lands on that item's board with the right project/board in the URL. Confirm a project you are not a member of never appears as a Project facet option and can't be reached via a forged `?project=` value (network tab: manually adding `&project=<other id>` to the request returns the 400 the mock/API both document).

- [ ] **Step 6: Commit**

```bash
git add ui/index.html ui/static/js/app.js ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): add the cross-project Search screen

Closes Wave 1 item W1.6 (pagination, roadmap M41, stays a backend gap).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

---

## Phase 9 — Bulk operations + CSV import

Closes Wave 1 item **W1.7** (roadmap §6, size M; roadmap also bundles CSV **export** — M46 — which has no backend endpoint at all yet, so it stays out of scope here, UI-only phase). Backend: `POST /api/work-items/bulk-move/`, `POST /api/work-items/bulk-update/`, `POST /api/work-items/bulk-delete/`, `POST /api/boards/{id}/import/` (multipart) — `docs/api.md` "Bulk Operations & Import". Design reference: `design/js/app.js` `toggleSelectMode`/`toggleCardSelection`/`renderBulkBar`/`reportBulkResult`/`openImportModal` (2426-2610), the select-mode additions inside `workItemCard`/`columnEl` (2382-2424, 2357-2380).

**One documented gotcha this phase must respect:** per `docs/api.md`, *"Bulk operations do not fire automation."* Nothing to implement here — just don't be surprised in manual testing when a bulk-moved item's automation rules (Phase 11) silently don't fire; that's correct, documented behavior.

### Task 9.1: `api.js` and `store.js`

**Files:**
- Modify: `ui/static/js/api.js`
- Modify: `ui/static/js/store.js`

**Interfaces:**
- Produces: `Api.bulkMoveWorkItems(ids, statusId)`, `Api.bulkUpdateWorkItems(ids, fields)`, `Api.bulkDeleteWorkItems(ids)`, `Api.importWorkItems(boardId, csvFile)`; matching `Store.*`

- [ ] **Step 1: `api.js`**

Add after the search method (Phase 8):

```javascript

    /* Bulk operations & import ---------------------------------------------- */
    bulkMoveWorkItems:   (ids, statusId) => request('/api/work-items/bulk-move/', { method: 'POST', body: { ids, status: statusId } }),
    bulkUpdateWorkItems: (ids, fields)   => request('/api/work-items/bulk-update/', { method: 'POST', body: Object.assign({ ids }, fields) }),
    bulkDeleteWorkItems: (ids)           => request('/api/work-items/bulk-delete/', { method: 'POST', body: { ids } }),
    importWorkItems: async (boardId, csvFile) => {
      const form = new FormData();
      form.append('csv', csvFile);
      const token = getCookie('csrftoken');
      const res = await fetch(`/api/boards/${boardId}/import/`, {
        method: 'POST',
        headers: token ? { 'X-CSRFToken': token } : {},
        credentials: 'same-origin',
        body: form,
      });
      if (res.ok) return parseBody(res);
      const data = await parseBody(res);
      if (res.status === 403) {
        const me = await fetch('/api/auth/me/', { credentials: 'same-origin' });
        const err = Object.assign(new Error('Forbidden'), { status: 403, data });
        err.sessionExpired = (me.status === 403);
        throw err;
      }
      throw Object.assign(new Error('API ' + res.status), { status: res.status, data });
    },
```

`importWorkItems` repeats the same raw-`fetch` multipart pattern `uploadAttachment` established in Phase 7, for the same reason: `request()` cannot send a `FormData` body.

- [ ] **Step 2: `store.js` — bulk operations**

Add, right after Phase 8's `search` function (before `/* ---- me ... */`):

```javascript

  /* ---- bulk operations & import ---------------------------------------------
     Best-effort per id/row, not all-or-nothing, matching docs/api.md exactly:
     an id/row that fails is reported in the response, everything else still
     goes through. */

  function resolveBulkBatch(rawIds) {
    if (!Array.isArray(rawIds) || !rawIds.length) return { error: fail(400, { ids: 'Provide a non-empty list of ids.' }) };
    if (rawIds.length > 200) return { error: fail(400, { ids: 'No more than 200 ids per request.' }) };
    const ids = rawIds.map(Number);
    if (ids.some(Number.isNaN)) return { error: fail(400, { ids: 'Every id must be an integer.' }) };

    const found = ids.map(i => itemById(i)).filter(Boolean);
    if (!found.length) return { error: fail(400, { ids: 'None of these ids exist.' }) };
    const projectIds = new Set(found.map(w => boardProject(w.board)));
    if (projectIds.size > 1) return { error: fail(400, { ids: 'All ids must belong to work items in the same project.' }) };

    const projectId = [...projectIds][0];
    if (!myRole(projectId)) return { error: denied() };
    if (projectById(projectId).is_archived) {
      return { error: fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' }) };
    }
    const foundIds = new Set(found.map(w => w.id));
    const missing = [...new Set(ids)].filter(i => !foundIds.has(i));
    return { items: found, missing, projectId };
  }

  function bulkMoveWorkItems(rawIds, statusId) {
    const batch = resolveBulkBatch(rawIds);
    if (batch.error) return batch.error;
    const status = statusById(statusId);
    if (!status || status.project !== batch.projectId) return fail(400, { status: "Status must belong to this item's project." });

    const succeeded = [];
    batch.items.forEach(item => {
      const from = item.status;
      item.status = status.id;
      item.position = 0.5 + workItems.filter(w => w.board === item.board && w.status === status.id && w.id !== item.id).length;
      renumber(item.board, status.id);
      if (from !== status.id) renumber(item.board, from);
      succeeded.push(item.id);
    });
    const failed = batch.missing.map(id => ({ id, error: 'Not found.' }));
    return wait({ succeeded, failed });
  }

  function bulkUpdateWorkItems(rawIds, fields) {
    const batch = resolveBulkBatch(rawIds);
    if (batch.error) return batch.error;

    let assignee, priority, componentObjs = [], labelIds = [];
    if ('assignee' in fields) {
      if (fields.assignee !== null) {
        assignee = userById(fields.assignee);
        if (!assignee) return fail(400, { assignee: 'User not found.' });
      } else { assignee = null; }
    }
    if (fields.priority !== undefined && fields.priority !== null) {
      priority = Number(fields.priority);
      if (![1, 2, 3].includes(priority)) return fail(400, { priority: 'Must be 1, 2, or 3.' });
    }
    if (fields.components_add && fields.components_add.length) {
      componentObjs = fields.components_add.map(id => components.find(c => c.id === Number(id)));
      if (componentObjs.some(c => !c)) return fail(400, { components_add: 'Component not found.' });
      if (componentObjs.some(c => c.project !== batch.projectId)) return fail(400, { components_add: "Components must belong to this item's project." });
    }
    if (fields.labels_add && fields.labels_add.length) {
      const resolved = resolveLabelNames(fields.labels_add);
      if (resolved.error) return fail(400, resolved.error);
      labelIds = resolved.ids;
    }

    const succeeded = [];
    batch.items.forEach(item => {
      if ('assignee' in fields) item.assignee = assignee ? assignee.id : null;
      if (priority !== undefined) item.priority = priority;
      if (componentObjs.length) item.components = [...new Set([...(item.components || []), ...componentObjs.map(c => c.id)])];
      if (labelIds.length) item.labels = [...new Set([...(item.labels || []), ...labelIds])];
      item.updated_at = now();
      succeeded.push(item.id);
    });
    const failed = batch.missing.map(id => ({ id, error: 'Not found.' }));
    return wait({ succeeded, failed });
  }

  function bulkDeleteWorkItems(rawIds) {
    const batch = resolveBulkBatch(rawIds);
    if (batch.error) return batch.error;

    const deleted = [];
    batch.items.forEach(item => {
      workItems.forEach(w => { if (w.parent === item.id) w.parent = null; });
      workItems = workItems.filter(w => w.id !== item.id);
      deleted.push(item.id);
    });
    const failed = batch.missing.map(id => ({ id, error: 'Not found.' }));
    return wait({ deleted, failed });
  }

  const IMPORT_PRIORITY = { low: 1, medium: 2, high: 3 };

  function parseCsv(text) {
    // Minimal RFC-4180-ish parser: handles quoted fields with embedded
    // commas/quotes, not multi-line quoted fields (good enough for the
    // simple flat rows this feature's rows are — same scope the real
    // Python `csv` module's default dialect covers for these inputs).
    const rows = [];
    text.split(/\r\n|\n/).forEach(line => {
      if (line === '') return;
      const cells = [];
      let cur = '', inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') { inQuotes = false; }
          else { cur += ch; }
        } else if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { cells.push(cur); cur = ''; }
        else { cur += ch; }
      }
      cells.push(cur);
      rows.push(cells);
    });
    return rows;
  }

  async function importWorkItems(boardId, csvFile) {
    const board = boardById(boardId);
    if (!board) return fail(404, { detail: 'Not found.' });
    if (!myRole(board.project)) return denied();
    if (projectById(board.project).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }

    const text = await csvFile.text();
    if (!text.trim()) return fail(400, { csv: 'CSV file is empty.' });
    const rows = parseCsv(text);
    const header = rows[0].map(h => h.trim().toLowerCase());
    const titleIdx = header.indexOf('title');
    if (titleIdx === -1) return fail(400, { csv: 'CSV must include a "title" column.' });
    const dataRows = rows.slice(1);
    if (dataRows.length > 500) return fail(400, { csv: 'CSV has more than 500 rows.' });

    const col = (name) => header.indexOf(name);
    const failed = [];
    let imported = 0;

    dataRows.forEach((cells, i) => {
      const rowNum = i + 2;
      const get = (name) => { const idx = col(name); return idx === -1 ? '' : (cells[idx] || '').trim(); };
      const title = get('title');
      if (!title) { failed.push({ row: rowNum, title: null, error: 'Title is required.' }); return; }

      const itemType = get('item_type') || 'task';
      if (itemType === 'subtask') { failed.push({ row: rowNum, title, error: 'Subtasks cannot be imported (need a parent).' }); return; }
      if (!['epic', 'story', 'task', 'bug'].includes(itemType)) {
        failed.push({ row: rowNum, title, error: `Invalid item_type "${itemType}".` }); return;
      }

      let statusId = defaultStatusId(board.project);
      const statusName = get('status');
      if (statusName) {
        const match = statusesForProject(board.project).find(s => s.name.toLowerCase() === statusName.toLowerCase());
        if (!match) { failed.push({ row: rowNum, title, error: `Status "${statusName}" not found.` }); return; }
        statusId = match.id;
      }

      let priority = 2;
      const priorityName = get('priority');
      if (priorityName) {
        if (!(priorityName.toLowerCase() in IMPORT_PRIORITY)) {
          failed.push({ row: rowNum, title, error: `Invalid priority "${priorityName}".` }); return;
        }
        priority = IMPORT_PRIORITY[priorityName.toLowerCase()];
      }

      let assignee = null;
      const assigneeName = get('assignee');
      if (assigneeName) {
        const match = users.find(u => u.username.toLowerCase() === assigneeName.toLowerCase());
        if (!match) { failed.push({ row: rowNum, title, error: `User "${assigneeName}" not found.` }); return; }
        assignee = match.id;
      }

      let dueDate = null;
      const dueDateRaw = get('due_date');
      if (dueDateRaw) {
        if (!Logic.isIsoDate(dueDateRaw)) { failed.push({ row: rowNum, title, error: `Invalid due_date "${dueDateRaw}".` }); return; }
        dueDate = dueDateRaw;
      }

      const labelNames = get('labels').split(';').map(s => s.trim()).filter(Boolean);
      const resolvedLabels = labelNames.length ? resolveLabelNames(labelNames) : { ids: [] };
      if (resolvedLabels.error) { failed.push({ row: rowNum, title, error: resolvedLabels.error.labels }); return; }

      const componentNames = get('components').split(';').map(s => s.trim()).filter(Boolean);
      const componentIds = [];
      for (const name of componentNames) {
        const match = components.find(c => c.project === board.project && c.name.toLowerCase() === name.toLowerCase());
        if (!match) { failed.push({ row: rowNum, title, error: `Component "${name}" not found.` }); return; }
        componentIds.push(match.id);
      }

      const siblings = workItems.filter(w => w.board === board.id && w.status === statusId);
      seed({
        id: id(), key: `${projectById(board.project).key}-${itemCounters[board.project]++}`,
        board: board.id, item_type: itemType, title, description: get('description'),
        status: statusId, position: siblings.length, priority, due_date: dueDate, assignee,
        components: componentIds, labels: resolvedLabels.ids, created_by: me.id,
      });
      imported++;
    });

    return { imported, failed };
  }
```

- [ ] **Step 3: Export**

Add `bulkMoveWorkItems, bulkUpdateWorkItems, bulkDeleteWorkItems, importWorkItems,` to `store.js`'s final `return { ... }` block.

- [ ] **Step 4: Manual verification**

`?data=store`, console:

```javascript
await Store.bulkMoveWorkItems([32, 33], <a status id in project 1>)
// {succeeded: [32, 33], failed: []}
await Store.bulkUpdateWorkItems([32, 33], { priority: 3, labels_add: ['sprint-goal'] })
await Store.bulkDeleteWorkItems([9999])
// {deleted: [], failed: [{id: 9999, error: 'Not found.'}]}

const csv = new File(['title,item_type,priority\nFix login,bug,high\n,task,low'], 'x.csv')
await Store.importWorkItems(11, csv)
// {imported: 1, failed: [{row: 3, title: null, error: 'Title is required.'}]}
```

- [ ] **Step 5: Commit**

```bash
git add ui/static/js/api.js ui/static/js/store.js
git commit -m "$(cat <<'EOF'
feat(ui): add bulk move/update/delete and CSV import to both clients

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 9.2: Select mode, the bulk bar, and the import modal

**Files:**
- Modify: `ui/index.html` — `tpl-board` gains Select/Import buttons and a bulk-bar container
- Modify: `ui/static/js/app.js` — `boardState`, `workItemCard`, `viewBoard`, new `toggleSelectMode`/`toggleCardSelection`/`renderBulkBar`/`reportBulkResult`/`openImportModal`
- Modify: `ui/static/css/app.css`

**Interfaces:**
- Consumes: `data.bulkMoveWorkItems`, `data.bulkUpdateWorkItems`, `data.bulkDeleteWorkItems`, `data.importWorkItems` (Task 9.1); `data.listMembers`, `data.listComponents`, `boardState.statuses` (existing)

- [ ] **Step 1: `index.html`**

Change `tpl-board`'s header actions. Currently:

```html
    <div class="board-head">
      <div>
        <a class="back" data-back-link href="#/projects">Project</a>
        <div class="project-title-row">
          <h1 data-board-name></h1>
          <span class="key-pill" data-board-project></span>
        </div>
        <p class="page-sub" data-board-desc></p>
      </div>
      <div class="legend-stack">
        <p class="legend" data-type-legend></p>
        <p class="legend">
          <span class="legend-item"><i class="rule-demo p1"></i>Low</span>
          <span class="legend-item"><i class="rule-demo p2"></i>Medium</span>
          <span class="legend-item"><i class="rule-demo p3"></i>High</span>
          <span class="legend-item"><i class="rule-demo overdue"></i>Overdue</span>
        </p>
      </div>
    </div>
    <div class="columns" data-columns></div>
```

to:

```html
    <div class="board-head">
      <div>
        <a class="back" data-back-link href="#/projects">Project</a>
        <div class="project-title-row">
          <h1 data-board-name></h1>
          <span class="key-pill" data-board-project></span>
        </div>
        <p class="page-sub" data-board-desc></p>
      </div>
      <div class="board-head-actions">
        <div class="legend-stack">
          <p class="legend" data-type-legend></p>
          <p class="legend">
            <span class="legend-item"><i class="rule-demo p1"></i>Low</span>
            <span class="legend-item"><i class="rule-demo p2"></i>Medium</span>
            <span class="legend-item"><i class="rule-demo p3"></i>High</span>
            <span class="legend-item"><i class="rule-demo overdue"></i>Overdue</span>
          </p>
        </div>
        <button class="btn" type="button" data-select-toggle>Select</button>
        <button class="btn" type="button" data-import-btn>Import</button>
      </div>
    </div>
    <div class="bulk-bar" data-bulk-bar hidden></div>
    <div class="columns" data-columns></div>
```

- [ ] **Step 2: `app.js` — `boardState`, `viewBoard`, `workItemCard`**

Change `boardState`'s initial shape:

```javascript
let boardState = { projectId: null, boardId: null, buckets: null, statuses: [], components: [] };
```

to:

```javascript
let boardState = { projectId: null, boardId: null, buckets: null, statuses: [], components: [], selectMode: false, selectedIds: new Set() };
```

In `viewBoard`, reset select state on every visit and wire the two new buttons. Change:

```javascript
async function viewBoard(projectId, boardId) {
  const main = outlet();
  main.replaceChildren(tpl('tpl-board'));
  boardState = { projectId: Number(projectId), boardId: Number(boardId), buckets: null, statuses: [], components: [] };

  main.querySelector('[data-back-link]').href = `#/projects/${projectId}`;
```

to:

```javascript
async function viewBoard(projectId, boardId) {
  const main = outlet();
  main.replaceChildren(tpl('tpl-board'));
  boardState = {
    projectId: Number(projectId), boardId: Number(boardId), buckets: null, statuses: [], components: [],
    selectMode: false, selectedIds: new Set(),
  };

  main.querySelector('[data-back-link]').href = `#/projects/${projectId}`;
  main.querySelector('[data-select-toggle]').addEventListener('click', toggleSelectMode);
  main.querySelector('[data-import-btn]').addEventListener('click', openImportModal);
```

Change `workItemCard` to render a selection checkbox in select mode and toggle instead of opening the modal. Change:

```javascript
function workItemCard(item) {
  const el = document.createElement('article');
  el.className = `wi-card p${item.priority || 2}`;
  if (Logic.isOverdue(item)) el.classList.add('is-overdue');
  el.draggable = true;
  el.tabIndex = 0;
  el.dataset.id = item.id;
```

to:

```javascript
function workItemCard(item) {
  const el = document.createElement('article');
  const selected = boardState.selectedIds.has(item.id);
  el.className = `wi-card p${item.priority || 2}` + (selected ? ' is-selected' : '');
  if (Logic.isOverdue(item)) el.classList.add('is-overdue');
  el.draggable = !boardState.selectMode;
  el.tabIndex = 0;
  el.dataset.id = item.id;
```

Add the select checkbox into the card's markup — change the `el.innerHTML = ...` assignment's opening to prepend it:

```javascript
  el.innerHTML =
    `<div class="wi-top">` +
```

to:

```javascript
  el.innerHTML =
    (boardState.selectMode
      ? `<label class="card-select" data-select-wrap><input type="checkbox" ${selected ? 'checked' : ''}></label>`
      : '') +
    `<div class="wi-top">` +
```

Change the card's click/keydown handlers to branch on select mode. Change:

```javascript
  el.addEventListener('click', () => openWorkItemModal(item.id));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWorkItemModal(item.id); }
  });
```

to:

```javascript
  const openOrToggle = () => {
    if (boardState.selectMode) { toggleCardSelection(item.id, el); return; }
    openWorkItemModal(item.id);
  };
  el.addEventListener('click', openOrToggle);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOrToggle(); }
  });
  const checkbox = el.querySelector('[data-select-wrap] input');
  if (checkbox) {
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', () => toggleCardSelection(item.id, el, checkbox.checked));
  }
```

The existing `el.addEventListener('dragstart', ...)`/`dragend` block stays exactly as-is — `el.draggable = !boardState.selectMode` (set above) already stops a drag from starting while selecting.

- [ ] **Step 3: The new functions**

Add, right after `wireDrop` and before `/* Work item detail modal ... */` (i.e., right where drag-and-drop wiring ends and the modal section begins):

```javascript
/* Multi-select + bulk operations (sub-project 2c) ------------------------- */

function toggleSelectMode() {
  boardState.selectMode = !boardState.selectMode;
  boardState.selectedIds = new Set();
  const btn = root.querySelector('[data-select-toggle]');
  btn.classList.toggle('is-active', boardState.selectMode);
  btn.textContent = boardState.selectMode ? 'Done' : 'Select';
  paintColumns();
  renderBulkBar();
}

function toggleCardSelection(itemId, cardEl, forceChecked) {
  const checked = forceChecked !== undefined ? forceChecked : !boardState.selectedIds.has(itemId);
  if (checked) boardState.selectedIds.add(itemId); else boardState.selectedIds.delete(itemId);
  cardEl.classList.toggle('is-selected', checked);
  const box = cardEl.querySelector('[data-select-wrap] input');
  if (box) box.checked = checked;
  renderBulkBar();
}

function reportBulkResult(result, successKey) {
  const okCount = (result[successKey] || []).length;
  const failCount = (result.failed || []).length;
  if (!failCount) { toast(`${okCount} updated`); return; }
  toast(`${okCount} updated, ${failCount} failed: ${result.failed[0].error}`, true);
}

async function renderBulkBar() {
  const bar = root.querySelector('[data-bulk-bar]');
  if (!bar) return;
  const count = boardState.selectedIds.size;
  if (!boardState.selectMode || count === 0) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;

  let members = [], projectComponents = [];
  try {
    [members, projectComponents] = await Promise.all([data.listMembers(boardState.projectId), data.listComponents(boardState.projectId)]);
  } catch { /* proceed with what's available */ }

  bar.innerHTML =
    `<span class="bulk-count">${count} selected</span>` +
    `<select data-bulk-status aria-label="Move to status"><option value="">Move to…</option>${
      (boardState.statuses || []).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
    }</select>` +
    `<select data-bulk-assignee aria-label="Set assignee"><option value="">Assignee…</option><option value="__unassign">Unassign</option>${
      members.map(m => `<option value="${m.user_detail.id}">${esc(m.user_detail.display_name || m.user_detail.username)}</option>`).join('')
    }</select>` +
    `<select data-bulk-priority aria-label="Set priority"><option value="">Priority…</option><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option></select>` +
    `<input type="text" data-bulk-label placeholder="Add label…" aria-label="Add label">` +
    `<select data-bulk-component aria-label="Add component"><option value="">Add component…</option>${
      projectComponents.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
    }</select>` +
    `<button class="btn btn-danger" type="button" data-bulk-delete>Delete</button>` +
    `<button class="btn btn-quiet" type="button" data-bulk-clear>Clear</button>`;

  const ids = () => Array.from(boardState.selectedIds);

  bar.querySelector('[data-bulk-status]').addEventListener('change', async (e) => {
    const statusId = e.target.value;
    if (!statusId) return;
    try {
      const result = await data.bulkMoveWorkItems(ids(), Number(statusId));
      reportBulkResult(result, 'succeeded');
      await reloadBoard();
    } catch (err) { handle(err); }
    e.target.value = '';
  });

  bar.querySelector('[data-bulk-assignee]').addEventListener('change', async (e) => {
    const value = e.target.value;
    if (!value) return;
    try {
      const result = await data.bulkUpdateWorkItems(ids(), { assignee: value === '__unassign' ? null : Number(value) });
      reportBulkResult(result, 'succeeded');
      await reloadBoard();
    } catch (err) { handle(err); }
    e.target.value = '';
  });

  bar.querySelector('[data-bulk-priority]').addEventListener('change', async (e) => {
    const value = e.target.value;
    if (!value) return;
    try {
      const result = await data.bulkUpdateWorkItems(ids(), { priority: Number(value) });
      reportBulkResult(result, 'succeeded');
      await reloadBoard();
    } catch (err) { handle(err); }
    e.target.value = '';
  });

  const labelInput = bar.querySelector('[data-bulk-label]');
  labelInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = labelInput.value.trim();
    if (!name) return;
    try {
      const result = await data.bulkUpdateWorkItems(ids(), { labels_add: [name] });
      reportBulkResult(result, 'succeeded');
      await reloadBoard();
    } catch (err) { handle(err); }
    labelInput.value = '';
  });

  bar.querySelector('[data-bulk-component]').addEventListener('change', async (e) => {
    const value = e.target.value;
    if (!value) return;
    try {
      const result = await data.bulkUpdateWorkItems(ids(), { components_add: [Number(value)] });
      reportBulkResult(result, 'succeeded');
      await reloadBoard();
    } catch (err) { handle(err); }
    e.target.value = '';
  });

  bar.querySelector('[data-bulk-delete]').addEventListener('click', async () => {
    if (!confirm(`Delete ${count} work item${count === 1 ? '' : 's'}? This can't be undone.`)) return;
    try {
      const result = await data.bulkDeleteWorkItems(ids());
      reportBulkResult(result, 'deleted');
      boardState.selectedIds = new Set();
      await reloadBoard();
      renderBulkBar();
    } catch (err) { handle(err); }
  });

  bar.querySelector('[data-bulk-clear]').addEventListener('click', () => {
    boardState.selectedIds = new Set();
    paintColumns();
    renderBulkBar();
  });
}

async function openImportModal() {
  const body = `
    <div class="modal-head">
      <p class="eyebrow">Import work items</p>
      <button class="btn btn-quiet" type="button" data-close>Close</button>
    </div>
    <p class="hint">
      A CSV file with a header row. Required column: <code>title</code>. Optional:
      <code>item_type</code> (epic/story/task/bug — never subtask), <code>description</code>,
      <code>status</code> (a status name in this project), <code>priority</code>
      (low/medium/high), <code>assignee</code> (username), <code>due_date</code>
      (YYYY-MM-DD), <code>labels</code>, <code>components</code> (both
      semicolon-separated names). Max 500 rows.
    </p>
    <label class="field">
      <span>CSV file</span>
      <input type="file" name="csv" data-import-file accept=".csv,text/csv">
    </label>
    <p class="form-error" data-error hidden></p>
    <div class="modal-actions">
      <button class="btn btn-primary" type="button" data-import-submit>Import</button>
      <button class="btn" type="button" data-close>Cancel</button>
    </div>
    <div class="import-results" data-import-results hidden></div>`;
  const { modal } = openModal(body);
  const fileInput = modal.querySelector('[data-import-file]');
  const errorEl = modal.querySelector('[data-error]');
  const resultsEl = modal.querySelector('[data-import-results]');

  modal.querySelector('[data-import-submit]').addEventListener('click', async () => {
    errorEl.hidden = true;
    resultsEl.hidden = true;
    const file = fileInput.files[0];
    if (!file) { errorEl.textContent = 'Choose a CSV file first.'; errorEl.hidden = false; return; }
    try {
      const result = await data.importWorkItems(boardState.boardId, file);
      resultsEl.hidden = false;
      const failLines = result.failed.map(f => `Row ${f.row}${f.title ? ` (${esc(f.title)})` : ''}: ${esc(f.error)}`);
      resultsEl.innerHTML =
        `<p>${result.imported} imported${result.failed.length ? `, ${result.failed.length} failed` : ''}.</p>` +
        (failLines.length ? `<ul>${failLines.map(l => `<li>${l}</li>`).join('')}</ul>` : '');
      if (result.imported) await reloadBoard();
    } catch (err) {
      if (err && err.sessionExpired) return handle(err);
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
    }
  });
}

```

- [ ] **Step 4: CSS**

Append:

```css
/* Bulk operations & import (sub-project 2c) ------------------------------ */

.board-head-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.btn.is-active { border-color: var(--accent); background: var(--accent-w); color: var(--accent); }

.bulk-bar[hidden] { display: none; }
.bulk-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: var(--sunk);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 8px 12px;
  margin-bottom: 14px;
}
.bulk-count { font-size: 12px; font-weight: 600; color: var(--ink-2); margin-right: 4px; }
.bulk-bar select, .bulk-bar input[type="text"] {
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 5px 8px;
  font-size: 12px;
}
.bulk-bar input[type="text"] { width: 140px; }

.card-select { position: absolute; top: 8px; right: 8px; }
.wi-card { position: relative; }
.wi-card.is-selected { border-color: var(--accent); background: var(--accent-w); }

.import-results { margin-top: 14px; border-top: 1px solid var(--rule); padding-top: 12px; font-size: 12.5px; }
.import-results ul { margin: 8px 0 0; padding-left: 18px; color: var(--ink-2); }
.import-results li { margin-bottom: 4px; }
```

- [ ] **Step 5: Manual verification**

Open a board. Click "Select" — the button becomes "Done" (accented), and every card grows a checkbox in its top-right corner; dragging a card no longer moves it. Check two or three cards — a bulk bar appears above the columns showing the count and controls. Move them to a different status via the bar's select — a toast confirms, and `reportBulkResult` correctly reports any that failed alongside the ones that succeeded (test this by mixing a valid id with one you've deleted in another tab). Add a label, add a component, set priority, set assignee — each confirms via toast. Delete the selection — confirms, board reloads, bulk bar clears. Click "Done" — checkboxes disappear, dragging works again. Click "Import", pick a small CSV with a deliberately bad row (blank title) and a good row — the results block shows "1 imported, 1 failed" with the row-numbered reason; the good row's item appears on the board after closing.

- [ ] **Step 6: Commit**

```bash
git add ui/index.html ui/static/js/app.js ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): add select mode, the bulk-action bar, and CSV import to the board

Closes Wave 1 item W1.7 (CSV export, roadmap M46, has no backend endpoint
yet — stays out of scope for this UI-only phase).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

---

## Phase 10 — Backlog and Sprints

Closes Wave 1 item **W1.8** (roadmap §6, size L). Backend: `GET/POST /api/boards/{id}/sprints/`, `GET/PATCH/DELETE /api/sprints/{id}/`, `POST /api/sprints/{id}/start/`, `POST /api/sprints/{id}/complete/`, `GET /api/sprints/{id}/work-items/`, `GET /api/boards/{id}/backlog/`, `POST /api/work-items/{id}/schedule/` (`docs/api.md` "Sprints & Backlog"). Design reference: `design/js/app.js` `viewBacklog`/`paintBacklogPage`/`sprintCard`/`backlogRow` (2179-2349). Spec: `docs/superpowers/specs/2026-08-24-tasky-backlog-sprints-design.md` (sub-project 6, signed off).

Sprint assignment (`sprint`) is a second axis, orthogonal to `status` — this new page is its home, separate from the board's status columns. It reuses `boardState`, `openWorkItemModal`, and `reloadBoard` exactly as the board view does (`reloadBoard()`'s `paintColumns()` call safely no-ops on this page, since it bails out when `[data-columns]` isn't present — no special-casing needed).

### Task 10.1: `logic.js`

**Files:**
- Modify: `ui/static/js/logic.js`

**Interfaces:**
- Produces: `Logic.canManageSprints(role)`

- [ ] **Step 1: Add and export**

Insert after Phase 7's Attachments section:

```javascript
  /* ---- Backlog & Sprints (sub-project 6) -----------------------------------
     Starting/completing/deleting a sprint is Owner/Admin, same tier as
     Statuses/Components/Releases — scheduling a work item into or out of a
     sprint is a plain edit any project member can already do, no separate
     check (docs/api.md: "no separate permission check beyond ordinary
     work-item edit permission"). */
  const canManageSprints = (role) => role === 'owner' || role === 'admin';

```

Export: add `canManageSprints,` to the `return { ... }` block.

- [ ] **Step 2: Manual verification**

Console: `Logic.canManageSprints('member') === false`.

- [ ] **Step 3: Commit**

```bash
git add ui/static/js/logic.js
git commit -m "$(cat <<'EOF'
feat(ui): add the sprint manage predicate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 10.2: `api.js` and `store.js`

**Files:**
- Modify: `ui/static/js/api.js`
- Modify: `ui/static/js/store.js`

**Interfaces:**
- Produces: `Api.listSprints(boardId)`, `Api.createSprint(boardId, {name, goal})`, `Api.getSprint(id)`, `Api.updateSprint(id, {name, goal})`, `Api.deleteSprint(id)`, `Api.startSprint(id)`, `Api.completeSprint(id)`, `Api.listSprintWorkItems(id)`, `Api.listBacklog(boardId)`, `Api.scheduleWorkItem(itemId, {sprint, position})`; matching `Store.*`

- [ ] **Step 1: `api.js`**

Add after the bulk/import methods (Phase 9):

```javascript

    /* Sprints & Backlog ------------------------------------------------------ */
    listSprints:  (boardId)      => request(`/api/boards/${boardId}/sprints/`),
    createSprint: (boardId, fields) => request(`/api/boards/${boardId}/sprints/`, { method: 'POST', body: fields }),
    getSprint:    (id)           => request(`/api/sprints/${id}/`),
    updateSprint: (id, fields)   => request(`/api/sprints/${id}/`, { method: 'PATCH', body: fields }),
    deleteSprint: (id)           => request(`/api/sprints/${id}/`, { method: 'DELETE' }),
    startSprint:    (id) => request(`/api/sprints/${id}/start/`,    { method: 'POST' }),
    completeSprint: (id) => request(`/api/sprints/${id}/complete/`, { method: 'POST' }),
    listSprintWorkItems: (id) => request(`/api/sprints/${id}/work-items/`),
    listBacklog: (boardId) => request(`/api/boards/${boardId}/backlog/`),
    scheduleWorkItem: (itemId, payload) => request(`/api/work-items/${itemId}/schedule/`, { method: 'POST', body: payload }),
```

- [ ] **Step 2: `store.js` — seed state and CRUD**

Add near the top, after the `attachments` block from Phase 7:

```javascript

  let sprints = [];
  let nextSprintId = 11000;
  const sprintById = (sid) => sprints.find(s => s.id === Number(sid)) || null;
  const sprintOut = (s) => Object.assign({}, s, { created_by: userById(s.created_by) });
```

Add `sprint: null, backlog_position: 0,` to `seed()`'s default object (alongside `release: null,` from Phase 6) — every work item defaults to the backlog, matching `docs/api.md`'s "a freshly created work item defaults to the backlog (`sprint: null`) unless `sprint` is given explicitly on create."

Add the CRUD functions, right after Phase 7's attachment functions (before `/* ---- me ... */`):

```javascript

  /* ---- sprints & backlog ----------------------------------------------------- */

  function renumberBacklogBucket(boardId, sprintId) {
    workItems
      .filter(w => w.board === boardId && w.sprint === sprintId)
      .sort((a, b) => a.backlog_position - b.backlog_position || a.id - b.id)
      .forEach((w, i) => { w.backlog_position = i; });
  }

  function listSprints(boardId) {
    const board = boardById(boardId);
    if (!board) return fail(404, { detail: 'Not found.' });
    if (!myRole(board.project)) return denied();
    return wait(
      sprints.filter(s => s.board === board.id)
             .map(s => Object.assign(sprintOut(s), { item_count: workItems.filter(w => w.sprint === s.id).length }))
    );
  }

  function createSprint(boardId, fields) {
    const board = boardById(boardId);
    if (!board) return fail(404, { detail: 'Not found.' });
    const role = myRole(board.project);
    if (!role) return denied();
    if (projectById(board.project).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageSprints(role)) return fail(403, { detail: "Only this project's Owner or Admins can manage sprints." });
    const sprint = {
      id: ++nextSprintId, board: board.id, name: fields.name || '', goal: fields.goal || '',
      state: 'planned', start_date: null, end_date: null, created_by: me.id, created_at: now(),
    };
    sprints.push(sprint);
    return wait(Object.assign(sprintOut(sprint), { item_count: 0 }));
  }

  function getSprint(sprintId) {
    const sprint = sprintById(sprintId);
    if (!sprint) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(sprint.board))) return denied();
    return wait(Object.assign(sprintOut(sprint), { item_count: workItems.filter(w => w.sprint === sprint.id).length }));
  }

  function updateSprint(sprintId, fields) {
    const sprint = sprintById(sprintId);
    if (!sprint) return fail(404, { detail: 'Not found.' });
    const role = myRole(boardProject(sprint.board));
    if (!role) return denied();
    if (projectById(boardProject(sprint.board)).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageSprints(role)) return fail(403, { detail: "Only this project's Owner or Admins can manage sprints." });
    if ('name' in fields) sprint.name = fields.name;
    if ('goal' in fields) sprint.goal = fields.goal;
    return wait(Object.assign(sprintOut(sprint), { item_count: workItems.filter(w => w.sprint === sprint.id).length }));
  }

  function deleteSprint(sprintId) {
    const sprint = sprintById(sprintId);
    if (!sprint) return fail(404, { detail: 'Not found.' });
    const role = myRole(boardProject(sprint.board));
    if (!role) return denied();
    if (projectById(boardProject(sprint.board)).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageSprints(role)) return fail(403, { detail: "Only this project's Owner or Admins can manage sprints." });
    if (sprint.state !== 'planned') return fail(400, { detail: 'Only a planned sprint can be deleted.' });
    const stillScheduled = workItems.filter(w => w.sprint === sprint.id).length;
    if (stillScheduled) {
      return fail(400, { detail: `Still has ${stillScheduled} work item${stillScheduled === 1 ? '' : 's'} scheduled into it. Move ${stillScheduled === 1 ? 'it' : 'them'} first.` });
    }
    sprints = sprints.filter(s => s.id !== sprint.id);
    return wait(null);
  }

  function startSprint(sprintId) {
    const sprint = sprintById(sprintId);
    if (!sprint) return fail(404, { detail: 'Not found.' });
    const role = myRole(boardProject(sprint.board));
    if (!role) return denied();
    if (projectById(boardProject(sprint.board)).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageSprints(role)) return fail(403, { detail: "Only this project's Owner or Admins can manage sprints." });
    if (sprint.state !== 'planned') return fail(400, { detail: 'Only a planned sprint can be started.' });
    const active = sprints.find(s => s.board === sprint.board && s.state === 'active' && s.id !== sprint.id);
    if (active) return fail(400, { detail: `"${active.name}" is already active on this board. Complete it first.` });
    sprint.state = 'active';
    sprint.start_date = today();
    return wait(Object.assign(sprintOut(sprint), { item_count: workItems.filter(w => w.sprint === sprint.id).length }));
  }

  function completeSprint(sprintId) {
    const sprint = sprintById(sprintId);
    if (!sprint) return fail(404, { detail: 'Not found.' });
    const role = myRole(boardProject(sprint.board));
    if (!role) return denied();
    if (projectById(boardProject(sprint.board)).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageSprints(role)) return fail(403, { detail: "Only this project's Owner or Admins can manage sprints." });
    if (sprint.state !== 'active') return fail(400, { detail: 'Only an active sprint can be completed.' });
    sprint.state = 'completed';
    sprint.end_date = today();
    const stragglers = workItems
      .filter(w => w.sprint === sprint.id)
      .sort((a, b) => a.backlog_position - b.backlog_position || a.id - b.id);
    let nextPos = workItems.filter(w => w.board === sprint.board && w.sprint === null).length;
    stragglers.forEach(w => { w.sprint = null; w.backlog_position = nextPos++; w.updated_at = now(); });
    return wait(Object.assign(sprintOut(sprint), { item_count: 0 }));
  }

  function listSprintWorkItems(sprintId) {
    const sprint = sprintById(sprintId);
    if (!sprint) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(sprint.board))) return denied();
    return wait(
      workItems.filter(w => w.sprint === sprint.id)
               .sort((a, b) => a.backlog_position - b.backlog_position || a.id - b.id)
               .map(itemOut)
    );
  }

  function listBacklog(boardId) {
    const board = boardById(boardId);
    if (!board) return fail(404, { detail: 'Not found.' });
    if (!myRole(board.project)) return denied();
    return wait(
      workItems.filter(w => w.board === board.id && w.sprint === null)
               .sort((a, b) => a.backlog_position - b.backlog_position || a.id - b.id)
               .map(itemOut)
    );
  }

  function scheduleWorkItem(itemId, payload) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();
    if (projectById(boardProject(item.board)).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }
    let sprintId = null;
    if (payload.sprint !== null && payload.sprint !== undefined) {
      const sprint = sprintById(payload.sprint);
      if (!sprint || sprint.board !== item.board) return fail(400, { sprint: "Sprint must belong to this item's board." });
      if (sprint.state === 'completed') return fail(400, { sprint: "Can't schedule into a completed sprint." });
      sprintId = sprint.id;
    }
    const position = payload.position !== undefined
      ? Number(payload.position)
      : workItems.filter(w => w.board === item.board && w.sprint === sprintId && w.id !== item.id).length;

    const fromSprint = item.sprint;
    item.sprint = sprintId;
    item.backlog_position = position - 0.5;
    renumberBacklogBucket(item.board, sprintId);
    if (fromSprint !== sprintId) renumberBacklogBucket(item.board, fromSprint);
    item.updated_at = now();
    return wait(itemOut(item));
  }
```

- [ ] **Step 3: Export**

Add `listSprints, createSprint, getSprint, updateSprint, deleteSprint, startSprint, completeSprint, listSprintWorkItems, listBacklog, scheduleWorkItem,` to `store.js`'s final `return { ... }` block.

- [ ] **Step 4: Manual verification**

`?data=store`, console:

```javascript
const sp = await Store.createSprint(11, { name: 'Sprint 1', goal: 'Ship onboarding' })
await Store.scheduleWorkItem(32, { sprint: sp.id })
await Store.listSprintWorkItems(sp.id)     // includes item 32
await Store.listBacklog(11)                // no longer includes item 32
await Store.startSprint(sp.id)             // state: 'active', start_date set
const sp2 = await Store.createSprint(11, { name: 'Sprint 2' })
await Store.startSprint(sp2.id)
// rejects 400: {detail: '"Sprint 1" is already active on this board. Complete it first.'}
await Store.completeSprint(sp.id)
await Store.listBacklog(11)                // item 32 is back
```

- [ ] **Step 5: Commit**

```bash
git add ui/static/js/api.js ui/static/js/store.js
git commit -m "$(cat <<'EOF'
feat(ui): add sprint CRUD, start/complete, and backlog scheduling

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 10.3: The Backlog & Sprints page

**Files:**
- Modify: `ui/index.html` — `tpl-board` gains a Backlog link; new `tpl-backlog` template
- Modify: `ui/static/js/app.js` — route, `viewBacklog`/`paintBacklogPage`/`sprintCard`/`backlogRow`
- Modify: `ui/static/css/app.css`

**Interfaces:**
- Consumes: `data.getBoard`, `data.getProject`, `data.listStatuses` (existing), `data.listSprints`/`createSprint`/`startSprint`/`completeSprint`/`deleteSprint`/`listSprintWorkItems`/`listBacklog`/`scheduleWorkItem` (Task 10.2), `Logic.canManageSprints` (Task 10.1)
- Produces: `viewBacklog(projectId, boardId)`, reachable at `#/projects/:id/boards/:id/backlog`

- [ ] **Step 1: `index.html` — Backlog link on the board, and `tpl-backlog`**

In `tpl-board`'s `board-head-actions` (added in Phase 9), add a Backlog link right before the Select button:

```html
        <a class="btn" data-backlog-link>Backlog</a>
        <button class="btn" type="button" data-select-toggle>Select</button>
```

Append `tpl-backlog` after `tpl-board`'s closing `</template>` and before `tpl-my-tasks`:

```html

<template id="tpl-backlog">
  <div class="page">
    <div class="board-head">
      <div>
        <a class="back" data-back-link href="#/projects">Board</a>
        <h1 data-board-name></h1>
        <p class="page-sub">Backlog &amp; Sprints</p>
      </div>
    </div>

    <section>
      <h2 class="section-label">Sprints</h2>
      <form class="create-sprint" data-create-sprint novalidate hidden>
        <input name="name" placeholder="Sprint name" aria-label="Sprint name" required>
        <input name="goal" placeholder="Goal (optional)" aria-label="Goal">
        <button class="btn" type="submit">Add sprint</button>
      </form>
      <div class="sprint-list" data-sprints></div>
    </section>

    <section>
      <h2 class="section-label">Backlog</h2>
      <p class="page-sub section-note">Not scheduled into any sprint.</p>
      <ul class="backlog-list" data-backlog></ul>
    </section>
  </div>
</template>
```

- [ ] **Step 2: Route and the Backlog link's `href`**

In `route()`, add above the `/boards/(\d+)$` fallback branch:

```javascript
  m = hash.match(/^\/projects\/(\d+)\/boards\/(\d+)\/backlog$/);
  if (m) { setActiveNav('projects'); return viewBacklog(Number(m[1]), Number(m[2])); }
```

(placed before the existing `^\/projects\/(\d+)\/boards\/(\d+)$` match, so the more specific `/backlog` suffix is checked first.)

In `viewBoard`, set the Backlog link's `href` alongside the existing `data-back-link` wiring:

```javascript
  main.querySelector('[data-back-link]').href = `#/projects/${projectId}`;
```

becomes:

```javascript
  main.querySelector('[data-back-link]').href = `#/projects/${projectId}`;
  main.querySelector('[data-backlog-link]').href = `#/projects/${projectId}/boards/${boardId}/backlog`;
```

- [ ] **Step 3: `app.js` — the view functions**

Append, right after Phase 9's `openImportModal` (before `/* Work item detail modal ... */`):

```javascript
/* Backlog & Sprints (sub-project 6) ---------------------------------------
   Sprint assignment is a second axis, orthogonal to status — this page is
   its home, separate from the board's status columns. `boardState` is
   populated the same way viewBoard does (minus `buckets`, since this page
   renders no columns) so openWorkItemModal — opened from either the
   backlog or a sprint's item list — has everything it needs, and
   reloadBoard()'s paintColumns() call safely no-ops here (it bails out
   when [data-columns] isn't on the page). */

async function viewBacklog(projectId, boardId) {
  const main = outlet();
  main.replaceChildren(tpl('tpl-backlog'));
  boardState = {
    projectId: Number(projectId), boardId: Number(boardId), buckets: null, statuses: [], components: [],
    selectMode: false, selectedIds: new Set(),
  };

  main.querySelector('[data-back-link]').href = `#/projects/${projectId}/boards/${boardId}`;

  const sprintsEl = main.querySelector('[data-sprints]');
  const backlogEl = main.querySelector('[data-backlog]');
  const createForm = main.querySelector('[data-create-sprint]');
  sprintsEl.innerHTML = skeletonList(2);
  backlogEl.innerHTML = skeletonList(2);

  let project, board, statuses, canManage;
  try {
    [project, board, statuses] = await Promise.all([data.getProject(projectId), data.getBoard(boardId), data.listStatuses(projectId)]);
    canManage = Logic.canManageSprints(project.my_role);
    boardState.statuses = statuses;
    main.querySelector('[data-board-name]').textContent = board.name;
  } catch (err) {
    sprintsEl.innerHTML = ''; backlogEl.innerHTML = '';
    if (err && err.sessionExpired) return handle(err);
    handle(err);
    location.hash = `#/projects/${projectId}/boards/${boardId}`;
    return;
  }

  createForm.hidden = !canManage;
  if (!createForm.dataset.wired) {
    createForm.dataset.wired = '1';
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = createForm.querySelector('[name=name]');
      const goalInput = createForm.querySelector('[name=goal]');
      if (!nameInput.value.trim()) return;
      try {
        await data.createSprint(boardId, { name: nameInput.value, goal: goalInput.value });
        nameInput.value = '';
        goalInput.value = '';
        await paintBacklogPage(boardId, canManage, sprintsEl, backlogEl);
      } catch (err) { handle(err); }
    });
  }

  await paintBacklogPage(boardId, canManage, sprintsEl, backlogEl);
}

async function paintBacklogPage(boardId, canManage, sprintsEl, backlogEl) {
  sprintsEl.innerHTML = skeletonList(2);
  backlogEl.innerHTML = skeletonList(2);
  try {
    const [allSprints, backlogItems] = await Promise.all([data.listSprints(boardId), data.listBacklog(boardId)]);

    if (!allSprints.length) {
      sprintsEl.innerHTML = '<p class="empty">No sprints yet.</p>';
    } else {
      const cards = await Promise.all(allSprints.map(s => sprintCard(s, boardId, canManage, sprintsEl, backlogEl, allSprints)));
      sprintsEl.replaceChildren(...cards);
    }

    if (!backlogItems.length) {
      backlogEl.innerHTML = '<li class="empty">Nothing in the backlog.</li>';
    } else {
      const rows = backlogItems.map(item => backlogRow(item, boardId, allSprints, sprintsEl, backlogEl, canManage));
      backlogEl.replaceChildren(...rows);
      stagger(rows);
    }
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    sprintsEl.innerHTML = ''; backlogEl.innerHTML = '';
    handle(err);
  }
}

async function sprintCard(sprint, boardId, canManage, sprintsEl, backlogEl, allSprints) {
  const card = document.createElement('div');
  card.className = `sprint-card sprint-${sprint.state}`;
  const dates = [sprint.start_date, sprint.end_date].filter(Boolean).join(' → ');

  card.innerHTML =
    `<div class="sprint-head">` +
      `<span class="sprint-name">${esc(sprint.name)}</span>` +
      `<span class="sprint-state-badge state-${sprint.state}">${esc(sprint.state)}</span>` +
      `<span class="row-meta">${sprint.item_count} item${sprint.item_count === 1 ? '' : 's'}${dates ? ' · ' + esc(dates) : ''}</span>` +
      (canManage
        ? `<span class="actions">` +
            (sprint.state === 'planned' ? `<button class="btn" type="button" data-start>Start</button>` : '') +
            (sprint.state === 'active' ? `<button class="btn" type="button" data-complete>Complete</button>` : '') +
            (sprint.state === 'planned' ? `<button class="btn btn-danger" type="button" data-delete>Delete</button>` : '') +
          `</span>`
        : '') +
    `</div>` +
    (sprint.goal ? `<p class="sprint-goal">${esc(sprint.goal)}</p>` : '') +
    `<ul class="sprint-items" data-items></ul>`;

  const itemsEl = card.querySelector('[data-items]');
  if (sprint.state === 'completed') {
    itemsEl.innerHTML = '<li class="empty-inline">Completed — its items returned to the backlog.</li>';
  } else {
    try {
      const items = await data.listSprintWorkItems(sprint.id);
      itemsEl.innerHTML = items.length ? '' : '<li class="empty-inline">Nothing scheduled yet.</li>';
      if (items.length) itemsEl.replaceChildren(...items.map(item => backlogRow(item, boardId, allSprints, sprintsEl, backlogEl, canManage)));
    } catch (err) { handle(err); }
  }

  const startBtn = card.querySelector('[data-start]');
  if (startBtn) startBtn.addEventListener('click', async () => {
    try {
      await data.startSprint(sprint.id);
      await paintBacklogPage(boardId, canManage, sprintsEl, backlogEl);
    } catch (err) { handle(err); }
  });
  const completeBtn = card.querySelector('[data-complete]');
  if (completeBtn) completeBtn.addEventListener('click', async () => {
    try {
      await data.completeSprint(sprint.id);
      toast(`"${sprint.name}" completed`);
      await paintBacklogPage(boardId, canManage, sprintsEl, backlogEl);
    } catch (err) { handle(err); }
  });
  const deleteBtn = card.querySelector('[data-delete]');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    try {
      await data.deleteSprint(sprint.id);
      await paintBacklogPage(boardId, canManage, sprintsEl, backlogEl);
    } catch (err) { handle(err); }
  });

  return card;
}

function backlogRow(item, boardId, allSprints, sprintsEl, backlogEl, canManage) {
  const li = document.createElement('li');
  li.className = 'backlog-row';
  const currentValue = item.sprint ? String(item.sprint) : 'backlog';
  const options = [`<option value="backlog" ${currentValue === 'backlog' ? 'selected' : ''}>Backlog</option>`]
    .concat(allSprints.filter(s => s.state !== 'completed').map(s =>
      `<option value="${s.id}" ${currentValue === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`
    )).join('');

  li.innerHTML =
    `<a href="#" class="backlog-row-link" data-open>` +
      `<span class="key-pill">${esc(item.key)}</span>` +
      `<span class="type-badge type-${esc(item.item_type)}">${esc(Logic.ITEM_TYPE_LABEL[item.item_type])}</span>` +
      `<span class="backlog-title">${esc(item.title)}</span>` +
    `</a>` +
    `<select class="move-select" aria-label="Move ${esc(item.key)}">${options}</select>`;

  li.querySelector('[data-open]').addEventListener('click', (e) => {
    e.preventDefault();
    openWorkItemModal(item.id);
  });
  li.querySelector('select').addEventListener('change', async (e) => {
    const value = e.target.value;
    try {
      await data.scheduleWorkItem(item.id, { sprint: value === 'backlog' ? null : Number(value) });
      await paintBacklogPage(boardId, canManage, sprintsEl, backlogEl);
    } catch (err) { handle(err); }
  });
  return li;
}

```

- [ ] **Step 4: CSS**

Append:

```css
/* Backlog & Sprints (sub-project 6) --------------------------------------- */

.section-row { display: flex; align-items: center; justify-content: space-between; }

.create-sprint[hidden] { display: none; }
.create-sprint { display: flex; gap: 8px; margin: 10px 0 16px; }
.create-sprint input {
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 7px 10px;
  font-size: 13px;
}
.create-sprint input[name="name"] { flex: 0 0 200px; }
.create-sprint input[name="goal"] { flex: 1; }

.sprint-list { display: grid; gap: 12px; margin-bottom: 24px; }
.sprint-card {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-left: 3px solid var(--rule-2);
  border-radius: var(--r);
  padding: 12px 16px;
}
.sprint-card.sprint-active { border-left-color: var(--accent); }
.sprint-card.sprint-completed { opacity: .7; }

.sprint-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sprint-name { font-weight: 600; font-size: 14px; }
.sprint-state-badge {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: .07em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--sunk);
  color: var(--ink-3);
}
.sprint-state-badge.state-active { background: var(--accent-w); color: var(--accent); }
.sprint-goal { color: var(--ink-2); font-size: 12.5px; margin: 6px 0 0; }

.sprint-items { list-style: none; margin: 10px 0 0; padding: 10px 0 0; border-top: 1px solid var(--rule); display: grid; gap: 6px; }

.backlog-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.backlog-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: var(--r);
  padding: 7px 12px;
  animation: row-in .22s var(--ease-out) both;
}
.backlog-row-link { flex: 1; display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink); min-width: 0; }
.backlog-title { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.move-select {
  background: var(--sunk);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 4px 8px;
  font-size: 11px;
  flex-shrink: 0;
}
```

- [ ] **Step 5: Manual verification**

Open a board, click "Backlog" — lands on the Backlog & Sprints page, showing every unscheduled item in the Backlog list. As Owner/Admin: create a sprint with a goal — it appears as a card. Move a backlog item into it via its row's select — it moves from the Backlog list into the sprint card's item list. Start the sprint — its badge and left border turn accent-coloured, and a "Complete" button replaces "Start"; try starting a second sprint on the same board — rejected with the exact "already active" message. Complete the first sprint — its items return to the Backlog list, and the card itself shows "Completed — its items returned to the backlog." Try deleting a sprint that still has items scheduled — rejected with the exact item-count message. Open an item from either the backlog or a sprint's list — the same work item modal opens, fully functional (save, delete, comments, attachments, labels, custom fields, release — everything every earlier phase added).

- [ ] **Step 6: Commit**

```bash
git add ui/index.html ui/static/js/app.js ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): add the Backlog & Sprints page

Closes Wave 1 item W1.8.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

---

## Phase 11 — Automation rules

Closes Wave 1 item **W1.10** (roadmap §6, size M; the roadmap also bundles "fire on bulk ops" — defect X9 — into this item, but that's a backend behavior change, not a UI gap, and this plan is scoped to UI wiring only — flag it, don't fix it here). Backend: `GET/POST /api/projects/{id}/automation-rules/`, `GET/PATCH/DELETE /api/projects/{id}/automation-rules/{id}/` (`docs/api.md` "Automation"). Design reference: `design/js/app.js` `renderAutomation`/`paintAutomationRules`/`paintTriggerFields`/`paintActionFields`/`readTriggerFields`/`readActionFields`/`automationRuleRow` (805-985). `design/js/logic.js` `canManageAutomation`/`AUTOMATION_TRIGGER_TYPES`/`AUTOMATION_TRIGGER_LABEL`/`AUTOMATION_ACTION_TYPES`/`AUTOMATION_ACTION_LABEL`/`describeAutomationRule` (242-317). Spec: `docs/superpowers/specs/2026-08-24-tasky-automation-design.md` (sub-project 11, signed off).

**Scope note:** this phase is the admin UI for defining rules only — it does **not** port `design/js/logic.js`'s `matchesWorkItemCreatedTrigger`/`matchesStatusChangedTrigger` functions, since actually *evaluating and firing* rules already happens server-side (`boards/automation.py`, wired into the single-item move/create endpoints) and re-implementing that logic client-side would be redundant, divergent-prone, and outside "wire the UI to the existing backend." `describeAutomationRule` (a pure display formatter) is ported, since the admin list needs it to render "When X, do Y" without a second network round trip per rule.

### Task 11.1: `logic.js`

**Files:**
- Modify: `ui/static/js/logic.js`

**Interfaces:**
- Produces: `Logic.canManageAutomation(role)`, `Logic.AUTOMATION_TRIGGER_TYPES`, `Logic.AUTOMATION_TRIGGER_LABEL`, `Logic.AUTOMATION_ACTION_TYPES`, `Logic.AUTOMATION_ACTION_LABEL`, `Logic.describeAutomationRule(rule, statusLookup)`

- [ ] **Step 1: Add and export**

Insert after Phase 10's Backlog & Sprints section:

```javascript
  /* ---- Automation (sub-project 11) ------------------------------------------
     Governance reuses the existing Owner/Admin tier. Only two triggers and
     four actions in this first pass — see the spec's Scope decisions for
     why a generic "field changed" trigger and multi-action rules are
     deliberately out. */
  const canManageAutomation = (role) => role === 'owner' || role === 'admin';

  const AUTOMATION_TRIGGER_TYPES = ['work_item_created', 'status_changed'];
  const AUTOMATION_TRIGGER_LABEL = { work_item_created: 'Work item created', status_changed: 'Status changed' };
  const AUTOMATION_ACTION_TYPES = ['set_assignee', 'apply_label', 'remove_label', 'change_status'];
  const AUTOMATION_ACTION_LABEL = {
    set_assignee: 'Set assignee', apply_label: 'Apply label', remove_label: 'Remove label', change_status: 'Change status',
  };

  /* Plain-English summary of a rule's trigger/action, for the admin list —
     takes a lookup function rather than a raw status id, so this stays
     free of any dependency on the data layer's shape. `statusLookup(id)`
     returns a status's name, or a placeholder if it's since been deleted
     (deletion is blocked while a rule references it, per docs/api.md, but
     a rule created before that guard existed — or restored via /admin/ —
     could still reference a gone one). */
  function describeAutomationRule(rule, statusLookup) {
    let triggerText;
    if (rule.trigger_type === 'work_item_created') {
      const itemType = rule.trigger_filter && rule.trigger_filter.item_type;
      triggerText = itemType ? `a ${ITEM_TYPE_LABEL[itemType] || itemType} is created` : 'any work item is created';
    } else {
      const f = rule.trigger_filter || {};
      const from = f.from_status != null ? `"${statusLookup(f.from_status)}"` : 'any status';
      let to = 'any status';
      if (f.to_status != null) to = `"${statusLookup(f.to_status)}"`;
      else if (f.to_category != null) to = `the ${CATEGORY_LABELS[f.to_category] || f.to_category} category`;
      triggerText = `status moves from ${from} to ${to}`;
    }

    let actionText;
    const cfg = rule.action_config || {};
    if (rule.action_type === 'set_assignee') {
      if (cfg.mode === 'actor') actionText = 'assign whoever triggered it';
      else if (cfg.mode === 'unassign') actionText = 'clear the assignee';
      else actionText = 'set the assignee';
    } else if (rule.action_type === 'apply_label') {
      actionText = `apply the "${cfg.label_name}" label`;
    } else if (rule.action_type === 'remove_label') {
      actionText = `remove the "${cfg.label_name}" label`;
    } else {
      actionText = `change status to "${statusLookup(cfg.status_id)}"`;
    }

    return `When ${triggerText}, ${actionText}.`;
  }

```

This relies on `ITEM_TYPE_LABEL` and `CATEGORY_LABELS`, both already defined earlier in this same file (item hierarchy and Phase 1's Statuses section respectively) — no new dependency, just reuse.

Export: add `canManageAutomation, AUTOMATION_TRIGGER_TYPES, AUTOMATION_TRIGGER_LABEL, AUTOMATION_ACTION_TYPES, AUTOMATION_ACTION_LABEL, describeAutomationRule,` to the `return { ... }` block.

- [ ] **Step 2: Manual verification**

Console: `Logic.describeAutomationRule({trigger_type: 'work_item_created', trigger_filter: {item_type: 'bug'}, action_type: 'apply_label', action_config: {label_name: 'triage'}}, () => '')` returns `'When a Bug is created, apply the "triage" label.'`.

- [ ] **Step 3: Commit**

```bash
git add ui/static/js/logic.js
git commit -m "$(cat <<'EOF'
feat(ui): add automation rule constants and the describe formatter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 11.2: `api.js` and `store.js`

**Files:**
- Modify: `ui/static/js/api.js`
- Modify: `ui/static/js/store.js`

**Interfaces:**
- Produces: `Api.listAutomationRules(projectId)`, `Api.createAutomationRule(projectId, fields)`, `Api.updateAutomationRule(projectId, id, fields)`, `Api.deleteAutomationRule(projectId, id)`; matching `Store.*`

- [ ] **Step 1: `api.js`**

Add after the sprint/backlog methods (Phase 10):

```javascript

    /* Automation ------------------------------------------------------------ */
    listAutomationRules:   (projectId)          => request(`/api/projects/${projectId}/automation-rules/`),
    createAutomationRule:  (projectId, fields)  => request(`/api/projects/${projectId}/automation-rules/`, { method: 'POST', body: fields }),
    updateAutomationRule:  (projectId, id, fields) => request(`/api/projects/${projectId}/automation-rules/${id}/`, { method: 'PATCH', body: fields }),
    deleteAutomationRule:  (projectId, id)      => request(`/api/projects/${projectId}/automation-rules/${id}/`, { method: 'DELETE' }),
```

- [ ] **Step 2: `store.js`**

Add near the top, after the `sprints` block from Phase 10:

```javascript

  let automationRules = [];
  let nextRuleId = 12000;
  const ruleById = (rid) => automationRules.find(r => r.id === Number(rid)) || null;
  const rulesForProject = (projectId) =>
    automationRules.filter(r => r.project === Number(projectId)).sort((a, b) => a.position - b.position);
```

Add the CRUD functions, right after Phase 10's sprint/backlog functions (before `/* ---- me ... */`):

```javascript

  /* ---- automation rules -------------------------------------------------- */
  /* Deliberately NOT evaluated/fired here — evaluation happens server-side
     only, wired into the single-item create/move endpoints. This is the
     admin UI for defining rules, not a client-side automation engine. */

  function listAutomationRules(projectId) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    if (!myRole(projectId)) return denied();
    return wait(rulesForProject(projectId));
  }

  function createAutomationRule(projectId, fields) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(projectId);
    if (!role) return denied();
    if (projectById(projectId).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageAutomation(role)) return fail(403, { detail: "You don't have permission to manage automation rules." });
    if (!fields.name || !fields.name.trim()) return fail(400, { name: 'This field may not be blank.' });
    if ('to_status' in (fields.trigger_filter || {}) && 'to_category' in (fields.trigger_filter || {})
        && fields.trigger_filter.to_status != null && fields.trigger_filter.to_category != null) {
      return fail(400, { trigger_filter: 'to_status and to_category are mutually exclusive.' });
    }
    const siblings = rulesForProject(projectId);
    const rule = {
      id: ++nextRuleId, project: Number(projectId), name: fields.name.trim(),
      trigger_type: fields.trigger_type, trigger_filter: fields.trigger_filter || {},
      action_type: fields.action_type, action_config: fields.action_config || {},
      is_active: fields.is_active !== undefined ? !!fields.is_active : true,
      position: siblings.length,
    };
    automationRules.push(rule);
    return wait(rule);
  }

  function updateAutomationRule(projectId, ruleId, fields) {
    const rule = ruleById(ruleId);
    if (!rule || rule.project !== Number(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(rule.project);
    if (!role) return denied();
    if (projectById(rule.project).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageAutomation(role)) return fail(403, { detail: "You don't have permission to manage automation rules." });
    ['name', 'trigger_type', 'trigger_filter', 'action_type', 'action_config', 'is_active', 'position'].forEach(f => {
      if (f in fields) rule[f] = fields[f];
    });
    return wait(rule);
  }

  function deleteAutomationRule(projectId, ruleId) {
    const rule = ruleById(ruleId);
    if (!rule || rule.project !== Number(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(rule.project);
    if (!role) return denied();
    if (projectById(rule.project).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageAutomation(role)) return fail(403, { detail: "You don't have permission to manage automation rules." });
    automationRules = automationRules.filter(r => r.id !== rule.id);
    rulesForProject(rule.project).forEach((r, i) => { r.position = i; });
    return wait(null);
  }
```

Every existing project-scoped mock mutation already carries the archived-project guard per Task 3.3's instruction to extend it phase by phase — this task's three write functions above already include it inline, matching that pattern.

- [ ] **Step 3: Export**

Add `listAutomationRules, createAutomationRule, updateAutomationRule, deleteAutomationRule,` to `store.js`'s final `return { ... }` block.

- [ ] **Step 4: Manual verification**

`?data=store`, console:

```javascript
const rule = await Store.createAutomationRule(1, {
  name: 'Auto-triage bugs', trigger_type: 'work_item_created', trigger_filter: { item_type: 'bug' },
  action_type: 'apply_label', action_config: { label_name: 'triage' },
})
await Store.listAutomationRules(1)   // [rule]
await Store.updateAutomationRule(1, rule.id, { is_active: false })
await Store.deleteAutomationRule(1, rule.id)
```

- [ ] **Step 5: Commit**

```bash
git add ui/static/js/api.js ui/static/js/store.js
git commit -m "$(cat <<'EOF'
feat(ui): add automation rule CRUD to the API and mock clients

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

### Task 11.3: The project page's Automation section

**Files:**
- Modify: `ui/index.html` — `tpl-project` gains an Automation section
- Modify: `ui/static/js/app.js` — `viewProject`'s render sequence, new `renderAutomation`/`paintAutomationRules`/`paintTriggerFields`/`paintActionFields`/`readTriggerFields`/`readActionFields`/`automationRuleRow`
- Modify: `ui/static/css/app.css`

**Interfaces:**
- Consumes: `data.listAutomationRules`/`createAutomationRule`/`updateAutomationRule`/`deleteAutomationRule` (Task 11.2), `data.listStatuses`, `data.listMembers` (existing), `Logic.canManageAutomation`/`AUTOMATION_*`/`describeAutomationRule` (Task 11.1)

- [ ] **Step 1: `index.html`**

Add this section to `tpl-project`, right after Releases (Phase 6) and before Members:

```html
    <section>
      <h2 class="section-label">Automation</h2>
      <p class="page-sub section-note">Rules that react to work item events — when X happens, do Y, no chaining. Owner and Admins manage the list; every member can see the list so it's clear why a card changed on its own.</p>
      <ul class="admin-list" data-automation-rules></ul>
      <form class="create-automation-rule" data-create-automation-rule novalidate hidden>
        <input name="name" placeholder="Rule name" aria-label="Rule name" required>
        <select name="trigger_type" aria-label="Trigger" data-trigger-select></select>
        <span data-trigger-fields></span>
        <select name="action_type" aria-label="Action" data-action-select></select>
        <span data-action-fields></span>
        <button class="btn btn-primary" type="submit">Add rule</button>
      </form>
      <p class="form-error" data-automation-error hidden></p>
    </section>
```

- [ ] **Step 2: CSS**

Append:

```css
/* Automation (sub-project 11) --------------------------------------------- */

.create-automation-rule[hidden] { display: none; }
.create-automation-rule { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0 8px; }
.create-automation-rule input {
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 7px 10px;
  flex: 1 1 160px;
}
.create-automation-rule select,
.create-automation-rule [data-trigger-fields] select,
.create-automation-rule [data-action-fields] select,
.create-automation-rule [data-action-fields] input {
  background: var(--surface);
  border: 1px solid var(--rule-2);
  border-radius: var(--r);
  padding: 6px 9px;
  font-size: 12px;
}
.create-automation-rule [data-trigger-fields],
.create-automation-rule [data-action-fields] {
  display: flex;
  gap: 6px;
}
```

(`.admin-list`/`.admin-row` already exist from Phase 5 — this section reuses them, matching `design/`'s own choice to give an automation rule the same row shell as a custom field or screen.)

- [ ] **Step 3: `app.js`**

Wire into `viewProject`, right after Phase 6's `renderReleases(main, project);`:

```javascript
  renderAutomation(main, project);
```

Add the functions, right after Phase 6's `releaseItemRow` (before `/* Attachments ... */`, added in Phase 7 — either order is fine; this plan places Automation right before Attachments in the file):

```javascript
/* Automation (sub-project 11) ----------------------------------------------
   trigger_filter/action_config shapes depend on which trigger_type/
   action_type is selected, so the create form's sub-fields are repainted
   on every change — same "form shape follows a type select" idea Custom
   Fields' type picker (Phase 5) already uses. Listeners on the create form
   are attached exactly once, here — toggling/deleting a rule afterward
   calls paintAutomationRules to repaint only the <ul>, never this whole
   function again, so the form never accumulates a second submit
   listener. */

async function renderAutomation(main, project) {
  const list = main.querySelector('[data-automation-rules]');
  const form = main.querySelector('[data-create-automation-rule]');
  if (!list || !form) return;
  const canManage = Logic.canManageAutomation(project.my_role);
  form.hidden = !canManage;

  let statuses = [];
  try { statuses = await data.listStatuses(project.id); } catch { /* form still usable without a preview */ }
  let members = [];
  try { members = (await data.listMembers(project.id)).map(m => m.user_detail); } catch { /* same */ }

  if (canManage && !form.dataset.wired) {
    form.dataset.wired = '1';
    const triggerSelect = form.querySelector('[data-trigger-select]');
    const actionSelect = form.querySelector('[data-action-select]');
    const triggerFields = form.querySelector('[data-trigger-fields]');
    const actionFields = form.querySelector('[data-action-fields]');

    triggerSelect.replaceChildren(...Logic.AUTOMATION_TRIGGER_TYPES.map(t => new Option(Logic.AUTOMATION_TRIGGER_LABEL[t], t)));
    actionSelect.replaceChildren(...Logic.AUTOMATION_ACTION_TYPES.map(t => new Option(Logic.AUTOMATION_ACTION_LABEL[t], t)));
    paintTriggerFields(triggerFields, triggerSelect.value, statuses);
    paintActionFields(actionFields, actionSelect.value, statuses, members);
    triggerSelect.addEventListener('change', () => paintTriggerFields(triggerFields, triggerSelect.value, statuses));
    actionSelect.addEventListener('change', () => paintActionFields(actionFields, actionSelect.value, statuses, members));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = main.querySelector('[data-automation-error]');
      errorEl.hidden = true;
      const nameInput = form.querySelector('[name=name]');
      try {
        await data.createAutomationRule(project.id, {
          name: nameInput.value,
          trigger_type: triggerSelect.value,
          trigger_filter: readTriggerFields(triggerFields, triggerSelect.value),
          action_type: actionSelect.value,
          action_config: readActionFields(actionFields, actionSelect.value),
        });
        nameInput.value = '';
        toast('Rule added');
        await paintAutomationRules(list, project, canManage, statuses);
      } catch (err) {
        errorEl.textContent = errorText(err);
        errorEl.hidden = false;
      }
    });
  }

  await paintAutomationRules(list, project, canManage, statuses);
}

async function paintAutomationRules(list, project, canManage, statuses) {
  list.innerHTML = skeletonList(2);
  try {
    const rules = await data.listAutomationRules(project.id);
    if (!rules.length) {
      list.innerHTML = '<li class="empty">No automation rules yet.</li>';
      return;
    }
    const statusLookup = (statusId) => { const s = statuses.find(s => s.id === Number(statusId)); return s ? s.name : '(deleted status)'; };
    const rows = rules.map(rule => automationRuleRow(rule, statusLookup, canManage, list, project, statuses));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, () => paintAutomationRules(list, project, canManage, statuses));
  }
}

function paintTriggerFields(container, triggerType, statuses) {
  if (triggerType === 'work_item_created') {
    container.innerHTML =
      `<select name="item_type" aria-label="Item type"><option value="">Any type</option>${
        Logic.ITEM_TYPES.map(t => `<option value="${t}">${Logic.ITEM_TYPE_LABEL[t]}</option>`).join('')
      }</select>`;
    return;
  }
  const statusOptions = statuses.map(s => `<option value="status:${s.id}">${esc(s.name)}</option>`).join('');
  const categoryOptions = Logic.CATEGORIES.map(c => `<option value="category:${c}">Any ${Logic.CATEGORY_LABELS[c]} status</option>`).join('');
  container.innerHTML =
    `<select name="from_status" aria-label="From status"><option value="">Any status</option>${
      statuses.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
    }</select>` +
    `<select name="to" aria-label="To"><option value="">Any status</option>${statusOptions}${categoryOptions}</select>`;
}

function paintActionFields(container, actionType, statuses, members) {
  if (actionType === 'set_assignee') {
    container.innerHTML =
      `<select name="mode" aria-label="Assignee mode" data-mode>` +
        `<option value="fixed">Fixed member</option><option value="actor">Whoever triggered it</option><option value="unassign">Unassign</option>` +
      `</select>` +
      `<select name="user_id" aria-label="Member">${members.map(m => `<option value="${m.id}">${esc(m.display_name || m.username)}</option>`).join('')}</select>`;
    return;
  }
  if (actionType === 'apply_label' || actionType === 'remove_label') {
    container.innerHTML = `<input name="label_name" placeholder="Label name" aria-label="Label name" required>`;
    return;
  }
  container.innerHTML = `<select name="status_id" aria-label="New status">${statuses.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>`;
}

function readTriggerFields(container, triggerType) {
  if (triggerType === 'work_item_created') {
    return { item_type: container.querySelector('[name=item_type]').value || null };
  }
  const fromStatus = container.querySelector('[name=from_status]').value;
  const to = container.querySelector('[name=to]').value;
  const filter = { from_status: fromStatus ? Number(fromStatus) : null, to_status: null, to_category: null };
  if (to.startsWith('status:')) filter.to_status = Number(to.slice('status:'.length));
  else if (to.startsWith('category:')) filter.to_category = to.slice('category:'.length);
  return filter;
}

function readActionFields(container, actionType) {
  if (actionType === 'set_assignee') {
    const mode = container.querySelector('[name=mode]').value;
    const userId = container.querySelector('[name=user_id]').value;
    return { mode, user_id: mode === 'fixed' ? Number(userId) : null };
  }
  if (actionType === 'apply_label' || actionType === 'remove_label') {
    return { label_name: container.querySelector('[name=label_name]').value };
  }
  return { status_id: Number(container.querySelector('[name=status_id]').value) };
}

function automationRuleRow(rule, statusLookup, canManage, list, project, statuses) {
  const li = document.createElement('li');
  li.className = 'admin-row';
  li.innerHTML =
    `<span class="name">${esc(rule.name)}</span>` +
    (rule.is_active ? '' : `<span class="role-badge is-inactive">Inactive</span>`) +
    `<span class="row-meta">${esc(Logic.describeAutomationRule(rule, statusLookup))}</span>` +
    `<span class="actions">${canManage
      ? `<button class="btn" data-toggle-active>${rule.is_active ? 'Deactivate' : 'Activate'}</button><button class="btn btn-danger" data-delete>Delete</button>`
      : ''}</span>`;

  const toggleBtn = li.querySelector('[data-toggle-active]');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      try {
        await data.updateAutomationRule(project.id, rule.id, { is_active: !rule.is_active });
        toast(rule.is_active ? 'Rule deactivated' : 'Rule activated');
        await paintAutomationRules(list, project, canManage, statuses);
      } catch (err) { handle(err); }
    });
  }
  const deleteBtn = li.querySelector('[data-delete]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      try {
        await data.deleteAutomationRule(project.id, rule.id);
        toast('Rule deleted');
        await paintAutomationRules(list, project, canManage, statuses);
      } catch (err) { handle(err); }
    });
  }
  return li;
}

```

- [ ] **Step 4: Manual verification**

Open a project you own. The Automation section shows the create form: pick trigger "Work item created", filtered to type "Bug"; pick action "Apply label", type "triage"; name it "Auto-triage bugs"; submit — it appears in the list reading "When a Bug is created, apply the "triage" label." Create a Bug on that project's board (via the normal add-work-item flow) — since server-side evaluation already exists and this phase only adds the UI, confirm the label lands on the new bug automatically (this exercises the *existing*, already-tested backend evaluator, not new code from this phase). Deactivate the rule — badge shows "Inactive," and a newly created Bug no longer gets the label. Delete the rule. As a plain Member, confirm the list is visible (so a card's unexplained change is traceable) but no create form or action buttons are offered.

- [ ] **Step 5: Commit**

```bash
git add ui/index.html ui/static/js/app.js ui/static/css/app.css
git commit -m "$(cat <<'EOF'
feat(ui): add the Automation rules section to the project page

Closes Wave 1 item W1.10 (bulk-ops not firing automation, defect X9, is a
backend behavior change and stays out of scope for this UI-only plan).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkQCFNNS6bjjx9UWW67aDk
EOF
)"
```

---

## Closing out the branch

After Phase 11's commit, all 11 Wave 1 items are wired in on `feat/wave1-ui-wiring`:

- [ ] **Full regression pass.** Walk `ui/README.md`'s existing behaviors-that-bite list once more against the finished branch — sign-in failure messaging, the drag-and-back-off-on-failure behavior, non-contiguous `position` handling — none of the 11 phases above touch that code, but this confirms nothing regressed by omission.
- [ ] **Backend check:** `make test && make lint` — must be fully green (Phase 3 is the only phase with new Python; everything else is additive frontend and cannot fail a Python test on its own, but confirm anyway).
- [ ] **Update `ui/README.md`**: its "Not built here — but built on the server" section (quoted in this plan's own research) is now false for all 11 items — remove that section, or replace it with a short note that Wave 1 shipped and link back to this plan for the detail. This file is documentation, not code — no test, just an accurate rewrite.
- [ ] **Open the PR**: `gh pr create --base main --title "Wire Wave 1 backend features into ui/" ...`, summarizing the 11 phases, linking `docs/superpowers/plans/2026-09-08-tasky-jira-parity-roadmap.md` and this plan. Per `.claude/rules/common/git-workflow.md`, this is a squash-and-merge into `main` after review — the branch's 36 commits (one per task above) compress to one on `main`, so the commit-by-commit granularity above is for review readability during the PR, not the shape history keeps forever.
</content>
