/* Tasky — design prototype: Projects & Membership (1), Work Item
   Hierarchy (2a), Custom Fields & Screens (2b).
   Mock-only: no backend, no build step. Role, hierarchy and field-validation
   rules live in logic.js; store.js enforces them the same way the real API
   will. Views, routing and the interaction polish (skeletons, staggered
   rows, animated modal and toast lifecycle) live here. */

const root = document.getElementById('root');
const tpl = (id) => document.getElementById(id).content.cloneNode(true);
// Everything below builds markup as strings, so this escapes rather than
// merely stringifies — field names and option labels are user-typed.
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const outlet = () => root.querySelector('[data-main]');

let me = null;

/* Toast ------------------------------------------------------------------ */

let toastTimer = null;
function toast(message, bad) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = message;
  t.setAttribute('role', 'status');
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('is-open'));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('is-open');
    setTimeout(() => t.remove(), 180);
  }, 2600);
}

function errorText(err) {
  return (err && err.message) || 'Something went wrong.';
}

function handle(err) { toast(errorText(err), true); }

/* Skeletons -------------------------------------------------------------- */

function skeletonList(count) {
  return `<ul class="skeleton-list">${
    Array.from({ length: count }, () => '<li class="skeleton-row"></li>').join('')
  }</ul>`;
}

/* Staggers a NodeList's entrance so rows settle in rather than popping in
   as one block — capped so a long list doesn't feel sluggish to arrive. */
function stagger(nodes) {
  nodes.forEach((el, i) => { el.style.animationDelay = `${Math.min(i, 8) * 28}ms`; });
}

/* Boot --------------------------------------------------------------------*/

async function boot() {
  try {
    me = await Store.getMe();
    renderShell();
  } catch {
    renderLogin();
  }
}

/* Login ------------------------------------------------------------------ */

function renderLogin() {
  root.replaceChildren(tpl('tpl-login'));
  const form = root.querySelector('form');
  const errorEl = form.querySelector('[data-error]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    errorEl.hidden = true;
    try {
      me = await Store.login(form.username.value, form.password.value);
      renderShell();
    } catch (err) {
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });
}

/* Shell + routing ---------------------------------------------------------*/

function renderShell() {
  root.replaceChildren(tpl('tpl-shell'));
  root.querySelector('[data-who]').textContent = me.display_name || me.username;
  root.querySelector('[data-signout]').addEventListener('click', async () => {
    await Store.logout();
    me = null;
    location.hash = '';
    renderLogin();
  });
  route();
}

function setActiveNav(key) {
  root.querySelectorAll('.nav a[data-nav]').forEach(a => {
    a.classList.toggle('is-active', a.dataset.nav === key);
  });
}

function route() {
  if (!me) return;
  const hash = location.hash.replace(/^#/, '') || '/projects';

  // Fields and Screens are global objects, not project-scoped ones, so they
  // sit beside Projects in the nav rather than inside a project.
  if (hash === '/fields')  { setActiveNav('fields');  return viewFields(); }
  if (hash === '/screens') { setActiveNav('screens'); return viewScreens(); }
  if (hash === '/labels')  { setActiveNav('labels');  return viewLabels(); }

  setActiveNav('projects');
  const boardMatch = hash.match(/^\/projects\/(\d+)\/boards\/(\d+)$/);
  if (boardMatch) return viewBoard(Number(boardMatch[1]), Number(boardMatch[2]));
  const m = hash.match(/^\/projects\/(\d+)$/);
  if (m) return viewProject(Number(m[1]));
  viewProjects();
}
window.addEventListener('hashchange', route);

/* Projects list ------------------------------------------------------------*/

async function viewProjects() {
  const main = outlet();
  main.replaceChildren(tpl('tpl-projects'));

  const invSection = main.querySelector('[data-invitations]');
  const invList = main.querySelector('[data-invite-list]');
  const list = main.querySelector('[data-list]');
  list.innerHTML = skeletonList(3);

  main.querySelector('[data-create-project]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = main.querySelector('[data-create-error]');
    errorEl.hidden = true;
    const name = e.target.querySelector('[name=name]').value;
    const key = e.target.querySelector('[name=key]').value;
    try {
      const project = await Store.createProject({ name, key });
      toast('Project created');
      location.hash = `#/projects/${project.id}`;
    } catch (err) {
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
    }
  });

  try {
    const [invitations, projects] = await Promise.all([
      Store.listMyInvitations(),
      Store.listMyProjects(),
    ]);

    if (invitations.length) {
      invSection.hidden = false;
      const rows = invitations.map(invitationRow);
      invList.replaceChildren(...rows);
      stagger(rows);
    }

    if (!projects.length) {
      list.innerHTML = '<li class="empty">No projects yet. Create one above, or wait for an invitation.</li>';
      return;
    }
    const rows = projects.map(projectRow);
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    list.innerHTML = '';
    handle(err);
  }
}

function invitationRow(invite) {
  const li = document.createElement('li');
  li.className = 'invite-row';
  li.innerHTML =
    `<span class="who">${esc(invite.project_detail.name)} <span class="key-pill">${esc(invite.project_detail.key)}</span></span>` +
    `<span class="sub">Invited by ${esc(invite.invited_by_detail.display_name)}</span>` +
    `<span class="actions">` +
      `<button class="btn btn-primary" data-accept>Accept</button>` +
      `<button class="btn btn-quiet" data-decline>Decline</button>` +
    `</span>`;
  li.querySelector('[data-accept]').addEventListener('click', async () => {
    try {
      await Store.acceptInvitation(invite.id);
      toast('Invitation accepted');
      viewProjects();
    } catch (err) { handle(err); }
  });
  li.querySelector('[data-decline]').addEventListener('click', async () => {
    try {
      await Store.declineInvitation(invite.id);
      toast('Invitation declined');
      viewProjects();
    } catch (err) { handle(err); }
  });
  return li;
}

function projectRow(project) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.className = 'project-row';
  a.href = `#/projects/${project.id}`;
  a.innerHTML =
    `<span class="name">${esc(project.name)}</span>` +
    `<span class="key-pill">${esc(project.key)}</span>` +
    `<span class="desc">${esc(project.description)}</span>` +
    `<span class="role-badge role-${project.my_role}">${Logic.ROLE_LABEL[project.my_role]}</span>` +
    `<span class="tally mono">${project.member_count} member${project.member_count === 1 ? '' : 's'}</span>`;
  li.appendChild(a);
  return li;
}

/* Project detail ------------------------------------------------------------*/

async function viewProject(projectId) {
  const main = outlet();
  main.replaceChildren(tpl('tpl-project'));
  main.querySelector('[data-members]').innerHTML = skeletonList(3);

  try {
    const [project, myProjects] = await Promise.all([
      Store.getProject(projectId),
      Store.listMyProjects(),
    ]);

    main.querySelector('[data-project-name]').textContent = project.name;
    main.querySelector('[data-project-key]').textContent = project.key;
    const desc = main.querySelector('[data-project-desc]');
    if (project.description) desc.textContent = project.description; else desc.remove();

    const roleBadge = main.querySelector('[data-my-role]');
    roleBadge.textContent = Logic.ROLE_LABEL[project.my_role];
    roleBadge.classList.add(`role-${project.my_role}`);

    const switcher = main.querySelector('[data-switcher]');
    switcher.replaceChildren(...myProjects.map(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.key})`;
      if (p.id === projectId) opt.selected = true;
      return opt;
    }));
    switcher.addEventListener('change', () => { location.hash = `#/projects/${switcher.value}`; });

    renderProjectActions(main, project);
    await renderBoards(main, projectId);
    await renderComponents(main, projectId, project.my_role);
    await renderStatuses(main, projectId, project.my_role);
    await renderScreenAssignments(main, projectId, project.my_role);
    await renderMembers(main, projectId, project.my_role);
    await renderPendingInvites(main, projectId, project.my_role);
  } catch (err) {
    handle(err);
    location.hash = '#/projects';
  }
}

