/* Tasky — the production UI.
   Views, routing and wiring. All business rules live in logic.js; all data
   access goes through one interface, so swapping the mock store for the real
   API is a one-line change. */

/* Data source. The live API by default; append ?data=store to any URL to run
   the seeded mock instead, which is how the UI is reviewed without a
   database. `boot` falls back to the mock automatically if the API cannot be
   reached at all, so opening this file off a bare static server still works. */
const FORCED = new URLSearchParams(location.search).get('data');
let data = FORCED === 'store' ? Store : Api;
const usingMock = () => data === Store;

const root = document.getElementById('root');
const tpl = (id) => document.getElementById(id).content.cloneNode(true);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const outlet = () => root.querySelector('[data-main]');

let me = null;
let usersCache = null;

/* Toast ---------------------------------------------------------------- */

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
    setTimeout(() => t.remove(), 200);
  }, 2800);
}

/* DRF hands back either {"detail": "..."} or {"field": ["...", ...]} — take
   whichever message is there rather than showing a bare status code. */
function errorText(err) {
  if (!err) return 'Something went wrong.';
  if (err.data && typeof err.data === 'object') {
    const first = Object.values(err.data)[0];
    if (first !== undefined) return Array.isArray(first) ? String(first[0]) : String(first);
  }
  if (err.status === undefined) return 'Cannot reach the server. Check your connection.';
  return err.message || 'Something went wrong.';
}

/* Handles a failure uniformly: an expired session sends you back to sign in,
   anything else is reported where you are. A 403 is NOT automatically a
   logout — it is just as likely to mean "you may not delete that comment"
   or "you are not a member of that project". */
function handle(err) {
  if (err && err.sessionExpired) {
    me = null;
    toast('Your session expired. Sign in again.', true);
    renderLogin();
    return;
  }
  toast(errorText(err), true);
}

/* Loading, empty and error states -------------------------------------- */

function skeletonList(count, tall) {
  return `<li class="skeleton-wrap"><ul class="skeleton-list">${
    Array.from({ length: count }, () => `<li class="skeleton-row${tall ? ' tall' : ''}"></li>`).join('')
  }</ul></li>`;
}

/* Staggers a NodeList's entrance so rows settle in rather than popping in as
   one block — capped so a long list doesn't feel sluggish to arrive. */
function stagger(nodes) {
  nodes.forEach((el, i) => { el.style.animationDelay = `${Math.min(i, 8) * 28}ms`; });
}

/* A real error state, not an empty list: says what failed and offers the one
   action that might fix it. */
function errorState(container, err, retry) {
  const wrap = document.createElement('li');
  wrap.className = 'error-state';
  wrap.innerHTML = `<p class="error-state-msg">${esc(errorText(err))}</p>`;
  if (retry) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = 'Try again';
    btn.addEventListener('click', retry);
    wrap.appendChild(btn);
  }
  container.replaceChildren(wrap);
}

/* Boot ----------------------------------------------------------------- */

function showMockBadge() {
  if (document.querySelector('.mock-badge')) return;
  const b = document.createElement('div');
  b.className = 'mock-badge';
  b.textContent = 'Mock data';
  b.title = 'No backend reachable — running on the seeded store.';
  document.body.appendChild(b);
}

async function boot() {
  try {
    await data.getCsrf();
  } catch (err) {
    /* An HTTP status means the API answered, so keep using it. No status at
       all means the request never reached a server — fall back to the mock so
       the UI stays reviewable instead of showing a dead screen. */
    if (!err || err.status === undefined) {
      data = Store;
      await data.getCsrf();
    }
  }
  if (usingMock()) showMockBadge();

  try {
    me = await data.getMe();
    renderShell();
  } catch {
    renderLogin();                                  // 403 means "not signed in"
  }
}

/* Login ---------------------------------------------------------------- */

function renderLogin() {
  root.replaceChildren(tpl('tpl-login'));
  const form = root.querySelector('form');
  const errorEl = form.querySelector('[data-error]');

  // The demo credentials only exist in the mock store.
  if (!usingMock()) form.querySelector('.login-hint').remove();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    errorEl.hidden = true;
    try {
      me = await data.login(form.username.value, form.password.value);
      renderShell();
    } catch (err) {
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });
}

/* Shell + routing ------------------------------------------------------ */

function renderShell() {
  root.replaceChildren(tpl('tpl-shell'));
  root.querySelector('[data-who]').textContent = me.display_name || me.username;
  root.querySelector('[data-signout]').addEventListener('click', async () => {
    try { await data.logout(); } catch { /* signing out locally regardless */ }
    me = null;
    usersCache = null;
    location.hash = '';
    renderLogin();
  });
  route();
}

function setActiveNav(name) {
  root.querySelectorAll('[data-nav]').forEach(a => {
    a.classList.toggle('is-active', a.dataset.nav === name);
  });
}

/* Hash routes. Boards live under their owning project, so a board's URL
   names both — `#/projects/3/boards/7`. `#/boards/7` still resolves: it
   looks the board up and rewrites the hash to the canonical form, which is
   what old links and the My tasks list both rely on. */
