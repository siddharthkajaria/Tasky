/* Business logic — pure, no DOM, no network.
   Everything here is the real logic the product needs, written against the
   contract in docs/api.md. It is deliberately independent of where the data
   comes from, so the same code runs on the mock store and the real API. */

const Logic = (() => {

  /* ---- Priorities -------------------------------------------------------- */

  const PRIORITY_LABELS = { 1: 'Low', 2: 'Medium', 3: 'High' };

  /* ---- Workflow status categories (sub-project 3) ------------------------
     Fixed, three-value vocabulary every status (built-in or custom) is
     tagged with. Many statuses can share a category — "Blocked" and "In
     Review" might both be tagged in_progress alongside "In Progress"
     itself. The board's column styling already keys off `status.category`
     (see `columnEl` in app.js), never off a status's name. */
  const CATEGORIES = ['todo', 'in_progress', 'done'];
  const CATEGORY_LABELS = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

  const canManageStatuses = (role) => role === 'owner' || role === 'admin';

  /* ---- Labels (sub-project 4) ----------------------------------------
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

  /* ---- Project archive (sub-project 9) ------------------------------------
     Archiving is Owner-only — one tier stricter than the Owner/Admin split
     every other per-project manage-tier predicate in this file uses. */
  const canManageProjectArchive = (role) => role === 'owner';

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

  /* ---- Project roles --------------------------------------------------- */

  /* The permission matrix from the Projects & Membership spec. It is
     duplicated in projects/permissions.py on the server; the server is the
     one that decides. These exist so the UI hides controls that would only
     ever 403, not so it can grant anything. */

  const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' };

  const canInvite = (role) => role === 'owner' || role === 'admin';

  const canRemove = (actingRole, targetRole) =>
    (actingRole === 'owner' && targetRole !== 'owner') ||
    (actingRole === 'admin' && targetRole === 'member');

  const canChangeRole = (actingRole) => actingRole === 'owner';
  const canTransferOwnership = (actingRole) => actingRole === 'owner';
  const canDeleteProject = (actingRole) => actingRole === 'owner';
  /* The Owner has no "leave" — the API rejects it with 400 until ownership
     has been transferred, so the button is not offered at all. */
  const canLeave = (actingRole) => actingRole === 'admin' || actingRole === 'member';
  const canManageComponents = (role) => role === 'owner' || role === 'admin';

  /* ---- Work item hierarchy --------------------------------------------- */

  const ITEM_TYPES = ['epic', 'story', 'task', 'bug', 'subtask'];
  const ITEM_TYPE_LABEL = { epic: 'Epic', story: 'Story', task: 'Task', bug: 'Bug', subtask: 'Subtask' };

  /* Exactly the shapes the API allows: epic -> {story,task,bug} -> subtask.
     Mirrors VALID_PARENT_TYPES in boards/serializers.py. */
  const VALID_PARENT_TYPES = {
    epic: [],
    story: ['epic'],
    task: ['epic'],
    bug: ['epic'],
    subtask: ['story', 'task', 'bug'],
  };

  const requiresParent = (itemType) => itemType === 'subtask';
  const canHaveParent = (itemType) => itemType !== 'epic';

  // parentType may be null/undefined, meaning "no parent".
  function isValidParent(itemType, parentType) {
    if (!parentType) return !requiresParent(itemType);
    return (VALID_PARENT_TYPES[itemType] || []).includes(parentType);
  }

  /* Every item on the board that could legally be `itemType`'s parent.
     `excludeId` keeps an item from offering itself. The API enforces the
     same rule and also that parent and child share a board — which holds
     here because the only list ever passed in is one board's items. */
  function parentCandidates(items, itemType, excludeId) {
    if (!canHaveParent(itemType)) return [];
    const allowed = VALID_PARENT_TYPES[itemType] || [];
    return (items || []).filter(i => i.id !== excludeId && allowed.includes(i.item_type));
  }

  /* ---- Grouping and the optimistic move -------------------------------- */

  /* The API returns every work item on a board in ONE position-ordered list
     that interleaves every column's items, so two items in different columns
     share a position. Grouping is the client's job.

     `status` is a per-project `WorkItemStatus` id (an integer), not a fixed
     three-value enum — a project can have any number of statuses, in any
     category. Every status in `statuses` (from `GET /projects/{id}/statuses/`)
     gets an entry, empty or not, so a column with no cards still renders. */
  function groupByStatus(items, statuses) {
    const buckets = {};
    (statuses || []).forEach(s => { buckets[s.id] = []; });
    for (const item of items || []) {
      (buckets[item.status] || (buckets[item.status] = [])).push(item);
    }
    return buckets;
  }

  function findItem(buckets, itemId) {
    for (const status of Object.keys(buckets)) {
      const item = buckets[status].find(i => i.id === itemId);
      if (item) return { item, from: status };
    }
    return { item: null, from: null };
  }

  function removeItem(buckets, itemId) {
    const next = {};
    for (const status of Object.keys(buckets)) {
      next[status] = buckets[status].filter(i => i.id !== itemId);
    }
    return next;
  }

  /* Remove from the source column BEFORE inserting into the destination.
     The other order is off by one whenever an item moves down within its own
     column. Returns new objects; never mutates the input. */
  function applyMove(buckets, itemId, toStatus, toIndex) {
    const { item } = findItem(buckets, itemId);
    if (!item) return buckets;

    const next = removeItem(buckets, itemId);
    const moved = Object.assign({}, item, { status: toStatus });
    const target = next[toStatus].slice();
    target.splice(toIndex, 0, moved);
    next[toStatus] = target;
    return next;
  }

  /* Optimistic move with rollback.
     `commit` performs the write and `reload` re-reads the board. */
  async function moveWorkItem(opts) {
    const { buckets, itemId, toStatus, toIndex, render, commit, reload } = opts;
    const snapshot = buckets;

    render(applyMove(buckets, itemId, toStatus, toIndex));

    try {
      await commit(itemId, { status: toStatus, position: toIndex });
      /* The server renumbers the whole column in a transaction. If a teammate
         dragged at the same time our local guess is wrong, so reconcile. */
      await reload();
    } catch (err) {
      if (err && err.status === 404) {
        /* Deleted before the move landed — drop it rather than resurrect it. */
        render(removeItem(snapshot, itemId));
        await reload();
        return;
      }
      render(snapshot);
      throw err;
    }
  }

  /* ---- Dates ------------------------------------------------------------ */

  /* Dates are compared as plain YYYY-MM-DD strings, which is what the API
     returns. No timezone maths, no Date parsing surprises. */
  function today() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function isOverdue(item) {
    const category = item.status_detail && item.status_detail.category;
    return Boolean(item.due_date) && category !== 'done' && item.due_date < today();
  }

  function dueLabel(dateStr) {
    if (!dateStr) return '';
    const days = Math.round((new Date(dateStr) - new Date(today())) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    if (days < 0) return `${Math.abs(days)}d late`;
    if (days <= 7) return `${days}d`;
    return dateStr.slice(5);            // MM-DD
  }

  /* ---- Write payloads --------------------------------------------------- */

  /* Fields the work item PATCH endpoint accepts. `status`, `board`,
     `item_type` and `key` are absent on purpose: the API rejects a change to
     any of them with 400. Column moves go only through the move endpoint,
     which the detail view calls separately when the status select changed.

     `parent` is only included when the item's type can carry one — an Epic
     has no parent field in the form at all, and sending `parent: null` for
     one would be a no-op at best and a confusing 400 at worst. */
  function editableWorkItemFields(form, itemType) {
    const fields = {
      title: form.title,
      description: form.description,
      priority: Number(form.priority),
      due_date: form.due_date || null,
      assignee: form.assignee === '' || form.assignee == null ? null : Number(form.assignee),
      components: (form.components || []).map(Number),
    };
    if (canHaveParent(itemType)) {
      fields.parent = form.parent === '' || form.parent == null ? null : Number(form.parent);
    }
    return fields;
  }

  return {
    PRIORITY_LABELS,
    ROLE_LABEL,
    CATEGORIES, CATEGORY_LABELS, canManageStatuses,
    LABEL_PALETTE, colorForLabelName,
    canManageProjectArchive,
    FIELD_TYPES, FIELD_TYPE_LABEL, FIELD_TYPE_HINT, fieldHasOptions, isMultiValue,
    canManageDefinitions, canManageScreenAssignments,
    isIsoDate, isBlankValue, fieldValueError, screenValueErrors,
    canInvite, canRemove, canChangeRole,
    canTransferOwnership, canDeleteProject, canLeave, canManageComponents,
    ITEM_TYPES, ITEM_TYPE_LABEL, VALID_PARENT_TYPES,
    requiresParent, canHaveParent, isValidParent, parentCandidates,
    groupByStatus, findItem, applyMove, removeItem, moveWorkItem,
    isOverdue, dueLabel, today, editableWorkItemFields,
  };
})();