/* Boards ---------------------------------------------------------------- */

async function renderBoards(main, projectId) {
  const list = main.querySelector('[data-boards]');
  list.innerHTML = skeletonList(2);

  main.querySelector('[data-create-board]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('[name=name]');
    if (!input.value.trim()) return;
    try {
      const board = await Store.createBoard(projectId, input.value);
      location.hash = `#/projects/${projectId}/boards/${board.id}`;
    } catch (err) { handle(err); }
  });

  try {
    const boards = await Store.listBoards(projectId);
    if (!boards.length) {
      list.innerHTML = '<li class="empty">No boards yet. Name one above to get started.</li>';
      return;
    }
    const rows = boards.map(b => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'board-row';
      a.href = `#/projects/${projectId}/boards/${b.id}`;
      a.innerHTML = `<span class="name">${esc(b.name)}</span>`;
      li.appendChild(a);
      return li;
    });
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    list.innerHTML = '';
    handle(err);
  }
}

/* Components -------------------------------------------------------------- */

async function renderComponents(main, projectId, myRole) {
  const list = main.querySelector('[data-components]');
  const form = main.querySelector('[data-create-component]');
  const canManage = Logic.canManageComponents(myRole);
  form.hidden = !canManage;
  list.innerHTML = skeletonList(1);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('[name=name]');
    if (!input.value.trim()) return;
    try {
      await Store.createComponent(projectId, input.value);
      input.value = '';
      await renderComponents(main, projectId, myRole);
    } catch (err) { handle(err); }
  });

  try {
    const items = await Store.listComponents(projectId);
    if (!items.length) {
      list.innerHTML = '<li class="empty">No components yet.</li>';
      return;
    }
    const rows = items.map(c => componentRow(c, projectId, myRole));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    list.innerHTML = '';
    handle(err);
  }
}

function componentRow(component, projectId, myRole) {
  const li = document.createElement('li');
  li.className = 'component-row';
  const canManage = Logic.canManageComponents(myRole);
  li.innerHTML =
    `<span class="who" ${canManage ? 'contenteditable="true" data-rename' : ''}>${esc(component.name)}</span>` +
    (canManage ? `<span class="actions"><button class="btn btn-danger" data-remove>Delete</button></span>` : '');

  const nameEl = li.querySelector('[data-rename]');
  if (nameEl) {
    nameEl.addEventListener('blur', async () => {
      const value = nameEl.textContent.trim();
      if (!value || value === component.name) { nameEl.textContent = component.name; return; }
      try {
        await Store.renameComponent(component.id, value);
        component.name = value;
        toast('Component renamed');
      } catch (err) {
        nameEl.textContent = component.name;
        handle(err);
      }
    });
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    });
  }
  const removeBtn = li.querySelector('[data-remove]');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      try {
        await Store.deleteComponent(component.id);
        toast('Component deleted');
        await renderComponents(outlet(), projectId, myRole);
      } catch (err) { handle(err); }
    });
  }
  return li;
}

/* Workflows: per-project work item statuses (sub-project 3) ---------------
   These ARE the board's columns — rendered here as an ordered, hand-sorted
   list (same shape as a Screen's field list from 2b) so reordering, renaming
   and recategorizing all read as one idea. */

async function renderStatuses(main, projectId, myRole) {
  const list = main.querySelector('[data-statuses]');
  const form = main.querySelector('[data-create-status]');
  const canManage = Logic.canManageStatuses(myRole);
  form.hidden = !canManage;
  list.innerHTML = skeletonList(1);

  const categorySelect = form.querySelector('[data-category-select]');
  categorySelect.innerHTML = Logic.CATEGORIES.map(c =>
    `<option value="${c}">${Logic.CATEGORY_LABELS[c]}</option>`
  ).join('');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = e.target.querySelector('[name=name]');
    if (!nameInput.value.trim()) return;
    try {
      await Store.createStatus(projectId, { name: nameInput.value, category: categorySelect.value });
      nameInput.value = '';
      await renderStatuses(main, projectId, myRole);
    } catch (err) { handle(err); }
  });

  try {
    const statuses = await Store.listStatuses(projectId);
    const rows = statuses.map((s, i) => statusRow(s, i, statuses, main, projectId, myRole));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    list.innerHTML = '';
    handle(err);
  }
}

function statusRow(status, i, all, main, projectId, myRole) {
  const canManage = Logic.canManageStatuses(myRole);
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
    `<span class="cat-dot cat-${status.category}"></span>` +
    `<span class="label" ${canManage ? 'contenteditable="true" data-rename' : ''}>${esc(status.name)}</span>` +
    (canManage
      ? `<select data-category>${Logic.CATEGORIES.map(c =>
          `<option value="${c}" ${c === status.category ? 'selected' : ''}>${Logic.CATEGORY_LABELS[c]}</option>`
        ).join('')}</select>`
      : `<span class="hint" style="margin:0">${Logic.CATEGORY_LABELS[status.category]}</span>`) +
    (canManage ? `<button class="btn btn-danger" data-remove type="button">Delete</button>` : '');

  const run = async (fn) => {
    try {
      await fn();
      await renderStatuses(main, projectId, myRole);
    } catch (err) { handle(err); }
  };

  const up = li.querySelector('[data-up]');
  if (up) up.addEventListener('click', () => run(() => Store.moveStatus(status.id, -1)));
  const down = li.querySelector('[data-down]');
  if (down) down.addEventListener('click', () => run(() => Store.moveStatus(status.id, 1)));
  const remove = li.querySelector('[data-remove]');
  if (remove) remove.addEventListener('click', () => run(() => Store.deleteStatus(status.id)));

  const categoryEl = li.querySelector('[data-category]');
  if (categoryEl) {
    categoryEl.addEventListener('change', () => run(() => Store.updateStatus(status.id, { category: categoryEl.value })));
  }

  const labelEl = li.querySelector('[data-rename]');
  if (labelEl) {
    labelEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); labelEl.blur(); }
    });
    labelEl.addEventListener('blur', async () => {
      const value = labelEl.textContent.trim();
      if (!value || value === status.name) { labelEl.textContent = status.name; return; }
      try {
        await Store.updateStatus(status.id, { name: value });
        toast('Status renamed');
      } catch (err) {
        labelEl.textContent = status.name;
        handle(err);
      }
    });
  }
  return li;
}

/* Per-project screen assignment (sub-project 2b) --------------------------
   One row per work item type. "None" is a real, common answer — it means
   the type keeps exactly the built-in fields it had before 2b existed. */

async function renderScreenAssignments(main, projectId, myRole) {
  const list = main.querySelector('[data-assignments]');
  if (!list) return;
  list.innerHTML = skeletonList(5);
  const canEdit = Logic.canManageScreenAssignments(myRole);

  try {
    const [assignments, allScreens] = await Promise.all([
      Store.listScreenAssignments(projectId),
      Store.listScreens(),
    ]);

    if (!allScreens.length && !assignments.some(a => a.screen)) {
      list.innerHTML =
        '<li class="empty">No screens exist yet. Build one under <a href="#/screens">Screens</a> ' +
        'and every work item type here can point at it.</li>';
      return;
    }

    const rows = assignments.map(a => assignmentRow(a, allScreens, projectId, myRole, canEdit));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    list.innerHTML = '';
    handle(err);
  }
}

