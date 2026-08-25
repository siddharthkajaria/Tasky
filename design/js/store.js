/* Mock data source for the Projects & Membership prototype.
   Enforces the same rules the real API will, so this prototype is an
   honest model of the feature rather than a picture of it — every
   permission check here has a matching row in the spec's error table. */

const Store = (() => {

  const LATENCY = 140;   // enough to see optimistic updates land
  let nextId = 100;
  const id = () => ++nextId;

  // The same people the real `seed_demo` command creates.
  const users = [
    { id: 1, username: 'asha',  display_name: 'Asha Rao' },
    { id: 2, username: 'kabir', display_name: 'Kabir Menon' },
    { id: 3, username: 'lena',  display_name: 'Lena Fischer' },
  ];
  const userById = (uid) => users.find(u => u.id === Number(uid));

  let me = null;

  // Seeded so signing in as Asha alone walks through Owner, Admin and
  // Member views without switching accounts, plus one pending invitation.
  let projects = [
    { id: 1, key: 'TASKY', name: 'Tasky Redesign',   description: 'The multi-project expansion itself' },
    { id: 2, key: 'WEB',   name: 'Website Refresh',  description: '' },
    { id: 3, key: 'CLNT',  name: 'Client Portal',    description: '' },
    { id: 4, key: 'MKT',   name: 'Marketing Launch', description: '' },
  ];

  let memberships = [
    { id: id(), project: 1, user: 1, role: 'owner' },   // Asha owns Tasky Redesign
    { id: id(), project: 1, user: 2, role: 'admin' },
    { id: id(), project: 2, user: 2, role: 'owner' },
    { id: id(), project: 2, user: 1, role: 'admin' },   // Asha admins Website Refresh
    { id: id(), project: 3, user: 3, role: 'owner' },
    { id: id(), project: 3, user: 2, role: 'admin' },
    { id: id(), project: 3, user: 1, role: 'member' },  // Asha is a plain member of Client Portal
    { id: id(), project: 4, user: 3, role: 'owner' },
  ];

  let invitations = [
    // Pending invite waiting for Asha to accept/decline on first login.
    { id: id(), project: 4, invited_user: 1, invited_by: 3, status: 'pending', created_at: new Date().toISOString() },
  ];

  // Work Item Hierarchy (sub-project 2a) seed data ------------------------

  let boards = [
    { id: id(), project: 1, name: 'Sprint Board' },
    { id: id(), project: 2, name: 'Main Board' },
  ];
  const [board1] = boards;

  let components = [
    { id: id(), project: 1, name: 'Frontend' },
    { id: id(), project: 1, name: 'Backend' },
  ];

  // Workflows (sub-project 3) seed data — every project gets the same 3
  // default statuses a real project would be seeded with, so a reviewer
  // sees "no customization yet" as the normal starting state.
  let workItemStatuses = [];
  function seedStatuses(projectId) {
    const todo = { id: id(), project: projectId, name: 'To Do', category: 'todo', position: 0 };
    const inProgress = { id: id(), project: projectId, name: 'In Progress', category: 'in_progress', position: 1 };
    const done = { id: id(), project: projectId, name: 'Done', category: 'done', position: 2 };
    workItemStatuses.push(todo, inProgress, done);
    return { todo, inProgress, done };
  }
  const taskyStatuses = seedStatuses(1);
  seedStatuses(2);
  seedStatuses(3);
  seedStatuses(4);

  // Labels (sub-project 4) data — declared here, ahead of the work item
  // seed block below, so seeding can assign labels to seed items directly.
  // The rest of the labels CRUD lives further down, grouped with Workflows;
  // function declarations are hoisted regardless of position, but `let`/
  // `const` bindings are not, so only the data itself needs to live this
  // early.
  const LABEL_PALETTE = [
    '#6E4FA3', '#2E7D5B', '#3B3F8F', '#A32218',
    '#B8860B', '#1F7A8C', '#C2447A', '#5B7B29',
  ];
  let labels = [];

  // Seed-only: `findOrCreateLabel` (defined below, with the rest of the
  // labels CRUD) uses `me.id` for `created_by`, but `me` is null until
  // someone logs in — this runs at module load, before that. Hardcodes
  // `created_by: 1` (Asha), matching how the rest of the seed data does.
  function seedLabel(name) {
    const label = { id: id(), name, color: hashLabelColor(name), created_by: 1 };
    labels.push(label);
    return label;
  }

  // Backlog & Sprints (sub-project 6) — declared ahead of the work item
  // seed block below, same reason `labels` is: seeding needs to assign
  // items directly into a sprint.
  let sprints = [
    {
      id: id(), board: board1.id, name: 'Sprint 14', goal: 'Ship the redesigned onboarding flow',
      state: 'active', start_date: '2026-08-11', end_date: null, created_by: 1,
    },
    {
      id: id(), board: board1.id, name: 'Sprint 15', goal: '',
      state: 'planned', start_date: null, end_date: null, created_by: 1,
    },
  ];

  let workItems = [];
  function seedItem(o) {
    const item = Object.assign({
      description: '', priority: 2, due_date: null, assignee: null,
      parent: null, position: 0, component_ids: [], label_ids: [], created_by: 1,
      sprint: null, backlog_position: 0,
    }, o);
    workItems.push(item);
    return item;
  }

  // One Epic, two of its children (a Story and a Task), a Subtask under
  // the Story, and a standalone Bug — enough to exercise every level of
  // the hierarchy and every valid parent shape from the seed alone.
  const epic = seedItem({
    id: id(), key: 'TASKY-1', board: board1.id, item_type: 'epic',
    title: 'Redesign onboarding', status: taskyStatuses.inProgress.id, priority: 3, assignee: 1,
    backlog_position: 0,
  });
  const lblNeedsDesign = seedLabel('needs-design');
  const lblUrgent = seedLabel('urgent');

  const story1 = seedItem({
    id: id(), key: 'TASKY-2', board: board1.id, item_type: 'story', parent: epic.id,
    title: 'Design the welcome screen', status: taskyStatuses.todo.id, assignee: 3,
    component_ids: [components[0].id], label_ids: [lblNeedsDesign.id],
    sprint: sprints[0].id, backlog_position: 0,
  });
  const task1 = seedItem({
    id: id(), key: 'TASKY-3', board: board1.id, item_type: 'task', parent: epic.id,
    title: 'Wire up the onboarding API', status: taskyStatuses.todo.id, assignee: 2,
    component_ids: [components[1].id],
    sprint: sprints[0].id, backlog_position: 1,
  });
  seedItem({
    id: id(), key: 'TASKY-4', board: board1.id, item_type: 'subtask', parent: story1.id,
    title: 'Write the welcome copy', status: taskyStatuses.todo.id,
    backlog_position: 1,
  });
  const bug1 = seedItem({
    id: id(), key: 'TASKY-5', board: board1.id, item_type: 'bug',
    title: 'Signup button misaligned on Safari', status: taskyStatuses.inProgress.id, priority: 3, assignee: 1,
    label_ids: [lblUrgent.id],
    backlog_position: 2,
  });

  let links = [
    {
      id: id(),
      item_a: Math.min(task1.id, bug1.id), item_b: Math.max(task1.id, bug1.id),
      created_by: 1, created_at: new Date().toISOString(),
    },
  ];

  const projectItemCounters = { 1: 6 }; // next number after the 5 seeded TASKY items

  // Custom Fields & Screens (sub-project 2b) seed data --------------------

  let customFields = [];
  let fieldOptions = [];
  let screens = [];
  let screenFields = [];
  let screenAssignments = [];
  let workItemFieldValues = [];

  function seedField(name, fieldType, optionLabels) {
    const field = { id: id(), name, field_type: fieldType, created_by: 1 };
    customFields.push(field);
    (optionLabels || []).forEach((label, i) => {
      fieldOptions.push({ id: id(), field: field.id, label, position: i });
    });
    return field;
  }

  // One of every type, so a reviewer sees each renderer without having to
  // create anything first.
  const fSeverity   = seedField('Severity', 'select', ['Blocker', 'Major', 'Minor', 'Cosmetic']);
  const fEnvironment = seedField('Environment', 'text_short');
  const fRepro      = seedField('Steps to reproduce', 'text_long');
  const fPlatforms  = seedField('Affected platforms', 'multiselect', ['Web', 'iOS', 'Android', 'Desktop']);
  const fStoryPts   = seedField('Story Points', 'number');
  const fTargetDate = seedField('Target release', 'date');
  const fNeedsQA    = seedField('Needs QA sign-off', 'checkbox');
  const fReviewer   = seedField('Reviewer', 'user_picker');
  // Deliberately on no screen at all: the one field a reviewer can delete
  // straight away, and the one they can add to a screen straight away.
  seedField('Customer reference', 'text_short');

  function seedScreen(name, rows) {
    const screen = { id: id(), name };
    screens.push(screen);
    rows.forEach(([field, required], i) => {
      screenFields.push({ id: id(), screen: screen.id, field: field.id, position: i, required: !!required });
    });
    return screen;
  }

  // Story Points sits on both screens — required on one, optional on the
  // other. That's the spec's per-screen `required` choice, visible from the
  // seed rather than only after a reviewer sets it up.
  const bugScreen = seedScreen('Bug triage', [
    [fSeverity, true], [fEnvironment, true], [fRepro, false],
    [fPlatforms, false], [fStoryPts, false],
  ]);
  const storyScreen = seedScreen('Story delivery', [
    [fStoryPts, true], [fTargetDate, false], [fNeedsQA, false], [fReviewer, false],
  ]);

  screenAssignments = [
    { id: id(), project: 1, item_type: 'story', screen: storyScreen.id },
    { id: id(), project: 1, item_type: 'bug',   screen: bugScreen.id },
  ];

  const optionByLabel = (field, label) =>
    fieldOptions.find(o => o.field === field.id && o.label === label);

  function seedValue(item, field, value) {
    workItemFieldValues.push({ id: id(), work_item: item.id, field: field.id, value: String(value) });
  }

  seedValue(bug1, fSeverity, optionByLabel(fSeverity, 'Major').id);
  seedValue(bug1, fEnvironment, 'Safari 17.4 / macOS 14.4');
  seedValue(bug1, fPlatforms, optionByLabel(fPlatforms, 'Web').id);
  seedValue(bug1, fPlatforms, optionByLabel(fPlatforms, 'Desktop').id);
  seedValue(story1, fStoryPts, '5');
  // Orphan on purpose: Environment is not on the "Story delivery" screen,
  // so TASKY-2 shows a saved value its form no longer offers — the spec's
  // "changing a screen never deletes values" rule, visible from the seed.
  seedValue(story1, fEnvironment, 'Staging');

  /* ---- plumbing ---- */

  const wait = (v) => new Promise(res => setTimeout(() => res(clone(v)), LATENCY));
  const clone = (v) => (v === null || v === undefined) ? v : JSON.parse(JSON.stringify(v));

  function fail(status, message) {
    return Promise.reject(Object.assign(new Error(message), { status }));
  }

  // A 400 that also carries a per-field breakdown, so a form can put each
  // complaint under the control that caused it instead of only shouting
  // one line at the top. `field: 'custom_fields'` mirrors the name the real
  // API's error payload uses.
  function failCustomFields(message, errors) {
    return Promise.reject(Object.assign(new Error(message), {
      status: 400, field: 'custom_fields', errors: errors || {},
    }));
  }

  const membershipFor = (projectId, userId) =>
    memberships.find(m => m.project === Number(projectId) && m.user === Number(userId));

  const myRole = (projectId) => {
    const m = membershipFor(projectId, me.id);
    return m ? m.role : null;
  };

  function requireMember(projectId) {
    if (!myRole(projectId)) throw Object.assign(new Error("You don't have access to this project."), { status: 403 });
  }

  /* ---- auth ---- */

  function login(username, password) {
    const user = users.find(u => u.username === username.trim().toLowerCase());
    if (!user || !password) {
      // Identical message for an unknown username and a wrong password —
      // matches the real API's anti-enumeration behaviour.
      return fail(400, 'Incorrect username or password.');
    }
    me = user;
    return wait(user);
  }

  function logout() { me = null; return wait(null); }
  function getMe() { return me ? wait(me) : fail(403, 'Authentication credentials were not provided.'); }

  /* ---- projects ---- */

  function decorateProject(project) {
    return Object.assign({}, project, {
      my_role: myRole(project.id),
      member_count: memberships.filter(m => m.project === project.id).length,
    });
  }

  const listMyProjects = () => wait(
    projects.filter(p => membershipFor(p.id, me.id)).map(decorateProject)
  );

  function getProject(projectId) {
    const project = projects.find(p => p.id === Number(projectId));
    if (!project) return fail(404, 'Not found.');
    try { requireMember(projectId); } catch (err) { return Promise.reject(err); }
    return wait(decorateProject(project));
  }

  function createProject({ name, key }) {
    if (!name || !name.trim()) return fail(400, 'This field may not be blank.');
    const cleanKey = (key || '').trim().toUpperCase();
    if (!/^[A-Z]{2,10}$/.test(cleanKey)) return fail(400, 'Key must be 2–10 letters, e.g. TASKY.');
    if (projects.some(p => p.key === cleanKey)) return fail(400, `"${cleanKey}" is already taken.`);
    const project = { id: id(), key: cleanKey, name: name.trim(), description: '' };
    projects.push(project);
    memberships.push({ id: id(), project: project.id, user: me.id, role: 'owner' });
    return wait(decorateProject(project));
  }

  function deleteProject(projectId) {
    if (myRole(projectId) !== 'owner') return fail(403, 'Only the owner can delete a project.');
    projects = projects.filter(p => p.id !== Number(projectId));
    memberships = memberships.filter(m => m.project !== Number(projectId));
    invitations = invitations.filter(i => i.project !== Number(projectId));
    // The project's screen assignments go with it; the global Screens and
    // CustomFields they pointed at survive, since they're not project-owned.
    screenAssignments = screenAssignments.filter(a => a.project !== Number(projectId));
    return wait(null);
  }

  /* ---- membership ---- */

  const decorateMembership = (m) => Object.assign({}, m, { user_detail: userById(m.user) });

  function listMembers(projectId) {
    try { requireMember(projectId); } catch (err) { return Promise.reject(err); }
    const rank = { owner: 0, admin: 1, member: 2 };
    return wait(
      memberships.filter(m => m.project === Number(projectId))
        .sort((a, b) => rank[a.role] - rank[b.role] || a.id - b.id)
        .map(decorateMembership)
    );
  }

  function removeMember(projectId, userId) {
    const actingRole = myRole(projectId);
    const target = membershipFor(projectId, userId);
    if (!target) return fail(404, 'Not found.');
    if (Number(userId) === me.id) return fail(400, 'Use "Leave project" to remove yourself.');
    const allowed = (actingRole === 'owner' && target.role !== 'owner') ||
                     (actingRole === 'admin' && target.role === 'member');
    if (!allowed) return fail(403, "You don't have permission to remove this member.");
    memberships = memberships.filter(m => m.id !== target.id);
    return wait(null);
  }

  function leaveProject(projectId) {
    const role = myRole(projectId);
    if (!role) return fail(404, 'Not found.');
    if (role === 'owner') return fail(400, 'Transfer ownership before leaving a project you own.');
    memberships = memberships.filter(m => !(m.project === Number(projectId) && m.user === me.id));
    return wait(null);
  }

  function changeRole(projectId, userId, newRole) {
    if (myRole(projectId) !== 'owner') return fail(403, 'Only the owner can change member roles.');
    if (!['admin', 'member'].includes(newRole)) return fail(400, 'Invalid role.');
    const target = membershipFor(projectId, userId);
    if (!target) return fail(404, 'Not found.');
    if (target.role === 'owner') return fail(403, "The owner's role can't be changed here — transfer ownership instead.");
    target.role = newRole;
    return wait(decorateMembership(target));
  }

  function transferOwnership(projectId, newOwnerUserId) {
    if (myRole(projectId) !== 'owner') return fail(403, 'Only the owner can transfer ownership.');
    const target = membershipFor(projectId, newOwnerUserId);
    if (!target || target.role !== 'admin') return fail(400, 'Ownership can only be transferred to an existing Admin.');
    membershipFor(projectId, me.id).role = 'admin';
    target.role = 'owner';
    return wait(null);
  }

  /* ---- invitations ---- */

  const decorateInvitation = (inv) => Object.assign({}, inv, {
    project_detail: projects.find(p => p.id === inv.project),
    invited_by_detail: userById(inv.invited_by),
    invited_user_detail: userById(inv.invited_user),
  });

  const listMyInvitations = () => wait(
    invitations.filter(i => i.invited_user === me.id && i.status === 'pending').map(decorateInvitation)
  );

  function listProjectInvitations(projectId) {
    try { requireMember(projectId); } catch (err) { return Promise.reject(err); }
    return wait(
      invitations.filter(i => i.project === Number(projectId) && i.status === 'pending').map(decorateInvitation)
    );
  }

  function listInvitableUsers(projectId) {
    try { requireMember(projectId); } catch (err) { return Promise.reject(err); }
    const memberIds = new Set(memberships.filter(m => m.project === Number(projectId)).map(m => m.user));
    const invitedIds = new Set(
      invitations.filter(i => i.project === Number(projectId) && i.status === 'pending').map(i => i.invited_user)
    );
    return wait(users.filter(u => !memberIds.has(u.id) && !invitedIds.has(u.id)));
  }

  function inviteMember(projectId, userId) {
    if (!canActingInvite(projectId)) return fail(403, "You don't have permission to invite members.");
    if (membershipFor(projectId, userId)) return fail(400, 'Already a member of this project.');
    if (invitations.some(i => i.project === Number(projectId) && i.invited_user === Number(userId) && i.status === 'pending')) {
      return fail(400, 'Already invited — waiting on a response.');
    }
    const inv = {
      id: id(), project: Number(projectId), invited_user: Number(userId),
      invited_by: me.id, status: 'pending', created_at: new Date().toISOString(),
    };
    invitations.push(inv);
    return wait(decorateInvitation(inv));
  }
  function canActingInvite(projectId) {
    const role = myRole(projectId);
    return role === 'owner' || role === 'admin';
  }

  function acceptInvitation(invitationId) {
    const inv = invitations.find(i => i.id === Number(invitationId));
    if (!inv) return fail(404, 'Not found.');
    if (inv.invited_user !== me.id) return fail(403, 'You can only respond to your own invitations.');
    inv.status = 'accepted';
    memberships.push({ id: id(), project: inv.project, user: me.id, role: 'member' });
    return wait(null);
  }

  function declineInvitation(invitationId) {
    const inv = invitations.find(i => i.id === Number(invitationId));
    if (!inv) return fail(404, 'Not found.');
    if (inv.invited_user !== me.id) return fail(403, 'You can only respond to your own invitations.');
    inv.status = 'declined';
    return wait(null);
  }

  /* ---- boards ---- */

  function listBoards(projectId) {
    try { requireMember(projectId); } catch (err) { return Promise.reject(err); }
    return wait(boards.filter(b => b.project === Number(projectId)));
  }

  function createBoard(projectId, name) {
    try { requireMember(projectId); } catch (err) { return Promise.reject(err); }
    if (!name || !name.trim()) return fail(400, 'This field may not be blank.');
    const board = { id: id(), project: Number(projectId), name: name.trim() };
    boards.push(board);
    return wait(board);
  }

  function getBoard(boardId) {
    const board = boards.find(b => b.id === Number(boardId));
    if (!board) return fail(404, 'Not found.');
    try { requireMember(board.project); } catch (err) { return Promise.reject(err); }
    return wait(board);
  }

  function boardProjectId(boardId) {
    const board = boards.find(b => b.id === boardId);
    return board ? board.project : null;
  }

  /* ---- work items ---- */

  const statusById = (statusId) => workItemStatuses.find(s => s.id === statusId) || null;

  function decorateWorkItem(item) {
    const parent = item.parent ? workItems.find(w => w.id === item.parent) : null;
    const children = workItems
      .filter(w => w.parent === item.id)
      .map(c => ({
        id: c.id, key: c.key, title: c.title, item_type: c.item_type,
        status: c.status, status_detail: statusById(c.status),
      }));
    const custom = customFieldsOf(item.id);
    return Object.assign({}, item, {
      // `custom_fields` is the API's read/write shape; `custom_field_details`
      // is the same data pre-resolved for display (labels, not ids).
      custom_fields: custom.map,
      custom_field_details: custom.details,
      assignee_detail: item.assignee ? userById(item.assignee) : null,
      created_by_detail: userById(item.created_by),
      priority_label: { 1: 'Low', 2: 'Medium', 3: 'High' }[item.priority],
      status_detail: statusById(item.status),
      parent_detail: parent
        ? { id: parent.id, key: parent.key, title: parent.title, item_type: parent.item_type }
        : null,
      children,
      components: components.filter(c => item.component_ids.includes(c.id)),
      labels_detail: (item.label_ids || []).map(lid => labels.find(l => l.id === lid)).filter(Boolean),
      sprint_detail: item.sprint ? sprintSummary(item.sprint) : null,
    });
  }

  function nextKey(projectId) {
    const project = projects.find(p => p.id === projectId);
    const n = projectItemCounters[projectId] || 1;
    projectItemCounters[projectId] = n + 1;
    return `${project.key}-${n}`;
  }

  // Shared by create and update: given a candidate item_type + parent work
  // item (or null), returns an error message string, or null if valid.
  function hierarchyError(itemType, parent) {
    if (!Logic.isValidParent(itemType, parent ? parent.item_type : null)) {
      const label = Logic.ITEM_TYPE_LABEL[itemType];
      const article = /^[AEIOU]/.test(label) ? 'An' : 'A';
      return Logic.requiresParent(itemType)
        ? `${article} ${label} must have a parent Story, Task, or Bug.`
        : `${article} ${label} can't have that parent.`;
    }
    return null;
  }

  function listBoardWorkItems(boardId) {
    const board = boards.find(b => b.id === Number(boardId));
    if (!board) return fail(404, 'Not found.');
    try { requireMember(board.project); } catch (err) { return Promise.reject(err); }
    return wait(workItems.filter(w => w.board === board.id).map(decorateWorkItem));
  }

  function getWorkItem(itemId) {
    const item = workItems.find(w => w.id === Number(itemId));
    if (!item) return fail(404, 'Not found.');
    try { requireMember(boardProjectId(item.board)); } catch (err) { return Promise.reject(err); }
    return wait(decorateWorkItem(item));
  }

  function createWorkItem(fields) {
    const board = boards.find(b => b.id === Number(fields.board));
    if (!board) return fail(404, 'Not found.');
    try { requireMember(board.project); } catch (err) { return Promise.reject(err); }

    if (!Logic.ITEM_TYPES.includes(fields.item_type)) return fail(400, 'Invalid item type.');
    if (!fields.title || !fields.title.trim()) return fail(400, 'This field may not be blank.');

    let parent = null;
    if (fields.parent) {
      parent = workItems.find(w => w.id === Number(fields.parent));
      if (!parent) return fail(400, 'Parent not found.');
      if (parent.board !== board.id) return fail(400, 'Parent must be on the same board.');
    }
    const hErr = hierarchyError(fields.item_type, parent);
    if (hErr) return fail(400, hErr);

    let status;
    if (fields.status) {
      status = workItemStatuses.find(s => s.id === Number(fields.status));
      if (!status) return fail(400, 'Status not found.');
      if (status.project !== board.project) return fail(400, 'Status must belong to this item\'s project.');
    } else {
      status = defaultStatusFor(board.project);
    }

    const cfErr = customFieldsError(board.project, fields.item_type, fields.custom_fields);
    if (cfErr) return failCustomFields(cfErr.message, cfErr.errors);

    const item = seedItem({
      id: id(), key: nextKey(board.project), board: board.id, item_type: fields.item_type,
      title: fields.title.trim(), description: fields.description || '',
      status: status.id, priority: fields.priority || 2,
      due_date: fields.due_date || null, assignee: fields.assignee || null,
      parent: parent ? parent.id : null, component_ids: fields.component_ids || [],
      label_ids: resolveLabelIds(fields.labels),
      created_by: me.id,
    });
    const siblings = workItems.filter(w => w.board === board.id && w.status === item.status && w.id !== item.id);
    item.position = siblings.length;
    if (fields.custom_fields) applyCustomFields(item.id, fields.custom_fields);
    return wait(decorateWorkItem(item));
  }

  function updateWorkItem(itemId, fields) {
    const item = workItems.find(w => w.id === Number(itemId));
    if (!item) return fail(404, 'Not found.');
    try { requireMember(boardProjectId(item.board)); } catch (err) { return Promise.reject(err); }

    if ('item_type' in fields && fields.item_type !== item.item_type) {
      return fail(400, 'Type cannot be changed after creation.');
    }
    if ('key' in fields && fields.key !== item.key) {
      return fail(400, 'Key cannot be changed.');
    }
    if ('title' in fields && !String(fields.title).trim()) {
      return fail(400, 'This field may not be blank.');
    }

    let newParent;
    if ('parent' in fields) {
      const newParentId = fields.parent ? Number(fields.parent) : null;
      if (newParentId === item.id) return fail(400, "An item can't be its own parent.");
      newParent = newParentId ? workItems.find(w => w.id === newParentId) : null;
      if (newParentId && !newParent) return fail(400, 'Parent not found.');
      if (newParent && newParent.board !== item.board) {
        return fail(400, 'Parent must be on the same board.');
      }
      const hErr = hierarchyError(item.item_type, newParent);
      if (hErr) return fail(400, hErr);
    }

    if ('custom_fields' in fields) {
      const cfErr = customFieldsError(
        boardProjectId(item.board), item.item_type, fields.custom_fields, item.id
      );
      if (cfErr) return failCustomFields(cfErr.message, cfErr.errors);
    }

    let newStatus;
    if ('status' in fields) {
      newStatus = workItemStatuses.find(s => s.id === Number(fields.status));
      if (!newStatus) return fail(400, 'Status not found.');
      if (newStatus.project !== boardProjectId(item.board)) {
        return fail(400, 'Status must belong to this item\'s project.');
      }
    }

    if ('title' in fields) item.title = fields.title.trim();
    ['description', 'priority', 'due_date', 'assignee', 'component_ids'].forEach(f => {
      if (f in fields) item[f] = fields[f];
    });
    if ('labels' in fields) item.label_ids = resolveLabelIds(fields.labels);
    if (newStatus) item.status = newStatus.id;
    if (newParent !== undefined) item.parent = newParent ? newParent.id : null;
    if ('custom_fields' in fields) applyCustomFields(item.id, fields.custom_fields);

    return wait(decorateWorkItem(item));
  }

  function deleteWorkItem(itemId) {
    const item = workItems.find(w => w.id === Number(itemId));
    if (!item) return fail(404, 'Not found.');
    try { requireMember(boardProjectId(item.board)); } catch (err) { return Promise.reject(err); }
    // Orphan children — they survive, they just lose their parent link.
    workItems.forEach(w => { if (w.parent === item.id) w.parent = null; });
    workItems = workItems.filter(w => w.id !== item.id);
    links = links.filter(l => l.item_a !== item.id && l.item_b !== item.id);
    workItemFieldValues = workItemFieldValues.filter(v => v.work_item !== item.id);
    return wait(null);
  }

  /* ---- bulk operations & import (sub-project 2c) --------------------------
     Best-effort, not all-or-nothing: a bad id lands in `failed` and the rest
     of the batch still applies, matching the spec's error-handling table. A
     uniform bad value (unknown status/assignee/component) is instead a
     same-shape `fail()` before touching any row — there's nothing "partial"
     about a value that would be wrong for every row alike. */

  function bulkMoveWorkItems(ids, statusId) {
    const status = workItemStatuses.find(s => s.id === Number(statusId));
    if (!status) return fail(400, 'Status not found.');
    const succeeded = [];
    const failed = [];
    (ids || []).forEach(raw => {
      const itemId = Number(raw);
      const item = workItems.find(w => w.id === itemId);
      if (!item) { failed.push({ id: itemId, error: 'Not found.' }); return; }
      if (status.project !== boardProjectId(item.board)) {
        return fail(400, "Status must belong to this item's project.");
      }
      item.status = status.id;
      succeeded.push(itemId);
    });
    return wait({ succeeded, failed });
  }

  function bulkUpdateWorkItems(ids, fields) {
    const succeeded = [];
    const failed = [];
    (ids || []).forEach(raw => {
      const itemId = Number(raw);
      const item = workItems.find(w => w.id === itemId);
      if (!item) { failed.push({ id: itemId, error: 'Not found.' }); return; }
      if ('assignee' in fields) item.assignee = fields.assignee || null;
      if ('priority' in fields) item.priority = fields.priority;
      if (fields.labels_add && fields.labels_add.length) {
        const addIds = resolveLabelIds(fields.labels_add);
        item.label_ids = [...new Set([...(item.label_ids || []), ...addIds])];
      }
      if (fields.components_add && fields.components_add.length) {
        const addIds = fields.components_add.map(Number);
        item.component_ids = [...new Set([...(item.component_ids || []), ...addIds])];
      }
      succeeded.push(itemId);
    });
    return wait({ succeeded, failed });
  }

  function bulkDeleteWorkItems(ids) {
    const deleted = [];
    const failed = [];
    (ids || []).forEach(raw => {
      const itemId = Number(raw);
      const item = workItems.find(w => w.id === itemId);
      if (!item) { failed.push({ id: itemId, error: 'Not found.' }); return; }
      workItems.forEach(w => { if (w.parent === item.id) w.parent = null; });
      workItems = workItems.filter(w => w.id !== item.id);
      links = links.filter(l => l.item_a !== item.id && l.item_b !== item.id);
      workItemFieldValues = workItemFieldValues.filter(v => v.work_item !== item.id);
      deleted.push(itemId);
    });
    return wait({ deleted, failed });
  }

  // A plain split-on-comma parser — real CSVs with quoted/escaped commas
  // need a real parser; this mock's fixed column set never contains one.
  function parseCsv(text) {
    return text.split(/\r?\n/).filter(line => line.trim() !== '').map(line => line.split(',').map(c => c.trim()));
  }

  function importWorkItems(boardId, csvText) {
    const board = boards.find(b => b.id === Number(boardId));
    if (!board) return fail(404, 'Not found.');
    try { requireMember(board.project); } catch (err) { return Promise.reject(err); }

    const rows = parseCsv(csvText);
    if (!rows.length) return fail(400, 'CSV file is empty.');
    const header = rows[0].map(h => h.toLowerCase());
    if (!header.includes('title')) return fail(400, 'CSV must include a "title" column.');
    const dataRows = rows.slice(1);
    if (dataRows.length > 500) return fail(400, 'CSV has more than 500 rows.');

    const priorityMap = { low: 1, medium: 2, high: 3 };
    let imported = 0;
    const failed = [];

    dataRows.forEach((cells, i) => {
      const rowNum = i + 2; // header is row 1
      const row = {};
      header.forEach((h, idx) => { row[h] = (cells[idx] || '').trim(); });
      const title = row.title;
      const failRow = (error) => failed.push({ row: rowNum, title: title || null, error });
      if (!title) return failRow('Title is required.');

      const itemType = (row.item_type || 'task').toLowerCase();
      if (itemType === 'subtask') return failRow('Subtasks cannot be imported (need a parent).');
      if (!Logic.ITEM_TYPES.includes(itemType)) return failRow(`Invalid item_type "${itemType}".`);

      let status = defaultStatusFor(board.project);
      if (row.status) {
        const match = workItemStatuses.find(
          s => s.project === board.project && s.name.toLowerCase() === row.status.toLowerCase()
        );
        if (!match) return failRow(`Status "${row.status}" not found.`);
        status = match;
      }

      let priority = 2;
      if (row.priority) {
        const p = priorityMap[row.priority.toLowerCase()];
        if (!p) return failRow(`Invalid priority "${row.priority}".`);
        priority = p;
      }

      let assignee = null;
      if (row.assignee) {
        const user = users.find(u => u.username.toLowerCase() === row.assignee.toLowerCase());
        if (!user) return failRow(`User "${row.assignee}" not found.`);
        assignee = user.id;
      }

      let dueDate = null;
      if (row.due_date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.due_date)) return failRow(`Invalid due_date "${row.due_date}".`);
        dueDate = row.due_date;
      }

      const componentIds = [];
      if (row.components) {
        const names = row.components.split(';').map(s => s.trim()).filter(Boolean);
        for (const name of names) {
          const comp = components.find(
            c => c.project === board.project && c.name.toLowerCase() === name.toLowerCase()
          );
          if (!comp) return failRow(`Component "${name}" not found.`);
          componentIds.push(comp.id);
        }
      }
      const labelNames = row.labels ? row.labels.split(';').map(s => s.trim()).filter(Boolean) : [];

      const item = seedItem({
        id: id(), key: nextKey(board.project), board: board.id, item_type: itemType,
        title, description: row.description || '',
        status: status.id, priority, due_date: dueDate, assignee,
        parent: null, component_ids: componentIds, label_ids: resolveLabelIds(labelNames),
        created_by: me.id,
      });
      const siblings = workItems.filter(w => w.board === board.id && w.status === item.status && w.id !== item.id);
      item.position = siblings.length;
      imported++;
    });

    return wait({ imported, failed });
  }

  /* ---- search (sub-project 5) --------------------------------------------
     Cross-project, scoped to the caller's own memberships — never a project
     they don't belong to, even as a facet filter. No `updated_at` exists on
     seed work items in this mock, so recency ordering uses `id` descending
     as a stand-in (higher id == created later) — the real API orders by the
     genuine `updated_at` column instead. */

  function search(params) {
    const q = (params.q || '').trim();
    const hasFacet = ['item_type', 'status_category', 'priority', 'assignee', 'component', 'label', 'project']
      .some(k => params[k] !== undefined && params[k] !== null && params[k] !== '');
    if (!q && !hasFacet) return fail(400, 'Provide a search term or at least one filter.');
    if (q && q.length < 2) return fail(400, 'Search term must be at least 2 characters.');

    const myProjectIds = new Set(memberships.filter(m => m.user === me.id).map(m => m.project));

    let projectFilter = null;
    if (params.project !== undefined && params.project !== '') {
      const projectId = Number(params.project);
      if (!myProjectIds.has(projectId)) return fail(400, 'Not a project you belong to.');
      projectFilter = projectId;
    }

    let componentFilter = null;
    if (params.component !== undefined && params.component !== '') {
      const comp = components.find(c => c.id === Number(params.component));
      if (!comp || !myProjectIds.has(comp.project)) return fail(400, 'Component not found.');
      componentFilter = comp.id;
    }

    let labelFilter = null;
    if (params.label !== undefined && params.label !== '') {
      const raw = params.label;
      const match = /^\d+$/.test(String(raw))
        ? labels.find(l => l.id === Number(raw))
        : labels.find(l => l.name.toLowerCase() === String(raw).toLowerCase());
      if (!match) return fail(400, 'Label not found.');
      labelFilter = match.id;
    }

    let assigneeFilter = null;
    if (params.assignee !== undefined && params.assignee !== '') {
      const u = userById(Number(params.assignee));
      if (!u) return fail(400, 'User not found.');
      assigneeFilter = u.id;
    }

    const candidates = workItems.filter(item => {
      const board = boards.find(b => b.id === item.board);
      if (!board || !myProjectIds.has(board.project)) return false;
      if (projectFilter !== null && board.project !== projectFilter) return false;
      if (params.item_type && item.item_type !== params.item_type) return false;
      if (params.status_category) {
        const status = workItemStatuses.find(s => s.id === item.status);
        if (!status || status.category !== params.status_category) return false;
      }
      if (params.priority !== undefined && params.priority !== '' && item.priority !== Number(params.priority)) return false;
      if (assigneeFilter !== null && item.assignee !== assigneeFilter) return false;
      if (componentFilter !== null && !(item.component_ids || []).includes(componentFilter)) return false;
      if (labelFilter !== null && !(item.label_ids || []).includes(labelFilter)) return false;
      return true;
    });

    let ranked;
    if (q) {
      const needle = q.toLowerCase();
      const tier1 = [];
      const tier2 = [];
      candidates.forEach(item => {
        const inKeyOrTitle = item.key.toLowerCase().includes(needle) || item.title.toLowerCase().includes(needle);
        const inDescription = (item.description || '').toLowerCase().includes(needle);
        if (inKeyOrTitle) tier1.push(item);
        else if (inDescription) tier2.push(item);
      });
      tier1.sort((a, b) => b.id - a.id);
      tier2.sort((a, b) => b.id - a.id);
      ranked = tier1.concat(tier2);
    } else {
      ranked = candidates.slice().sort((a, b) => b.id - a.id);
    }

    const results = ranked.slice(0, 50).map(item => {
      const board = boards.find(b => b.id === item.board);
      const project = projects.find(p => p.id === board.project);
      return {
        id: item.id, key: item.key, title: item.title, item_type: item.item_type,
        status_detail: statusById(item.status),
        priority: item.priority, priority_label: { 1: 'Low', 2: 'Medium', 3: 'High' }[item.priority],
        assignee_detail: item.assignee ? userById(item.assignee) : null,
        project: { id: project.id, key: project.key, name: project.name },
        board: { id: board.id, name: board.name },
      };
    });

    return wait({ results });
  }

  /* ---- components ---- */

  function listComponents(projectId) {
    try { requireMember(projectId); } catch (err) { return Promise.reject(err); }
    return wait(components.filter(c => c.project === Number(projectId)));
  }

  function createComponent(projectId, name) {
    if (!Logic.canManageComponents(myRole(projectId))) {
      return fail(403, "You don't have permission to manage components.");
    }
    if (!name || !name.trim()) return fail(400, 'This field may not be blank.');
    if (components.some(c => c.project === Number(projectId) && c.name.toLowerCase() === name.trim().toLowerCase())) {
      return fail(400, `"${name.trim()}" already exists.`);
    }
    const component = { id: id(), project: Number(projectId), name: name.trim() };
    components.push(component);
    return wait(component);
  }

  function renameComponent(componentId, name) {
    const component = components.find(c => c.id === Number(componentId));
    if (!component) return fail(404, 'Not found.');
    if (!Logic.canManageComponents(myRole(component.project))) {
      return fail(403, "You don't have permission to manage components.");
    }
    if (!name || !name.trim()) return fail(400, 'This field may not be blank.');
    component.name = name.trim();
    return wait(component);
  }

  function deleteComponent(componentId) {
    const component = components.find(c => c.id === Number(componentId));
    if (!component) return fail(404, 'Not found.');
    if (!Logic.canManageComponents(myRole(component.project))) {
      return fail(403, "You don't have permission to manage components.");
    }
    components = components.filter(c => c.id !== component.id);
    workItems.forEach(w => { w.component_ids = w.component_ids.filter(cid => cid !== component.id); });
    return wait(null);
  }

  /* ---- workflows: per-project work item statuses (sub-project 3) ------- */

  const statusesFor = (projectId) =>
    workItemStatuses.filter(s => s.project === Number(projectId)).sort(byPosition);

  // The status a brand-new work item lands in when none is given —
  // the lowest-position status in the todo category, i.e. the leftmost
  // column.
  const defaultStatusFor = (projectId) =>
    statusesFor(projectId).find(s => s.category === 'todo');

  function requireStatusManager(projectId) {
    if (!Logic.canManageStatuses(myRole(projectId))) {
      throw Object.assign(
        new Error("You don't have permission to manage this project's statuses."), { status: 403 },
      );
    }
  }

  function listStatuses(projectId) {
    try { requireMember(projectId); } catch (err) { return Promise.reject(err); }
    return wait(statusesFor(projectId));
  }

  function createStatus(projectId, { name, category }) {
    try { requireStatusManager(projectId); } catch (err) { return Promise.reject(err); }
    const clean = (name || '').trim();
    if (!clean) return fail(400, 'This field may not be blank.');
    if (!Logic.CATEGORIES.includes(category)) return fail(400, 'Pick a category.');
    if (workItemStatuses.some(s => s.project === Number(projectId) && s.name.toLowerCase() === clean.toLowerCase())) {
      return fail(400, `"${clean}" already exists.`);
    }
    const status = {
      id: id(), project: Number(projectId), name: clean, category,
      position: statusesFor(projectId).length,
    };
    workItemStatuses.push(status);
    return wait(status);
  }

  // `category` is the only field a "would leave a category empty" guard
  // applies to — renaming never can, since the status itself still exists.
  function updateStatus(statusId, { name, category }) {
    const status = workItemStatuses.find(s => s.id === Number(statusId));
    if (!status) return fail(404, 'Not found.');
    try { requireStatusManager(status.project); } catch (err) { return Promise.reject(err); }

    if (name !== undefined) {
      const clean = (name || '').trim();
      if (!clean) return fail(400, 'This field may not be blank.');
      if (workItemStatuses.some(s => s.project === status.project && s.id !== status.id && s.name.toLowerCase() === clean.toLowerCase())) {
        return fail(400, `"${clean}" already exists.`);
      }
      status.name = clean;
    }
    if (category !== undefined && category !== status.category) {
      if (!Logic.CATEGORIES.includes(category)) return fail(400, 'Pick a category.');
      const remaining = statusesFor(status.project).filter(s => s.category === status.category && s.id !== status.id);
      if (!remaining.length) {
        return fail(400, `${Logic.CATEGORY_LABELS[status.category]} needs at least one status — recategorize another one first.`);
      }
      status.category = category;
    }
    return wait(status);
  }

  function moveStatus(statusId, delta) {
    const status = workItemStatuses.find(s => s.id === Number(statusId));
    if (!status) return fail(404, 'Not found.');
    try { requireStatusManager(status.project); } catch (err) { return Promise.reject(err); }
    const siblings = statusesFor(status.project);
    const from = siblings.indexOf(status);
    const to = from + Number(delta);
    if (to < 0 || to >= siblings.length) return wait(status);
    siblings.splice(from, 1);
    siblings.splice(to, 0, status);
    siblings.forEach((s, i) => { s.position = i; });
    return wait(status);
  }

  function deleteStatus(statusId) {
    const status = workItemStatuses.find(s => s.id === Number(statusId));
    if (!status) return fail(404, 'Not found.');
    try { requireStatusManager(status.project); } catch (err) { return Promise.reject(err); }

    const inUse = workItems.filter(w => w.status === status.id);
    if (inUse.length) {
      return fail(400, `"${status.name}" is still used by ${inUse.length} work item${inUse.length === 1 ? '' : 's'}. Move ${inUse.length === 1 ? 'it' : 'them'} first.`);
    }
    const remaining = statusesFor(status.project).filter(s => s.category === status.category && s.id !== status.id);
    if (!remaining.length) {
      return fail(400, `${Logic.CATEGORY_LABELS[status.category]} needs at least one status.`);
    }
    workItemStatuses = workItemStatuses.filter(s => s.id !== status.id);
    renumber(statusesFor(status.project));
    return wait(null);
  }

  /* ---- backlog & sprints (sub-project 6) ---------------------------------
     Sprint assignment is a second, independent axis from status — a work
     item's status (workflow column) and its sprint (which iteration it's
     committed to, or null for "in the backlog") never constrain each
     other. Starting/completing/deleting a sprint is Owner/Admin-gated;
     scheduling an item into or out of one is a plain edit any project
     member can already do. `sprints` itself is declared earlier, ahead of
     the work item seed block, so the seed can assign items into one
     directly. */

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function requireSprintManager(projectId) {
    if (!Logic.canManageSprints(myRole(projectId))) {
      throw Object.assign(
        new Error("You don't have permission to manage this board's sprints."), { status: 403 },
      );
    }
  }

  function sprintsFor(boardId) {
    return sprints.filter(s => s.board === Number(boardId));
  }

  function decorateSprint(sprint) {
    return Object.assign({}, sprint, {
      item_count: workItems.filter(w => w.sprint === sprint.id).length,
    });
  }

  function sprintSummary(sprintId) {
    const sprint = sprints.find(s => s.id === sprintId);
    return sprint ? { id: sprint.id, name: sprint.name, state: sprint.state } : null;
  }

  function listSprints(boardId) {
    const board = boards.find(b => b.id === Number(boardId));
    if (!board) return fail(404, 'Not found.');
    try { requireMember(board.project); } catch (err) { return Promise.reject(err); }
    return wait(sprintsFor(boardId).map(decorateSprint));
  }

  function createSprint(boardId, { name, goal }) {
    const board = boards.find(b => b.id === Number(boardId));
    if (!board) return fail(404, 'Not found.');
    try { requireSprintManager(board.project); } catch (err) { return Promise.reject(err); }
    if (!name || !name.trim()) return fail(400, 'This field may not be blank.');
    const sprint = {
      id: id(), board: board.id, name: name.trim(), goal: (goal || '').trim(),
      state: 'planned', start_date: null, end_date: null, created_by: me.id,
    };
    sprints.push(sprint);
    return wait(decorateSprint(sprint));
  }

  function updateSprint(sprintId, { name, goal }) {
    const sprint = sprints.find(s => s.id === Number(sprintId));
    if (!sprint) return fail(404, 'Not found.');
    try { requireSprintManager(boardProjectId(sprint.board)); } catch (err) { return Promise.reject(err); }
    if (name !== undefined) {
      if (!name.trim()) return fail(400, 'This field may not be blank.');
      sprint.name = name.trim();
    }
    if (goal !== undefined) sprint.goal = goal.trim();
    return wait(decorateSprint(sprint));
  }

  function startSprint(sprintId) {
    const sprint = sprints.find(s => s.id === Number(sprintId));
    if (!sprint) return fail(404, 'Not found.');
    try { requireSprintManager(boardProjectId(sprint.board)); } catch (err) { return Promise.reject(err); }
    if (sprint.state !== 'planned') return fail(400, 'Only a planned sprint can be started.');
    const alreadyActive = sprintsFor(sprint.board).find(s => s.state === 'active');
    if (alreadyActive) return fail(400, `"${alreadyActive.name}" is already active on this board. Complete it first.`);
    sprint.state = 'active';
    sprint.start_date = todayISO();
    return wait(decorateSprint(sprint));
  }

  function completeSprint(sprintId) {
    const sprint = sprints.find(s => s.id === Number(sprintId));
    if (!sprint) return fail(404, 'Not found.');
    try { requireSprintManager(boardProjectId(sprint.board)); } catch (err) { return Promise.reject(err); }
    if (sprint.state !== 'active') return fail(400, 'Only an active sprint can be completed.');
    sprint.state = 'completed';
    sprint.end_date = todayISO();
    let next = nextBacklogPosition(sprint.board, null);
    workItems.filter(w => w.sprint === sprint.id).forEach(w => {
      w.sprint = null;
      w.backlog_position = next++;
    });
    return wait(decorateSprint(sprint));
  }

  function deleteSprint(sprintId) {
    const sprint = sprints.find(s => s.id === Number(sprintId));
    if (!sprint) return fail(404, 'Not found.');
    try { requireSprintManager(boardProjectId(sprint.board)); } catch (err) { return Promise.reject(err); }
    if (sprint.state !== 'planned') return fail(400, 'Only a planned sprint can be deleted.');
    const inUse = workItems.filter(w => w.sprint === sprint.id);
    if (inUse.length) {
      return fail(400, `Still has ${inUse.length} work item${inUse.length === 1 ? '' : 's'} scheduled into it. Move ${inUse.length === 1 ? 'it' : 'them'} first.`);
    }
    sprints = sprints.filter(s => s.id !== sprint.id);
    return wait(null);
  }

  function nextBacklogPosition(boardId, sprintId) {
    const siblings = workItems.filter(w => w.board === Number(boardId) && w.sprint === sprintId);
    return siblings.length ? Math.max(...siblings.map(w => w.backlog_position)) + 1 : 0;
  }

  function listBacklog(boardId) {
    const board = boards.find(b => b.id === Number(boardId));
    if (!board) return fail(404, 'Not found.');
    try { requireMember(board.project); } catch (err) { return Promise.reject(err); }
    const items = workItems.filter(w => w.board === board.id && w.sprint === null)
      .sort((a, b) => a.backlog_position - b.backlog_position)
      .map(decorateWorkItem);
    return wait(items);
  }

  function listSprintWorkItems(sprintId) {
    const sprint = sprints.find(s => s.id === Number(sprintId));
    if (!sprint) return fail(404, 'Not found.');
    try { requireMember(boardProjectId(sprint.board)); } catch (err) { return Promise.reject(err); }
    const items = workItems.filter(w => w.sprint === sprint.id)
      .sort((a, b) => a.backlog_position - b.backlog_position)
      .map(decorateWorkItem);
    return wait(items);
  }

  function scheduleWorkItem(itemId, { sprint }) {
    const item = workItems.find(w => w.id === Number(itemId));
    if (!item) return fail(404, 'Not found.');
    try { requireMember(boardProjectId(item.board)); } catch (err) { return Promise.reject(err); }

    let targetSprintId = null;
    if (sprint !== null && sprint !== undefined && sprint !== '') {
      const target = sprints.find(s => s.id === Number(sprint));
      if (!target) return fail(400, 'Sprint not found.');
      if (target.board !== item.board) return fail(400, 'Sprint must belong to the same board.');
      if (target.state === 'completed') return fail(400, "Can't schedule into a completed sprint.");
      targetSprintId = target.id;
    }
    item.sprint = targetSprintId;
    item.backlog_position = nextBacklogPosition(item.board, targetSprintId);
    return wait(decorateWorkItem(item));
  }

  /* ---- labels (sub-project 4) -------------------------------------------
     Global, free-form, self-serve — the opposite governance model from
     Components. Applying a label to a work item (including inventing a
     brand-new one) is open to any project member; renaming, recoloring or
     deleting a label from the system is gated to an Owner of any project,
     the same "canManageDefinitions" tier as CustomField/Screen.
     `LABEL_PALETTE` and `labels` itself are declared earlier, ahead of the
     work item seed block, so the seed can assign labels directly. */

  // Deterministic, not random — the same name always lands on the same
  // color, even across a delete-and-recreate, with no stored "next color"
  // counter to keep in sync.
  function hashLabelColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return LABEL_PALETTE[hash % LABEL_PALETTE.length];
  }

  const listLabels = () => wait(labels.slice().sort((a, b) => a.name.localeCompare(b.name)));

  // Lets the UI preview a chip's color for a not-yet-created label name —
  // same deterministic hash `findOrCreateLabel` will use once it's saved,
  // so the preview never flips color when the write actually happens.
  function colorForLabelName(name) {
    const clean = (name || '').trim();
    if (!clean) return LABEL_PALETTE[0];
    const existing = labels.find(l => l.name.toLowerCase() === clean.toLowerCase());
    return existing ? existing.color : hashLabelColor(clean);
  }

  // The one place a Label gets created — implicitly, from a work item write
  // naming one that doesn't exist yet. No POST /api/labels/ of its own.
  // Case-insensitive match-or-create, so "urgent" and "Urgent" in the same
  // write resolve to one label, never two.
  function findOrCreateLabel(name) {
    const clean = (name || '').trim();
    if (!clean) return null;
    let label = labels.find(l => l.name.toLowerCase() === clean.toLowerCase());
    if (!label) {
      label = { id: id(), name: clean, color: hashLabelColor(clean), created_by: me.id };
      labels.push(label);
    }
    return label;
  }

  // Used by createWorkItem/updateWorkItem: a list of names (self-serve
  // input) -> a deduped list of label ids, creating any that don't exist
  // yet. Blank names are silently dropped rather than rejected — the UI
  // never sends one, and there's no "this label doesn't exist" error to
  // raise when naming one always succeeds.
  function resolveLabelIds(names) {
    const ids = (names || []).map(n => {
      const label = findOrCreateLabel(n);
      return label ? label.id : null;
    }).filter(Boolean);
    return [...new Set(ids)];
  }

  function renameLabel(labelId, name) {
    const label = labels.find(l => l.id === Number(labelId));
    if (!label) return fail(404, 'Not found.');
    try { requireDefinitionManager('labels'); } catch (err) { return Promise.reject(err); }
    const clean = (name || '').trim();
    if (!clean) return fail(400, 'This field may not be blank.');
    if (labels.some(l => l.id !== label.id && l.name.toLowerCase() === clean.toLowerCase())) {
      return fail(400, `"${clean}" already exists.`);
    }
    label.name = clean;
    return wait(label);
  }

  function recolorLabel(labelId, color) {
    const label = labels.find(l => l.id === Number(labelId));
    if (!label) return fail(404, 'Not found.');
    try { requireDefinitionManager('labels'); } catch (err) { return Promise.reject(err); }
    if (!LABEL_PALETTE.includes(color)) return fail(400, 'Pick a color from the palette.');
    label.color = color;
    return wait(label);
  }

  function deleteLabel(labelId) {
    const label = labels.find(l => l.id === Number(labelId));
    if (!label) return fail(404, 'Not found.');
    try { requireDefinitionManager('labels'); } catch (err) { return Promise.reject(err); }
    labels = labels.filter(l => l.id !== label.id);
    // Unassigns everywhere rather than blocking — labels are deliberately
    // lightweight, matching how Component deletion already behaves.
    workItems.forEach(w => { w.label_ids = (w.label_ids || []).filter(lid => lid !== label.id); });
    return wait(null);
  }

  /* ---- work item links ("relates to") ---- */

  function decorateLink(link) {
    const a = workItems.find(w => w.id === link.item_a);
    const b = workItems.find(w => w.id === link.item_b);
    return Object.assign({}, link, {
      item_a_detail: a && { id: a.id, key: a.key, title: a.title, item_type: a.item_type },
      item_b_detail: b && { id: b.id, key: b.key, title: b.title, item_type: b.item_type },
    });
  }

  function listLinks(itemId) {
    const item = workItems.find(w => w.id === Number(itemId));
    if (!item) return fail(404, 'Not found.');
    try { requireMember(boardProjectId(item.board)); } catch (err) { return Promise.reject(err); }
    return wait(links.filter(l => l.item_a === item.id || l.item_b === item.id).map(decorateLink));
  }

  function createLink(itemAId, itemBId) {
    itemAId = Number(itemAId); itemBId = Number(itemBId);
    if (itemAId === itemBId) return fail(400, "An item can't be linked to itself.");
    const a = workItems.find(w => w.id === itemAId);
    const b = workItems.find(w => w.id === itemBId);
    if (!a || !b) return fail(404, 'Not found.');
    try { requireMember(boardProjectId(a.board)); } catch (err) { return Promise.reject(err); }

    if (a.parent === b.id || b.parent === a.id) {
      return fail(400, 'These items are already parent and child.');
    }
    const [lo, hi] = itemAId < itemBId ? [itemAId, itemBId] : [itemBId, itemAId];
    if (links.some(l => l.item_a === lo && l.item_b === hi)) {
      return fail(400, 'These items are already linked.');
    }
    const link = { id: id(), item_a: lo, item_b: hi, created_by: me.id, created_at: new Date().toISOString() };
    links.push(link);
    return wait(decorateLink(link));
  }

  function deleteLink(linkId) {
    const link = links.find(l => l.id === Number(linkId));
    if (!link) return fail(404, 'Not found.');
    links = links.filter(l => l.id !== link.id);
    return wait(null);
  }

  /* ---- custom fields & screens (sub-project 2b) --------------------------

     CustomField and Screen are global: any project Owner manages them, and
     "Owner" means Owner of *any* project, so every check below looks at all
     of this person's memberships rather than one project's role. Each guard
     here has a matching row in the spec's error table. */

  const myRoles = () => memberships.filter(m => m.user === me.id).map(m => m.role);
  const canManageDefinitions = () => Logic.canManageDefinitions(myRoles());

  function requireDefinitionManager(noun) {
    if (!canManageDefinitions()) {
      throw Object.assign(
        new Error(`Only a project Owner can manage ${noun}. You're not an Owner of any project.`),
        { status: 403 },
      );
    }
  }

  const byPosition = (a, b) => a.position - b.position || a.id - b.id;

  const optionsFor = (fieldId) => fieldOptions.filter(o => o.field === fieldId).sort(byPosition);

  function decorateField(field) {
    const options = optionsFor(field.id);
    const onScreens = screenFields
      .filter(sf => sf.field === field.id)
      .map(sf => screens.find(s => s.id === sf.screen))
      .filter(Boolean);
    return Object.assign({}, field, {
      type_label: Logic.FIELD_TYPE_LABEL[field.field_type],
      has_options: Logic.fieldHasOptions(field.field_type),
      options,
      screen_names: onScreens.map(s => s.name),
      value_count: workItemFieldValues.filter(v => v.field === field.id).length,
      created_by_detail: userById(field.created_by),
    });
  }

  function decorateScreen(screen) {
    const rows = screenFields
      .filter(sf => sf.screen === screen.id)
      .sort(byPosition)
      .map(sf => ({
        id: sf.id,
        position: sf.position,
        required: sf.required,
        field: decorateField(customFields.find(f => f.id === sf.field)),
      }));
    const assignedTo = screenAssignments
      .filter(a => a.screen === screen.id)
      .map(a => {
        const project = projects.find(p => p.id === a.project);
        return {
          project_id: a.project,
          project_key: project ? project.key : '—',
          item_type: a.item_type,
          label: `${project ? project.key : '—'} · ${Logic.ITEM_TYPE_LABEL[a.item_type]}`,
        };
      });
    return Object.assign({}, screen, { fields: rows, assigned_to: assignedTo });
  }

  // Renumbers a position-ordered slice so positions stay 0..n-1 after an
  // insert, move or delete. (WorkItem.position deliberately allows gaps;
  // these lists are hand-ordered by a human, so they don't.)
  function renumber(rows) {
    rows.sort(byPosition).forEach((row, i) => { row.position = i; });
  }

  const listFieldTypes = () => wait(Logic.FIELD_TYPES.map(t => ({
    value: t, label: Logic.FIELD_TYPE_LABEL[t], hint: Logic.FIELD_TYPE_HINT[t],
  })));

  // Everything a global-admin screen needs to decide what to offer before
  // it has fetched anything else.
  const getMyCapabilities = () => wait({
    can_manage_definitions: canManageDefinitions(),
    owned_project_keys: memberships
      .filter(m => m.user === me.id && m.role === 'owner')
      .map(m => (projects.find(p => p.id === m.project) || {}).key)
      .filter(Boolean),
  });

  const listFields = () => wait(
    customFields.slice().sort((a, b) => a.name.localeCompare(b.name)).map(decorateField)
  );

  function getField(fieldId) {
    const field = customFields.find(f => f.id === Number(fieldId));
    if (!field) return fail(404, 'Not found.');
    return wait(decorateField(field));
  }

  function createField({ name, field_type }) {
    try { requireDefinitionManager('custom fields'); } catch (err) { return Promise.reject(err); }
    const clean = (name || '').trim();
    if (!clean) return fail(400, 'This field may not be blank.');
    if (!Logic.FIELD_TYPES.includes(field_type)) return fail(400, 'Pick a field type.');
    if (customFields.some(f => f.name.toLowerCase() === clean.toLowerCase())) {
      return fail(400, `"${clean}" already exists.`);
    }
    const field = { id: id(), name: clean, field_type, created_by: me.id };
    customFields.push(field);
    return wait(decorateField(field));
  }

  function renameField(fieldId, name) {
    const field = customFields.find(f => f.id === Number(fieldId));
    if (!field) return fail(404, 'Not found.');
    try { requireDefinitionManager('custom fields'); } catch (err) { return Promise.reject(err); }
    const clean = (name || '').trim();
    if (!clean) return fail(400, 'This field may not be blank.');
    if (customFields.some(f => f.id !== field.id && f.name.toLowerCase() === clean.toLowerCase())) {
      return fail(400, `"${clean}" already exists.`);
    }
    field.name = clean;
    return wait(decorateField(field));
  }

  // field_type is immutable — kept as a real rejection rather than just
  // hiding the control, so the prototype models the API's 400.
  function changeFieldType(fieldId, fieldType) {
    const field = customFields.find(f => f.id === Number(fieldId));
    if (!field) return fail(404, 'Not found.');
    if (fieldType === field.field_type) return wait(decorateField(field));
    return fail(400, "A field's type can't be changed after it's created.");
  }

  function deleteField(fieldId) {
    const field = customFields.find(f => f.id === Number(fieldId));
    if (!field) return fail(404, 'Not found.');
    try { requireDefinitionManager('custom fields'); } catch (err) { return Promise.reject(err); }

    const using = screenFields
      .filter(sf => sf.field === field.id)
      .map(sf => (screens.find(s => s.id === sf.screen) || {}).name)
      .filter(Boolean);
    if (using.length) {
      return fail(400, `"${field.name}" is still on ${using.join(', ')}. Remove it from ${using.length === 1 ? 'that screen' : 'those screens'} first.`);
    }
    customFields = customFields.filter(f => f.id !== field.id);
    fieldOptions = fieldOptions.filter(o => o.field !== field.id);
    workItemFieldValues = workItemFieldValues.filter(v => v.field !== field.id);
    return wait(null);
  }

  /* ---- field options ---- */

  function requireOptionField(fieldId) {
    const field = customFields.find(f => f.id === Number(fieldId));
    if (!field) throw Object.assign(new Error('Not found.'), { status: 404 });
    if (!Logic.fieldHasOptions(field.field_type)) {
      throw Object.assign(
        new Error(`Only Select and Multi-select fields have options — "${field.name}" is a ${Logic.FIELD_TYPE_LABEL[field.field_type]}.`),
        { status: 400 },
      );
    }
    return field;
  }

  function addFieldOption(fieldId, label) {
    let field;
    try {
      field = requireOptionField(fieldId);
      requireDefinitionManager('custom fields');
    } catch (err) { return Promise.reject(err); }
    const clean = (label || '').trim();
    if (!clean) return fail(400, 'This field may not be blank.');
    if (fieldOptions.some(o => o.field === field.id && o.label.toLowerCase() === clean.toLowerCase())) {
      return fail(400, `"${clean}" is already an option.`);
    }
    const option = { id: id(), field: field.id, label: clean, position: optionsFor(field.id).length };
    fieldOptions.push(option);
    return wait(decorateField(field));
  }

  function renameFieldOption(optionId, label) {
    const option = fieldOptions.find(o => o.id === Number(optionId));
    if (!option) return fail(404, 'Not found.');
    try { requireDefinitionManager('custom fields'); } catch (err) { return Promise.reject(err); }
    const clean = (label || '').trim();
    if (!clean) return fail(400, 'This field may not be blank.');
    if (fieldOptions.some(o => o.field === option.field && o.id !== option.id && o.label.toLowerCase() === clean.toLowerCase())) {
      return fail(400, `"${clean}" is already an option.`);
    }
    // Values store the option's id, never its label, so a rename can't
    // invalidate anything already saved.
    option.label = clean;
    return wait(decorateField(customFields.find(f => f.id === option.field)));
  }

  function moveFieldOption(optionId, delta) {
    const option = fieldOptions.find(o => o.id === Number(optionId));
    if (!option) return fail(404, 'Not found.');
    try { requireDefinitionManager('custom fields'); } catch (err) { return Promise.reject(err); }
    const siblings = optionsFor(option.field);
    const from = siblings.indexOf(option);
    const to = from + Number(delta);
    if (to < 0 || to >= siblings.length) return wait(decorateField(customFields.find(f => f.id === option.field)));
    siblings.splice(from, 1);
    siblings.splice(to, 0, option);
    siblings.forEach((o, i) => { o.position = i; });
    return wait(decorateField(customFields.find(f => f.id === option.field)));
  }

  function deleteFieldOption(optionId) {
    const option = fieldOptions.find(o => o.id === Number(optionId));
    if (!option) return fail(404, 'Not found.');
    try { requireDefinitionManager('custom fields'); } catch (err) { return Promise.reject(err); }

    const uses = workItemFieldValues.filter(
      v => v.field === option.field && String(v.value) === String(option.id)
    );
    if (uses.length) {
      const where = uses
        .map(v => (workItems.find(w => w.id === v.work_item) || {}).key)
        .filter(Boolean);
      return fail(400, `"${option.label}" is still chosen on ${where.join(', ') || 'a work item'}. Clear it there first.`);
    }
    fieldOptions = fieldOptions.filter(o => o.id !== option.id);
    renumber(optionsFor(option.field));
    return wait(decorateField(customFields.find(f => f.id === option.field)));
  }

  /* ---- screens ---- */

  const listScreens = () => wait(
    screens.slice().sort((a, b) => a.name.localeCompare(b.name)).map(decorateScreen)
  );

  function getScreen(screenId) {
    const screen = screens.find(s => s.id === Number(screenId));
    if (!screen) return fail(404, 'Not found.');
    return wait(decorateScreen(screen));
  }

  function createScreen(name) {
    try { requireDefinitionManager('screens'); } catch (err) { return Promise.reject(err); }
    const clean = (name || '').trim();
    if (!clean) return fail(400, 'This field may not be blank.');
    if (screens.some(s => s.name.toLowerCase() === clean.toLowerCase())) {
      return fail(400, `"${clean}" already exists.`);
    }
    const screen = { id: id(), name: clean };
    screens.push(screen);
    return wait(decorateScreen(screen));
  }

  function renameScreen(screenId, name) {
    const screen = screens.find(s => s.id === Number(screenId));
    if (!screen) return fail(404, 'Not found.');
    try { requireDefinitionManager('screens'); } catch (err) { return Promise.reject(err); }
    const clean = (name || '').trim();
    if (!clean) return fail(400, 'This field may not be blank.');
    if (screens.some(s => s.id !== screen.id && s.name.toLowerCase() === clean.toLowerCase())) {
      return fail(400, `"${clean}" already exists.`);
    }
    screen.name = clean;
    return wait(decorateScreen(screen));
  }

  function deleteScreen(screenId) {
    const screen = screens.find(s => s.id === Number(screenId));
    if (!screen) return fail(404, 'Not found.');
    try { requireDefinitionManager('screens'); } catch (err) { return Promise.reject(err); }

    const assigned = decorateScreen(screen).assigned_to.map(a => a.label);
    if (assigned.length) {
      return fail(400, `"${screen.name}" is still assigned to ${assigned.join(', ')}. Unassign it first.`);
    }
    screens = screens.filter(s => s.id !== screen.id);
    screenFields = screenFields.filter(sf => sf.screen !== screen.id);
    return wait(null);
  }

  function addScreenField(screenId, fieldId) {
    const screen = screens.find(s => s.id === Number(screenId));
    const field = customFields.find(f => f.id === Number(fieldId));
    if (!screen || !field) return fail(404, 'Not found.');
    try { requireDefinitionManager('screens'); } catch (err) { return Promise.reject(err); }
    if (screenFields.some(sf => sf.screen === screen.id && sf.field === field.id)) {
      return fail(400, `"${field.name}" is already on this screen.`);
    }
    screenFields.push({
      id: id(), screen: screen.id, field: field.id,
      position: screenFields.filter(sf => sf.screen === screen.id).length,
      required: false,
    });
    return wait(decorateScreen(screen));
  }

  function moveScreenField(screenFieldId, delta) {
    const row = screenFields.find(sf => sf.id === Number(screenFieldId));
    if (!row) return fail(404, 'Not found.');
    try { requireDefinitionManager('screens'); } catch (err) { return Promise.reject(err); }
    const screen = screens.find(s => s.id === row.screen);
    const siblings = screenFields.filter(sf => sf.screen === row.screen).sort(byPosition);
    const from = siblings.indexOf(row);
    const to = from + Number(delta);
    if (to < 0 || to >= siblings.length) return wait(decorateScreen(screen));
    siblings.splice(from, 1);
    siblings.splice(to, 0, row);
    siblings.forEach((sf, i) => { sf.position = i; });
    return wait(decorateScreen(screen));
  }

  // `required` lives on the through-model, so the same field can be
  // required here and optional on the next screen along.
  function setScreenFieldRequired(screenFieldId, required) {
    const row = screenFields.find(sf => sf.id === Number(screenFieldId));
    if (!row) return fail(404, 'Not found.');
    try { requireDefinitionManager('screens'); } catch (err) { return Promise.reject(err); }
    row.required = !!required;
    return wait(decorateScreen(screens.find(s => s.id === row.screen)));
  }

  function removeScreenField(screenFieldId) {
    const row = screenFields.find(sf => sf.id === Number(screenFieldId));
    if (!row) return fail(404, 'Not found.');
    try { requireDefinitionManager('screens'); } catch (err) { return Promise.reject(err); }
    const screen = screens.find(s => s.id === row.screen);
    screenFields = screenFields.filter(sf => sf.id !== row.id);
    renumber(screenFields.filter(sf => sf.screen === screen.id));
    // Values already saved against this field stay put — the spec is
    // explicit that changing a screen never deletes data.
    return wait(decorateScreen(screen));
  }

  /* ---- per-project screen assignment ---- */

  const assignmentFor = (projectId, itemType) =>
    screenAssignments.find(a => a.project === Number(projectId) && a.item_type === itemType);

  function listScreenAssignments(projectId) {
    try { requireMember(projectId); } catch (err) { return Promise.reject(err); }
    return wait(Logic.ITEM_TYPES.map(itemType => {
      const row = assignmentFor(projectId, itemType);
      const screen = row ? screens.find(s => s.id === row.screen) : null;
      return {
        item_type: itemType,
        item_type_label: Logic.ITEM_TYPE_LABEL[itemType],
        screen: screen ? screen.id : null,
        screen_name: screen ? screen.name : null,
        field_count: screen ? screenFields.filter(sf => sf.screen === screen.id).length : 0,
      };
    }));
  }

  function setScreenAssignment(projectId, itemType, screenId) {
    try { requireMember(projectId); } catch (err) { return Promise.reject(err); }
    if (!Logic.canManageScreenAssignments(myRole(projectId))) {
      return fail(403, "Only this project's Owner or Admins can change screen assignments.");
    }
    if (!Logic.ITEM_TYPES.includes(itemType)) return fail(400, 'Invalid item type.');

    const existing = assignmentFor(projectId, itemType);
    if (screenId === null || screenId === '' || screenId === undefined) {
      screenAssignments = screenAssignments.filter(a => a !== existing);
      return wait(null);
    }
    const screen = screens.find(s => s.id === Number(screenId));
    if (!screen) return fail(400, 'That screen no longer exists.');
    if (existing) existing.screen = screen.id;
    else screenAssignments.push({ id: id(), project: Number(projectId), item_type: itemType, screen: screen.id });
    return wait(decorateScreen(screen));
  }

  // Resolves (project, item_type) -> Screen, the lookup the create/edit
  // form does before it knows what to render. null means "built-in fields
  // only", which is exactly the pre-2b behaviour.
  function getScreenForItemType(projectId, itemType) {
    try { requireMember(projectId); } catch (err) { return Promise.reject(err); }
    const row = assignmentFor(projectId, itemType);
    if (!row) return wait(null);
    const screen = screens.find(s => s.id === row.screen);
    return wait(screen ? decorateScreen(screen) : null);
  }

  /* ---- work item field values ---- */

  const valuesFor = (itemId, fieldId) =>
    workItemFieldValues.filter(v => v.work_item === Number(itemId) && v.field === Number(fieldId));

  // The read shape: multiselect -> array of option ids, checkbox -> true
  // (absent when unticked), everything else -> its single value.
  function readValue(itemId, field) {
    const rows = valuesFor(itemId, field.id);
    if (Logic.isMultiValue(field.field_type)) return rows.map(r => Number(r.value));
    if (!rows.length) return null;
    if (field.field_type === 'checkbox') return true;
    if (field.field_type === 'select' || field.field_type === 'user_picker') return Number(rows[0].value);
    return rows[0].value;
  }

  function displayValue(field, value) {
    const labelOf = (optionId) => {
      const option = fieldOptions.find(o => o.id === Number(optionId));
      return option ? option.label : '(removed option)';
    };
    switch (field.field_type) {
      case 'select': return labelOf(value);
      case 'multiselect': return value.map(labelOf).join(', ');
      case 'checkbox': return 'Yes';
      case 'user_picker': {
        const user = userById(value);
        return user ? user.display_name : 'Unknown user';
      }
      default: return String(value);
    }
  }

  // Every saved value on this item, screen or no screen — the spec's
  // "orphaned values stay visible" rule lives here.
  function customFieldsOf(itemId) {
    const map = {};
    const details = [];
    const fieldIds = [...new Set(workItemFieldValues.filter(v => v.work_item === itemId).map(v => v.field))];
    fieldIds
      .map(fid => customFields.find(f => f.id === fid))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(field => {
        const value = readValue(itemId, field);
        if (Logic.isBlankValue(field.field_type, value)) return;
        map[field.id] = value;
        details.push({ field: decorateField(field), value, display: displayValue(field, value) });
      });
    return { map, details };
  }

  /* Validates a `custom_fields` payload against the screen assigned to
     (project, item_type). Returns null when it's fine, or
     { message, errors } — one entry per offending field. On an edit,
     `existingItemId` lets a required field already holding a value stay
     satisfied when the payload doesn't mention it. */
  function customFieldsError(projectId, itemType, payload, existingItemId) {
    const keys = Object.keys(payload || {});
    const row = assignmentFor(projectId, itemType);
    const screen = row ? screens.find(s => s.id === row.screen) : null;

    if (!screen) {
      if (!keys.length) return null;
      return {
        message: `${Logic.ITEM_TYPE_LABEL[itemType]} items in this project have no screen assigned, so custom fields can't be set on them.`,
        errors: {},
      };
    }

    const rows = decorateScreen(screen).fields;
    const allowed = new Set(rows.map(r => r.field.id));
    const stray = {};
    keys.forEach(key => {
      if (!allowed.has(Number(key))) {
        const field = customFields.find(f => f.id === Number(key));
        stray[key] = `${field ? `"${field.name}"` : 'That field'} isn't on the "${screen.name}" screen.`;
      }
    });
    if (Object.keys(stray).length) {
      return { message: `Some values aren't on the "${screen.name}" screen.`, errors: stray };
    }

    const memberIds = memberships.filter(m => m.project === Number(projectId)).map(m => m.user);
    // Merge payload over what's already saved: a PATCH that names only some
    // of the screen's fields still has to leave every required one filled.
    const merged = {};
    rows.forEach(r => {
      const field = r.field;
      merged[field.id] = Object.prototype.hasOwnProperty.call(payload || {}, String(field.id))
        ? payload[field.id]
        : (existingItemId ? readValue(existingItemId, field) : undefined);
    });

    const errors = Logic.screenValueErrors(rows, merged, (field) => ({
      optionIds: optionsFor(field.id).map(o => o.id),
      memberIds,
    }));
    if (Object.keys(errors).length) {
      return { message: Object.values(errors)[0], errors };
    }
    return null;
  }

  // Upsert-by-replacement, per the spec: every field named in the payload
  // loses all of its existing rows first, then gets the new one (or several,
  // for multiselect). Blank clears the field rather than storing an empty.
  function applyCustomFields(itemId, payload) {
    Object.keys(payload || {}).forEach(key => {
      const field = customFields.find(f => f.id === Number(key));
      if (!field) return;
      workItemFieldValues = workItemFieldValues.filter(
        v => !(v.work_item === itemId && v.field === field.id)
      );
      const raw = payload[key];
      if (Logic.isBlankValue(field.field_type, raw)) return;
      const list = Logic.isMultiValue(field.field_type) ? raw : [raw];
      [...new Set(list.map(String))].forEach(value => {
        workItemFieldValues.push({ id: id(), work_item: itemId, field: field.id, value });
      });
    });
  }

  const listUsers = () => wait(users);

  return {
    login, logout, getMe,
    listMyProjects, getProject, createProject, deleteProject,
    listMembers, removeMember, leaveProject, changeRole, transferOwnership,
    listMyInvitations, listProjectInvitations, listInvitableUsers,
    inviteMember, acceptInvitation, declineInvitation,
    listBoards, createBoard, getBoard,
    listBoardWorkItems, getWorkItem, createWorkItem, updateWorkItem, deleteWorkItem,
    bulkMoveWorkItems, bulkUpdateWorkItems, bulkDeleteWorkItems, importWorkItems,
    search,
    listComponents, createComponent, renameComponent, deleteComponent,
    listStatuses, createStatus, updateStatus, moveStatus, deleteStatus,
    listSprints, createSprint, updateSprint, startSprint, completeSprint, deleteSprint,
    listBacklog, listSprintWorkItems, scheduleWorkItem,
    listLabels, renameLabel, recolorLabel, deleteLabel, colorForLabelName, LABEL_PALETTE,
    listLinks, createLink, deleteLink,
    listUsers,
    getMyCapabilities, listFieldTypes,
    listFields, getField, createField, renameField, changeFieldType, deleteField,
    addFieldOption, renameFieldOption, moveFieldOption, deleteFieldOption,
    listScreens, getScreen, createScreen, renameScreen, deleteScreen,
    addScreenField, moveScreenField, setScreenFieldRequired, removeScreenField,
    listScreenAssignments, setScreenAssignment, getScreenForItemType,
  };
})();