async function route() {
  if (!me) return;
  const hash = location.hash.replace(/^#/, '') || '/projects';

  let m = hash.match(/^\/projects\/(\d+)\/boards\/(\d+)$/);
  if (m) { setActiveNav('projects'); return viewBoard(Number(m[1]), Number(m[2])); }

  m = hash.match(/^\/projects\/(\d+)$/);
  if (m) { setActiveNav('projects'); return viewProject(Number(m[1])); }

  m = hash.match(/^\/boards\/(\d+)$/);
  if (m) { setActiveNav('projects'); return resolveBoard(Number(m[1])); }

  if (hash === '/my-tasks') { setActiveNav('my-tasks'); return viewMyTasks(); }

  setActiveNav('projects');
  viewProjects();
}

window.addEventListener('hashchange', route);

async function resolveBoard(boardId) {
  const main = outlet();
  main.innerHTML = '<p class="loading">Opening board…</p>';
  try {
    const board = await data.getBoard(boardId);
    location.replace(`#/projects/${board.project}/boards/${board.id}`);
  } catch (err) {
    handle(err);
    location.replace('#/projects');
  }
}

/* Projects ------------------------------------------------------------- */

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

function invitationRow(invite) {
  const li = document.createElement('li');
  li.className = 'invite-row';
  const by = invite.invited_by_detail;
  li.innerHTML =
    `<span class="who">${esc(invite.project_detail.name)} ` +
      `<span class="key-pill">${esc(invite.project_detail.key)}</span>` +
      `<span class="sub">Invited by ${esc(by ? (by.display_name || by.username) : 'a former teammate')}</span>` +
    `</span>` +
    `<span class="actions">` +
      `<button class="btn btn-primary" data-accept>Accept</button>` +
      `<button class="btn btn-quiet" data-decline>Decline</button>` +
    `</span>`;

  const respond = async (fn, message) => {
    li.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      await fn(invite.id);
      toast(message);
      viewProjects();
    } catch (err) {
      li.querySelectorAll('button').forEach(b => { b.disabled = false; });
      handle(err);
    }
  };
  li.querySelector('[data-accept]').addEventListener('click', () => respond(data.acceptInvitation, 'Invitation accepted'));
  li.querySelector('[data-decline]').addEventListener('click', () => respond(data.declineInvitation, 'Invitation declined'));
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
    `<span class="role-badge role-${esc(project.my_role)}">${esc(Logic.ROLE_LABEL[project.my_role] || '—')}</span>` +
    `<span class="tally mono">${project.member_count} member${project.member_count === 1 ? '' : 's'}</span>`;
  li.appendChild(a);
  return li;
}

/* Project detail ------------------------------------------------------- */

async function viewProject(projectId) {
  const main = outlet();
  main.replaceChildren(tpl('tpl-project'));
  main.querySelector('[data-boards]').innerHTML = skeletonList(2);
  main.querySelector('[data-components]').innerHTML = skeletonList(2);
  main.querySelector('[data-members]').innerHTML = skeletonList(3);

  let project, myProjects;
  try {
    [project, myProjects] = await Promise.all([
      data.getProject(projectId),
      data.listProjects(),
    ]);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    handle(err);
    location.replace('#/projects');
    return;
  }

  main.querySelector('[data-project-name]').textContent = project.name;
  main.querySelector('[data-project-key]').textContent = project.key;
  const desc = main.querySelector('[data-project-desc]');
  if (project.description) desc.textContent = project.description; else desc.remove();

  const roleBadge = main.querySelector('[data-my-role]');
  roleBadge.textContent = Logic.ROLE_LABEL[project.my_role] || '—';
  roleBadge.classList.add(`role-${project.my_role}`);

  const switcher = main.querySelector('[data-switcher]');
  switcher.replaceChildren(...myProjects.map(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.key})`;
    if (p.id === Number(projectId)) opt.selected = true;
    return opt;
  }));
  switcher.addEventListener('change', () => { location.hash = `#/projects/${switcher.value}`; });

  renderProjectActions(main, project);
  renderBoards(main, project);
  renderComponents(main, project);
  renderMembers(main, project);
}

function renderProjectActions(main, project) {
  const actions = main.querySelector('[data-actions]');
  actions.replaceChildren();
  const role = project.my_role;

  const add = (label, className, onClick) => {
    const btn = document.createElement('button');
    btn.className = className;
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    actions.appendChild(btn);
    return btn;
  };

  if (Logic.canInvite(role)) add('Invite', 'btn', () => openInviteModal(project));
  if (Logic.canTransferOwnership(role)) add('Transfer ownership', 'btn', () => openTransferModal(project));

  /* No "Leave" for the Owner: the API rejects it with 400 until ownership has
     been transferred, so offering the button would only ever be a dead end. */
  if (Logic.canLeave(role)) {
    add('Leave project', 'btn btn-quiet', async () => {
      if (!confirm(`Leave ${project.name}? You'll need a new invitation to come back.`)) return;
      try {
        await data.removeMember(project.id, me.id);
        toast('You left the project');
        location.hash = '#/projects';
      } catch (err) { handle(err); }
    });
  }
  if (Logic.canDeleteProject(role)) {
    add('Delete project', 'btn btn-danger', async () => {
      if (!confirm(`Delete ${project.name}? Its boards, work items and comments go with it. This cannot be undone.`)) return;
      try {
        await data.deleteProject(project.id);
        toast('Project deleted');
        location.hash = '#/projects';
      } catch (err) { handle(err); }
    });
  }
}

async function renderBoards(main, project) {
  const list = main.querySelector('[data-boards]');
  const form = main.querySelector('[data-create-board]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('[name=name]');
    const btn = e.target.querySelector('button');
    if (!input.value.trim()) return;
    btn.disabled = true;
    try {
      const board = await data.createBoard({ project: project.id, name: input.value });
      input.value = '';
      location.hash = `#/projects/${project.id}/boards/${board.id}`;
    } catch (err) {
      handle(err);
    } finally {
      btn.disabled = false;
    }
  });

  try {
    const boards = await data.listBoards(project.id);
    if (!boards.length) {
      list.innerHTML = '<li class="empty">No boards yet. Name one above to get started.</li>';
      return;
    }
    const rows = boards.map(b => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'board-row';
      a.href = `#/projects/${project.id}/boards/${b.id}`;
      a.innerHTML =
        `<span class="name">${esc(b.name)}</span>` +
        (b.description ? `<span class="desc">${esc(b.description)}</span>` : '');
      li.appendChild(a);
      return li;
    });
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, () => renderBoards(main, project));
  }
}

