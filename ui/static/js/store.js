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
    { id: 1, key: 'TASKY', name: 'Tasky Redesign',   description: 'The multi-project expansion itself', created_at: now() },
    { id: 2, key: 'WEB',   name: 'Website Refresh',  description: '', created_at: now() },
    { id: 3, key: 'CLNT',  name: 'Client Portal',    description: '', created_at: now() },
    { id: 4, key: 'MKT',   name: 'Marketing Launch', description: '', created_at: now() },
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

  /* Work item statuses (sub-project 3, Workflows). Per-project and
     configurable on the real backend; the mock only needs the fixed
     "simple" 3-status preset every project starts with, since nothing here
     exercises adding/renaming/reordering statuses. `status` on a work item
     is always one of these ids, never a string. */
  let statuses = [];
  let nextStatusId = 1000;
  function seedDefaultStatuses(projectId) {
    const made = [
      { id: ++nextStatusId, project: projectId, name: 'To Do', category: 'todo', position: 0 },
      { id: ++nextStatusId, project: projectId, name: 'In Progress', category: 'in_progress', position: 1 },
      { id: ++nextStatusId, project: projectId, name: 'Done', category: 'done', position: 2 },
    ];
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
      parent: null, position: 0, components: [], created_by: 1,
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
      status_detail: statusById(w.status),
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

  const listProjects = () => wait(
    projects.filter(p => membershipFor(p.id, me.id))
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

    const project = { id: id(), key, name: fields.name.trim(), description: fields.description || '', created_at: now() };
    projects.push(project);
    memberships.push({ id: id(), project: project.id, user: me.id, role: 'owner', joined_at: now() });
    itemCounters[project.id] = 1;
    seedDefaultStatuses(project.id);
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

  function listStatuses(projectId) {
    if (!projectById(projectId)) return fail(404, { detail: 'Not found.' });
    if (!myRole(projectId)) return denied();
    return wait(statusesForProject(projectId));
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

  function createWorkItem(fields) {
    const board = boardById(fields.board);
    if (!board) return fail(400, { board: 'Invalid pk — object does not exist.' });
    if (!myRole(board.project)) return fail(400, { board: "You must be a member of this board's project." });

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
  }

  function updateWorkItem(itemId, fields) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();

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
    item.updated_at = now();

    return wait(itemOut(item));
  }

  function deleteWorkItem(itemId) {
    const item = itemById(itemId);
    if (!item) return fail(404, { detail: 'Not found.' });
    if (!myRole(boardProject(item.board))) return denied();

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

    const other = itemById(otherId);
    if (!other) return fail(400, { item: 'Invalid pk — object does not exist.' });
    if (other.id === item.id) return fail(400, { item: "An item can't be linked to itself." });
    // Membership in BOTH sides' projects, the same AND the real API applies.
    if (!myRole(boardProject(other.board))) return denied();
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
    // Author-only, exactly like the real endpoint. A comment whose author was
    // deleted (author === null) can be removed by any member.
    if (comment.author !== null && me && comment.author !== me.id) {
      return fail(403, { detail: 'You can only delete your own comments.' });
    }
    comments = comments.filter(c => c.id !== comment.id);
    return wait(null);
  }

  /* ---- me -------------------------------------------------------------- */

  const listUsers = () => wait(users);

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
    listProjects, getProject, createProject, deleteProject,
    listMembers, removeMember, changeRole, transferOwnership, inviteMember,
    listMyInvitations, acceptInvitation, declineInvitation,
    listBoards, getBoard, createBoard, getBoardWorkItems, listStatuses,
    getWorkItem, createWorkItem, updateWorkItem, deleteWorkItem, postMove, listChildren,
    listComponents, createComponent, renameComponent, deleteComponent,
    listLinks, createLink, deleteLink,
    listComments, createComment, deleteComment,
    listUsers, myTasks,
  };
})();
