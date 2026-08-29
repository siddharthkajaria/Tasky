/* Tasky — Projects & Membership + Work Item Hierarchy + Custom Fields
   & Screens + Workflows prototype.
   Pure role-permission, hierarchy and field-validation rules; no DOM, no
   network — mirrors the matrices in
   docs/superpowers/specs/2026-08-13-...-membership-design.md,
   docs/superpowers/specs/2026-08-14-...-work-item-hierarchy-design.md,
   docs/superpowers/specs/2026-08-18-...-custom-fields-screens-design.md and
   docs/superpowers/specs/2026-08-18-...-workflows-design.md
   exactly, so this file IS those specs' rule tables, executable. */

const Logic = (() => {

  const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' };

  const canInvite = (role) => role === 'owner' || role === 'admin';

  const canRemove = (actingRole, targetRole) =>
    (actingRole === 'owner' && targetRole !== 'owner') ||
    (actingRole === 'admin' && targetRole === 'member');

  const canChangeRole = (actingRole) => actingRole === 'owner';
  const canTransferOwnership = (actingRole) => actingRole === 'owner';
  const canDeleteProject = (actingRole) => actingRole === 'owner';
  const canLeave = (actingRole) => actingRole === 'admin' || actingRole === 'member';

  /* ---- Work item hierarchy (sub-project 2a) ---------------------------- */

  const ITEM_TYPES = ['epic', 'story', 'task', 'bug', 'subtask'];
  const ITEM_TYPE_LABEL = { epic: 'Epic', story: 'Story', task: 'Task', bug: 'Bug', subtask: 'Subtask' };

  // Exactly the shapes the spec allows: epic -> {story,task,bug} -> subtask.
  const VALID_PARENT_TYPES = {
    epic: [],
    story: ['epic'],
    task: ['epic'],
    bug: ['epic'],
    subtask: ['story', 'task', 'bug'],
  };

  const requiresParent = (itemType) => itemType === 'subtask';
  const canHaveParent = (itemType) => itemType !== 'epic';

  // parentType may be null/undefined (meaning "no parent").
  function isValidParent(itemType, parentType) {
    if (!parentType) return !requiresParent(itemType);
    return VALID_PARENT_TYPES[itemType].includes(parentType);
  }

  const canManageComponents = (role) => role === 'owner' || role === 'admin';

  /* ---- Workflows (sub-project 3) ---------------------------------------- */

  // Fixed, three-value vocabulary every status (built-in or custom) is
  // tagged with — this is what "done-ness" logic keys off, not the status's
  // name. Many statuses can share a category (e.g. "Blocked" and "In
  // Review" both tagged in_progress alongside "In Progress" itself).
  const CATEGORIES = ['todo', 'in_progress', 'done'];
  const CATEGORY_LABELS = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

  const canManageStatuses = (role) => role === 'owner' || role === 'admin';

  /* ---- Backlog & Sprints (sub-project 6) -------------------------------- */

  // Starting/completing/deleting a sprint is Owner/Admin, same tier as
  // Statuses/Components — scheduling a work item into or out of a sprint
  // is a plain edit any project member can already do, no separate check.
  const canManageSprints = (role) => role === 'owner' || role === 'admin';

  /* ---- Releases (sub-project 7) ------------------------------------------
     Same governance tier as Components/Statuses/Sprints: Owner/Admin manage
     the release itself (create/rename/status/date/delete); any project
     member can tag a work item with an existing one — an ordinary edit, no
     separate check. Flat status, no transition rules — the same "custom
     statuses, no workflow" simplification Workflows itself uses. */
  const RELEASE_STATUSES = ['unreleased', 'released', 'archived'];
  const RELEASE_STATUS_LABEL = { unreleased: 'Unreleased', released: 'Released', archived: 'Archived' };
  const canManageReleases = (role) => role === 'owner' || role === 'admin';

  /* ---- Attachments (sub-project 8) --------------------------------------
     Wider than Comment's author-only-unless-account-gone rule: the
     uploader can always delete their own upload, AND an Owner/Admin of the
     work item's project can delete anyone's — an attachment reads as
     shared project property (a spec doc, a screenshot everyone needs)
     rather than a personal remark. This is the one permission check in
     this file that isn't purely role-based — it also needs to compare
     against a specific record's `uploaded_by` — but it stays here rather
     than inline in store.js because it's still a pure rule with no DOM or
     network involved, same as everything else in this file. */
  function canDeleteAttachment(uploadedBy, actingUserId, actingRole) {
    if (uploadedBy !== null && uploadedBy !== undefined && Number(uploadedBy) === Number(actingUserId)) {
      return true;
    }
    return actingRole === 'owner' || actingRole === 'admin';
  }

  /* ---- Custom fields & screens (sub-project 2b) ------------------------ */

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
  const isMultiValue = (fieldType) => fieldType === 'multiselect';

  // Global CustomField/Screen management: Owner of ANY project, not
  // necessarily the project in front of you, OR a Site Admin (sub-project
  // 9 widens this rule, it doesn't narrow it — see that spec's Judgment
  // calls). `roles` is every role this person holds, across every project
  // they're a member of; `isStaff` is their `is_staff` flag.
  const canManageDefinitions = (roles, isStaff) => !!isStaff || (roles || []).includes('owner');

  // Per-project screen assignment — same tier already used for Components.
  const canManageScreenAssignments = (role) => role === 'owner' || role === 'admin';

  /* ---- Permissions & Admin (sub-project 9) ------------------------------
     Site Admin reuses Django's built-in `is_staff` flag rather than a
     purpose-built field — see the spec's Judgment calls. Managing user
     accounts is Site-Admin-only, a genuinely different (stricter) gate
     than every role-based check above: there is no non-admin view of this
     screen at all, unlike Fields/Screens/Labels, which stay readable for
     everyone and only lock their edit controls. */
  const isSiteAdmin = (user) => !!(user && user.is_staff);

  // Archiving a project is Owner-only — one tier stricter than the
  // Owner/Admin split every other per-project manage-tier check uses.
  const canManageProjectArchive = (role) => role === 'owner';

  // Revoking someone else's Site Admin status is blocked once it would
  // leave zero Site Admins. `otherStaffCount` is how many *other* is_staff
  // users exist besides the one being revoked.
  const canRevokeSiteAdmin = (otherStaffCount) => otherStaffCount > 0;

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  function isIsoDate(value) {
    const s = String(value);
    if (!ISO_DATE.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  /* "Blank" is deliberately per-type:
       - multiselect: an empty list
       - checkbox:    unticked (so "required" on a checkbox means "must be
                      ticked", which is the only reading that makes a
                      required checkbox mean anything)
       - everything else: null/undefined/whitespace
     Blankness is the required-check's business; fieldValueError never
     complains about a blank value. */
  function isBlankValue(fieldType, value) {
    if (isMultiValue(fieldType)) return !Array.isArray(value) || value.length === 0;
    if (fieldType === 'checkbox') return !(value === true || value === 'true');
    return value === null || value === undefined || String(value).trim() === '';
  }

  /* Type-checks one value against its field. Returns a human message, or
     null when it's fine. `ctx.optionIds` is the field's *current* option
     ids; `ctx.memberIds` is the work item's project's member user ids. */
  function fieldValueError(field, value, ctx) {
    ctx = ctx || {};
    const type = field.field_type;
    if (isBlankValue(type, value)) return null;

    const optionIds = (ctx.optionIds || []).map(Number);
    const memberIds = (ctx.memberIds || []).map(Number);

    switch (type) {
      case 'text_short':
        return String(value).length > 255
          ? `"${field.name}" must be 255 characters or fewer.`
          : null;
      case 'text_long':
        return null;
      case 'number': {
        const n = Number(String(value).trim());
        return Number.isFinite(n) ? null : `"${field.name}" must be a number.`;
      }
      case 'date':
        return isIsoDate(value) ? null : `"${field.name}" must be a date (YYYY-MM-DD).`;
      case 'checkbox':
        return null; // anything truthy already survived isBlankValue
      case 'select':
        return optionIds.includes(Number(value))
          ? null
          : `"${field.name}" must be one of its current options.`;
      case 'multiselect': {
        const bad = value.filter(v => !optionIds.includes(Number(v)));
        return bad.length ? `"${field.name}" must only use its current options.` : null;
      }
      case 'user_picker':
        return memberIds.includes(Number(value))
          ? null
          : `"${field.name}" must be a member of this project.`;
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

  /* ---- Automation (sub-project 11) ---------------------------------------
     Governance reuses the existing Owner/Admin tier — same as Components/
     Statuses/Sprints/Releases — no new permission level. Only two triggers
     and four actions made this first pass; see the spec's Scope decisions
     for why a generic "field changed" trigger and multi-action rules were
     deliberately left out. */
  const canManageAutomation = (role) => role === 'owner' || role === 'admin';

  const AUTOMATION_TRIGGER_TYPES = ['work_item_created', 'status_changed'];
  const AUTOMATION_TRIGGER_LABEL = {
    work_item_created: 'Work item created',
    status_changed: 'Status changed',
  };
  const AUTOMATION_ACTION_TYPES = ['set_assignee', 'apply_label', 'remove_label', 'change_status'];
  const AUTOMATION_ACTION_LABEL = {
    set_assignee: 'Set assignee',
    apply_label: 'Apply label',
    remove_label: 'Remove label',
    change_status: 'Change status',
  };

  // `item_type: null` matches every item type — the filter's only key.
  function matchesWorkItemCreatedTrigger(filter, item) {
    const itemType = filter && filter.item_type;
    return !itemType || item.item_type === itemType;
  }

  // `from_status: null` matches any originating status. `to_status` and
  // `to_category` are mutually exclusive (enforced at write time, not
  // here) — whichever is set narrows the destination; both null matches
  // any destination. `toStatus` is the full status object being moved
  // into (not just its id), since a `to_category` filter needs its
  // category too.
  function matchesStatusChangedTrigger(filter, fromStatusId, toStatus) {
    filter = filter || {};
    if (filter.from_status != null && Number(filter.from_status) !== Number(fromStatusId)) return false;
    if (filter.to_status != null) return Number(filter.to_status) === Number(toStatus.id);
    if (filter.to_category != null) return filter.to_category === toStatus.category;
    return true;
  }

  // Plain-English summary of a rule's trigger/action, for the admin list —
  // takes lookup functions rather than raw ids so this stays free of any
  // dependency on Store's data shape.
  function describeAutomationRule(rule, statusLookup) {
    let triggerText;
    if (rule.trigger_type === 'work_item_created') {
      const itemType = rule.trigger_filter && rule.trigger_filter.item_type;
      triggerText = itemType
        ? `a ${ITEM_TYPE_LABEL[itemType] || itemType} is created`
        : 'any work item is created';
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
      else actionText = `set the assignee`;
    } else if (rule.action_type === 'apply_label') {
      actionText = `apply the "${cfg.label_name}" label`;
    } else if (rule.action_type === 'remove_label') {
      actionText = `remove the "${cfg.label_name}" label`;
    } else {
      actionText = `change status to "${statusLookup(cfg.status_id)}"`;
    }

    return `When ${triggerText}, ${actionText}.`;
  }

  return {
    ROLE_LABEL,
    canInvite, canRemove, canChangeRole,
    canTransferOwnership, canDeleteProject, canLeave,
    ITEM_TYPES, ITEM_TYPE_LABEL, VALID_PARENT_TYPES,
    requiresParent, canHaveParent, isValidParent, canManageComponents,
    CATEGORIES, CATEGORY_LABELS, canManageStatuses, canManageSprints,
    RELEASE_STATUSES, RELEASE_STATUS_LABEL, canManageReleases,
    canDeleteAttachment,
    FIELD_TYPES, FIELD_TYPE_LABEL, FIELD_TYPE_HINT,
    fieldHasOptions, isMultiValue,
    canManageDefinitions, canManageScreenAssignments,
    isIsoDate, isBlankValue, fieldValueError, screenValueErrors,
    isSiteAdmin, canManageProjectArchive, canRevokeSiteAdmin,
    canManageAutomation, AUTOMATION_TRIGGER_TYPES, AUTOMATION_TRIGGER_LABEL,
    AUTOMATION_ACTION_TYPES, AUTOMATION_ACTION_LABEL,
    matchesWorkItemCreatedTrigger, matchesStatusChangedTrigger, describeAutomationRule,
  };
})();