/* Components ----------------------------------------------------------- */

async function renderComponents(main, project) {
  const list = main.querySelector('[data-components]');
  const form = main.querySelector('[data-create-component]');
  const note = main.querySelector('[data-component-note]');
  const canManage = Logic.canManageComponents(project.my_role);

  note.textContent = canManage
    ? 'Applied to work items in this project. You can add, rename and delete them.'
    : 'Applied to work items in this project. Owner and Admins manage the list.';

  /* This function re-runs itself after every add and delete, so the submit
     handler is attached once and only once. */
  if (!form.dataset.wired) {
    form.dataset.wired = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.querySelector('[name=name]');
      const btn = e.target.querySelector('button');
      if (!input.value.trim()) return;
      btn.disabled = true;
      try {
        await data.createComponent(project.id, input.value);
        input.value = '';
        toast('Component added');
        await renderComponents(main, project);
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
    const items = await data.listComponents(project.id);
    if (!items.length) {
      list.innerHTML = canManage
        ? '<li class="empty">No components yet. Add one above — Frontend, Backend, Docs.</li>'
        : '<li class="empty">No components yet. An Owner or Admin can add them.</li>';
      return;
    }
    const rows = items.map(c => componentRow(c, main, project));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, () => renderComponents(main, project));
  }
}

function componentRow(component, main, project) {
  const li = document.createElement('li');
  li.className = 'component-row';
  const canManage = Logic.canManageComponents(project.my_role);

  li.innerHTML =
    `<span class="who"${canManage ? ' contenteditable="true" role="textbox" aria-label="Component name" data-rename' : ''}>${esc(component.name)}</span>` +
    (canManage ? `<span class="actions"><button class="btn btn-danger" type="button" data-remove>Delete</button></span>` : '');

  const nameEl = li.querySelector('[data-rename]');
  if (nameEl) {
    nameEl.addEventListener('blur', async () => {
      const value = nameEl.textContent.trim();
      if (!value || value === component.name) { nameEl.textContent = component.name; return; }
      try {
        await data.renameComponent(project.id, component.id, value);
        component.name = value;
        toast('Component renamed');
      } catch (err) {
        nameEl.textContent = component.name;
        handle(err);
      }
    });
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
      if (e.key === 'Escape') { nameEl.textContent = component.name; nameEl.blur(); }
    });
  }

  const removeBtn = li.querySelector('[data-remove]');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      if (!confirm(`Delete the "${component.name}" component? It comes off every work item using it.`)) return;
      try {
        await data.deleteComponent(project.id, component.id);
        toast('Component deleted');
        await renderComponents(main, project);
      } catch (err) { handle(err); }
    });
  }
  return li;
}

/* Members -------------------------------------------------------------- */

async function renderMembers(main, project) {
  const list = main.querySelector('[data-members]');
  try {
    const members = await data.listMembers(project.id);
    const rows = members.map(m => memberRow(m, main, project));
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, () => renderMembers(main, project));
  }
}

function memberRow(member, main, project) {
  const li = document.createElement('li');
  li.className = 'member-row';
  const user = member.user_detail || {};
  const isMe = me && user.id === me.id;
  const myRole = project.my_role;

  let controls = '';
  if (Logic.canChangeRole(myRole) && member.role !== 'owner') {
    controls +=
      `<select class="role-select" data-role-select aria-label="Role for ${esc(user.username)}">` +
        `<option value="member"${member.role === 'member' ? ' selected' : ''}>Member</option>` +
        `<option value="admin"${member.role === 'admin' ? ' selected' : ''}>Admin</option>` +
      `</select>`;
  }
  if (Logic.canRemove(myRole, member.role) && !isMe) {
    controls += `<button class="btn btn-danger" type="button" data-remove>Remove</button>`;
  }

  li.innerHTML =
    `<span class="who">${esc(user.display_name || user.username)}${isMe ? ' (you)' : ''} ` +
      `<span class="sub">@${esc(user.username)}</span></span>` +
    `<span class="role-badge role-${esc(member.role)}">${esc(Logic.ROLE_LABEL[member.role])}</span>` +
    `<span class="actions">${controls}</span>`;

  const roleSelect = li.querySelector('[data-role-select]');
  if (roleSelect) {
    const previous = member.role;
    roleSelect.addEventListener('change', async () => {
      try {
        await data.changeRole(project.id, user.id, roleSelect.value);
        toast('Role updated');
        await renderMembers(main, project);
      } catch (err) {
        roleSelect.value = previous;
        handle(err);
      }
    });
  }

  const removeBtn = li.querySelector('[data-remove]');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      if (!confirm(`Remove ${user.display_name || user.username} from ${project.name}?`)) return;
      try {
        await data.removeMember(project.id, user.id);
        toast('Member removed');
        await renderMembers(main, project);
      } catch (err) { handle(err); }
    });
  }

  return li;
}

/* Modals — a shared open/close lifecycle so every dialog animates the same
   way and Escape/backdrop-click always behave the same. Modals nest (the
   work item modal opens a link picker on top of itself), so Escape only ever
   closes the topmost one. ---------------------------------------------- */

const modalStack = [];