function assignmentRow(assignment, allScreens, projectId, myRole, canEdit) {
  const li = document.createElement('li');
  li.className = 'assign-row';
  const type = assignment.item_type;
  const meta = assignment.screen
    ? `${assignment.field_count} field${assignment.field_count === 1 ? '' : 's'}`
    : 'Built-in fields only';

  li.innerHTML =
    `<span class="type-badge type-${type}">${esc(assignment.item_type_label)}</span>` +
    `<span class="assign-meta">${esc(meta)}</span>` +
    (canEdit
      ? `<select class="assign-select" data-screen aria-label="Screen for ${esc(assignment.item_type_label)}">` +
          `<option value="">None — built-in fields only</option>` +
          allScreens.map(s =>
            `<option value="${s.id}" ${assignment.screen === s.id ? 'selected' : ''}>${esc(s.name)}</option>`
          ).join('') +
        `</select>`
      : `<span class="assign-value ${assignment.screen ? '' : 'is-none'}">${esc(assignment.screen_name || 'None')}</span>`);

  const select = li.querySelector('[data-screen]');
  if (select) {
    const previous = assignment.screen ? String(assignment.screen) : '';
    select.addEventListener('change', async () => {
      const chosen = select.options[select.selectedIndex].textContent;
      try {
        await Store.setScreenAssignment(projectId, type, select.value || null);
        toast(select.value
          ? `${assignment.item_type_label}s now use "${chosen}"`
          : `${assignment.item_type_label}s use built-in fields only`);
        await renderScreenAssignments(outlet(), projectId, myRole);
      } catch (err) {
        select.value = previous;  // put the control back where it was
        handle(err);
      }
    });
  }
  return li;
}

function renderProjectActions(main, project) {
  const actions = main.querySelector('[data-actions]');
  actions.innerHTML = '';
  const role = project.my_role;

  if (Logic.canInvite(role)) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Invite';
    btn.addEventListener('click', () => openInviteModal(project));
    actions.appendChild(btn);
  }
  if (Logic.canTransferOwnership(role)) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Transfer ownership';
    btn.addEventListener('click', () => openTransferModal(project));
    actions.appendChild(btn);
  }
  if (Logic.canLeave(role)) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-quiet';
    btn.textContent = 'Leave project';
    btn.addEventListener('click', async () => {
      try {
        await Store.leaveProject(project.id);
        toast('You left the project');
        location.hash = '#/projects';
      } catch (err) { handle(err); }
    });
    actions.appendChild(btn);
  }
  if (Logic.canDeleteProject(role)) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-danger';
    btn.textContent = 'Delete project';
    btn.addEventListener('click', async () => {
      try {
        await Store.deleteProject(project.id);
        toast('Project deleted');
        location.hash = '#/projects';
      } catch (err) { handle(err); }
    });
    actions.appendChild(btn);
  }
}

async function renderMembers(main, projectId, myRole) {
  const list = main.querySelector('[data-members]');
  try {
    const members = await Store.listMembers(projectId);
    const rows = members.map(m => memberRow(m, projectId, myRole));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    list.innerHTML = '';
    handle(err);
  }
}

function memberRow(member, projectId, myRole) {
  const li = document.createElement('li');
  li.className = 'member-row';
  const isMe = me && member.user_detail.id === me.id;

  let controls = '';
  if (Logic.canChangeRole(myRole) && member.role !== 'owner') {
    controls +=
      `<select class="role-select" data-role-select>` +
        `<option value="member" ${member.role === 'member' ? 'selected' : ''}>Member</option>` +
        `<option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>` +
      `</select>`;
  }
  if (Logic.canRemove(myRole, member.role) && !isMe) {
    controls += `<button class="btn btn-danger" data-remove>Remove</button>`;
  }

  li.innerHTML =
    `<span class="who">${esc(member.user_detail.display_name)}${isMe ? ' (you)' : ''} <span class="sub">@${esc(member.user_detail.username)}</span></span>` +
    `<span class="role-badge role-${member.role}">${Logic.ROLE_LABEL[member.role]}</span>` +
    `<span class="actions">${controls}</span>`;

  const roleSelect = li.querySelector('[data-role-select]');
  if (roleSelect) {
    roleSelect.addEventListener('change', async () => {
      try {
        await Store.changeRole(projectId, member.user_detail.id, roleSelect.value);
        toast('Role updated');
        await renderMembers(outlet(), projectId, myRole);
      } catch (err) { handle(err); }
    });
  }
  const removeBtn = li.querySelector('[data-remove]');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      try {
        await Store.removeMember(projectId, member.user_detail.id);
        toast('Member removed');
        await renderMembers(outlet(), projectId, myRole);
      } catch (err) { handle(err); }
    });
  }

  return li;
}

async function renderPendingInvites(main, projectId, myRole) {
  if (!Logic.canInvite(myRole)) return; // only Owner/Admin see outgoing invites
  const section = main.querySelector('[data-pending-section]');
  const list = main.querySelector('[data-pending-invites]');
  try {
    const invites = await Store.listProjectInvitations(projectId);
    if (!invites.length) return;
    section.hidden = false;
    const rows = invites.map(inv => {
      const li = document.createElement('li');
      li.className = 'invite-row';
      li.innerHTML =
        `<span class="who">${esc(inv.invited_user_detail.display_name)}</span>` +
        `<span class="sub">Invited by ${esc(inv.invited_by_detail.display_name)} · awaiting response</span>`;
      return li;
    });
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) { handle(err); }
}

/* Modals — a shared open/close lifecycle so every dialog animates the
   same way and Escape/backdrop-click always work the same way. Modals can
   nest (the work item modal opens a link picker on top of itself), so
   Escape only ever closes the topmost one. -------------------------- */

const modalStack = [];

function openModal(bodyHtml) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = bodyHtml;

  scrim.appendChild(modal);
  document.body.appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add('is-open'));

  function close() {
    scrim.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => scrim.remove(), 180);
    const idx = modalStack.indexOf(close);
    if (idx !== -1) modalStack.splice(idx, 1);
  }
  function onKey(e) {
    if (e.key === 'Escape' && modalStack[modalStack.length - 1] === close) close();
  }

  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey);
  modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));

  modalStack.push(close);
  return { modal, close };
}

async function openInviteModal(project) {
  let invitable;
  try { invitable = await Store.listInvitableUsers(project.id); }
  catch (err) { return handle(err); }

  const body = !invitable.length
    ? `<div class="modal-head"><p class="eyebrow">Invite to ${esc(project.key)}</p><button class="btn btn-quiet" data-close>Close</button></div>
       <p class="empty">Everyone with an account is already a member or already invited.</p>`
    : `<div class="modal-head"><p class="eyebrow">Invite to ${esc(project.key)}</p><button class="btn btn-quiet" data-close>Close</button></div>
       <label class="field"><span>Person</span><select name="user">${
         invitable.map(u => `<option value="${u.id}">${esc(u.display_name)} (@${esc(u.username)})</option>`).join('')
       }</select></label>
       <p class="form-error" data-error hidden></p>
       <div class="modal-actions"><button class="btn btn-primary" data-send>Send invite</button><button class="btn" data-close>Cancel</button></div>`;

  const { modal, close } = openModal(body);
  const sendBtn = modal.querySelector('[data-send]');
  if (!sendBtn) return;

  sendBtn.addEventListener('click', async () => {
    const errorEl = modal.querySelector('[data-error]');
    const userId = modal.querySelector('[name=user]').value;
    try {
      await Store.inviteMember(project.id, Number(userId));
      close();
      toast('Invitation sent');
      await renderPendingInvites(outlet(), project.id, project.my_role);
    } catch (err) {
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
    }
  });
}

