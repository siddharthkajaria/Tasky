/* Business logic — pure, no DOM, no network.
   Everything here is the real logic the product needs, written against the
   contract in docs/api.md. It is deliberately independent of where the data
   comes from, so the same code runs on the mock store and the real API. */

const Logic = (() => {

  /* ---- Priorities -------------------------------------------------------- */

  const PRIORITY_LABELS = { 1: 'Low', 2: 'Medium', 3: 'High' };

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
    canInvite, canRemove, canChangeRole,
    canTransferOwnership, canDeleteProject, canLeave, canManageComponents,
    ITEM_TYPES, ITEM_TYPE_LABEL, VALID_PARENT_TYPES,
    requiresParent, canHaveParent, isValidParent, parentCandidates,
    groupByStatus, findItem, applyMove, removeItem, moveWorkItem,
    isOverdue, dueLabel, today, editableWorkItemFields,
  };
})();