function openModal(bodyHtml, opts) {
  const wide = opts && opts.wide;
  const restoreFocus = document.activeElement;

  const scrim = document.createElement('div');
  scrim.className = 'scrim';

  const modal = document.createElement('div');
  modal.className = 'modal' + (wide ? ' modal-wide' : '');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = bodyHtml;

  scrim.appendChild(modal);
  document.body.appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add('is-open'));

  function close() {
    const idx = modalStack.indexOf(close);
    if (idx === -1) return;                       // already closing
    modalStack.splice(idx, 1);
    scrim.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => scrim.remove(), 200);
    if (restoreFocus && restoreFocus.focus && document.contains(restoreFocus)) {
      restoreFocus.focus();
    }
  }
  function onKey(e) {
    if (e.key === 'Escape' && modalStack[modalStack.length - 1] === close) {
      e.stopPropagation();
      close();
    }
  }

  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey);
  modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));

  modalStack.push(close);

  const first = modal.querySelector('input, select, textarea');
  if (first) requestAnimationFrame(() => first.focus());

  return { modal, close };
}

function modalHead(eyebrowHtml) {
  return `<div class="modal-head"><p class="eyebrow">${eyebrowHtml}</p>` +
         `<button class="btn btn-quiet" type="button" data-close>Close</button></div>`;
}

async function cachedUsers() {
  if (!usersCache) {
    try { usersCache = await data.listUsers(); } catch { usersCache = []; }
  }
  return usersCache;
}

async function openInviteModal(project) {
  let candidates;
  try {
    /* There is no "who can I invite" endpoint, so the list is every account
       minus the people already in the project. Someone with an invitation
       still pending is not filterable from here — the API answers that with
       "Already invited — waiting on a response", shown in the modal. */
    const [users, members] = await Promise.all([cachedUsers(), data.listMembers(project.id)]);
    const memberIds = new Set(members.map(m => m.user_detail && m.user_detail.id));
    candidates = users.filter(u => !memberIds.has(u.id));
  } catch (err) { return handle(err); }

  const head = modalHead(`Invite to ${esc(project.key)}`);
  const body = !candidates.length
    ? head + `<p class="empty">Everyone with an account is already a member of this project.</p>`
    : head +
      `<label class="field"><span>Person</span><select name="user">${
        candidates.map(u => `<option value="${u.id}">${esc(u.display_name || u.username)} (@${esc(u.username)})</option>`).join('')
      }</select></label>` +
      `<p class="form-error" data-error hidden></p>` +
      `<div class="modal-actions"><button class="btn btn-primary" type="button" data-send>Send invite</button>` +
      `<button class="btn" type="button" data-close>Cancel</button></div>`;

  const { modal, close } = openModal(body);
  const sendBtn = modal.querySelector('[data-send]');
  if (!sendBtn) return;

  sendBtn.addEventListener('click', async () => {
    const errorEl = modal.querySelector('[data-error]');
    errorEl.hidden = true;
    sendBtn.disabled = true;
    try {
      await data.inviteMember(project.id, Number(modal.querySelector('[name=user]').value));
      close();
      toast('Invitation sent');
    } catch (err) {
      if (err && err.sessionExpired) { close(); return handle(err); }
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
      sendBtn.disabled = false;
    }
  });
}

async function openTransferModal(project) {
  let admins;
  try {
    admins = (await data.listMembers(project.id)).filter(m => m.role === 'admin');
  } catch (err) { return handle(err); }

  const head = modalHead('Transfer ownership');
  const body = !admins.length
    ? head + `<p class="empty">There's no Admin to transfer to yet. Promote a member to Admin first.</p>`
    : head +
      `<p class="page-sub modal-note">You'll become an Admin. This can't be undone from here.</p>` +
      `<label class="field"><span>New owner</span><select name="user">${
        admins.map(m => `<option value="${m.user_detail.id}">${esc(m.user_detail.display_name || m.user_detail.username)} (@${esc(m.user_detail.username)})</option>`).join('')
      }</select></label>` +
      `<p class="form-error" data-error hidden></p>` +
      `<div class="modal-actions"><button class="btn btn-primary" type="button" data-send>Transfer</button>` +
      `<button class="btn" type="button" data-close>Cancel</button></div>`;

  const { modal, close } = openModal(body);
  const sendBtn = modal.querySelector('[data-send]');
  if (!sendBtn) return;

  sendBtn.addEventListener('click', async () => {
    const errorEl = modal.querySelector('[data-error]');
    errorEl.hidden = true;
    sendBtn.disabled = true;
    try {
      await data.transferOwnership(project.id, Number(modal.querySelector('[name=user]').value));
      close();
      toast('Ownership transferred');
      viewProject(project.id);
    } catch (err) {
      if (err && err.sessionExpired) { close(); return handle(err); }
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
      sendBtn.disabled = false;
    }
  });
}

/* Board ---------------------------------------------------------------- */

let boardState = { projectId: null, boardId: null, buckets: null, statuses: [], components: [] };

// Real column names aren't known until the project's statuses are fetched,
// so the skeleton just shows generic placeholders while that's in flight.
function skeletonColumns() {
  return Array.from({ length: 3 }, () =>
    `<section class="column"><div class="column-head">` +
      `<span class="dot"></span><span class="label">&nbsp;</span>` +
    `</div><ul class="skeleton-list">${
      Array.from({ length: 3 }, () => '<li class="skeleton-row tall"></li>').join('')
    }</ul></section>`
  ).join('');
}