async function openTransferModal(project) {
  let admins;
  try { admins = (await Store.listMembers(project.id)).filter(m => m.role === 'admin'); }
  catch (err) { return handle(err); }

  const body = !admins.length
    ? `<div class="modal-head"><p class="eyebrow">Transfer ownership</p><button class="btn btn-quiet" data-close>Close</button></div>
       <p class="empty">There's no Admin to transfer to yet. Promote a member to Admin first.</p>`
    : `<div class="modal-head"><p class="eyebrow">Transfer ownership</p><button class="btn btn-quiet" data-close>Close</button></div>
       <p class="page-sub" style="margin-bottom:12px">You'll become an Admin. This can't be undone from here.</p>
       <label class="field"><span>New owner</span><select name="user">${
         admins.map(m => `<option value="${m.user_detail.id}">${esc(m.user_detail.display_name)} (@${esc(m.user_detail.username)})</option>`).join('')
       }</select></label>
       <p class="form-error" data-error hidden></p>
       <div class="modal-actions"><button class="btn btn-primary" data-send>Transfer</button><button class="btn" data-close>Cancel</button></div>`;

  const { modal, close } = openModal(body);
  const sendBtn = modal.querySelector('[data-send]');
  if (!sendBtn) return;

  sendBtn.addEventListener('click', async () => {
    const errorEl = modal.querySelector('[data-error]');
    const userId = modal.querySelector('[name=user]').value;
    try {
      await Store.transferOwnership(project.id, Number(userId));
      close();
      toast('Ownership transferred');
      viewProject(project.id);
    } catch (err) {
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
    }
  });
}

/* Custom fields admin (sub-project 2b) ------------------------------------
   Global list. Anyone can look; only an Owner — of any project, which is
   the spec's deliberate self-serve choice — gets the controls. */

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

  let caps, types;
  try {
    [caps, types] = await Promise.all([Store.getMyCapabilities(), Store.listFieldTypes()]);
  } catch (err) {
    list.innerHTML = '';
    return handle(err);
  }

  if (caps.can_manage_definitions) {
    form.hidden = false;
    typeSelect.replaceChildren(...types.map(t => {
      const opt = document.createElement('option');
      opt.value = t.value;
      opt.textContent = t.label;
      return opt;
    }));
    const showHint = () => {
      const chosen = types.find(t => t.value === typeSelect.value);
      hint.textContent = `${chosen.hint} A field's type is fixed once it's created.`;
      hint.hidden = false;
    };
    typeSelect.addEventListener('change', showHint);
    showHint();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      const nameInput = form.querySelector('[name=name]');
      try {
        const field = await Store.createField({ name: nameInput.value, field_type: typeSelect.value });
        nameInput.value = '';
        nameInput.focus();
        toast(`"${field.name}" added`);
        await paintFields(list, true);
        // A brand-new select needs options before it's usable anywhere, so
        // offer that step rather than making them find it.
        if (field.has_options) openFieldOptionsModal(field.id, true, () => paintFields(list, true));
      } catch (err) {
        errorEl.textContent = errorText(err);
        errorEl.hidden = false;
      }
    });
  } else {
    locked.hidden = false;
    locked.textContent =
      "Only a project Owner can add or change custom fields — Owner of any project counts. " +
      "You can see the whole list, and use these fields on any work item whose screen includes them.";
  }

  await paintFields(list, caps.can_manage_definitions);
}

async function paintFields(list, canManage) {
  list.innerHTML = skeletonList(4);
  try {
    const fields = await Store.listFields();
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
    list.innerHTML = '';
    handle(err);
  }
}

function fieldRow(field, list, canManage) {
  const li = document.createElement('li');
  li.className = 'admin-row';

  const bits = [];
  if (field.has_options) bits.push(`${field.options.length} option${field.options.length === 1 ? '' : 's'}`);
  bits.push(field.screen_names.length ? `on ${field.screen_names.join(', ')}` : 'on no screen');
  if (field.value_count) bits.push(`${field.value_count} saved value${field.value_count === 1 ? '' : 's'}`);

  li.innerHTML =
    `<span class="name" ${canManage ? 'contenteditable="true" data-rename' : ''}>${esc(field.name)}</span>` +
    `<span class="type-badge ft">${esc(field.type_label)}</span>` +
    `<span class="row-meta">${esc(bits.join(' · '))}</span>` +
    `<span class="actions">` +
      (field.has_options ? `<button class="btn" data-options>Options</button>` : '') +
      (canManage ? `<button class="btn btn-danger" data-delete>Delete</button>` : '') +
    `</span>`;

  const nameEl = li.querySelector('[data-rename]');
  if (nameEl) {
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    });
    nameEl.addEventListener('blur', async () => {
      const value = nameEl.textContent.trim();
      if (!value || value === field.name) { nameEl.textContent = field.name; return; }
      try {
        await Store.renameField(field.id, value);
        field.name = value;
        toast('Field renamed');
        await paintFields(list, canManage);
      } catch (err) {
        nameEl.textContent = field.name;
        handle(err);
      }
    });
  }

  const optionsBtn = li.querySelector('[data-options]');
  if (optionsBtn) {
    optionsBtn.addEventListener('click', () =>
      openFieldOptionsModal(field.id, canManage, () => paintFields(list, canManage)));
  }

  const deleteBtn = li.querySelector('[data-delete]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      try {
        await Store.deleteField(field.id);
        toast(`"${field.name}" deleted`);
        await paintFields(list, canManage);
      } catch (err) { handle(err); }
    });
  }

  return li;
}

/* Field options — an ordered list, edited in place so the reviewer sees the
   order change rather than a page reload. */

async function openFieldOptionsModal(fieldId, canManage, onChange) {
  let field;
  try { field = await Store.getField(fieldId); } catch (err) { return handle(err); }
  if (!field.has_options) {
    return toast(`"${field.name}" is a ${field.type_label} — only Select and Multi-select have options.`, true);
  }

  const body =
    `<div class="modal-head">` +
      `<p class="eyebrow">${esc(field.name)} · <span class="type-badge ft">${esc(field.type_label)}</span></p>` +
      `<button class="btn btn-quiet" data-close>Close</button>` +
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
    if (up) up.addEventListener('click', () => run(() => Store.moveFieldOption(option.id, -1)));
    const down = li.querySelector('[data-down]');
    if (down) down.addEventListener('click', () => run(() => Store.moveFieldOption(option.id, 1)));
    const remove = li.querySelector('[data-remove]');
    if (remove) remove.addEventListener('click', () => run(() => Store.deleteFieldOption(option.id)));

    const labelEl = li.querySelector('[data-rename]');
    if (labelEl) {
      labelEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); labelEl.blur(); }
      });
      labelEl.addEventListener('blur', async () => {
        const value = labelEl.textContent.trim();
        if (!value || value === option.label) { labelEl.textContent = option.label; return; }
        clearError();
        try {
          field = await Store.renameFieldOption(option.id, value);
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
        field = await Store.addFieldOption(field.id, input.value);
        input.value = '';
        input.focus();
        paint();
        if (onChange) onChange();
      } catch (err) { showError(err); }
    });
  }

  paint();
}

/* Screens admin (sub-project 2b) ----------------------------------------- */

