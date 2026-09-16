/* Mock data source.
   Implements exactly the interface Api does, so the UI runs standalone with
   no backend. It deliberately enforces the same server-side rules the real
   API enforces — the role matrix, the hierarchy rules, a rejected PATCH, an
   author-only comment delete, column renumbering on move — and returns the
   same response shapes, so mock mode is an honest model of the product
   rather than a picture of it. */

const Store = (() => {

  const LATENCY = 140;   // enough to see optimistic updates land

  let nextId = 100;
  const id = () => ++nextId;

  // Deliberately the same people the real `seed_demo` command creates, so the
  // mock and a seeded local database do not contradict each other.
  const users = [
    { id: 1, username: 'asha',  display_name: 'Asha Rao' },
    { id: 2, username: 'kabir', display_name: 'Kabir Menon' },
    { id: 3, username: 'lena',  display_name: 'Lena Fischer' },
  ];
  const userById = (uid) => users.find(u => u.id === Number(uid)) || null;

  let me = null;

  const now = () => new Date().toISOString();

  const day = offset => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  /* ---- seed ------------------------------------------------------------ */

  /* Seeded so signing in as Asha alone walks through Owner, Admin and Member
     views without switching accounts, plus one pending invitation. */
  let projects = [
    { id: 1, key: 'TASKY', name: 'Tasky Redesign',   description: 'The multi-project expansion itself', created_at: now(), is_archived: false, archived_at: null, archived_by: null },
    { id: 2, key: 'WEB',   name: 'Website Refresh',  description: '', created_at: now(), is_archived: false, archived_at: null, archived_by: null },
    { id: 3, key: 'CLNT',  name: 'Client Portal',    description: '', created_at: now(), is_archived: false, archived_at: null, archived_by: null },
    { id: 4, key: 'MKT',   name: 'Marketing Launch', description: '', created_at: now(), is_archived: false, archived_at: null, archived_by: null },
  ];

  let memberships = [
    { id: id(), project: 1, user: 1, role: 'owner',  joined_at: now() },   // Asha owns Tasky Redesign
    { id: id(), project: 1, user: 2, role: 'admin',  joined_at: now() },
    { id: id(), project: 1, user: 3, role: 'member', joined_at: now() },
    { id: id(), project: 2, user: 2, role: 'owner',  joined_at: now() },
    { id: id(), project: 2, user: 1, role: 'admin',  joined_at: now() },   // Asha admins Website Refresh
    { id: id(), project: 3, user: 3, role: 'owner',  joined_at: now() },
    { id: id(), project: 3, user: 2, role: 'admin',  joined_at: now() },
    { id: id(), project: 3, user: 1, role: 'member', joined_at: now() },   // Asha is a plain member of Client Portal
    { id: id(), project: 4, user: 3, role: 'owner',  joined_at: now() },
  ];

  let invitations = [
    // Pending invite waiting for Asha to accept or decline on first sign-in.
    { id: id(), project: 4, invited_user: 1, invited_by: 3, status: 'pending', created_at: now() },
  ];

  let boards = [
    { id: 11, project: 1, name: 'Sprint Board', description: 'The redesign work in flight', created_by: 1, created_at: now(), updated_at: now() },
    { id: 12, project: 1, name: 'Backlog',      description: '', created_by: 1, created_at: now(), updated_at: now() },
    { id: 13, project: 2, name: 'Main Board',   description: '', created_by: 2, created_at: now(), updated_at: now() },
  ];

  let components = [
    { id: 21, project: 1, name: 'Backend' },
    { id: 22, project: 1, name: 'Frontend' },
  ];

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
     Validates the WHOLE list for blanks in a first pass, before creating
     anything — otherwise a genuinely-new name earlier in the array would
     get pushed into `labels` before a later blank name triggers the
     rejection, leaving a stray label behind on a request that should have
     failed atomically. */
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

  let releases = [];
  let nextReleaseId = 9000;
  const releaseById = (rid) => releases.find(r => r.id === Number(rid)) || null;
  const releaseOut = (r) => Object.assign({}, r);

  let attachments = [];
  let nextAttachmentId = 10000;
  const attachmentById = (aid) => attachments.find(a => a.id === Number(aid)) || null;
  // AttachmentSerializer nests the uploader under `uploaded_by` itself (a
  // full user object, or null once that account is gone) — unlike most
  // other relations here it has no `_detail` suffix, matching Comment's
  // `author`. Must stay `uploaded_by`, not `uploaded_by_detail`, so this
  // mock's shape matches the real API's.
  const attachmentOut = (a) => ({
    id: a.id, work_item: a.work_item, filename: a.filename, size: a.size,
    uploaded_by: a.uploaded_by ? userById(a.uploaded_by) : null,
    uploaded_at: a.uploaded_at,
  });

  let sprints = [];
  let nextSprintId = 11000;
  const sprintById = (sid) => sprints.find(s => s.id === Number(sid)) || null;
  const sprintOut = (s) => Object.assign({}, s, { created_by: userById(s.created_by) });
  // docs/api.md: work item responses carry `sprint_detail`, a nested
  // `{id, name, state, start_date, end_date}` — deliberately narrower than
  // sprintOut (no `board`/`goal`/`created_by`/`created_at`), so this stays a
  // separate helper rather than reusing sprintOut.
  const sprintDetailOut = (s) => s && { id: s.id, name: s.name, state: s.state, start_date: s.start_date, end_date: s.end_date };

  let automationRules = [];
  let nextRuleId = 12000;
  const ruleById = (rid) => automationRules.find(r => r.id === Number(rid)) || null;
  const rulesForProject = (projectId) =>
    automationRules.filter(r => r.project === Number(projectId)).sort((a, b) => a.position - b.position);
  // docs/api.md: the serializer exposes `created_by_detail` (nested user), not
  // a raw `created_by` id — unlike sprintOut/fieldOut, which reuse the plain
  // `created_by` key because that's what those two serializers actually name it.
  const ruleOut = (r) => {
    const out = Object.assign({}, r, { created_by_detail: userById(r.created_by) });
    delete out.created_by;
    return out;
  };

  const fieldOut = (f) => Object.assign({}, f, {
    options: optionsForField(f.id),
    created_by: userById(f.created_by),
  });
  const screenFieldOut = (r) => Object.assign({}, r, { field_detail: fieldOut(fieldById(r.field)) });
  const screenOut = (s) => Object.assign({}, s, { fields: screenFieldsFor(s.id).map(screenFieldOut) });

  /* Work item statuses (sub-project 3, Workflows). Per-project and
     configurable on the real backend; the mock only needs the fixed
     "simple" 3-status preset every project starts with, since nothing here
     exercises adding/renaming/reordering statuses. `status` on a work item
     is always one of these ids, never a string. */
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

  let statuses = [];
  let nextStatusId = 1000;
  function seedDefaultStatuses(projectId, statusPreset) {
    const preset = statusPreset || PROJECT_TEMPLATES[0].statuses;   // 'blank''s 3-status preset
    const made = preset.map((s, i) => ({ id: ++nextStatusId, project: projectId, name: s.name, category: s.category, position: i }));
    statuses.push(...made);
    return made;
  }
  const statusesForProject = (projectId) =>
    statuses.filter(s => s.project === Number(projectId)).sort((a, b) => a.position - b.position);
  const statusById = (sid) => statuses.find(s => s.id === Number(sid)) || null;
  const defaultStatusId = (projectId) =>
    statusesForProject(projectId).find(s => s.category === 'todo').id;

  // Seed statuses for every seed project before any work item references one.
  const [P1_TODO, P1_IN_PROGRESS, P1_DONE] = seedDefaultStatuses(1).map(s => s.id);
  const [P2_TODO] = seedDefaultStatuses(2).map(s => s.id);
  seedDefaultStatuses(3);
  seedDefaultStatuses(4);

  let workItems = [];
  function seed(o) {
    const item = Object.assign({
      description: '', status: P1_TODO, priority: 2, due_date: null, assignee: null,
      parent: null, position: 0, components: [], labels: [], custom_fields: {}, release: null,
      sprint: null, backlog_position: 0, created_by: 1,
      created_at: now(), updated_at: now(),
    }, o);
    workItems.push(item);
    return item;
  }

  /* One Epic, two of its children (a Story and a Task), a Subtask under the
     Story, and a standalone Bug — enough to exercise every level of the
     hierarchy and every valid parent shape from the seed alone. */
  const epic = seed({
    id: 31, key: 'TASKY-1', board: 11, item_type: 'epic', title: 'Redesign onboarding',
    status: P1_IN_PROGRESS, position: 0, priority: 3, assignee: 1, due_date: day(9),
    description: 'Everything a new teammate sees in their first ten minutes.',
  });
  const story = seed({
    id: 32, key: 'TASKY-2', board: 11, item_type: 'story', parent: epic.id,
    title: 'Design the welcome screen', status: P1_TODO, position: 0, assignee: 3,
    components: [22],
  });
  const task = seed({
    id: 33, key: 'TASKY-3', board: 11, item_type: 'task', parent: epic.id,
    title: 'Wire up the onboarding API', status: P1_TODO, position: 1, assignee: 2,
    due_date: day(-2), components: [21],
  });
  seed({
    id: 34, key: 'TASKY-4', board: 11, item_type: 'subtask', parent: story.id,
    title: 'Write the welcome copy', status: P1_TODO, position: 2,
  });
  const bug = seed({
    id: 35, key: 'TASKY-5', board: 11, item_type: 'bug', title: 'Signup button misaligned on Safari',
    status: P1_IN_PROGRESS, position: 1, priority: 3, assignee: 1, due_date: day(1),
  });
  seed({
    id: 36, key: 'TASKY-6', board: 11, item_type: 'task', title: 'Session auth, same origin',
    status: P1_DONE, position: 0, assignee: 1,
  });
  seed({
    id: 37, key: 'WEB-1', board: 13, item_type: 'bug', title: 'Compress the hero image',
    status: P2_TODO, position: 0, priority: 1, due_date: day(-5), assignee: 1,
  });

  // Every seeded item defaults to backlog_position: 0 (see seed() above), so
  // a board with more than one seeded item is degenerate — everything ties
  // at 0 — until something actually reorders it. Renumber each board's
  // backlog bucket once here, right after seed data is built, so a fresh
  // boot already has a real, contiguous 0-based order (ties broken by id,
  // same as everywhere else). renumberBacklogBucket is a hoisted function
  // declaration (defined further down, in the sprints & backlog section),
  // so calling it here from module init is safe.
  [...new Set(workItems.map(w => w.board))].forEach(boardId => renumberBacklogBucket(boardId, null));

  let links = [
    { id: id(), item_a: Math.min(task.id, bug.id), item_b: Math.max(task.id, bug.id),
      created_by: 1, created_at: now() },
  ];

  let comments = [
    { id: id(), card: epic.id, author: 2, body: 'Kicked this off — the welcome screen is the long pole.',
      created_at: day(-3) + 'T09:12:00Z' },
    { id: id(), card: epic.id, author: 1, body: 'Agreed. Splitting the copy out as a subtask.',
      created_at: day(-2) + 'T14:40:00Z' },
  ];

  // Next work item number per project, shared across every type and board.
  const itemCounters = { 1: 7, 2: 2, 3: 1, 4: 1 };

  /* ---- plumbing -------------------------------------------------------- */

  const wait = (v) => new Promise(res => setTimeout(() => res(clone(v)), LATENCY));
  const clone = (v) => (v === null || v === undefined) ? v : JSON.parse(JSON.stringify(v));

  /* The same `{ status, data }` shape Api throws, so app.js's errorText()
     reads a mock failure exactly the way it reads a real one. */
  function fail(status, data) {
    return Promise.reject(Object.assign(new Error('Mock API ' + status), { status, data }));
  }

  const membershipFor = (projectId, userId) =>
    memberships.find(m => m.project === Number(projectId) && m.user === Number(userId));

  const myRole = (projectId) => {
    const m = me && membershipFor(projectId, me.id);
    return m ? m.role : null;
  };

  /* A non-member gets 403, never 404 — existence is checked first,
     membership second, exactly like the real API. */
  function denied() {
    return fail(403, { detail: "You don't have access to this project." });
  }

  const projectById = (pid) => projects.find(p => p.id === Number(pid)) || null;
  const boardById = (bid) => boards.find(b => b.id === Number(bid)) || null;
  const itemById = (iid) => workItems.find(w => w.id === Number(iid)) || null;
  const boardProject = (bid) => { const b = boardById(bid); return b ? b.project : null; };

  /* ---- serialisers ----------------------------------------------------- */

  const projectOut = (p) => Object.assign({}, p, {
    my_role: myRole(p.id),
    member_count: memberships.filter(m => m.project === p.id).length,
    archived_by_detail: p.archived_by ? userById(p.archived_by) : null,
  });

  const membershipOut = (m) => ({
    id: m.id, user_detail: userById(m.user), role: m.role, joined_at: m.joined_at,
  });

  const invitationOut = (inv) => ({
    id: inv.id,
    project_detail: projectOut(projectById(inv.project)),
    invited_by_detail: userById(inv.invited_by),
    status: inv.status,
    created_at: inv.created_at,
  });

  const boardOut = (b) => Object.assign({}, b, { created_by: userById(b.created_by) });

  const summaryOut = (w) => w && ({
    id: w.id, key: w.key, title: w.title, item_type: w.item_type,
    status: w.status, status_detail: statusById(w.status),
  });

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
      release_detail: w.release ? releaseOut(releaseById(w.release)) : null,
      sprint_detail: w.sprint ? sprintDetailOut(sprintById(w.sprint)) : null,
    });
  }

  const commentOut = (c) => ({
    id: c.id, card: c.card, author: c.author === null ? null : userById(c.author),
    body: c.body, created_at: c.created_at,
  });

  // Each row carries the OTHER side, already resolved, as the real API does.
  const linkOut = (l, forItemId) => ({
    id: l.id,
    item_detail: summaryOut(itemById(l.item_a === Number(forItemId) ? l.item_b : l.item_a)),
    created_at: l.created_at,
  });

  /* ---- auth ------------------------------------------------------------ */

  const getCsrf = () => wait(null);

  function login(username, password) {
    const user = users.find(u => u.username === String(username).trim().toLowerCase());
    if (!user || !password) {
      // Identical for an unknown username and a wrong password, exactly as the
      // real backend does — a different message would let anyone enumerate
      // who works here.
      return fail(400, { detail: 'Incorrect username or password.' });
    }
    me = user;
    return wait(user);
  }

  function logout() { me = null; return wait(null); }
  function getMe() { return me ? wait(me) : fail(403, { detail: 'Authentication credentials were not provided.' }); }

  /* ---- projects -------------------------------------------------------- */

  const listProjects = (includeArchived) => wait(
    projects.filter(p => membershipFor(p.id, me.id) && (includeArchived || !p.is_archived))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(projectOut)
  );

  function getProject(projectId) {
    const project = projectById(projectId);
    if (!project) return fail(404, { detail: 'Not found.' });
    if (!myRole(projectId)) return denied();
    return wait(projectOut(project));
  }

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

  function deleteProject(projectId) {
    const project = projectById(projectId);
    if (!project) return fail(404, { detail: 'Not found.' });
    if (!myRole(projectId)) return denied();
    if (myRole(projectId) !== 'owner') return fail(403, { detail: 'Only the owner can delete a project.' });

    const boardIds = boards.filter(b => b.project === project.id).map(b => b.id);
    const itemIds = workItems.filter(w => boardIds.includes(w.board)).map(w => w.id);
    workItems = workItems.filter(w => !itemIds.includes(w.id));
    comments = comments.filter(c => !itemIds.includes(c.card));
    links = links.filter(l => !itemIds.includes(l.item_a) && !itemIds.includes(l.item_b));
    boards = boards.filter(b => b.project !== project.id);
    components = components.filter(c => c.project !== project.id);
    memberships = memberships.filter(m => m.project !== project.id);
    invitations = invitations.filter(i => i.project !== project.id);
    projects = projects.filter(p => p.id !== project.id);
    return wait(null);
  }

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

  /* ---- membership ------------------------------------------------------ */

  function listMembers(projectId) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    if (!myRole(projectId)) return denied();
    const rank = { owner: 0, admin: 1, member: 2 };
    return wait(
      memberships.filter(m => m.project === Number(projectId))
                 .sort((a, b) => rank[a.role] - rank[b.role] || a.id - b.id)
                 .map(membershipOut)
    );
  }

  /* Doubles as "leave": removing your own membership is only ever blocked
     for the Owner, who must transfer ownership first. */
  function removeMember(projectId, userId) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    const acting = myRole(projectId);
    if (!acting) return denied();
    const target = membershipFor(projectId, userId);
    if (!target) return fail(404, { detail: 'Not found.' });

    if (Number(userId) === me.id) {
      if (!Logic.canLeave(acting)) {
        return fail(400, { detail: 'Transfer ownership before leaving a project you own.' });
      }
    } else if (!Logic.canRemove(acting, target.role)) {
      return fail(403, { detail: "You don't have permission to remove this member." });
    }

    memberships = memberships.filter(m => m.id !== target.id);
    return wait(null);
  }

  function changeRole(projectId, userId, role) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    const acting = myRole(projectId);
    if (!acting) return denied();
    if (!Logic.canChangeRole(acting)) return fail(403, { detail: 'Only the owner can change member roles.' });
    if (!['admin', 'member'].includes(role)) return fail(400, { role: `"${role}" is not a valid choice.` });

    const target = membershipFor(projectId, userId);
    if (!target) return fail(404, { detail: 'Not found.' });
    if (target.role === 'owner') {
      return fail(403, { detail: "The owner's role can't be changed here — transfer ownership instead." });
    }
    target.role = role;
    return wait(membershipOut(target));
  }

  function transferOwnership(projectId, userId) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    const acting = myRole(projectId);
    if (!acting) return denied();
    if (!Logic.canTransferOwnership(acting)) return fail(403, { detail: 'Only the owner can transfer ownership.' });

    const target = membershipFor(projectId, userId);
    if (!target || target.role !== 'admin') {
      return fail(400, { user_id: 'Ownership can only be transferred to an existing Admin.' });
    }
    membershipFor(projectId, me.id).role = 'admin';
    target.role = 'owner';
    return wait(null);
  }

  function inviteMember(projectId, userId) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    const acting = myRole(projectId);
    if (!acting) return denied();
    if (!Logic.canInvite(acting)) return fail(403, { detail: "You don't have permission to invite members." });
    if (!userById(userId)) return fail(400, { user_id: 'Invalid pk — object does not exist.' });
    if (membershipFor(projectId, userId)) return fail(400, { user_id: 'Already a member of this project.' });
    if (invitations.some(i => i.project === Number(projectId) && i.invited_user === Number(userId) && i.status === 'pending')) {
      return fail(400, { user_id: 'Already invited — waiting on a response.' });
    }

    const inv = {
      id: id(), project: Number(projectId), invited_user: Number(userId),
      invited_by: me.id, status: 'pending', created_at: now(),
    };
    invitations.push(inv);
    return wait(invitationOut(inv));
  }

  /* ---- invitations ----------------------------------------------------- */

  const listMyInvitations = () => wait(
    invitations.filter(i => i.invited_user === me.id && i.status === 'pending').map(invitationOut)
  );

  function respondToInvitation(invitationId, status) {
    const inv = invitations.find(i => i.id === Number(invitationId));
    if (!inv) return fail(404, { detail: 'Not found.' });
    if (inv.invited_user !== me.id) return fail(403, { detail: 'You can only respond to your own invitations.' });
    if (inv.status !== 'pending') return fail(400, { detail: 'This invitation has already been answered.' });

    inv.status = status;
    if (status === 'accepted' && !membershipFor(inv.project, me.id)) {
      memberships.push({ id: id(), project: inv.project, user: me.id, role: 'member', joined_at: now() });
    }
    return wait(null);
  }

  const acceptInvitation = (invitationId) => respondToInvitation(invitationId, 'accepted');
  const declineInvitation = (invitationId) => respondToInvitation(invitationId, 'declined');

  /* ---- boards ---------------------------------------------------------- */

  function listBoards(projectId) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    if (!myRole(projectId)) return denied();
    return wait(boards.filter(b => b.project === Number(projectId)).map(boardOut));
  }

  function getBoard(boardId) {
    const board = boardById(boardId);
    if (!board) return fail(404, { detail: 'Not found.' });
    if (!myRole(board.project)) return denied();
    return wait(boardOut(board));
  }

  function createBoard(fields) {
    const project = projectById(fields.project);
    if (!project) return fail(400, { project: 'Invalid pk — object does not exist.' });
    if (!myRole(project.id)) {
      return fail(400, { project: 'You must be a member of this project to create a board in it.' });
    }
    if (project.is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }
    if (!fields.name || !fields.name.trim()) return fail(400, { name: 'This field may not be blank.' });

    const board = {
      id: id(), project: project.id, name: fields.name.trim(),
      description: fields.description || '', created_by: me.id,
      created_at: now(), updated_at: now(),
    };
    boards.push(board);
    return wait(boardOut(board));
  }

  /* Every work item on the board in ONE position-ordered list across every
     status — interleaved, exactly like the real endpoint. */
  function getBoardWorkItems(boardId) {
    const board = boardById(boardId);
    if (!board) return fail(404, { detail: 'Not found.' });
    if (!myRole(board.project)) return denied();
    return wait(
      workItems.filter(w => w.board === board.id)
               .sort((a, b) => a.position - b.position || a.id - b.id)
               .map(itemOut)
    );
  }

  /* Mirrors the real backend's `_reposition` (see FieldOptionViewSet and
     WorkItemStatusViewSet in boards/views.py): `rawTarget` is a plain index,
     clamped into range and inserted among `others` (siblings excluding the
     item itself), then the WHOLE list is renumbered 0..n-1 in one pass.
     A bare `item.position = rawTarget` assignment — this mock's old
     behaviour — could collide with an existing sibling's position instead
     of honestly modeling the single-PATCH clamp-and-renumber contract the
     real API documents. */
  function reposition(others, item, rawTarget) {
    let target = Math.trunc(Number(rawTarget));
    if (!Number.isFinite(target)) target = 0;
    target = Math.min(Math.max(0, target), others.length);
    others.splice(target, 0, item);
    others.forEach((sibling, i) => { sibling.position = i; });
  }

  function listStatuses(projectId) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    if (!myRole(projectId)) return denied();
    return wait(statusesForProject(projectId));
  }

  function createStatus(projectId, fields) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(projectId);
    if (!role) return denied();
    if (projectById(projectId).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageStatuses(role)) return fail(403, { detail: "You don't have permission to manage statuses." });
    if (!fields.name || !fields.name.trim()) return fail(400, { name: 'This field may not be blank.' });
    if (!Logic.CATEGORIES.includes(fields.category)) {
      return fail(400, { category: `"${fields.category}" is not a valid choice.` });
    }
    const siblings = statusesForProject(projectId);
    const status = {
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
    if (projectById(status.project).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
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
    if ('position' in fields) {
      const others = statusesForProject(status.project).filter(s => s.id !== status.id);
      reposition(others, status, fields.position);
    }
    return wait(status);
  }

  function deleteStatus(projectId, statusId) {
    const status = statusById(statusId);
    if (!status || status.project !== Number(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(status.project);
    if (!role) return denied();
    if (projectById(status.project).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
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

  /* ---- work items ------------------------------------------------------ */

  function hierarchyError(itemType, parent) {
    if (Logic.isValidParent(itemType, parent ? parent.item_type : null)) return null;
    const label = Logic.ITEM_TYPE_LABEL[itemType];
    const article = /^[AEIOU]/.test(label) ? 'An' : 'A';
    return parent
      ? `${article} ${label} can't have that parent.`
      : 'A Subtask must have a parent Story, Task, or Bug.';
  }

  function getWorkItem(itemId) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();
    return wait(itemOut(item));
  }

  /* Validates `payload.custom_fields` against the assigned screen for
     `itemType` in `projectId`. Returns `{ value, error }` — `error` is
     `{ custom_fields: <message-or-per-field-object> }` on failure, matching
     the shape docs/api.md documents for the real endpoint's 400 body: a
     bare string only when no screen is assigned; a `{fieldId: message}`
     dict for every other failure (not-on-screen, required, type error) —
     mirrors `boards/services.py`'s `custom_fields_write_error` exactly,
     including validating against the MERGED (existing + newly-submitted)
     value per field, not the raw payload alone — a partial PATCH that
     doesn't touch an already-satisfied required field must not re-reject
     it (`boards/services.py:581`: `value = payload[key] if key in payload
     else existing_map.get(key)`). */
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

    const stray = {};
    for (const key of Object.keys(rawValues || {})) {
      if (!onScreenIds.has(Number(key))) {
        const field = fieldById(key);
        stray[key] = `"${field ? field.name : key}" isn't on the "${screen.name}" screen.`;
      }
    }
    if (Object.keys(stray).length) return { error: { custom_fields: stray } };

    const merged = Object.assign({}, currentValues || {});
    rows.forEach(r => {
      if (rawValues && r.field.id in rawValues) merged[r.field.id] = rawValues[r.field.id];
    });

    const contextFor = (field) => ({
      optionIds: optionsForField(field.id).map(o => o.id),
      memberIds: memberships.filter(m => m.project === Number(projectId)).map(m => m.user),
    });
    const errors = Logic.screenValueErrors(rows, merged, contextFor);
    if (Object.keys(errors).length) return { error: { custom_fields: errors } };

    return { value: merged };
  }

  function createWorkItem(fields) {
    const board = boardById(fields.board);
    if (!board) return fail(400, { board: 'Invalid pk — object does not exist.' });
    if (!myRole(board.project)) return fail(400, { board: "You must be a member of this board's project." });
    if (projectById(board.project).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }

    const itemType = fields.item_type || 'task';
    if (!Logic.ITEM_TYPES.includes(itemType)) return fail(400, { item_type: `"${itemType}" is not a valid choice.` });
    if (!fields.title || !fields.title.trim()) return fail(400, { title: 'This field may not be blank.' });

    let parent = null;
    if (fields.parent) {
      parent = itemById(fields.parent);
      if (!parent) return fail(400, { parent: 'Invalid pk — object does not exist.' });
      if (parent.board !== board.id) return fail(400, { parent: 'Parent must be on the same board.' });
    }
    const hErr = hierarchyError(itemType, parent);
    if (hErr) return fail(400, { parent: hErr });

    const status = fields.status ? Number(fields.status) : defaultStatusId(board.project);
    if (!statusById(status) || statusById(status).project !== board.project) {
      return fail(400, { status: 'Status must belong to this item\'s project.' });
    }
    let labelIds = [];
    if (fields.labels && fields.labels.length) {
      const resolved = resolveLabelNames(fields.labels);
      if (resolved.error) return fail(400, resolved.error);
      labelIds = resolved.ids;
    }
    let customFieldsValue = {};
    if (fields.custom_fields) {
      const result = validateCustomFields(board.project, itemType, fields.custom_fields, {});
      if (result.error) return fail(400, result.error);
      customFieldsValue = result.value;
    }

    if (fields.release) {
      const release = releaseById(fields.release);
      if (!release || release.project !== board.project) {
        return fail(400, { release: "Release must belong to this item's project." });
      }
    }

    const siblings = workItems.filter(w => w.board === board.id && w.status === status);
    const item = seed({
      id: id(), key: `${projectById(board.project).key}-${itemCounters[board.project]++}`,
      board: board.id, item_type: itemType, title: fields.title.trim(),
      description: fields.description || '', status, position: siblings.length,
      priority: fields.priority || 2, due_date: fields.due_date || null,
      assignee: fields.assignee || null, parent: parent ? parent.id : null,
      components: fields.components || [], labels: labelIds, custom_fields: customFieldsValue,
      release: fields.release ? Number(fields.release) : null,
      // A freshly created work item defaults to the backlog (sprint: null),
      // appended to the end. backlog_position isn't contiguous after a
      // delete (gaps are normal), so a mere count of the current backlog
      // could under-allocate and land the new item BEFORE a real item past
      // a gap. MAX_SAFE_INTEGER guarantees it sorts after everything, then
      // renumberBacklogBucket below collapses the bucket to a clean 0..n-1
      // order — same pattern as completeSprint's straggler return.
      backlog_position: Number.MAX_SAFE_INTEGER,
      created_by: me.id,
    });
    renumberBacklogBucket(board.id, null);
    return wait(itemOut(item));
  }

  function updateWorkItem(itemId, fields) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();
    if (projectById(boardProject(item.board)).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }

    if ('status' in fields && fields.status !== item.status) {
      return fail(400, { status: 'Status cannot be changed here — POST to /api/work-items/{id}/move/ instead.' });
    }
    if ('board' in fields && Number(fields.board) !== item.board) {
      return fail(400, { board: 'Work items cannot be moved between boards.' });
    }
    if ('item_type' in fields && fields.item_type !== item.item_type) {
      return fail(400, { item_type: 'Type cannot be changed after creation.' });
    }
    if ('key' in fields && fields.key !== item.key) {
      return fail(400, { key: 'Key cannot be changed.' });
    }
    if ('title' in fields && !String(fields.title).trim()) {
      return fail(400, { title: 'This field may not be blank.' });
    }

    let newParent;
    if ('parent' in fields) {
      const parentId = fields.parent ? Number(fields.parent) : null;
      if (parentId === item.id) return fail(400, { parent: "An item can't be its own parent." });
      newParent = parentId ? itemById(parentId) : null;
      if (parentId && !newParent) return fail(400, { parent: 'Invalid pk — object does not exist.' });
      if (newParent && newParent.board !== item.board) {
        return fail(400, { parent: 'Parent must be on the same board.' });
      }
      const hErr = hierarchyError(item.item_type, newParent);
      if (hErr) return fail(400, { parent: hErr });
    }

    if ('components' in fields) {
      const ids = (fields.components || []).map(Number);
      const mismatched = ids.filter(cid => {
        const c = components.find(x => x.id === cid);
        return !c || c.project !== boardProject(item.board);
      });
      if (mismatched.length) return fail(400, { components: "Components must belong to this item's project." });
      item.components = ids;
    }

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
    if ('custom_fields' in fields) {
      const result = validateCustomFields(boardProject(item.board), item.item_type, fields.custom_fields, item.custom_fields);
      if (result.error) return fail(400, result.error);
      item.custom_fields = result.value;
    }
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
    item.updated_at = now();

    return wait(itemOut(item));
  }

  function deleteWorkItem(itemId) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();
    if (projectById(boardProject(item.board)).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }

    // Children are orphaned, not deleted — they survive without a parent.
    workItems.forEach(w => { if (w.parent === item.id) w.parent = null; });
    workItems = workItems.filter(w => w.id !== item.id);
    comments = comments.filter(c => c.card !== item.id);
    links = links.filter(l => l.item_a !== item.id && l.item_b !== item.id);
    // Deliberately no renumber: position gaps are normal and harmless.
    return wait(null);
  }

  function listChildren(itemId) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();
    return wait(workItems.filter(w => w.parent === item.id).map(summaryOut));
  }

  function renumber(boardId, status) {
    workItems
      .filter(w => w.board === boardId && w.status === status)
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .forEach((w, i) => { w.position = i; });
  }

  function postMove(itemId, { status, position }) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();
    if (projectById(boardProject(item.board)).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }

    const from = item.status;
    item.status = status;
    item.position = position - 0.5;      // slot in between, then renumber to integers
    renumber(item.board, status);
    if (from !== status) renumber(item.board, from);
    return wait(itemOut(item));
  }

  /* ---- components ------------------------------------------------------ */

  function listComponents(projectId) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    if (!myRole(projectId)) return denied();
    return wait(
      components.filter(c => c.project === Number(projectId))
                .sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  function createComponent(projectId, name) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(projectId);
    if (!role) return denied();
    if (projectById(projectId).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }
    if (!Logic.canManageComponents(role)) return fail(403, { detail: "You don't have permission to manage components." });
    if (!name || !name.trim()) return fail(400, { name: 'This field may not be blank.' });
    if (components.some(c => c.project === Number(projectId) && c.name === name.trim())) {
      return fail(400, { name: 'A component with this name already exists in this project.' });
    }
    const component = { id: id(), project: Number(projectId), name: name.trim() };
    components.push(component);
    return wait(component);
  }

  function renameComponent(projectId, componentId, name) {
    const component = components.find(c => c.id === Number(componentId) && c.project === Number(projectId));
    if (!component) return fail(404, { detail: 'Not found.' });
    const role = myRole(component.project);
    if (!role) return denied();
    if (projectById(component.project).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }
    if (!Logic.canManageComponents(role)) return fail(403, { detail: "You don't have permission to manage components." });
    if (!name || !name.trim()) return fail(400, { name: 'This field may not be blank.' });
    if (components.some(c => c.project === component.project && c.name === name.trim() && c.id !== component.id)) {
      return fail(400, { name: 'A component with this name already exists in this project.' });
    }
    component.name = name.trim();
    return wait(component);
  }

  function deleteComponent(projectId, componentId) {
    const component = components.find(c => c.id === Number(componentId) && c.project === Number(projectId));
    if (!component) return fail(404, { detail: 'Not found.' });
    const role = myRole(component.project);
    if (!role) return denied();
    if (projectById(component.project).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }
    if (!Logic.canManageComponents(role)) return fail(403, { detail: "You don't have permission to manage components." });
    components = components.filter(c => c.id !== component.id);
    workItems.forEach(w => { w.components = w.components.filter(cid => cid !== component.id); });
    return wait(null);
  }

  /* ---- "relates to" links ---------------------------------------------- */

  function listLinks(itemId) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();
    return wait(
      links.filter(l => l.item_a === item.id || l.item_b === item.id).map(l => linkOut(l, item.id))
    );
  }

  function createLink(itemId, otherId) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();
    if (projectById(boardProject(item.board)).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }

    const other = itemById(otherId);
    if (!other) return fail(400, { item: 'Invalid pk — object does not exist.' });
    if (other.id === item.id) return fail(400, { item: "An item can't be linked to itself." });
    // Membership in BOTH sides' projects, the same AND the real API applies.
    if (!myRole(boardProject(other.board))) return denied();
    if (projectById(boardProject(other.board)).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }
    if (item.parent === other.id || other.parent === item.id) {
      return fail(400, { item: 'These items are already parent and child.' });
    }
    const [lo, hi] = item.id < other.id ? [item.id, other.id] : [other.id, item.id];
    if (links.some(l => l.item_a === lo && l.item_b === hi)) {
      return fail(400, { item: 'These items are already linked.' });
    }

    const link = { id: id(), item_a: lo, item_b: hi, created_by: me.id, created_at: now() };
    links.push(link);
    return wait(linkOut(link, item.id));
  }

  function deleteLink(linkId) {
    const link = links.find(l => l.id === Number(linkId));
    if (!link) return fail(404, { detail: 'Not found.' });
    const a = itemById(link.item_a);
    const b = itemById(link.item_b);
    if (!myRole(boardProject(a.board)) || !myRole(boardProject(b.board))) return denied();
    if (projectById(boardProject(a.board)).is_archived || projectById(boardProject(b.board)).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }
    links = links.filter(l => l.id !== link.id);
    return wait(null);
  }

  /* ---- comments -------------------------------------------------------- */

  function listComments(itemId) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();
    return wait(
      comments.filter(c => c.card === item.id)
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
              .map(commentOut)
    );
  }

  function createComment(itemId, body) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();
    if (projectById(boardProject(item.board)).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }
    /* DRF trims the string before its own blank check runs, so a
       whitespace-only comment fails as blank rather than reaching the
       serializer's "cannot be empty" message. Same wording here. */
    if (!body || !body.trim()) return fail(400, { body: 'This field may not be blank.' });
    const comment = { id: id(), card: item.id, author: me.id, body: body.trim(), created_at: now() };
    comments.push(comment);
    return wait(commentOut(comment));
  }

  function deleteComment(commentId) {
    const comment = comments.find(c => c.id === Number(commentId));
    if (!comment) return fail(404, { detail: 'Not found.' });
    if (projectById(boardProject(itemById(comment.card).board)).is_archived) {
      return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    }
    // Author-only, exactly like the real endpoint. A comment whose author was
    // deleted (author === null) can be removed by any member.
    if (comment.author !== null && me && comment.author !== me.id) {
      return fail(403, { detail: 'You can only delete your own comments.' });
    }
    comments = comments.filter(c => c.id !== comment.id);
    return wait(null);
  }

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
    if ('position' in fields) {
      const others = optionsForField(option.field).filter(o => o.id !== option.id);
      reposition(others, option, fields.position);
    }
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

  async function getScreenForItemType(projectId, itemType) {
    const assignments = await listScreenAssignments(projectId);
    const screenId = assignments[itemType];
    return screenId ? screenOut(screenById(screenId)) : null;
  }

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
      if (resolved.error) return fail(400, { labels_add: resolved.error.labels });
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
      comments = comments.filter(c => c.card !== item.id);
      links = links.filter(l => l.item_a !== item.id && l.item_b !== item.id);
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

      const itemType = get('item_type').toLowerCase() || 'task';
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
        components: componentIds, labels: resolvedLabels.ids,
        // Same fix as createWorkItem: a mere count would under-allocate once
        // a prior delete has opened a gap in backlog_position. Keying off
        // the row's own index (not a running "imported" counter) keeps
        // successfully-imported rows in their original CSV order relative
        // to each other even if an earlier row failed; the renumber after
        // the loop collapses the whole bucket to a clean 0..n-1 order.
        backlog_position: Number.MAX_SAFE_INTEGER - (dataRows.length - i),
        created_by: me.id,
      });
      imported++;
    });

    renumberBacklogBucket(board.id, null);
    return { imported, failed };
  }

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
    return wait(sprints.filter(s => s.board === board.id).map(sprintOut));
  }

  function createSprint(boardId, fields) {
    const board = boardById(boardId);
    if (!board) return fail(404, { detail: 'Not found.' });
    const role = myRole(board.project);
    if (!role) return denied();
    if (projectById(board.project).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageSprints(role)) return fail(403, { detail: "Only this project's Owner or Admins can manage sprints." });
    const name = (fields.name || '').trim();
    if (!name) return fail(400, { name: 'This field may not be blank.' });
    const sprint = {
      id: ++nextSprintId, board: board.id, name, goal: fields.goal || '',
      state: 'planned', start_date: null, end_date: null, created_by: me.id, created_at: now(),
    };
    sprints.push(sprint);
    return wait(sprintOut(sprint));
  }

  function getSprint(sprintId) {
    const sprint = sprintById(sprintId);
    if (!sprint) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(sprint.board))) return denied();
    return wait(sprintOut(sprint));
  }

  function updateSprint(sprintId, fields) {
    const sprint = sprintById(sprintId);
    if (!sprint) return fail(404, { detail: 'Not found.' });
    const role = myRole(boardProject(sprint.board));
    if (!role) return denied();
    if (projectById(boardProject(sprint.board)).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageSprints(role)) return fail(403, { detail: "Only this project's Owner or Admins can manage sprints." });
    if ('name' in fields) {
      const trimmed = (fields.name || '').trim();
      if (!trimmed) return fail(400, { name: 'This field may not be blank.' });
      sprint.name = trimmed;
    }
    if ('goal' in fields) sprint.goal = fields.goal;
    return wait(sprintOut(sprint));
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
    sprint.start_date = Logic.today();
    return wait(sprintOut(sprint));
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
    sprint.end_date = Logic.today();
    // Every work item still scheduled into this sprint returns to the backlog,
    // appended after whatever is already there. backlog_position is
    // deliberately NOT contiguous after a delete (gaps like 0, 2, 3 are
    // normal), so counting existing backlog items would under-allocate and
    // collide with a real gap-adjacent position — a straggler could sort
    // BEFORE the board's true last item instead of after it. Giving each
    // straggler a position far past anything a real backlog_position could
    // reach sidesteps computing an exact max: renumberBacklogBucket below
    // then collapses the whole bucket (existing items + stragglers) to a
    // clean 0..n-1 order, with stragglers guaranteed last and in their
    // original relative order.
    const stragglers = workItems
      .filter(w => w.sprint === sprint.id)
      .sort((a, b) => a.backlog_position - b.backlog_position || a.id - b.id);
    stragglers.forEach((w, i) => {
      w.sprint = null;
      w.backlog_position = Number.MAX_SAFE_INTEGER - (stragglers.length - 1 - i);
      w.updated_at = now();
    });
    renumberBacklogBucket(sprint.board, null);
    return wait(sprintOut(sprint));
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
    // The 0.5 offset places the item strictly between its two neighbors at
    // the requested position without first renumbering anything, so a single
    // renumberBacklogBucket pass afterward produces a clean 0..n-1 order with
    // the item exactly where it was asked to go.
    item.backlog_position = position - 0.5;
    renumberBacklogBucket(item.board, sprintId);
    if (fromSprint !== sprintId) renumberBacklogBucket(item.board, fromSprint);
    item.updated_at = now();
    return wait(itemOut(item));
  }

  /* ---- automation rules -------------------------------------------------- */
  /* Deliberately NOT evaluated/fired here — evaluation happens server-side
     only, wired into the single-item create/move endpoints. This is the
     admin UI for defining rules, not a client-side automation engine.

     Validation intentionally stops at what boards/automation.py's
     trigger_filter_error/action_config_error check structurally (blank name,
     to_status/to_category mutual exclusivity) — it does NOT re-validate that
     a from_status/to_status/status_id actually belongs to this project, or
     that a set_assignee user_id is a project member. Those checks require
     cross-referencing statuses/memberships this mock doesn't thread through
     here, and the real 400s for them are edge cases a well-behaved admin
     form won't hit in practice. Flagged as a known gap, not an oversight. */

  function listAutomationRules(projectId) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    if (!myRole(projectId)) return denied();
    return wait(rulesForProject(projectId).map(ruleOut));
  }

  function createAutomationRule(projectId, fields) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(projectId);
    if (!role) return denied();
    if (projectById(projectId).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageAutomation(role)) return fail(403, { detail: "You don't have permission to manage this project's automation rules." });
    if (!fields.name || !fields.name.trim()) return fail(400, { name: 'This field may not be blank.' });
    const triggerFilter = fields.trigger_filter || {};
    // boards/automation.py only rejects the to_status/to_category combo for
    // a status_changed trigger — a work_item_created rule's trigger_filter
    // has no to_status/to_category to begin with, so this mirrors that gate
    // rather than checking the two keys unconditionally.
    if (fields.trigger_type === 'status_changed' && triggerFilter.to_status != null && triggerFilter.to_category != null) {
      return fail(400, { trigger_filter: "to_status and to_category can't both be set." });
    }
    const siblings = rulesForProject(projectId);
    const rule = {
      id: ++nextRuleId, project: Number(projectId), name: fields.name.trim(),
      trigger_type: fields.trigger_type, trigger_filter: triggerFilter,
      action_type: fields.action_type, action_config: fields.action_config || {},
      is_active: fields.is_active !== undefined ? !!fields.is_active : true,
      position: siblings.length, created_by: me.id, created_at: now(),
    };
    automationRules.push(rule);
    return wait(ruleOut(rule));
  }

  function updateAutomationRule(projectId, ruleId, fields) {
    const rule = ruleById(ruleId);
    if (!rule || rule.project !== Number(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(rule.project);
    if (!role) return denied();
    if (projectById(rule.project).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageAutomation(role)) return fail(403, { detail: "You don't have permission to manage this project's automation rules." });
    if ('name' in fields && (!fields.name || !fields.name.trim())) return fail(400, { name: 'This field may not be blank.' });
    // Re-check mutual exclusivity against the effective (patched-or-existing)
    // trigger_type/trigger_filter, same as perform_update does server-side,
    // and only when one of those two fields is actually part of this PATCH.
    if ('trigger_filter' in fields || 'trigger_type' in fields) {
      const effectiveType = 'trigger_type' in fields ? fields.trigger_type : rule.trigger_type;
      const effectiveFilter = 'trigger_filter' in fields ? (fields.trigger_filter || {}) : rule.trigger_filter;
      if (effectiveType === 'status_changed' && effectiveFilter.to_status != null && effectiveFilter.to_category != null) {
        return fail(400, { trigger_filter: "to_status and to_category can't both be set." });
      }
    }
    ['name', 'trigger_type', 'trigger_filter', 'action_type', 'action_config', 'is_active', 'position'].forEach(f => {
      if (f in fields) rule[f] = (f === 'name') ? fields[f].trim() : fields[f];
    });
    return wait(ruleOut(rule));
  }

  function deleteAutomationRule(projectId, ruleId) {
    const rule = ruleById(ruleId);
    if (!rule || rule.project !== Number(projectId)) return fail(404, { detail: 'Not found.' });
    const role = myRole(rule.project);
    if (!role) return denied();
    if (projectById(rule.project).is_archived) return fail(403, { detail: 'This project is archived and read-only. Unarchive it first.' });
    if (!Logic.canManageAutomation(role)) return fail(403, { detail: "You don't have permission to manage this project's automation rules." });
    automationRules = automationRules.filter(r => r.id !== rule.id);
    rulesForProject(rule.project).forEach((r, i) => { r.position = i; });
    return wait(null);
  }

  /* ---- me -------------------------------------------------------------- */

  const listUsers = () => wait(users);

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
      return fail(400, { color: 'Pick a color from the palette.' });
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

  const myTasks = () => wait(
    workItems
      .filter(w => me && w.assignee === me.id &&
        (statusById(w.status) || {}).category !== 'done' && myRole(boardProject(w.board)))
      .sort((a, b) => {
        if (a.due_date !== b.due_date) {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return a.due_date.localeCompare(b.due_date);
        }
        return (b.priority - a.priority) || (a.id - b.id);
      })
      .map(itemOut)
  );

  return {
    getCsrf, login, logout, getMe,
    listProjects, getProject, createProject, deleteProject, listProjectTemplates,
    listMembers, removeMember, changeRole, transferOwnership, inviteMember,
    archiveProject, unarchiveProject,
    listMyInvitations, acceptInvitation, declineInvitation,
    listBoards, getBoard, createBoard, getBoardWorkItems,
    listStatuses, createStatus, updateStatus, deleteStatus,
    getWorkItem, createWorkItem, updateWorkItem, deleteWorkItem, postMove, listChildren,
    listComponents, createComponent, renameComponent, deleteComponent,
    listLinks, createLink, deleteLink,
    listLabels, renameLabel, recolorLabel, deleteLabel,
    listFields, createField, getField, renameField, deleteField,
    addFieldOption, renameFieldOption, moveFieldOption, deleteFieldOption,
    listScreens, createScreen, getScreen, renameScreen, deleteScreen,
    addScreenField, setScreenFieldRequired, moveScreenField, removeScreenField,
    listScreenAssignments, setScreenAssignments, getScreenForItemType,
    listReleases, createRelease, updateRelease, deleteRelease, listReleaseWorkItems,
    listAttachments, uploadAttachment, deleteAttachment, downloadUrl,
    listComments, createComment, deleteComment,
    listUsers, myTasks,
    search,
    bulkMoveWorkItems, bulkUpdateWorkItems, bulkDeleteWorkItems, importWorkItems,
    listSprints, createSprint, getSprint, updateSprint, deleteSprint,
    startSprint, completeSprint, listSprintWorkItems, listBacklog, scheduleWorkItem,
    listAutomationRules, createAutomationRule, updateAutomationRule, deleteAutomationRule,
  };
})();