async function viewBoard(projectId, boardId) {
  const main = outlet();
  main.replaceChildren(tpl('tpl-board'));
  boardState = { projectId: Number(projectId), boardId: Number(boardId), buckets: null, statuses: [], components: [] };

  main.querySelector('[data-back-link]').href = `#/projects/${projectId}`;
  main.querySelector('[data-type-legend]').innerHTML = Logic.ITEM_TYPES.map(t =>
    `<span class="legend-item"><i class="type-dot type-${t}"></i>${Logic.ITEM_TYPE_LABEL[t]}</span>`
  ).join('');

  const columnsEl = main.querySelector('[data-columns]');
  columnsEl.innerHTML = skeletonColumns();

  try {
    const [board, project, items, statuses] = await Promise.all([
      data.getBoard(boardId),
      data.getProject(projectId),
      data.getBoardWorkItems(boardId),
      data.listStatuses(projectId),
    ]);

    main.querySelector('[data-board-name]').textContent = board.name;
    main.querySelector('[data-board-project]').textContent = project.key;
    main.querySelector('[data-back-link]').textContent = project.name;
    const desc = main.querySelector('[data-board-desc]');
    if (board.description) desc.textContent = board.description; else desc.remove();

    /* Cached for the work item modal's component checklist — the whole board
       shares one project, so this is fetched once per board visit. */
    try { boardState.components = await data.listComponents(projectId); } catch { boardState.components = []; }

    boardState.statuses = statuses;
    boardState.buckets = Logic.groupByStatus(items, statuses);
    paintColumns();
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    columnsEl.innerHTML = '';
    const holder = document.createElement('ul');
    holder.className = 'board-error';
    columnsEl.appendChild(holder);
    errorState(holder, err, () => viewBoard(projectId, boardId));
  }
}

async function reloadBoard() {
  const items = await data.getBoardWorkItems(boardState.boardId);
  boardState.buckets = Logic.groupByStatus(items, boardState.statuses);
  paintColumns();
}

function boardItems() {
  if (!boardState.buckets) return [];
  return Object.values(boardState.buckets).flat();
}

function paintColumns(buckets) {
  if (buckets) boardState.buckets = buckets;
  const columnsEl = root.querySelector('[data-columns]');
  if (!columnsEl) return;
  columnsEl.replaceChildren(...boardState.statuses.map(s => columnEl(s, boardState.buckets[s.id] || [])));
}

// `status` is a WorkItemStatus row ({id, name, category}) — several statuses
// can share a category (see Logic/docs/api.md), so visual treatment keys off
// `status.category`, never off `status.name`.
function columnEl(status, items) {
  const col = document.createElement('section');
  col.className = 'column';
  if (status.category === 'in_progress') col.classList.add('column-active');
  if (status.category === 'done') col.classList.add('column-done');
  col.dataset.status = status.id;

  const head = document.createElement('div');
  head.className = 'column-head';
  head.innerHTML =
    `<span class="dot"></span>` +
    `<span class="label">${esc(status.name)}</span>` +
    `<span class="count">${items.length}</span>`;
  col.appendChild(head);

  const stack = document.createElement('div');
  stack.className = 'stack';
  stack.dataset.stack = '';
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'column-empty';
    empty.textContent = status.category === 'done' ? 'Nothing finished yet.' : 'Nothing here — drop one in.';
    stack.appendChild(empty);
  }
  items.forEach(item => stack.appendChild(workItemCard(item)));
  col.appendChild(stack);

  col.appendChild(addWorkItemControl(status.id));
  wireDrop(col, stack, status.id);
  return col;
}

function workItemCard(item) {
  const el = document.createElement('article');
  el.className = `wi-card p${item.priority || 2}`;
  if (Logic.isOverdue(item)) el.classList.add('is-overdue');
  el.draggable = true;
  el.tabIndex = 0;
  el.dataset.id = item.id;

  const due = item.due_date
    ? `<time class="${Logic.isOverdue(item) ? 'late' : ''}" datetime="${esc(item.due_date)}">${esc(Logic.dueLabel(item.due_date))}</time>`
    : '';
  const who = item.assignee_detail
    ? `<span class="who-chip">${esc(item.assignee_detail.display_name || item.assignee_detail.username)}</span>`
    : '';
  const parent = item.parent_detail
    ? `<span class="parent-chip" title="Parent: ${esc(item.parent_detail.title)}">↑ ${esc(item.parent_detail.key)}</span>`
    : '';
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

  el.addEventListener('click', () => openWorkItemModal(item.id));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWorkItemModal(item.id); }
  });

  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(item.id));
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => el.classList.add('is-dragging'));
  });
  el.addEventListener('dragend', () => el.classList.remove('is-dragging'));

  return el;
}

/* Inline create. The type is picked first, because it decides whether the
   parent field exists at all (never for an Epic), whether it is required
   (always for a Subtask) and which items it may offer. */
function addWorkItemControl(status) {
  const wrap = document.createElement('div');
  const btn = document.createElement('button');
  btn.className = 'add-card';
  btn.type = 'button';
  btn.textContent = '+ Add work item';
  wrap.appendChild(btn);

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

    const typeSelect = form.querySelector('[name=item_type]');
    const parentSelect = form.querySelector('[name=parent]');
    const parentWrap = form.querySelector('[data-parent-wrap]');
    const parentLabel = form.querySelector('[data-parent-label]');
    const titleInput = form.querySelector('[name=title]');
    const errorEl = form.querySelector('[data-error]');
    const submitBtn = form.querySelector('[type=submit]');
    titleInput.focus();

    function refreshParent() {
      const type = typeSelect.value;
      errorEl.hidden = true;
      submitBtn.disabled = false;

      if (!Logic.canHaveParent(type)) {
        parentWrap.hidden = true;                 // an Epic has no parent, ever
        parentSelect.replaceChildren();
        return;
      }
      parentWrap.hidden = false;
      const required = Logic.requiresParent(type);
      parentLabel.textContent = required ? 'Parent (required)' : 'Parent (optional)';

      const candidates = Logic.parentCandidates(boardItems(), type);
      const options = [];
      if (!required) options.push(new Option('No parent', ''));
      candidates.forEach(c => options.push(new Option(`${c.key} — ${c.title}`, c.id)));
      parentSelect.replaceChildren(...options);

      if (required && !candidates.length) {
        errorEl.textContent = 'A Subtask needs a Story, Task or Bug on this board to sit under. Add one first.';
        errorEl.hidden = false;
        submitBtn.disabled = true;
      }
    }
    typeSelect.addEventListener('change', refreshParent);
    refreshParent();

    const cancel = () => wrap.replaceChildren(btn);
    form.querySelector('[data-cancel]').addEventListener('click', cancel);
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!titleInput.value.trim()) { titleInput.focus(); return; }
      errorEl.hidden = true;
      submitBtn.disabled = true;
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
    });
  });

  return wrap;
}