async function viewScreens() {
  const main = outlet();
  main.replaceChildren(tpl('tpl-screens'));

  const list = main.querySelector('[data-list]');
  const form = main.querySelector('[data-create-screen]');
  const errorEl = main.querySelector('[data-create-error]');
  const locked = main.querySelector('[data-locked]');
  list.innerHTML = skeletonList(2);

  let caps;
  try { caps = await Store.getMyCapabilities(); }
  catch (err) { list.innerHTML = ''; return handle(err); }

  if (caps.can_manage_definitions) {
    form.hidden = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      const input = form.querySelector('[name=name]');
      try {
        const screen = await Store.createScreen(input.value);
        input.value = '';
        toast(`"${screen.name}" added`);
        await paintScreens(list, true);
        // A screen with no fields does nothing, so go straight to filling it.
        openScreenFieldsModal(screen.id, true, () => paintScreens(list, true));
      } catch (err) {
        errorEl.textContent = errorText(err);
        errorEl.hidden = false;
      }
    });
  } else {
    locked.hidden = false;
    locked.textContent =
      "Only a project Owner can add or change screens — Owner of any project counts. " +
      "Assigning one of these to a work item type is a per-project job, done on the project page.";
  }

  await paintScreens(list, caps.can_manage_definitions);
}

async function paintScreens(list, canManage) {
  list.innerHTML = skeletonList(2);
  try {
    const screens = await Store.listScreens();
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
    list.innerHTML = '';
    handle(err);
  }
}

function screenRow(screen, list, canManage) {
  const li = document.createElement('li');
  li.className = 'admin-row';

  const required = screen.fields.filter(f => f.required).length;
  const bits = [
    `${screen.fields.length} field${screen.fields.length === 1 ? '' : 's'}${required ? `, ${required} required` : ''}`,
    screen.assigned_to.length
      ? `used by ${screen.assigned_to.map(a => a.label).join(', ')}`
      : 'not assigned anywhere',
  ];

  li.innerHTML =
    `<span class="name" ${canManage ? 'contenteditable="true" data-rename' : ''}>${esc(screen.name)}</span>` +
    `<span class="row-meta">${esc(bits.join(' · '))}</span>` +
    `<span class="actions">` +
      `<button class="btn" data-fields>Fields</button>` +
      (canManage ? `<button class="btn btn-danger" data-delete>Delete</button>` : '') +
    `</span>`;

  const nameEl = li.querySelector('[data-rename]');
  if (nameEl) {
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    });
    nameEl.addEventListener('blur', async () => {
      const value = nameEl.textContent.trim();
      if (!value || value === screen.name) { nameEl.textContent = screen.name; return; }
      try {
        await Store.renameScreen(screen.id, value);
        screen.name = value;
        toast('Screen renamed');
        await paintScreens(list, canManage);
      } catch (err) {
        nameEl.textContent = screen.name;
        handle(err);
      }
    });
  }

  li.querySelector('[data-fields]').addEventListener('click', () =>
    openScreenFieldsModal(screen.id, canManage, () => paintScreens(list, canManage)));

  const deleteBtn = li.querySelector('[data-delete]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      try {
        await Store.deleteScreen(screen.id);
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
    [screen, allFields] = await Promise.all([Store.getScreen(screenId), Store.listFields()]);
  } catch (err) { return handle(err); }

  const body =
    `<div class="modal-head">` +
      `<p class="eyebrow">Screen · ${esc(screen.name)}</p>` +
      `<button class="btn btn-quiet" data-close>Close</button>` +
    `</div>` +
    `<p class="hint">This order is the order the fields appear on the work item form. <strong>Required</strong> is per screen — the same field can be required here and optional on another screen.</p>` +
    `<ul class="order-list" data-fields></ul>` +
    `<p class="form-error" data-error hidden></p>` +
    (canManage
      ? `<form class="add-row" data-add novalidate>` +
          `<select name="field" aria-label="Field to add" data-add-select></select>` +
          `<button class="btn" type="submit">Add field</button>` +
        `</form>`
      : `<p class="hint">Only a project Owner can change these.</p>`) +
    `<p class="hint" data-assigned></p>`;

  const { modal } = openModal(body);
  const listEl = modal.querySelector('[data-fields]');
  const errorEl = modal.querySelector('[data-error]');
  const assignedEl = modal.querySelector('[data-assigned]');
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

    assignedEl.textContent = screen.assigned_to.length
      ? `In use on ${screen.assigned_to.map(a => a.label).join(', ')}.`
      : 'Not assigned to any project’s work item type yet.';

    if (addSelect) {
      const onScreen = new Set(screen.fields.map(r => r.field.id));
      const available = allFields.filter(f => !onScreen.has(f.id));
      addSelect.replaceChildren(...available.map(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = `${f.name} · ${f.type_label}`;
        return opt;
      }));
      const none = !available.length;
      addSelect.disabled = none;
      addForm.querySelector('button').disabled = none;
      if (none) {
        const opt = document.createElement('option');
        opt.textContent = 'Every custom field is already on this screen';
        addSelect.replaceChildren(opt);
      }
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
      `<span class="label">${esc(row.field.name)}</span>` +
      `<span class="type-badge ft">${esc(row.field.type_label)}</span>` +
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
    if (up) up.addEventListener('click', () => run(() => Store.moveScreenField(row.id, -1)));
    const down = li.querySelector('[data-down]');
    if (down) down.addEventListener('click', () => run(() => Store.moveScreenField(row.id, 1)));
    const remove = li.querySelector('[data-remove]');
    if (remove) remove.addEventListener('click', () => run(() => Store.removeScreenField(row.id)));

    const toggle = li.querySelector('[data-required] input');
    if (toggle) {
      toggle.addEventListener('change', () => run(() => Store.setScreenFieldRequired(row.id, toggle.checked)));
    }
    return li;
  }

  if (addForm) {
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!addSelect.value) return;
      clearError();
      try {
        screen = await Store.addScreenField(screen.id, Number(addSelect.value));
        paint();
        if (onChange) onChange();
      } catch (err) { showError(err); }
    });
  }

  paint();
}

/* Labels admin (sub-project 4) --------------------------------------------
   Global, free-form list — the admin screen only renames, recolors and
   deletes; there's no create form, since a label is created implicitly the
   first time someone types a new name onto a work item (see the chip-input
   widget below). */

async function viewLabels() {
  const main = outlet();
  main.replaceChildren(tpl('tpl-labels'));

  const list = main.querySelector('[data-list]');
  const locked = main.querySelector('[data-locked]');
  list.innerHTML = skeletonList(3);

  let caps;
  try { caps = await Store.getMyCapabilities(); }
  catch (err) { list.innerHTML = ''; return handle(err); }

  if (!caps.can_manage_definitions) {
    locked.hidden = false;
    locked.textContent =
      "Only a project Owner can rename, recolor or delete a label — Owner of any project counts. " +
      "Anyone can still apply an existing label, or create a new one, right on a work item.";
  }

  await paintLabels(list, caps.can_manage_definitions);
}

async function paintLabels(list, canManage) {
  list.innerHTML = skeletonList(3);
  try {
    const labels = await Store.listLabels();
    if (!labels.length) {
      list.innerHTML = '<li class="empty">No labels yet. Type one onto a work item to create it.</li>';
      return;
    }
    const rows = labels.map(l => labelRow(l, list, canManage));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    list.innerHTML = '';
    handle(err);
  }
}

