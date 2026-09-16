# Implementation Plan: Finish Custom Fields Admin UI (sub-project 2b, Fields only)

> For agentic workers: REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish wiring the already-signed-off, backend-complete Custom Fields half of sub-project 2b into `ui/`, completing the WIP scaffolding committed at `e07af89` (`viewFields`/`paintFields`/`fieldRow`/`openFieldOptionsModal` in `ui/static/js/app.js`) rather than discarding it. Covers create/rename/delete a field, its type (fixed at creation), and for `select`/`multiselect` fields, an ordered list of options: add/rename/reorder/delete. **Screens are explicitly out of scope** — no tasks here touch `Screen`/`ScreenField`/`ProjectScreenAssignment`.

**Architecture:** Unchanged four-way split — `logic.js` (pure: field-type vocabulary, the `canManageDefinitions` predicate), `store.js` (mock mutations reproducing the server's real invariants), `api.js` (thin `request()` wrappers, same names/signatures as `store.js`), `app.js` (render + wiring only, fixing three real bugs found in the WIP rather than rewriting it). Zero backend changes — `CustomFieldViewSet`/`FieldOptionViewSet` (`boards/views.py:1205-1324`) already implement and test everything needed.

**Tech Stack:** Vanilla JS, no build step, no framework, no npm. Django serves `ui/` static files as-is.

**Spec:** `docs/api.md:320-331` (Custom Fields / Field Options contract), `boards/models.py:255-301` (`CustomField`/`FieldOption`), `boards/serializers.py:81-86,203-234` (`user_can_manage_definitions`, `CustomFieldSerializer`, `FieldOptionSerializer`), `boards/views.py:1205-1324` (`CustomFieldViewSet`, `FieldOptionViewSet`), `boards/tests/test_custom_fields_api.py` (the ground truth for every error shape below), `design/js/app.js:1244-1495` (`viewFields`/`paintFields`/`fieldRow`/`openFieldOptionsModal` reference), `design/js/logic.js:96-135` (`FIELD_TYPES`/`FIELD_TYPE_LABEL`/`FIELD_TYPE_HINT`/`fieldHasOptions`/`canManageDefinitions` reference), `design/js/store.js:1861-2015` (mock reference), `design/index.html:228-246` (`tpl-fields` reference), `.claude/memory/feature-menu-map.md:70` (already documents the target `#/fields` route and its permission tier).

---

## Global Constraints

- **No JS test framework** — this repo has none, deliberately. Each task's "test" step is a manual check: pure `logic.js` additions get a `node -e` one-liner; `api.js`/`store.js` additions get exercised from the devtools console; `app.js`/markup/CSS changes get a manual browser click-through, run once in mock mode (`?data=store`) and once against the real backend.
- **`make lint` must stay clean** — no Python is touched by this plan; run it once at the end to confirm (no-op).
- **Git workflow:** this work already has its own worktree/branch (`feat/custom-fields-admin-ui`, this directory, starting from commit `e07af89`) — no new worktree needed. Conventional commits, one per task.
- **Build on the WIP, don't discard it.** `e07af89`'s `viewFields`/`paintFields`/`fieldRow`/`openFieldOptionsModal` are structurally correct and closely track `design/js/app.js`. This plan fixes three real bugs in it (Task 6) and fills the four missing dependencies (Tasks 1–4), rather than rewriting from scratch.
- **Real backend confirms the Site-Admin exception design assumed.** `boards/serializers.py:81-86` — `user_can_manage_definitions(user)` returns `True` for `user.is_staff` **or** membership with `role="owner"` on any project (verified directly against the file — see below). This is NOT project-scoped at all (`CustomField`/`FieldOption` have no `project` field) — confirmed independently by `test_being_owner_of_any_project_is_enough_not_necessarily_a_specific_one`, which creates an unrelated project with no `project` fixture in the request at all. So `design/js/logic.js`'s `canManageDefinitions(roles, isStaff) => !!isStaff || roles.includes('owner')` is **exactly right** and is ported verbatim (as `Logic.canManageDefinitions`) — do not drop the `isStaff` branch.
- **Known, documented gap this plan does NOT fix:** `/api/auth/me/` (`accounts/serializers.py`'s `UserSerializer`, used by `AuthView.me` — `accounts/views.py:63`) only returns `["id", "username", "display_name"]` — **no `is_staff`**. Only `AdminUserSerializer` (Site-Admin-only routes under `/api/admin/users/`) exposes it. So `me.is_staff` is always `undefined` against the real backend today, meaning **a genuine Site Admin who owns no project will not see field-management controls in this UI**, even though the server would accept their write. This is a real pre-existing API-surface gap, not something this plan invents or silently papers over — flagging it here rather than fixing it, since fixing it is a one-line backend serializer change and out of this plan's front-end-only scope. Recommend a follow-up entry in `docs/follow-ups.md` (not executed here): add `is_staff` to `UserSerializer`. The mock is unaffected in practice — `boards/management/commands/seed_demo.py` gives none of `asha`/`kabir`/`lena` `is_staff=True` either, so mock and real match behavior for every demo account that exists today.
- **Deliberate deviation from `design/js/app.js`'s `fieldRow`:** design's row shows `screen_names`/`value_count` meta bits, computed by a `decorateField` helper backed by mock-only `screenFields`/`workItemFieldValues` data. The real `CustomFieldSerializer` (`boards/serializers.py:216-223`) returns `["id", "name", "field_type", "options", "created_by", "created_at"]` — **no `screen_names`, no `value_count`** — and there is no other endpoint that supplies them without doing Screens work (out of scope) or a `WorkItemFieldValue` list endpoint that doesn't exist anywhere in `docs/api.md`. So this plan intentionally keeps the WIP's simpler row (name, type badge, option count only) rather than porting those two bits — not a scope shortcut but a real API-surface constraint. `has_options`/`type_label` **are** kept, computed inline via `Logic.fieldHasOptions`/`Logic.FIELD_TYPE_LABEL`, matching the WIP already.
- **Deliberate deviation from `design/js/store.js`'s `moveFieldOption(optionId, delta)`:** the real endpoint (`PATCH /api/fields/{field_pk}/options/{id}/`) takes an absolute `{position}` and the server clamps + renumbers every sibling in one transaction (`FieldOptionViewSet._reposition`, `boards/views.py:1294-1305`) — proven by `test_reordering_options`. This is the identical pattern already established for Work Item Statuses reordering elsewhere in this codebase: **one PATCH per move, no swap-via-two-PATCH.** The WIP's `openFieldOptionsModal` currently does an unnecessary two-PATCH "swap" for each ▲/▼ click (`ui/static/js/app.js:515-521`) — Task 6 replaces it with the single-PATCH form, both because it's simpler and because it matches the one already-shipped convention in this codebase rather than introducing a second one.
- **Mock invariant-matching follows the same documented-gap discipline as the shipped Statuses mock:** the real `CustomFieldViewSet.perform_destroy` also rejects deleting a field still on any `Screen`, and `FieldOptionViewSet.perform_destroy` rejects deleting an option still chosen on a work item (`WorkItemFieldValue`). Neither `Screen`/`ScreenField` nor per-work-item custom field values are modeled anywhere in `ui/static/js/store.js` today (both are out of scope for this plan), so — exactly like the shipped Statuses mock's un-modeled automation-rule guard — these two guards have no data to check against and are **not reproduced**. This is called out again inline at each function below.
- **Real ordering quirk found and deliberately not reproduced:** DRF's `UpdateModelMixin`/`CreateModelMixin` run `serializer.is_valid()` (→ 400s, e.g. duplicate name) *before* `perform_update`/`perform_create` (→ the 403 permission check), so a plain Member submitting a duplicate name would get 400 before 403 against the real API. This mock, like the already-shipped Statuses mock, checks permission first, then validates fields — consistent with this codebase's established mock precedent, and unreachable through the UI anyway since the create/rename controls are hidden entirely from anyone who fails `canManageDefinitions`.

---

### Task 1: `logic.js` — field-type vocabulary + `canManageDefinitions` predicate

**Files:**
- Modify: `ui/static/js/logic.js` (insert after line 33, before line 34; add names to the `return {}` block at lines 195-204)

**Interfaces:**
- Produces: `Logic.FIELD_TYPES`, `Logic.FIELD_TYPE_LABEL`, `Logic.FIELD_TYPE_HINT`, `Logic.fieldHasOptions(fieldType)`, `Logic.canManageDefinitions(roles, isStaff)`
- Consumes: none

- [ ] **Step 1: Manual pre-check**

```bash
node -e "$(cat ui/static/js/logic.js); console.assert(typeof Logic.canManageDefinitions === 'undefined', 'should not exist yet'); console.log('OK — gap confirmed')"
```

- [ ] **Step 2: Add the code**

In `ui/static/js/logic.js`, immediately after line 33 (`const canManageComponents = (role) => role === 'owner' || role === 'admin';`) and before line 34's blank line / the `/* ---- Work item hierarchy --- */` header, insert:

```js

  /* ---- Custom fields (sub-project 2b) -----------------------------------
     Global — CustomField has no `project` field at all, unlike
     Components/Statuses, so there is no per-project role check here. */

  // The spec's fixed set. No custom types, and a field's type is immutable
  // once created, so this list is only ever consulted at creation time.
  const FIELD_TYPES = [
    'text_short', 'text_long', 'number', 'date',
    'select', 'multiselect', 'checkbox', 'user_picker',
  ];
  const FIELD_TYPE_LABEL = {
    text_short: 'Short text',
    text_long: 'Long text',
    number: 'Number',
    date: 'Date',
    select: 'Select',
    multiselect: 'Multi-select',
    checkbox: 'Checkbox',
    user_picker: 'User picker',
  };
  // One line of plain English per type, shown next to the type picker so the
  // irreversible choice is made with its consequences visible.
  const FIELD_TYPE_HINT = {
    text_short: 'A single line of text.',
    text_long: 'A paragraph — notes, steps to reproduce.',
    number: 'Any number, whole or decimal.',
    date: 'A calendar date.',
    select: 'Pick exactly one from a list you define.',
    multiselect: 'Pick any number from a list you define.',
    checkbox: 'A yes / no tick.',
    user_picker: 'A member of the work item\'s project.',
  };

  const fieldHasOptions = (fieldType) => fieldType === 'select' || fieldType === 'multiselect';

  // Owner of ANY project (not necessarily one relevant to the screen in
  // front of you — verified against `user_can_manage_definitions` in
  // boards/serializers.py:81-86, and against
  // test_being_owner_of_any_project_is_enough_not_necessarily_a_specific_one),
  // OR a Site Admin. `roles` is every role this person holds, across every
  // project they're a member of; `isStaff` is their `is_staff` flag.
  //
  // Known gap: the real `/api/auth/me/` does not expose `is_staff` today
  // (see the plan's Global Constraints), so `isStaff` is always falsy
  // against the real backend until that's fixed server-side. This predicate
  // is written correctly regardless, so it starts working the moment that
  // gap closes.
  const canManageDefinitions = (roles, isStaff) => !!isStaff || (roles || []).includes('owner');
```

- [ ] **Step 3: Add the exports**

In the `return { ... }` block (currently lines 195-204), add `FIELD_TYPES, FIELD_TYPE_LABEL, FIELD_TYPE_HINT, fieldHasOptions, canManageDefinitions,` — e.g. right after `canTransferOwnership, canDeleteProject, canLeave, canManageComponents,` (line 199):

```js
    canTransferOwnership, canDeleteProject, canLeave, canManageComponents,
    FIELD_TYPES, FIELD_TYPE_LABEL, FIELD_TYPE_HINT, fieldHasOptions, canManageDefinitions,
```

- [ ] **Step 4: Run the real check**

```bash
node -e "$(cat ui/static/js/logic.js); \
console.assert(Logic.FIELD_TYPES.length === 8); \
console.assert(Logic.fieldHasOptions('select') === true); \
console.assert(Logic.fieldHasOptions('number') === false); \
console.assert(Logic.canManageDefinitions([], true) === true); \
console.assert(Logic.canManageDefinitions(['member'], false) === false); \
console.assert(Logic.canManageDefinitions(['admin','owner'], false) === true); \
console.log('OK')"
```

- [ ] **Step 5: Commit**

```bash
git add ui/static/js/logic.js
git commit -m "feat(fields): add field-type vocabulary and canManageDefinitions to logic.js"
```

---

### Task 2: `api.js` — field and field-option endpoints

**Files:**
- Modify: `ui/static/js/api.js` (insert after line 111, before line 112/113)

**Interfaces:**
- Produces: `Api.listFields()`, `Api.getField(id)`, `Api.createField(fields)`, `Api.renameField(id, name)`, `Api.deleteField(id)`, `Api.addFieldOption(fieldId, label)`, `Api.renameFieldOption(fieldId, optionId, label)`, `Api.moveFieldOption(fieldId, optionId, fields)`, `Api.deleteFieldOption(fieldId, optionId)`
- Consumes: existing `request()` helper; `docs/api.md:320-331`

- [ ] **Step 1: Manual pre-check**

With Django running (real API mode), signed in, devtools console:

```js
Api.createField({ name: 'Story Points', field_type: 'number' })
```

Expected: `TypeError: Api.createField is not a function`.

- [ ] **Step 2: Add the code**

In `ui/static/js/api.js`, immediately after line 111 (`deleteComponent:  (projectId, id)         => request(...)`) and before line 112's blank line / the "Relates to" links comment, insert:

```js

    /* Custom fields (sub-project 2b). Global — not scoped to any project.
       `listFields`/`getField` are readable by any authenticated user; the
       mutating calls 403 unless the caller is an Owner of some project (or
       a Site Admin) — see Logic.canManageDefinitions. Screens are a
       separate, out-of-scope concern (docs/api.md's Screens section). */
    listFields:  ()          => request('/api/fields/'),
    getField:    (id)        => request(`/api/fields/${id}/`),
    createField: (fields)    => request('/api/fields/', { method: 'POST', body: fields }),
    // `field_type` is immutable after creation (400 if you try to change
    // it — boards/views.py:1212-1216), so this only ever sends `{name}`.
    // There is deliberately no `changeFieldType`.
    renameField: (id, name)  => request(`/api/fields/${id}/`, { method: 'PATCH', body: { name } }),
    deleteField: (id)        => request(`/api/fields/${id}/`, { method: 'DELETE' }),

    /* Field options. The option endpoints only ever return the one option,
       never the parent field, so each mutator re-fetches the field
       afterward — every caller gets back the same shape `getField` does,
       with `options` freshly sorted by position. */
    addFieldOption: (fieldId, label) =>
      request(`/api/fields/${fieldId}/options/`, { method: 'POST', body: { label } })
        .then(() => request(`/api/fields/${fieldId}/`)),
    renameFieldOption: (fieldId, optionId, label) =>
      request(`/api/fields/${fieldId}/options/${optionId}/`, { method: 'PATCH', body: { label } })
        .then(() => request(`/api/fields/${fieldId}/`)),
    // `fields` is `{position}` — one PATCH is enough. The server clamps and
    // renumbers every sibling in a transaction
    // (FieldOptionViewSet._reposition, boards/views.py:1294-1305), same
    // pattern as the work item statuses reorder.
    moveFieldOption: (fieldId, optionId, fields) =>
      request(`/api/fields/${fieldId}/options/${optionId}/`, { method: 'PATCH', body: fields })
        .then(() => request(`/api/fields/${fieldId}/`)),
    deleteFieldOption: (fieldId, optionId) =>
      request(`/api/fields/${fieldId}/options/${optionId}/`, { method: 'DELETE' })
        .then(() => request(`/api/fields/${fieldId}/`)),
```

- [ ] **Step 3: Re-run the console check**

```js
const f = await Api.createField({ name: 'Story Points', field_type: 'number' });
// {id, name: 'Story Points', field_type: 'number', options: [], created_by: {...}, created_at: '...'}
await Api.renameField(f.id, 'Points');
const sel = await Api.createField({ name: 'Severity', field_type: 'select' });
const withOpt = await Api.addFieldOption(sel.id, 'High');
// withOpt.options -> [{id, field, label: 'High', position: 0}]
await Api.addFieldOption(sel.id, 'Low');
await Api.moveFieldOption(sel.id, withOpt.options[0].id, { position: 1 }); // should move 'High' after 'Low'
await Api.deleteFieldOption(sel.id, withOpt.options[0].id);
await Api.deleteField(f.id);
```

Also confirm as a plain Member (no project Owner role, not staff): `Api.createField(...)` rejects with 403 and `err.data.detail === "Only a project Owner can manage custom fields. You're not an Owner of any project."` — matches `boards/views.py:1219-1222` exactly.

- [ ] **Step 4: Commit**

```bash
git add ui/static/js/api.js
git commit -m "feat(fields): add field and field-option endpoints to api.js"
```

---

### Task 3: `store.js` — seed data + mock CRUD mirroring server invariants

**Files:**
- Modify: `ui/static/js/store.js` (edit lines 19-21; insert seed block after line 73; insert CRUD block after line 662; add names to the exported object around lines 772)

**Interfaces:**
- Produces: `Store.listFields()`, `Store.getField(id)`, `Store.createField(fields)`, `Store.renameField(id, name)`, `Store.deleteField(id)`, `Store.addFieldOption(fieldId, label)`, `Store.renameFieldOption(fieldId, optionId, label)`, `Store.moveFieldOption(fieldId, optionId, fields)`, `Store.deleteFieldOption(fieldId, optionId)` — same names/signatures as Task 2's `Api.*`
- Consumes: `Logic.FIELD_TYPES`, `Logic.fieldHasOptions`, `Logic.FIELD_TYPE_LABEL`, `Logic.canManageDefinitions` (Task 1); existing `id`/`fail`/`wait`/`now`/`userById`/`me`/`memberships` plumbing

Design note (documented gap, matching the shipped Statuses mock's precedent): the real API also rejects deleting a field still on any Screen, and deleting an option still chosen on a work item. Neither Screens nor per-item custom field values are modeled in this store at all (out of scope), so those two guards have no data to check against and are not reproduced here — only what's reachable through this UI's actual feature set is modeled.

- [ ] **Step 1: Manual pre-check**

With `?data=store`, devtools console:

```js
Store.createField({ name: 'Story Points', field_type: 'number' })
```

Expected: `TypeError: Store.createField is not a function`.

- [ ] **Step 2: Add `is_staff` to the seeded users**

Replace lines 19-21 (inside the existing `users` array, line 18-22) —

```js
  const users = [
    { id: 1, username: 'asha',  display_name: 'Asha Rao' },
    { id: 2, username: 'kabir', display_name: 'Kabir Menon' },
    { id: 3, username: 'lena',  display_name: 'Lena Fischer' },
  ];
```

— with:

```js
  const users = [
    // `is_staff` matches boards/management/commands/seed_demo.py — none of
    // the three demo accounts is a Site Admin, exactly like the real
    // backend's seed. See canManageDefinitions() below.
    { id: 1, username: 'asha',  display_name: 'Asha Rao',    is_staff: false },
    { id: 2, username: 'kabir', display_name: 'Kabir Menon', is_staff: false },
    { id: 3, username: 'lena',  display_name: 'Lena Fischer', is_staff: false },
  ];
```

- [ ] **Step 3: Add the seed data**

Immediately after line 73 (`];` closing the `components` seed) and before line 74's blank line / the Work item statuses comment, insert:

```js

  /* Custom fields (sub-project 2b). Global — no `project` key at all,
     unlike components/statuses. One of every type, so a reviewer sees each
     renderer without creating anything first; "Customer reference" is
     deliberately on no screen and used by no work item, so it's the one a
     reviewer can delete straight away. */
  let customFields = [
    { id: 31, name: 'Severity',            field_type: 'select',      created_by: 1, created_at: now() },
    { id: 32, name: 'Environment',         field_type: 'text_short',  created_by: 1, created_at: now() },
    { id: 33, name: 'Steps to reproduce',  field_type: 'text_long',   created_by: 1, created_at: now() },
    { id: 34, name: 'Affected platforms',  field_type: 'multiselect', created_by: 1, created_at: now() },
    { id: 35, name: 'Story Points',        field_type: 'number',      created_by: 1, created_at: now() },
    { id: 36, name: 'Target release',      field_type: 'date',        created_by: 1, created_at: now() },
    { id: 37, name: 'Needs QA sign-off',   field_type: 'checkbox',    created_by: 1, created_at: now() },
    { id: 38, name: 'Reviewer',            field_type: 'user_picker', created_by: 1, created_at: now() },
    { id: 39, name: 'Customer reference',  field_type: 'text_short',  created_by: 1, created_at: now() },
  ];
  let fieldOptions = [
    { id: 41, field: 31, label: 'Blocker',  position: 0 },
    { id: 42, field: 31, label: 'Major',    position: 1 },
    { id: 43, field: 31, label: 'Minor',    position: 2 },
    { id: 44, field: 31, label: 'Cosmetic', position: 3 },
    { id: 45, field: 34, label: 'Web',      position: 0 },
    { id: 46, field: 34, label: 'iOS',      position: 1 },
    { id: 47, field: 34, label: 'Android',  position: 2 },
    { id: 48, field: 34, label: 'Desktop',  position: 3 },
  ];

  const optionsForField = (fieldId) =>
    fieldOptions.filter(o => o.field === Number(fieldId)).sort((a, b) => a.position - b.position);

  // Matches the real CustomFieldSerializer shape exactly:
  // {id, name, field_type, options, created_by, created_at}.
  const fieldOut = (field) => Object.assign({}, field, {
    created_by: field.created_by ? userById(field.created_by) : null,
    options: optionsForField(field.id),
  });

  // Global, not project-scoped — mirrors user_can_manage_definitions()
  // (boards/serializers.py:81-86) exactly: Owner of ANY project, or staff.
  function definitionManagerRole() {
    const roles = me ? memberships.filter(m => m.user === me.id).map(m => m.role) : [];
    return Logic.canManageDefinitions(roles, me && me.is_staff);
  }

  const DEFINITIONS_DENIED = { detail: "Only a project Owner can manage custom fields. You're not an Owner of any project." };
```

- [ ] **Step 4: Add the CRUD functions**

Immediately after line 662 (the closing `}` of `deleteComponent`) and before line 663's blank line / the `/* ---- "relates to" links ---- */` comment, insert:

```js

  /* ---- custom fields (sub-project 2b) ----------------------------------
     Global — every function below is deliberately NOT project-scoped, and
     list/get need no role check at all (docs/follow-ups.md: "Custom fields
     and screens are readable by any authenticated user" — a known,
     accepted gap, not something to close here). */

  const listFields = () => wait(
    customFields.slice().sort((a, b) => a.name.localeCompare(b.name)).map(fieldOut)
  );

  function getField(fieldId) {
    const field = customFields.find(f => f.id === Number(fieldId));
    if (!field) return fail(404, { detail: 'Not found.' });
    return wait(fieldOut(field));
  }

  function createField(fields) {
    if (!definitionManagerRole()) return fail(403, DEFINITIONS_DENIED);
    const clean = ((fields && fields.name) || '').trim();
    if (!clean) return fail(400, { name: 'This field may not be blank.' });
    if (!Logic.FIELD_TYPES.includes(fields.field_type)) return fail(400, { field_type: 'Pick a field type.' });
    if (customFields.some(f => f.name.toLowerCase() === clean.toLowerCase())) {
      return fail(400, { name: `"${clean}" already exists.` });
    }
    const field = { id: id(), name: clean, field_type: fields.field_type, created_by: me.id, created_at: now() };
    customFields.push(field);
    return wait(fieldOut(field));
  }

  // field_type is immutable after creation — this UI never attempts to
  // change it (the real endpoint 400s if you try), so that guard has no
  // reachable path here and isn't modeled, same discipline as the two
  // un-modeled delete guards below.
  function renameField(fieldId, name) {
    const field = customFields.find(f => f.id === Number(fieldId));
    if (!field) return fail(404, { detail: 'Not found.' });
    if (!definitionManagerRole()) return fail(403, DEFINITIONS_DENIED);
    const clean = (name || '').trim();
    if (!clean) return fail(400, { name: 'This field may not be blank.' });
    if (customFields.some(f => f.id !== field.id && f.name.toLowerCase() === clean.toLowerCase())) {
      return fail(400, { name: `"${clean}" already exists.` });
    }
    field.name = clean;
    return wait(fieldOut(field));
  }

  // Real guard NOT modeled: rejected while still assigned to a Screen
  // (CustomFieldViewSet.perform_destroy, boards/views.py:1237-1244).
  // Screens have no data in this mock at all (out of scope) — nothing to
  // check the guard against.
  function deleteField(fieldId) {
    const field = customFields.find(f => f.id === Number(fieldId));
    if (!field) return fail(404, { detail: 'Not found.' });
    if (!definitionManagerRole()) return fail(403, DEFINITIONS_DENIED);
    customFields = customFields.filter(f => f.id !== field.id);
    fieldOptions = fieldOptions.filter(o => o.field !== field.id); // mirrors ON DELETE CASCADE
    return wait(null);
  }

  /* ---- field options ---- */

  // Real order: FieldOptionViewSet.perform_create checks permission BEFORE
  // looking the field up (boards/views.py:1260-1274) — unlike the
  // project-scoped endpoints elsewhere in this file, where existence is
  // always checked before permission. Mirrored here for the same reason.
  function addFieldOption(fieldId, label) {
    if (!definitionManagerRole()) return fail(403, DEFINITIONS_DENIED);
    const field = customFields.find(f => f.id === Number(fieldId));
    if (!field) return fail(404, { detail: 'Not found.' });
    if (!Logic.fieldHasOptions(field.field_type)) {
      return fail(400, { detail: `Only Select and Multi-select fields have options — "${field.name}" is a ${Logic.FIELD_TYPE_LABEL[field.field_type]}.` });
    }
    const clean = (label || '').trim();
    if (!clean) return fail(400, { label: 'This field may not be blank.' });
    if (fieldOptions.some(o => o.field === field.id && o.label.toLowerCase() === clean.toLowerCase())) {
      return fail(400, { label: `"${clean}" is already an option.` });
    }
    fieldOptions.push({ id: id(), field: field.id, label: clean, position: optionsForField(field.id).length });
    return wait(fieldOut(field));
  }

  function renameFieldOption(fieldId, optionId, label) {
    const option = fieldOptions.find(o => o.id === Number(optionId) && o.field === Number(fieldId));
    if (!option) return fail(404, { detail: 'Not found.' });
    if (!definitionManagerRole()) return fail(403, DEFINITIONS_DENIED);
    const clean = (label || '').trim();
    if (!clean) return fail(400, { label: 'This field may not be blank.' });
    if (fieldOptions.some(o => o.field === option.field && o.id !== option.id && o.label.toLowerCase() === clean.toLowerCase())) {
      return fail(400, { label: `"${clean}" is already an option.` });
    }
    option.label = clean;
    return wait(fieldOut(customFields.find(f => f.id === option.field)));
  }

  // Mirrors FieldOptionViewSet._reposition (boards/views.py:1294-1305)
  // exactly: pull the option out of its field's position-ordered siblings,
  // clamp the target index to the sibling count, reinsert, then renumber
  // everyone 0..n-1. One PATCH moves it — no swap-via-two-PATCH.
  function moveFieldOption(fieldId, optionId, fields) {
    const option = fieldOptions.find(o => o.id === Number(optionId) && o.field === Number(fieldId));
    if (!option) return fail(404, { detail: 'Not found.' });
    if (!definitionManagerRole()) return fail(403, DEFINITIONS_DENIED);
    const raw = Number(fields.position);
    if (!Number.isFinite(raw)) return fail(400, { position: 'Must be a whole number.' });
    const target = Math.max(0, raw);
    const siblings = optionsForField(option.field).filter(o => o.id !== option.id);
    const clamped = Math.min(target, siblings.length);
    siblings.splice(clamped, 0, option);
    siblings.forEach((o, i) => { o.position = i; });
    return wait(fieldOut(customFields.find(f => f.id === option.field)));
  }

  // Real guard NOT modeled: rejected while still chosen on a work item
  // (WorkItemFieldValue). No UI anywhere yet reads or writes a work item's
  // custom field values (out of scope) — nothing to check the guard
  // against, same discipline as deleteField's un-modeled screen guard.
  function deleteFieldOption(fieldId, optionId) {
    const option = fieldOptions.find(o => o.id === Number(optionId) && o.field === Number(fieldId));
    if (!option) return fail(404, { detail: 'Not found.' });
    if (!definitionManagerRole()) return fail(403, DEFINITIONS_DENIED);
    fieldOptions = fieldOptions.filter(o => o.id !== option.id);
    optionsForField(option.field).forEach((o, i) => { o.position = i; });
    return wait(fieldOut(customFields.find(f => f.id === option.field)));
  }
```

- [ ] **Step 5: Add the exports**

In the `return { ... }` block, add a new line after `listComponents, createComponent, renameComponent, deleteComponent,` (currently line 772):

```js
    listComponents, createComponent, renameComponent, deleteComponent,
    listFields, getField, createField, renameField, deleteField,
    addFieldOption, renameFieldOption, moveFieldOption, deleteFieldOption,
```

- [ ] **Step 6: Re-run the console check plus invariant checks**

Sign in as `kabir` (Owner of `WEB`, so `canManageDefinitions` is true). Create a field, rename it, confirm the list re-sorts alphabetically. Create a `select` field, add three options, reorder via `Store.moveFieldOption(fieldId, optionId, {position: 0})`, confirm sibling positions renumber via a follow-up `Store.getField(fieldId)`. Try `Store.addFieldOption(<a number-type field's id>, 'x')` — rejected with the exact "Only Select and Multi-select..." message. Try a duplicate name/label — rejected with the exact `"..." already exists.` / `"..." is already an option.` text. Sign in as `lena` (Owner of `CLNT` — still an Owner-of-*a*-project, so also allowed) to confirm the check really is global, not project-scoped, matching `test_being_owner_of_any_project_is_enough_not_necessarily_a_specific_one`.

- [ ] **Step 7: Commit**

```bash
git add ui/static/js/store.js
git commit -m "feat(fields): add field and field-option seed data and mock CRUD to store.js"
```

---

### Task 4: `index.html` — `tpl-fields` template, nav link, route

**Files:**
- Modify: `ui/index.html` (insert nav link after line 49; insert `tpl-fields` template after line 159)
- Modify: `ui/static/js/app.js` (`route()`, insert after line 197)

**Interfaces:**
- Produces: `tpl-fields` template with `data-list`, `data-create-field`, `[data-type-select]`, `[data-type-hint]`, `[data-create-error]`, `[data-locked]` hooks (exactly what the existing WIP `viewFields()` already expects); `#/fields` route; `data-nav="fields"` nav link
- Consumes: none yet (the WIP `viewFields()` from `e07af89` already targets these hooks — this task just makes them exist and makes the route reachable)

- [ ] **Step 1: Manual pre-check**

Load `ui/index.html`, sign in, click a browser address bar `#/fields` — today this 404s silently (falls through to the Projects route) since there's no `/fields` case in `route()` and no `Fields` nav link.

- [ ] **Step 2: Add the nav link**

In `ui/index.html`, in `tpl-shell`'s `<nav class="nav">` (lines 47-50), insert after line 49:

```html
    <nav class="nav">
      <a href="#/projects" data-nav="projects">Projects</a>
      <a href="#/my-tasks" data-nav="my-tasks">My tasks</a>
      <a href="#/fields" data-nav="fields">Fields</a>
    </nav>
```

Visible to every signed-in user regardless of role — reads are open to any authenticated user (`docs/follow-ups.md`: "Custom fields and screens are readable by any authenticated user"), so there is no permission gate on the link itself; `viewFields()` gates only the write controls.

- [ ] **Step 3: Add the template**

In `ui/index.html`, immediately after line 159 (`</template>` closing `tpl-my-tasks`) and before line 160's blank line / the `<script src="/static/js/logic.js">` block, insert (ported near-verbatim from `design/index.html:228-246`, already matching this file's `page page-narrow`/`page-head` house style used by `tpl-projects`):

```html

<template id="tpl-fields">
  <div class="page page-narrow">
    <div class="page-head">
      <h1>Custom fields</h1>
      <p class="page-sub">Global — one list, shared by every project. Put a field on a Screen to make it appear on a work item.</p>
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

- [ ] **Step 4: Wire the route**

In `ui/static/js/app.js`'s `route()`, immediately after line 197 (`if (hash === '/my-tasks') { setActiveNav('my-tasks'); return viewMyTasks(); }`) and before line 199's `setActiveNav('projects');` fallback, insert:

```js

  if (hash === '/fields') { setActiveNav('fields'); return viewFields(); }
```

- [ ] **Step 5: Browser verification**

Reload, sign in, click "Fields" in the nav — the page loads without a console error (skeleton rows appear then settle), the nav link highlights as active. This is expected to render an **empty or broken list** still, since `viewFields()`'s dependencies (`data.listFields`, `Logic.FIELD_TYPES`, etc.) aren't fully correct until Task 6 — the goal of this step is only "reaches the page, template resolves, no `tpl-fields not found` error."

- [ ] **Step 6: Commit**

```bash
git add ui/index.html ui/static/js/app.js
git commit -m "feat(fields): add Fields nav link, route, and tpl-fields template"
```

---

### Task 5: `app.css` — missing supporting styles

**Files:**
- Modify: `ui/static/css/app.css` (insert after line 920, before line 921/922)

**Interfaces:**
- Produces: `.locked-note`, `.order-list`, `.order-row`, `.order-handle`, `.icon-btn` — the WIP's `openFieldOptionsModal` (`ui/static/js/app.js:454-566`) already emits these classes; `viewFields()`'s `locked` path already emits `.locked-note`. `e07af89` already added `.create-field`, `.hint`, `.type-badge.ft`, `.admin-list`/`.admin-row`, `.pos-index`, `.add-row` — this task fills the rest.
- Consumes: existing custom properties `--surface`, `--sunk`, `--rule-2`, `--ink-3`, `--r`, `--ease-out` (all confirmed already defined in `ui/static/css/app.css`'s `:root` block)

- [ ] **Step 1: Manual pre-check**

`grep -n "order-list\|locked-note\|icon-btn" ui/static/css/app.css` — confirm none of these three exist yet in this file (they exist in `design/css/app.css:1067-1141` but haven't been ported).

- [ ] **Step 2: Add the CSS**

In `ui/static/css/app.css`, immediately after line 920 (the closing `}` of the `.add-row input, .add-row select` rule) and before line 921's blank line / the `/* Responsive ... */` comment, insert (ported verbatim from `design/css/app.css:1067-1141`, substituting the literal `cubic-bezier(...)` for the `var(--ease-out)` alias already used everywhere else in this file):

```css

.locked-note {
  color: var(--ink-2);
  background: var(--sunk);
  border-radius: var(--r);
  padding: 9px 12px;
  margin-bottom: 12px;
  font-size: 12.5px;
}

/* Ordered lists a human hand-sorts — field options here, a screen's fields
   when that work lands. Same row, so "reorder" reads as one idea. */
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

- [ ] **Step 3: Visual check**

Reload `#/fields` — no unstyled/raw-HTML flashes; a locked note (if signed in as a plain Member) renders as a quiet grey box, not plain text.

- [ ] **Step 4: Commit**

```bash
git add ui/static/css/app.css
git commit -m "feat(fields): add locked-note and order-list styles for field options"
```

---

### Task 6: `app.js` — fix the WIP's three real bugs, full verification

**Files:**
- Modify: `ui/static/js/app.js` (line 338; lines 418-429; lines 514-521)

**Interfaces:**
- Consumes: `Logic.canManageDefinitions` (Task 1), `data.listFields`/`createField`/`renameField`/`deleteField`/`getField`/`addFieldOption`/`renameFieldOption`/`moveFieldOption`/`deleteFieldOption` (Tasks 2/3), `tpl-fields`/nav/route (Task 4), CSS (Task 5)

Three concrete bugs identified by reading the current WIP against the real API contract:

1. **Dangling `isOwnerOfAnyProject(projects)` call** (line 338) — not defined anywhere; this is the crash the WIP's own commit message calls out. Fix: replace with `Logic.canManageDefinitions(...)`.
2. **Rename never repaints the list** (lines 418-429) — `CustomField.Meta.ordering = ["name"]` (`boards/models.py:279`), so the list is alphabetical; renaming a field can change its position, but the WIP only patches the DOM node's text in place, leaving stale ordering until the next full reload. `design/js/app.js:1357` repaints; the WIP should too.
3. **Unnecessary, inconsistent two-PATCH "swap" for reordering options** (lines 514-521) — the real `_reposition` endpoint clamps and renumbers everyone in one PATCH (proven by `test_reordering_options`), the same as the already-shipped Statuses reorder convention elsewhere in this codebase. The WIP's second PATCH is redundant at best.

- [ ] **Step 1: Manual pre-check**

In mock mode, open `#/fields` as `kabir` (Owner of `WEB`) — today (before this task) it throws `isOwnerOfAnyProject is not defined` in the console and the page never finishes rendering past the skeleton.

- [ ] **Step 2: Fix the permission predicate**

Replace line 338:

```js
  const canManage = isOwnerOfAnyProject(projects);
```

with:

```js
  // Global: Owner of ANY project (CustomField has no `project` field at
  // all), or a Site Admin. Mirrors user_can_manage_definitions exactly
  // (boards/serializers.py:81-86).
  //
  // Known gap (see the plan's Global Constraints): /api/auth/me/ doesn't
  // expose is_staff today, so `me.is_staff` is always undefined against the
  // real backend — a Site Admin who owns no project won't see these
  // controls here yet. Not fixed here; that's a backend serializer change,
  // outside this front-end-only plan's scope.
  const canManage = Logic.canManageDefinitions(projects.map(p => p.my_role), me && me.is_staff);
```

- [ ] **Step 3: Fix the rename-doesn't-repaint bug**

Replace lines 418-429:

```js
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
```

with:

```js
    nameEl.addEventListener('blur', async () => {
      const value = nameEl.textContent.trim();
      if (!value || value === field.name) { nameEl.textContent = field.name; return; }
      try {
        await data.renameField(field.id, value);
        field.name = value;
        toast('Field renamed');
        // The list is alphabetical (CustomField.Meta.ordering = ["name"]) —
        // a rename can change this row's position, so repaint the whole
        // list rather than only patching this node's text in place.
        await paintFields(list, canManage);
      } catch (err) {
        nameEl.textContent = field.name;
        handle(err);
      }
    });
```

- [ ] **Step 4: Fix the reorder to a single PATCH**

Replace lines 514-521:

```js
    const up = li.querySelector('[data-up]');
    if (up) up.addEventListener('click', () => run(() => data.moveFieldOption(field.id, option.id, { position: field.options[i - 1].position })
      .then(() => data.moveFieldOption(field.id, field.options[i - 1].id, { position: option.position }))
      .then(() => data.getField(field.id))));
    const down = li.querySelector('[data-down]');
    if (down) down.addEventListener('click', () => run(() => data.moveFieldOption(field.id, option.id, { position: field.options[i + 1].position })
      .then(() => data.moveFieldOption(field.id, field.options[i + 1].id, { position: option.position }))
      .then(() => data.getField(field.id))));
```

with:

```js
    // A single PATCH is enough — the server (FieldOptionViewSet._reposition,
    // boards/views.py:1294-1305) clamps the target index and renumbers
    // every sibling in one transaction, proven by test_reordering_options.
    // No swap-via-two-PATCH, matching the Work Item Statuses reorder
    // convention already used elsewhere in this codebase.
    const up = li.querySelector('[data-up]');
    if (up) up.addEventListener('click', () => run(() => data.moveFieldOption(field.id, option.id, { position: i - 1 })));
    const down = li.querySelector('[data-down]');
    if (down) down.addEventListener('click', () => run(() => data.moveFieldOption(field.id, option.id, { position: i + 1 })));
```

- [ ] **Step 5: Full browser verification checklist**

Run once in mock mode (`?data=store`), once against the real backend. Cover every role tier:

- **As `kabir`/an Owner of any project (or a real backend superuser, if you can get one to also own a project — see the `is_staff` gap above):** the create-field form is visible; the "locked" note is hidden.
- Create a field of each of the 8 types; confirm the type hint text updates on select change and matches `Logic.FIELD_TYPE_HINT`.
- Create a `select` or `multiselect` field — the options modal opens automatically right after creation (matches `design/js/app.js:1292`'s "brand-new select needs options before it's usable" behavior, already in the WIP).
- Rename a field so its alphabetical position changes (e.g. rename "Customer reference" to "Aardvark") — confirm the list visibly reorders, not just the text.
- Try renaming to a name that already exists — rejected, exact `"..." already exists.` text surfaced via toast/inline error.
- Delete an unused field — succeeds, disappears from the list.
- Open the Options modal on a `select`/`multiselect` field: add an option, rename one, reorder via ▲/▼ (confirm order persists across a modal re-open and a full page reload), delete one.
- Try adding an option to a non-option-type field directly (e.g. via devtools `data.addFieldOption`) — rejected with the exact "Only Select and Multi-select..." message.
- **As a plain Member (owner of nothing, not staff):** the create-field form and every per-row Delete/rename/Options-modal-edit control are hidden; the field list is still fully visible (read access is universal); the locked note reads the expected copy.
- `Logic.fieldHasOptions`-gated "Options" button only appears on `select`/`multiselect` rows.
- Click "Fields" in the top nav from every other page — the link highlights as active; browser back/forward and a hard reload on `#/fields` all work.

- [ ] **Step 6: `make lint`**

```bash
make lint
```

Expected: clean, no-op (no Python touched by this plan).

- [ ] **Step 7: Commit**

```bash
git add ui/static/js/app.js
git commit -m "fix(fields): correct permission predicate, rename repaint, and option reorder in viewFields"
```

---

## Final verification

- [ ] `make lint` — confirm clean.
- [ ] Full manual regression pass on `#/fields`, covering every checklist item from Task 6 Step 5, as both an Owner-of-some-project and a plain Member, in both `?data=store` mock mode and against a real backend session.
- [ ] `git log --oneline` on the branch — confirm each of the 6 new commits is independently revertible and reads as one logical change.
- [ ] Confirm no reference to Screens/`ScreenField`/`ProjectScreenAssignment` was introduced anywhere in this diff — `git diff e07af89 --stat` then `git diff e07af89 -- ui/ | grep -i screen` should return nothing beyond the pre-existing "Screens are a separate concern" comments.
- [ ] Push branch, open PR against `main`.

---

### Critical Files for Implementation
- `ui/static/js/app.js` — the WIP being finished; three targeted bug fixes plus route/nav wiring
- `ui/static/js/store.js` — new seed data and mock CRUD mirroring `boards/views.py`'s real invariants
- `ui/static/js/api.js` — new thin `request()` wrappers over `/api/fields/` and `/api/fields/{id}/options/`
- `ui/static/js/logic.js` — new pure `FIELD_TYPES`/`FIELD_TYPE_LABEL`/`FIELD_TYPE_HINT`/`fieldHasOptions`/`canManageDefinitions`
- `ui/index.html` — new `tpl-fields` template and `Fields` nav link
- `boards/views.py` (read-only reference) — `CustomFieldViewSet`/`FieldOptionViewSet` at lines 1205-1324 is the ground truth every mock guard and error string above is copied from