/* Drag and drop -------------------------------------------------------- */

/* The destination index among the items that will remain after the dragged
   one is removed — which is exactly what applyMove expects. */
function indexAtY(stack, y, draggedId) {
  const others = Array.from(stack.querySelectorAll('.wi-card'))
    .filter(el => Number(el.dataset.id) !== draggedId);
  let index = 0;
  for (const el of others) {
    const box = el.getBoundingClientRect();
    if (y > box.top + box.height / 2) index++;
  }
  return index;
}

function wireDrop(col, stack, status) {
  col.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    col.classList.add('is-over');
  });
  col.addEventListener('dragleave', (e) => {
    if (!col.contains(e.relatedTarget)) col.classList.remove('is-over');
  });
  col.addEventListener('drop', async (e) => {
    e.preventDefault();
    col.classList.remove('is-over');
    const itemId = Number(e.dataTransfer.getData('text/plain'));
    if (!itemId) return;

    try {
      await Logic.moveWorkItem({
        buckets: boardState.buckets,
        itemId,
        toStatus: status,
        toIndex: indexAtY(stack, e.clientY, itemId),
        render: paintColumns,
        commit: data.postMove,
        reload: reloadBoard,
      });
    } catch (err) {
      handle(err);
    }
  });
}

/* Work item detail modal ------------------------------------------------ */