function labelRow(label, list, canManage) {
  const li = document.createElement('li');
  li.className = 'label-admin-row';

  li.innerHTML =
    (canManage
      ? `<button class="swatch-btn" data-swatch style="background:${label.color}" aria-label="Change color" type="button"></button>`
      : `<span class="swatch" style="background:${label.color}"></span>`) +
    `<span class="name" ${canManage ? 'contenteditable="true" data-rename' : ''}>${esc(label.name)}</span>` +
    (canManage ? `<span class="actions"><button class="btn btn-danger" data-delete>Delete</button></span>` : '');

  const nameEl = li.querySelector('[data-rename]');
  if (nameEl) {
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    });
    nameEl.addEventListener('blur', async () => {
      const value = nameEl.textContent.trim();
      if (!value || value === label.name) { nameEl.textContent = label.name; return; }
      try {
        await Store.renameLabel(label.id, value);
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
      const options = Store.LABEL_PALETTE || [];
      const next = options[(options.indexOf(label.color) + 1) % options.length];
      try {
        await Store.recolorLabel(label.id, next);
        label.color = next;
        swatchBtn.style.background = next;
      } catch (err) { handle(err); }
    });
  }

  const deleteBtn = li.querySelector('[data-delete]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      try {
        await Store.deleteLabel(label.id);
        toast(`"${label.name}" deleted`);
        await paintLabels(list, canManage);
      } catch (err) { handle(err); }
    });
  }

  return li;
}

/* Label chip-input — a reusable widget for the work item create form and
   detail modal. Free-text: press Enter or "," to turn the current input
   value into a chip, backed by a <datalist> of existing label names for
   autocomplete. Names, not ids — the store resolves each one to a label
   (creating it if it's new) on save, same shape the real API will take. */

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
    return match ? match.color : (Store.colorForLabelName ? Store.colorForLabelName(name) : '#888');
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

/* Custom field controls on a work item form ------------------------------
   One renderer, used by both the work item modal and the board's inline
   "add work item" form, so a field looks and behaves the same wherever it
   is filled in. */

const CF_WIDE_TYPES = ['text_long', 'multiselect'];

function customFieldControl(row, value, members) {
  const field = row.field;
  const name = `cf-${field.id}`;
  const req = row.required ? '<em class="req">required</em>' : '';
  const wide = CF_WIDE_TYPES.includes(field.field_type);
  let control;
  let tag = 'label';   // a <label> wraps a single control; a <div> wraps many

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
        field.options.map(o =>
          `<option value="${o.id}" ${String(value) === String(o.id) ? 'selected' : ''}>${esc(o.label)}</option>`
        ).join('') +
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
              return `<label class="chip-check ${on ? 'is-checked' : ''}">` +
                `<input type="checkbox" value="${o.id}" ${on ? 'checked' : ''}>${esc(o.label)}</label>`;
            }).join('')
          : `<p class="empty-inline">No options defined yet — add some under Fields.</p>`) +
        `</div>`;
      break;
    }
    case 'checkbox': {
      tag = 'div';
      const on = value === true;
      control =
        `<div class="chip-check-list" data-cf="${field.id}">` +
          `<label class="chip-check ${on ? 'is-checked' : ''}">` +
            `<input type="checkbox" ${on ? 'checked' : ''}>Yes</label>` +
        `</div>`;
      break;
    }
    case 'user_picker':
      control =
        `<select name="${name}" data-cf="${field.id}"><option value="">—</option>` +
        members.map(m =>
          `<option value="${m.user_detail.id}" ${String(value) === String(m.user_detail.id) ? 'selected' : ''}>${esc(m.user_detail.display_name)}</option>`
        ).join('') +
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
  return rows.map(row =>
    customFieldControl(row, values ? values[row.field.id] : undefined, members)
  ).join('');
}