async function openWorkItemModal(itemId) {
  let item;
  try {
    item = await data.getWorkItem(itemId);
  } catch (err) { return handle(err); }

  const users = await cachedUsers();
  const projectComponents = boardState.components || [];
  const onBoard = boardItems();

  const assigneeOptions = users.map(u =>
    `<option value="${u.id}"${Number(item.assignee) === u.id ? ' selected' : ''}>${esc(u.display_name || u.username)}</option>`
  ).join('');

  const componentChips = projectComponents.map(c => {
    const checked = (item.components || []).includes(c.id);
    return `<label class="chip-check${checked ? ' is-checked' : ''}">` +
      `<input type="checkbox" value="${c.id}"${checked ? ' checked' : ''}>${esc(c.name)}</label>`;
  }).join('');

  const showParent = Logic.canHaveParent(item.item_type);
  const parentRequired = Logic.requiresParent(item.item_type);
  const candidates = Logic.parentCandidates(onBoard, item.item_type, item.id);
  const parentOptions =
    (parentRequired ? '' : '<option value="">No parent</option>') +
    candidates.map(i =>
      `<option value="${i.id}"${Number(item.parent) === i.id ? ' selected' : ''}>${esc(i.key)} — ${esc(i.title)}</option>`
    ).join('');

  const canHaveChildren = item.item_type !== 'subtask';

  const body =
    `<div class="modal-head">` +
      `<p class="eyebrow"><span class="key-pill">${esc(item.key)}</span> ` +
      `<span class="type-badge type-${esc(item.item_type)}">${esc(Logic.ITEM_TYPE_LABEL[item.item_type])}</span></p>` +
      `<button class="btn btn-quiet" type="button" data-close>Close</button>` +
    `</div>` +
    `<input class="modal-title" name="title" value="${esc(item.title)}" aria-label="Title">` +
    `<label class="field"><span>Description</span>` +
      `<textarea name="description" placeholder="What does done look like?">${esc(item.description)}</textarea></label>` +
    `<div class="grid-3">` +
      `<label class="field"><span>Status</span><select name="status">${
        (boardState.statuses || []).map(s => `<option value="${s.id}"${item.status === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')
      }</select></label>` +
      `<label class="field"><span>Priority</span><select name="priority">` +
        `<option value="1"${item.priority === 1 ? ' selected' : ''}>Low</option>` +
        `<option value="2"${item.priority === 2 ? ' selected' : ''}>Medium</option>` +
        `<option value="3"${item.priority === 3 ? ' selected' : ''}>High</option>` +
      `</select></label>` +
      `<label class="field"><span>Assignee</span>` +
        `<select name="assignee"><option value="">Unassigned</option>${assigneeOptions}</select></label>` +
    `</div>` +
    `<div class="grid-2">` +
      `<label class="field"><span>Due</span><input type="date" name="due_date" value="${esc(item.due_date || '')}"></label>` +
      (showParent
        ? `<label class="field"><span>Parent${parentRequired ? ' (required)' : ''}</span>` +
          `<select name="parent"${candidates.length ? '' : ' disabled'}>${
            parentOptions || '<option value="">Nothing on this board can be its parent</option>'
          }</select></label>`
        : `<div class="field field-note"><span>Parent</span><p class="empty-inline">An Epic sits at the top — it never has one.</p></div>`) +
    `</div>` +
    `<p class="form-error" data-error hidden></p>` +
    `<div class="modal-actions">` +
      `<button class="btn btn-primary" type="button" data-save>Save changes</button>` +
      `<button class="btn" type="button" data-close>Cancel</button>` +
      `<button class="btn btn-danger" type="button" data-delete>Delete</button>` +
    `</div>` +

    `<div class="block">` +
      `<h2>Components</h2>` +
      `<div class="chip-check-list">${
        componentChips || '<p class="empty-inline">No components on this project yet. Add them on the project page.</p>'
      }</div>` +
    `</div>` +

    (canHaveChildren
      ? `<div class="block"><h2>Children</h2>` +
        `<ul class="children-list" data-children><li class="loading">Loading…</li></ul></div>`
      : '') +

    `<div class="block">` +
      `<h2>Related items</h2>` +
      `<ul class="link-list" data-links><li class="loading">Loading…</li></ul>` +
      `<button class="btn" type="button" data-add-link>+ Link an item</button>` +
    `</div>` +

    `<div class="block">` +
      `<h2>Comments</h2>` +
      `<ul class="comment-list" data-comments><li class="loading">Loading…</li></ul>` +
      `<form class="comment-form" data-comment-form>` +
        `<input name="body" placeholder="Add a comment" aria-label="Comment">` +
        `<button class="btn" type="submit">Post</button>` +
      `</form>` +
    `</div>`;

  const { modal, close } = openModal(body, { wide: true });
  /* Everything hung off this modal — the link picker, the children list —
     shares one context object rather than reaching back through the DOM. */
  const ctx = { modal, close, links: [] };
  const errorEl = modal.querySelector('[data-error]');

  modal.querySelectorAll('.chip-check').forEach(chip => {
    const input = chip.querySelector('input');
    input.addEventListener('change', () => chip.classList.toggle('is-checked', input.checked));
  });

  modal.querySelector('[data-save]').addEventListener('click', async () => {
    errorEl.hidden = true;
    const saveBtn = modal.querySelector('[data-save]');
    saveBtn.disabled = true;

    const parentSelect = modal.querySelector('[name=parent]');
    const fields = Logic.editableWorkItemFields({
      title: modal.querySelector('[name=title]').value,
      description: modal.querySelector('[name=description]').value,
      priority: modal.querySelector('[name=priority]').value,
      due_date: modal.querySelector('[name=due_date]').value,
      assignee: modal.querySelector('[name=assignee]').value,
      parent: parentSelect ? parentSelect.value : '',
      components: Array.from(modal.querySelectorAll('.chip-check input:checked')).map(i => i.value),
    }, item.item_type);

    const newStatus = Number(modal.querySelector('[name=status]').value);

    try {
      /* `status` is not PATCHable — the move endpoint is the only thing that
         renumbers both columns correctly. So a column change made here goes
         through /move/ first: if it fails, nothing else has been written
         yet and the item is exactly as it was. */
      if (newStatus !== item.status) {
        const dest = (boardState.buckets && boardState.buckets[newStatus]) || [];
        await data.postMove(item.id, { status: newStatus, position: dest.length });
      }
      await data.updateWorkItem(item.id, fields);
      close();
      await reloadBoard();
      toast('Saved');
    } catch (err) {
      if (err && err.sessionExpired) { close(); return handle(err); }
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
      saveBtn.disabled = false;
      /* The move may have landed before the PATCH failed, so the board on
         screen would otherwise be stale. */
      reloadBoard().catch(() => {});
    }
  });

  modal.querySelector('[data-delete]').addEventListener('click', async () => {
    const warning = canHaveChildren
      ? `Delete ${item.key}? Any children survive — they just lose their parent.`
      : `Delete ${item.key}?`;
    if (!confirm(warning)) return;
    try {
      await data.deleteWorkItem(item.id);
      close();
      await reloadBoard();
      toast(canHaveChildren ? 'Deleted — any children were kept, just unlinked from it' : 'Deleted');
    } catch (err) { handle(err); }
  });

  if (canHaveChildren) loadChildren(item, ctx);
  loadLinks(item, ctx);
  loadComments(item.id, modal);

  modal.querySelector('[data-add-link]').addEventListener('click', () => openLinkModal(item, ctx));

  modal.querySelector('[data-comment-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('[name=body]');
    if (!input.value.trim()) return;
    try {
      await data.createComment(item.id, input.value);
      input.value = '';
      loadComments(item.id, modal);
    } catch (err) { handle(err); }
  });
}

async function loadChildren(item, ctx) {
  const list = ctx.modal.querySelector('[data-children]');
  if (!list) return;
  try {
    const children = await data.listChildren(item.id);
    if (!children.length) {
      list.innerHTML = '<li class="empty-inline">No children yet.</li>';
      return;
    }
    list.replaceChildren(...children.map(child => {
      const li = document.createElement('li');
      li.innerHTML =
        `<a href="#" data-open-item>` +
          `<span class="key-pill">${esc(child.key)}</span>` +
          `<span class="type-badge type-${esc(child.item_type)}">${esc(Logic.ITEM_TYPE_LABEL[child.item_type])}</span>` +
          `<span class="link-title">${esc(child.title)}</span>` +
        `</a>` +
        `<span class="status-tag">${esc(child.status_detail ? child.status_detail.name : '')}</span>`;
      li.querySelector('[data-open-item]').addEventListener('click', (e) => {
        e.preventDefault();
        /* Jump straight to the child. The parent modal closes so the stack
           does not grow one deep per hop down the tree. */
        ctx.close();
        openWorkItemModal(child.id);
      });
      return li;
    }));
  } catch (err) {
    list.innerHTML = '';
    errorState(list, err, () => loadChildren(item, ctx));
  }
}

async function loadLinks(item, ctx) {
  const list = ctx.modal.querySelector('[data-links]');
  if (!list) return;
  try {
    const links = await data.listLinks(item.id);
    ctx.links = links;
    if (!links.length) {
      list.innerHTML = '<li class="empty-inline">No related items yet.</li>';
      return;
    }
    list.replaceChildren(...links.map(link => {
      const other = link.item_detail || {};
      const li = document.createElement('li');
      li.className = 'link-row';
      li.innerHTML =
        `<span class="key-pill">${esc(other.key)}</span>` +
        `<span class="type-badge type-${esc(other.item_type)}">${esc(Logic.ITEM_TYPE_LABEL[other.item_type])}</span>` +
        `<span class="link-title">${esc(other.title)}</span>` +
        `<button class="btn btn-danger" type="button" data-unlink>Remove</button>`;
      li.querySelector('[data-unlink]').addEventListener('click', async () => {
        try {
          await data.deleteLink(link.id);
          loadLinks(item, ctx);
          toast('Link removed');
        } catch (err) { handle(err); }
      });
      return li;
    }));
  } catch (err) {
    list.innerHTML = '';
    errorState(list, err, () => loadLinks(item, ctx));
  }
}

/* The link picker opens on top of the work item modal — hence the modal
   stack, so Escape closes only this one. */
async function openLinkModal(item, ctx) {
  const linked = new Set((ctx.links || []).map(l => l.item_detail && l.item_detail.id));
  /* Filter out everything the API would reject anyway: itself, an existing
     link, and its own parent or children. */
  const candidates = boardItems().filter(i =>
    i.id !== item.id &&
    !linked.has(i.id) &&
    Number(item.parent) !== i.id &&
    Number(i.parent) !== item.id
  );

  const head = modalHead(`Link ${esc(item.key)}`);
  const body = !candidates.length
    ? head + `<p class="empty">Nothing else on this board is available to link to.</p>`
    : head +
      `<label class="field"><span>Item</span><select name="target">${
        candidates.map(c => `<option value="${c.id}">${esc(c.key)} — ${esc(c.title)}</option>`).join('')
      }</select></label>` +
      `<p class="form-error" data-error hidden></p>` +
      `<div class="modal-actions"><button class="btn btn-primary" type="button" data-send>Link</button>` +
      `<button class="btn" type="button" data-close>Cancel</button></div>`;

  const { modal, close } = openModal(body);
  const sendBtn = modal.querySelector('[data-send]');
  if (!sendBtn) return;

  sendBtn.addEventListener('click', async () => {
    const errorEl = modal.querySelector('[data-error]');
    errorEl.hidden = true;
    sendBtn.disabled = true;
    try {
      await data.createLink(item.id, Number(modal.querySelector('[name=target]').value));
      close();
      toast('Linked');
      loadLinks(item, ctx);
    } catch (err) {
      if (err && err.sessionExpired) { close(); return handle(err); }
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
      sendBtn.disabled = false;
    }
  });
}

/* Comments -------------------------------------------------------------- */

async function loadComments(itemId, modal) {
  const list = modal.querySelector('[data-comments]');
  if (!list) return;
  try {
    const comments = await data.listComments(itemId);
    if (!comments.length) {
      list.innerHTML = '<li class="empty-inline">No comments yet. Explain the tricky part here.</li>';
      return;
    }
    list.replaceChildren(...comments.map(c => commentEl(c, itemId, modal)));
  } catch (err) {
    list.innerHTML = '';
    errorState(list, err, () => loadComments(itemId, modal));
  }
}

function commentEl(comment, itemId, modal) {
  const li = document.createElement('li');
  li.className = 'comment';
  const author = comment.author
    ? esc(comment.author.display_name || comment.author.username)
    : 'Deleted user';
  /* An authorless comment is deletable by any member, exactly as the API
     allows — its owner's account is gone. */
  const mine = !comment.author || (me && comment.author.id === me.id);

  li.innerHTML =
    `<div class="comment-head">` +
      `<span class="author">${author}</span>` +
      `<time datetime="${esc(comment.created_at)}">${esc(String(comment.created_at).slice(0, 10))}</time>` +
      (mine ? `<button class="btn btn-danger" type="button" data-del>Delete</button>` : '') +
    `</div>` +
    `<p class="comment-body">${esc(comment.body)}</p>`;

  const del = li.querySelector('[data-del]');
  if (del) del.addEventListener('click', async () => {
    try {
      await data.deleteComment(comment.id);
      loadComments(itemId, modal);
    } catch (err) { handle(err); }
  });

  return li;
}

/* My tasks -------------------------------------------------------------- */

async function viewMyTasks() {
  const main = outlet();
  main.replaceChildren(tpl('tpl-my-tasks'));
  const list = main.querySelector('[data-list]');
  list.innerHTML = skeletonList(4);

  try {
    const items = await data.myTasks();
    if (!items.length) {
      list.innerHTML = '<li class="empty">Nothing assigned to you. Enjoy it while it lasts.</li>';
      return;
    }
    const rows = items.map(taskRow);
    list.replaceChildren(...rows);
    stagger(rows);
  } catch (err) {
    if (err && err.sessionExpired) return handle(err);
    errorState(list, err, viewMyTasks);
  }
}

function taskRow(item) {
  const li = document.createElement('li');
  li.className = `task-row p${item.priority || 2}`;
  if (Logic.isOverdue(item)) li.classList.add('is-overdue');
  li.tabIndex = 0;

  const due = item.due_date
    ? `<time class="${Logic.isOverdue(item) ? 'late' : ''}" datetime="${esc(item.due_date)}">${esc(Logic.dueLabel(item.due_date))}</time>`
    : '<span class="where">No due date</span>';

  li.innerHTML =
    `<span class="key-pill">${esc(item.key)}</span>` +
    `<span class="type-badge type-${esc(item.item_type)}">${esc(Logic.ITEM_TYPE_LABEL[item.item_type])}</span>` +
    `<span class="t">${esc(item.title)}</span>` +
    due +
    `<span class="state ${item.status_detail && item.status_detail.category === 'in_progress' ? 'active' : ''}">${esc(item.status_detail ? item.status_detail.name : '')}</span>`;

  /* The tasks endpoint returns a board id but no project id, so the board
     route resolves the project itself and rewrites the hash. */
  const open = () => { location.hash = `#/boards/${item.board}`; };
  li.addEventListener('click', open);
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return li;
}

boot();