// Reads the controls back into the { fieldId: value } shape the store (and
// the real API) expects: a list for multiselect, a boolean for checkbox, an
// id for select/user_picker, the raw string otherwise.
function readCustomFieldInputs(scope, rows) {
  const out = {};
  rows.forEach(row => {
    const field = row.field;
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

// Puts each complaint under the control that caused it, rather than only
// showing the first one at the top of the form.
function applyCustomFieldErrors(scope, errors) {
  clearCustomFieldErrors(scope);
  Object.keys(errors || {}).forEach(fieldId => {
    const el = scope.querySelector(`[data-cf-error="${fieldId}"]`);
    if (!el) return;
    el.textContent = errors[fieldId];
    el.hidden = false;
    const wrap = scope.querySelector(`[data-cf-wrap="${fieldId}"]`);
    if (wrap) wrap.classList.add('has-error');
  });
  const first = scope.querySelector('.cf-field.has-error');
  if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* Board — work items (sub-project 2a) ------------------------------------ */

let boardState = { projectId: null, boardId: null, statuses: null, buckets: null };

// Buckets are keyed by status id (a number) now, not a fixed status string —
// every column in `boardState.statuses` gets an entry, empty or not, so a
// freshly-added status with no items yet still renders as a column.
function groupByStatus(items, statuses) {
  const buckets = {};
  statuses.forEach(s => { buckets[s.id] = []; });
  items.forEach(item => { (buckets[item.status] || (buckets[item.status] = [])).push(item); });
  return buckets;
}

async function viewBoard(projectId, boardId) {
  const main = outlet();
  main.replaceChildren(tpl('tpl-board'));
  boardState.projectId = projectId;
  boardState.boardId = boardId;

  main.querySelector('[data-back-link]').href = `#/projects/${projectId}`;
  main.querySelector('[data-type-legend]').innerHTML = Logic.ITEM_TYPES.map(t =>
    `<span class="legend-item"><i class="type-dot type-${t}"></i>${Logic.ITEM_TYPE_LABEL[t]}</span>`
  ).join('');

  const columnsEl = main.querySelector('[data-columns]');
  columnsEl.innerHTML = '<p class="loading">Loading board…</p>';

  try {
    const [board, items, statuses] = await Promise.all([
      Store.getBoard(boardId),
      Store.listBoardWorkItems(boardId),
      Store.listStatuses(projectId),
    ]);
    main.querySelector('[data-board-name]').textContent = board.name;

    boardState.statuses = statuses;
    boardState.buckets = groupByStatus(items, statuses);
    paintColumns();
  } catch (err) {
    columnsEl.innerHTML = '';
    handle(err);
    location.hash = `#/projects/${projectId}`;
  }
}

async function reloadBoard() {
  const items = await Store.listBoardWorkItems(boardState.boardId);
  boardState.buckets = groupByStatus(items, boardState.statuses);
  paintColumns();
}

function paintColumns() {
  const columnsEl = root.querySelector('[data-columns]');
  if (!columnsEl) return;
  columnsEl.replaceChildren(...boardState.statuses.map(s => columnEl(s, boardState.buckets[s.id] || [])));
}

function columnEl(status, items) {
  const col = document.createElement('section');
  col.className = 'column';
  // Same three visual buckets as before — now keyed by category, since
  // several statuses can share one (see design/js/logic.js CATEGORIES).
  if (status.category === 'in_progress') col.classList.add('column-active');
  if (status.category === 'done') col.classList.add('column-done');

  const head = document.createElement('div');
  head.className = 'column-head';
  head.innerHTML =
    `<span class="dot"></span>` +
    `<span class="label">${esc(status.name)}</span>` +
    `<span class="count">${items.length}</span>`;
  col.appendChild(head);

  const stack = document.createElement('div');
  stack.className = 'stack';
  items.forEach(item => stack.appendChild(workItemCard(item)));
  col.appendChild(stack);

  col.appendChild(addWorkItemControl(status.id));
  return col;
}

function workItemCard(item) {
  const el = document.createElement('article');
  el.className = `wi-card p${item.priority || 2}`;
  el.tabIndex = 0;

  const parentChip = item.parent_detail
    ? `<span class="parent-chip">${esc(item.parent_detail.key)}</span>` : '';
  const who = item.assignee_detail
    ? `<span class="who-chip">${esc(item.assignee_detail.display_name)}</span>` : '';
  const labelChips = (item.labels_detail || [])
    .map(l => `<span class="label-chip label-chip-sm" style="background:${l.color}">${esc(l.name)}</span>`)
    .join('');

  el.innerHTML =
    `<div class="wi-top">` +
      `<span class="key-pill">${esc(item.key)}</span>` +
      `<span class="type-badge type-${item.item_type}">${Logic.ITEM_TYPE_LABEL[item.item_type]}</span>` +
    `</div>` +
    `<p class="card-title">${esc(item.title)}</p>` +
    (labelChips ? `<div class="card-labels">${labelChips}</div>` : '') +
    `<div class="card-meta">${parentChip}${who}</div>`;

  el.addEventListener('click', () => openWorkItemModal(item.id));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWorkItemModal(item.id); }
  });
  return el;
}

function addWorkItemControl(status) {
  const wrap = document.createElement('div');
  const btn = document.createElement('button');
  btn.className = 'add-card';
  btn.type = 'button';
  btn.textContent = '+ Add work item';
  wrap.appendChild(btn);

  btn.addEventListener('click', async () => {
    let members = [];
    try { members = await Store.listMembers(boardState.projectId); } catch (err) { /* proceed without user_picker options */ }
    let allLabels = [];
    try { allLabels = await Store.listLabels(); } catch (err) { /* proceed without autocomplete */ }

    const form = document.createElement('form');
    form.className = 'add-wi-form';
    form.innerHTML =
      `<select name="item_type" aria-label="Type">${
        Logic.ITEM_TYPES.map(t => `<option value="${t}">${Logic.ITEM_TYPE_LABEL[t]}</option>`).join('')
      }</select>` +
      `<input name="title" placeholder="What needs doing?" aria-label="Title">` +
      `<select name="parent" aria-label="Parent"><option value="">No parent</option></select>` +
      `<div class="cf-grid" data-cf-container></div>` +
      `<div data-labels-container></div>` +
      `<p class="form-error" data-error hidden></p>` +
      `<button class="btn btn-primary" type="submit">Add</button>`;
    wrap.replaceChildren(form);

    const typeSelect = form.querySelector('[name=item_type]');
    const parentSelect = form.querySelector('[name=parent]');
    const titleInput = form.querySelector('[name=title]');
    const cfContainer = form.querySelector('[data-cf-container]');
    const labelInput = labelChipInput([], allLabels);
    form.querySelector('[data-labels-container]').replaceChildren(labelInput.el);
    titleInput.focus();

    // Attached synchronously, right after the form enters the DOM — the
    // remaining setup below awaits (screen fields), and the form is
    // interactive the moment it's visible, so the submit handler must be
    // live before that gap or a real submit falls through to the browser's
    // native (page-navigating) form submission instead of this handler.
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!titleInput.value.trim()) return;
      const errorEl = form.querySelector('[data-error]');
      errorEl.hidden = true;
      clearCustomFieldErrors(form);
      const payload = {
        board: boardState.boardId, item_type: typeSelect.value, title: titleInput.value,
        parent: parentSelect.value || null, status, labels: labelInput.getNames(),
      };
      if (currentScreen && currentScreen.fields.length) {
        payload.custom_fields = readCustomFieldInputs(form, currentScreen.fields);
      }
      try {
        await Store.createWorkItem(payload);
        await reloadBoard();
      } catch (err) {
        if (err.field === 'custom_fields') {
          applyCustomFieldErrors(form, err.errors);
        } else {
          errorEl.textContent = errorText(err);
          errorEl.hidden = false;
        }
      }
    });

    function refreshParentOptions() {
      const type = typeSelect.value;
      parentSelect.innerHTML = '<option value="">No parent</option>';
      if (!Logic.canHaveParent(type)) { parentSelect.disabled = true; return; }
      parentSelect.disabled = false;
      const items = boardState.buckets ? Object.values(boardState.buckets).flat() : [];
      const candidates = items.filter(i => Logic.VALID_PARENT_TYPES[type].includes(i.item_type));
      candidates.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.key} — ${c.title}`;
        parentSelect.appendChild(opt);
      });
      if (Logic.requiresParent(type) && candidates.length) parentSelect.value = candidates[0].id;
    }
    typeSelect.addEventListener('change', refreshParentOptions);
    refreshParentOptions();

    let currentScreen = null;
    async function refreshCustomFields() {
      try { currentScreen = await Store.getScreenForItemType(boardState.projectId, typeSelect.value); }
      catch (err) { currentScreen = null; }
      const rows = currentScreen ? currentScreen.fields : [];
      cfContainer.innerHTML = rows.length ? customFieldControls(rows, null, members) : '';
      bindChipChecks(cfContainer);
    }
    typeSelect.addEventListener('change', refreshCustomFields);
    await refreshCustomFields();

    const cancel = () => { if (!titleInput.value.trim()) wrap.replaceChildren(btn); };
    titleInput.addEventListener('blur', () => setTimeout(cancel, 150));
  });

  return wrap;
}

/* Work item detail modal -------------------------------------------------- */

async function openWorkItemModal(itemId) {
  let item, users, projectComponents, boardItems, members, allLabels;
  try {
    [item, users, projectComponents, boardItems, members, allLabels] = await Promise.all([
      Store.getWorkItem(itemId),
      Store.listUsers(),
      Store.listComponents(boardState.projectId),
      Store.listBoardWorkItems(boardState.boardId),
      Store.listMembers(boardState.projectId),
      Store.listLabels(),
    ]);
  } catch (err) { return handle(err); }

  let screen = null;
  try { screen = await Store.getScreenForItemType(boardState.projectId, item.item_type); }
  catch (err) { screen = null; }
  const screenRows = screen ? screen.fields : [];
  const screenFieldIds = new Set(screenRows.map(r => r.field.id));
  const orphanedDetails = (item.custom_field_details || []).filter(d => !screenFieldIds.has(d.field.id));

  const customFieldsHtml = screenRows.length
    ? `<div class="custom-fields-block">
        <h2>Custom fields</h2>
        <div class="cf-grid">${customFieldControls(screenRows, item.custom_fields, members)}</div>
      </div>`
    : '';
  const orphanedHtml = orphanedDetails.length
    ? `<div class="custom-fields-block">
        <h2>Other saved values</h2>
        <ul class="cf-orphan-list">${orphanedDetails.map(d =>
          `<li><span>${esc(d.field.name)}</span><span>${esc(d.display)}</span></li>`
        ).join('')}</ul>
      </div>`
    : '';

  const assigneeOptions = users.map(u =>
    `<option value="${u.id}" ${item.assignee === u.id ? 'selected' : ''}>${esc(u.display_name)}</option>`
  ).join('');

  const componentChips = projectComponents.map(c => {
    const checked = item.component_ids.includes(c.id);
    return `<label class="chip-check ${checked ? 'is-checked' : ''}">` +
      `<input type="checkbox" value="${c.id}" ${checked ? 'checked' : ''}>${esc(c.name)}</label>`;
  }).join('');

  const childrenHtml = item.children.length
    ? `<ul class="children-list">${item.children.map(c =>
        `<li><a href="#" data-open-item="${c.id}"><span class="key-pill">${esc(c.key)}</span> ${esc(c.title)}</a>` +
        `<span class="status-tag">${c.status_detail ? esc(c.status_detail.name) : ''}</span></li>`
      ).join('')}</ul>`
    : `<p class="empty-inline">No children yet.</p>`;

  const showParentField = Logic.canHaveParent(item.item_type);
  const parentOptions = showParentField
    ? boardItems
        .filter(i => i.id !== item.id && Logic.VALID_PARENT_TYPES[item.item_type].includes(i.item_type))
        .map(i => `<option value="${i.id}" ${item.parent === i.id ? 'selected' : ''}>${esc(i.key)} — ${esc(i.title)}</option>`)
        .join('')
    : '';

  const body = `
    <div class="modal-head">
      <p class="eyebrow">${esc(item.key)} · <span class="type-badge type-${item.item_type}">${Logic.ITEM_TYPE_LABEL[item.item_type]}</span></p>
      <button class="btn btn-quiet" data-close>Close</button>
    </div>
    <input class="modal-title" name="title" value="${esc(item.title)}" aria-label="Title">
    <label class="field">
      <span>Description</span>
      <textarea name="description" placeholder="What does done look like?">${esc(item.description)}</textarea>
    </label>
    <div class="grid-3">
      <label class="field">
        <span>Status</span>
        <select name="status">${(boardState.statuses || []).map(s =>
          `<option value="${s.id}" ${item.status === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      </label>
      <label class="field">
        <span>Priority</span>
        <select name="priority">
          <option value="1" ${item.priority === 1 ? 'selected' : ''}>Low</option>
          <option value="2" ${item.priority === 2 ? 'selected' : ''}>Medium</option>
          <option value="3" ${item.priority === 3 ? 'selected' : ''}>High</option>
        </select>
      </label>
      <label class="field">
        <span>Assignee</span>
        <select name="assignee"><option value="">Unassigned</option>${assigneeOptions}</select>
      </label>
    </div>
    <div class="grid-2">
      <label class="field">
        <span>Due</span>
        <input type="date" name="due_date" value="${item.due_date || ''}">
      </label>
      ${showParentField ? `
      <label class="field">
        <span>Parent ${Logic.requiresParent(item.item_type) ? '(required)' : ''}</span>
        <select name="parent"><option value="">No parent</option>${parentOptions}</select>
      </label>` : '<div></div>'}
    </div>
    ${customFieldsHtml}
    ${orphanedHtml}
    <p class="form-error" data-error hidden></p>
    <div class="modal-actions">
      <button class="btn btn-primary" data-save>Save changes</button>
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-danger" data-delete>Delete</button>
    </div>

    <div class="components-block">
      <h2>Components</h2>
      <div class="chip-check-list">${componentChips || '<p class="empty-inline">No components on this project yet.</p>'}</div>
    </div>

    <div class="labels-block">
      <h2>Labels</h2>
      <div data-labels-container></div>
    </div>

    <div class="children-block">
      <h2>Children</h2>
      ${childrenHtml}
    </div>

    <div class="links-block">
      <h2>Related items</h2>
      <ul class="link-list" data-links><li class="loading">Loading…</li></ul>
      <button class="btn" type="button" data-add-link>+ Link an item</button>
    </div>`;

  const { modal, close } = openModal(body);
  const errorEl = modal.querySelector('[data-error]');

  const labelInput = labelChipInput((item.labels_detail || []).map(l => l.name), allLabels);
  modal.querySelector('[data-labels-container]').replaceChildren(labelInput.el);

  modal.querySelectorAll('.chip-check').forEach(chip => {
    const input = chip.querySelector('input');
    input.addEventListener('change', () => chip.classList.toggle('is-checked', input.checked));
  });

  modal.querySelectorAll('[data-open-item]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const childId = Number(a.dataset.openItem);
      close();
      openWorkItemModal(childId);
    });
  });

  modal.querySelector('[data-save]').addEventListener('click', async () => {
    errorEl.hidden = true;
    clearCustomFieldErrors(modal);
    const componentIds = Array.from(modal.querySelectorAll('.components-block .chip-check input:checked')).map(i => Number(i.value));
    const parentSelect = modal.querySelector('[name=parent]');
    const fields = {
      title: modal.querySelector('[name=title]').value,
      description: modal.querySelector('[name=description]').value,
      status: modal.querySelector('[name=status]').value,
      priority: Number(modal.querySelector('[name=priority]').value),
      due_date: modal.querySelector('[name=due_date]').value || null,
      assignee: modal.querySelector('[name=assignee]').value || null,
      component_ids: componentIds,
      labels: labelInput.getNames(),
    };
    if (parentSelect) fields.parent = parentSelect.value || null;
    if (screenRows.length) fields.custom_fields = readCustomFieldInputs(modal, screenRows);
    try {
      await Store.updateWorkItem(item.id, fields);
      close();
      await reloadBoard();
      toast('Saved');
    } catch (err) {
      if (err.field === 'custom_fields') {
        applyCustomFieldErrors(modal, err.errors);
      } else {
        errorEl.textContent = errorText(err);
        errorEl.hidden = false;
      }
    }
  });

  modal.querySelector('[data-delete]').addEventListener('click', async () => {
    try {
      await Store.deleteWorkItem(item.id);
      close();
      await reloadBoard();
      toast('Deleted — any children were kept, just unlinked from it');
    } catch (err) { handle(err); }
  });

  loadLinks(item, modal);
  modal.querySelector('[data-add-link]').addEventListener('click', () => openLinkModal(item, modal));
}

async function loadLinks(item, modal) {
  const list = modal.querySelector('[data-links]');
  try {
    const links = await Store.listLinks(item.id);
    if (!links.length) {
      list.innerHTML = '<li class="empty-inline">No related items yet.</li>';
      return;
    }
    const rows = links.map(link => {
      const other = link.item_a === item.id ? link.item_b_detail : link.item_a_detail;
      const li = document.createElement('li');
      li.className = 'link-row';
      li.innerHTML =
        `<span class="key-pill">${esc(other.key)}</span>` +
        `<span class="link-title">${esc(other.title)}</span>` +
        `<button class="btn btn-danger" data-unlink>Remove</button>`;
      li.querySelector('[data-unlink]').addEventListener('click', async () => {
        try {
          await Store.deleteLink(link.id);
          loadLinks(item, modal);
        } catch (err) { handle(err); }
      });
      return li;
    });
    list.replaceChildren(...rows);
  } catch (err) {
    list.innerHTML = '';
    handle(err);
  }
}

async function openLinkModal(item, parentModal) {
  let candidates;
  try {
    const boardItems = await Store.listBoardWorkItems(item.board);
    candidates = boardItems.filter(i => i.id !== item.id);
  } catch (err) { return handle(err); }

  const body = !candidates.length
    ? `<div class="modal-head"><p class="eyebrow">Link ${esc(item.key)}</p><button class="btn btn-quiet" data-close>Close</button></div>
       <p class="empty">No other items on this board to link to yet.</p>`
    : `<div class="modal-head"><p class="eyebrow">Link ${esc(item.key)}</p><button class="btn btn-quiet" data-close>Close</button></div>
       <label class="field"><span>Item</span><select name="target">${
         candidates.map(c => `<option value="${c.id}">${esc(c.key)} — ${esc(c.title)}</option>`).join('')
       }</select></label>
       <p class="form-error" data-error hidden></p>
       <div class="modal-actions"><button class="btn btn-primary" data-send>Link</button><button class="btn" data-close>Cancel</button></div>`;

  const { modal, close } = openModal(body);
  const sendBtn = modal.querySelector('[data-send]');
  if (!sendBtn) return;

  sendBtn.addEventListener('click', async () => {
    const errorEl = modal.querySelector('[data-error]');
    const targetId = modal.querySelector('[name=target]').value;
    try {
      await Store.createLink(item.id, Number(targetId));
      close();
      toast('Linked');
      loadLinks(item, parentModal);
    } catch (err) {
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
    }
  });
}

boot();
