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
  if (hash === '/search')  { setActiveNav('search');  return viewSearch(); }

  setActiveNav('projects');
  const backlogMatch = hash.match(/^\/projects\/(\d+)\/boards\/(\d+)\/backlog$/);
  if (backlogMatch) return viewBacklog(Number(backlogMatch[1]), Number(backlogMatch[2]));
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
    await renderReleases(main, projectId, project.my_role);
    await renderMembers(main, projectId, project.my_role);
    await renderPendingInvites(main, projectId, project.my_role);
  } catch (err) {
    // This chain awaits several sections in sequence; a user can navigate
    // away (e.g. into a board) before it finishes, which leaves later
    // sections writing into a `main` that's no longer this page's template
    // and throwing. That's harmless — only treat it as a real load failure,
    // and only bounce to the projects list, if we're still looking at this
    // project's page when it happens.
    if (location.hash === `#/projects/${projectId}`) {
      handle(err);
      location.hash = '#/projects';
    }
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

/* Releases (sub-project 7) -------------------------------------------------
   Project-scoped, like Components and Statuses, not global — so this lives
   on the project page too. Each card always shows its currently-tagged
   items inline (same choice sub-project 6 made for a sprint's items), no
   separate "view items" click needed. */

async function renderReleases(main, projectId, myRole) {
  const list = main.querySelector('[data-releases]');
  const form = main.querySelector('[data-create-release]');
  if (!list || !form) return;
  const canManage = Logic.canManageReleases(myRole);
  form.hidden = !canManage;
  list.innerHTML = skeletonList(2);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = form.querySelector('[name=name]');
    const dateInput = form.querySelector('[name=release_date]');
    if (!nameInput.value.trim()) return;
    try {
      await Store.createRelease(projectId, { name: nameInput.value, release_date: dateInput.value || null });
      nameInput.value = '';
      dateInput.value = '';
      await renderReleases(main, projectId, myRole);
    } catch (err) { handle(err); }
  });

  try {
    const items = await Store.listReleases(projectId);
    if (!items.length) {
      list.innerHTML = '<p class="empty">No releases yet.</p>';
      return;
    }
    const cards = await Promise.all(items.map(r => releaseCard(r, main, projectId, myRole, canManage)));
    list.replaceChildren(...cards);
    stagger(cards);
  } catch (err) {
    list.innerHTML = '';
    handle(err);
  }
}

async function releaseCard(release, main, projectId, myRole, canManage) {
  const card = document.createElement('div');
  card.className = `release-card status-${release.status}`;

  card.innerHTML =
    `<div class="release-head">` +
      `<span class="release-name" ${canManage ? 'contenteditable="true" data-rename' : ''}>${esc(release.name)}</span>` +
      (canManage
        ? `<select class="release-status-select" data-status aria-label="Status for ${esc(release.name)}">${
            Logic.RELEASE_STATUSES.map(s =>
              `<option value="${s}" ${s === release.status ? 'selected' : ''}>${Logic.RELEASE_STATUS_LABEL[s]}</option>`
            ).join('')
          }</select>`
        : `<span class="release-status-badge state-${release.status}">${Logic.RELEASE_STATUS_LABEL[release.status]}</span>`) +
      (canManage
        ? `<input type="date" class="release-date-input" data-date value="${release.release_date || ''}" aria-label="Date for ${esc(release.name)}">`
        : `<span class="row-meta">${release.release_date ? esc(release.release_date) : 'No date set'}</span>`) +
      `<span class="row-meta">${release.item_count} item${release.item_count === 1 ? '' : 's'}</span>` +
      (canManage ? `<button class="btn btn-danger" type="button" data-delete>Delete</button>` : '') +
    `</div>` +
    `<ul class="release-items" data-items></ul>`;

  const itemsEl = card.querySelector('[data-items]');
  try {
    const items = await Store.listReleaseWorkItems(release.id);
    if (!items.length) {
      itemsEl.innerHTML = '<li class="empty-inline">Nothing tagged with this release yet.</li>';
    } else {
      itemsEl.replaceChildren(...items.map(item => releaseItemRow(item, projectId)));
    }
  } catch (err) { handle(err); }

  const run = async (fn) => {
    try {
      await fn();
      await renderReleases(main, projectId, myRole);
    } catch (err) { handle(err); }
  };

  const nameEl = card.querySelector('[data-rename]');
  if (nameEl) {
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    });
    nameEl.addEventListener('blur', async () => {
      const value = nameEl.textContent.trim();
      if (!value || value === release.name) { nameEl.textContent = release.name; return; }
      try {
        await Store.updateRelease(release.id, { name: value });
        toast('Release renamed');
      } catch (err) {
        nameEl.textContent = release.name;
        handle(err);
      }
    });
  }
  const statusEl = card.querySelector('[data-status]');
  if (statusEl) statusEl.addEventListener('change', () => run(() => Store.updateRelease(release.id, { status: statusEl.value })));
  const dateEl = card.querySelector('[data-date]');
  if (dateEl) dateEl.addEventListener('change', () => run(() => Store.updateRelease(release.id, { release_date: dateEl.value || null })));
  const deleteBtn = card.querySelector('[data-delete]');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (release.item_count && !confirm(`Delete "${release.name}"? ${release.item_count} work item${release.item_count === 1 ? '' : 's'} will be un-tagged, not deleted.`)) return;
    await run(() => Store.deleteRelease(release.id));
  });

  return card;
}

// Reached from the project page, not a board — `boardState` isn't already
// pointed at this item's board the way it is when a card is opened from
// the board or Backlog page, so it's set explicitly before opening the
// modal (which reads `boardState.projectId`/`boardState.boardId` to load
// components, members and sibling items for the parent picker).
function releaseItemRow(item, projectId) {
  const li = document.createElement('li');
  li.className = 'release-item-row';
  li.innerHTML =
    `<a href="#" data-open-item="${item.id}">` +
      `<span class="key-pill">${esc(item.key)}</span>` +
      `<span class="type-badge type-${item.item_type}">${Logic.ITEM_TYPE_LABEL[item.item_type]}</span>` +
      `<span class="title">${esc(item.title)}</span>` +
      `<span class="status-tag">${item.status_detail ? esc(item.status_detail.name) : ''}</span>` +
    `</a>`;
  li.querySelector('[data-open-item]').addEventListener('click', async (e) => {
    e.preventDefault();
    boardState.projectId = projectId;
    boardState.boardId = item.board;
    // The modal's Status dropdown reads `boardState.statuses` — already
    // populated when a card is opened from its own board or the Backlog
    // page, but not when reached from here, so it's fetched explicitly
    // first rather than opening the modal with an empty Status control.
    try { boardState.statuses = await Store.listStatuses(projectId); } catch (err) { /* modal shows what it can */ }
    openWorkItemModal(item.id);
  });
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

/* Search (sub-project 5) --------------------------------------------------
   Cross-project, scoped to the caller's own memberships — the facet
   dropdowns are only ever populated from projects/labels/users this person
   can already see, so there's no way to even ask about a project you're
   not in. */

async function viewSearch() {
  const main = outlet();
  main.replaceChildren(tpl('tpl-search'));

  const form = main.querySelector('[data-search-form]');
  const errorEl = main.querySelector('[data-error]');
  const resultsEl = main.querySelector('[data-results]');

  form.querySelector('[name=item_type]').insertAdjacentHTML('beforeend',
    Logic.ITEM_TYPES.map(t => `<option value="${t}">${Logic.ITEM_TYPE_LABEL[t]}</option>`).join(''));
  form.querySelector('[name=status_category]').insertAdjacentHTML('beforeend',
    Logic.CATEGORIES.map(c => `<option value="${c}">${Logic.CATEGORY_LABELS[c]}</option>`).join(''));
  form.querySelector('[name=priority]').insertAdjacentHTML('beforeend',
    `<option value="1">Low</option><option value="2">Medium</option><option value="3">High</option>`);

  try {
    const [users, myProjects, allLabels] = await Promise.all([
      Store.listUsers(), Store.listMyProjects(), Store.listLabels(),
    ]);
    form.querySelector('[name=assignee]').insertAdjacentHTML('beforeend',
      users.map(u => `<option value="${u.id}">${esc(u.display_name)}</option>`).join(''));
    form.querySelector('[name=project]').insertAdjacentHTML('beforeend',
      myProjects.map(p => `<option value="${p.id}">${esc(p.key)} — ${esc(p.name)}</option>`).join(''));
    form.querySelector('[name=label]').insertAdjacentHTML('beforeend',
      allLabels.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join(''));
  } catch (err) { /* facets are a nice-to-have; a plain text search still works without them */ }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const data = new FormData(form);
    const params = {};
    for (const [key, value] of data.entries()) { if (value) params[key] = value; }

    try {
      const { results } = await Store.search(params);
      if (!results.length) {
        resultsEl.innerHTML = '<li class="empty">No matches.</li>';
        return;
      }
      const rows = results.map(searchResultRow);
      resultsEl.replaceChildren(...rows);
      stagger(rows);
    } catch (err) {
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
    ? `<span class="who-chip">${esc(item.assignee_detail.display_name)}</span>` : '';
  li.innerHTML =
    `<a href="#/projects/${item.project.id}/boards/${item.board.id}">` +
      `<span class="key-pill">${esc(item.key)}</span>` +
      `<span class="type-badge type-${item.item_type}">${Logic.ITEM_TYPE_LABEL[item.item_type]}</span>` +
      `<span class="search-title">${esc(item.title)}</span>` +
      `<span class="search-meta">${esc(item.project.key)} · ${esc(item.status_detail.name)}</span>` +
      who +
    `</a>`;
  return li;
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

let boardState = {
  projectId: null, boardId: null, statuses: null, buckets: null,
  selectMode: false, selectedIds: new Set(),
};

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
  boardState.selectMode = false;
  boardState.selectedIds = new Set();

  main.querySelector('[data-back-link]').href = `#/projects/${projectId}`;
  main.querySelector('[data-backlog-link]').href = `#/projects/${projectId}/boards/${boardId}/backlog`;
  main.querySelector('[data-type-legend]').innerHTML = Logic.ITEM_TYPES.map(t =>
    `<span class="legend-item"><i class="type-dot type-${t}"></i>${Logic.ITEM_TYPE_LABEL[t]}</span>`
  ).join('');

  main.querySelector('[data-select-toggle]').addEventListener('click', toggleSelectMode);
  main.querySelector('[data-import-btn]').addEventListener('click', openImportModal);

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

/* Backlog & Sprints (sub-project 6) ---------------------------------------
   Sprint assignment is a second axis, orthogonal to status — this page is
   the home for it, separate from the board's status columns. `boardState`
   is populated the same way `viewBoard` does (minus `buckets`, since this
   page doesn't render columns) so `openWorkItemModal` — opened from either
   the backlog or a sprint's item list — has everything it needs, and its
   `reloadBoard()` on save safely no-ops here since paintColumns() bails
   out when `[data-columns]` isn't on the page. */

async function viewBacklog(projectId, boardId) {
  const main = outlet();
  main.replaceChildren(tpl('tpl-backlog'));
  boardState.projectId = projectId;
  boardState.boardId = boardId;
  boardState.selectMode = false;
  boardState.selectedIds = new Set();

  main.querySelector('[data-back-link]').href = `#/projects/${projectId}/boards/${boardId}`;

  const sprintsEl = main.querySelector('[data-sprints]');
  const backlogEl = main.querySelector('[data-backlog]');
  const createForm = main.querySelector('[data-create-sprint]');
  sprintsEl.innerHTML = skeletonList(2);
  backlogEl.innerHTML = skeletonList(2);

  let project, board, statuses, canManage;
  try {
    [project, board, statuses] = await Promise.all([
      Store.getProject(projectId), Store.getBoard(boardId), Store.listStatuses(projectId),
    ]);
    canManage = Logic.canManageSprints(project.my_role);
    boardState.statuses = statuses;
    main.querySelector('[data-board-name]').textContent = board.name;
  } catch (err) {
    sprintsEl.innerHTML = ''; backlogEl.innerHTML = '';
    handle(err);
    location.hash = `#/projects/${projectId}/boards/${boardId}`;
    return;
  }

  createForm.hidden = !canManage;
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = createForm.querySelector('[name=name]');
    const goalInput = createForm.querySelector('[name=goal]');
    if (!nameInput.value.trim()) return;
    try {
      await Store.createSprint(boardId, { name: nameInput.value, goal: goalInput.value });
      nameInput.value = '';
      goalInput.value = '';
      await paintBacklogPage(boardId, canManage, sprintsEl, backlogEl);
    } catch (err) { handle(err); }
  });

  await paintBacklogPage(boardId, canManage, sprintsEl, backlogEl);
}

async function paintBacklogPage(boardId, canManage, sprintsEl, backlogEl) {
  sprintsEl.innerHTML = skeletonList(2);
  backlogEl.innerHTML = skeletonList(2);
  try {
    const [allSprints, backlogItems] = await Promise.all([
      Store.listSprints(boardId), Store.listBacklog(boardId),
    ]);

    if (!allSprints.length) {
      sprintsEl.innerHTML = '<p class="empty">No sprints yet.</p>';
    } else {
      const cards = await Promise.all(
        allSprints.map(s => sprintCard(s, boardId, canManage, sprintsEl, backlogEl, allSprints))
      );
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
    sprintsEl.innerHTML = '';
    backlogEl.innerHTML = '';
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
      `<span class="sprint-state-badge state-${sprint.state}">${sprint.state}</span>` +
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
      const items = await Store.listSprintWorkItems(sprint.id);
      itemsEl.innerHTML = '';
      if (!items.length) {
        itemsEl.innerHTML = '<li class="empty-inline">Nothing scheduled yet.</li>';
      } else {
        itemsEl.replaceChildren(...items.map(item => backlogRow(item, boardId, allSprints, sprintsEl, backlogEl, canManage)));
      }
    } catch (err) { handle(err); }
  }

  const startBtn = card.querySelector('[data-start]');
  if (startBtn) startBtn.addEventListener('click', async () => {
    try {
      await Store.startSprint(sprint.id);
      await paintBacklogPage(boardId, canManage, sprintsEl, backlogEl);
    } catch (err) { handle(err); }
  });
  const completeBtn = card.querySelector('[data-complete]');
  if (completeBtn) completeBtn.addEventListener('click', async () => {
    try {
      await Store.completeSprint(sprint.id);
      toast(`"${sprint.name}" completed`);
      await paintBacklogPage(boardId, canManage, sprintsEl, backlogEl);
    } catch (err) { handle(err); }
  });
  const deleteBtn = card.querySelector('[data-delete]');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    try {
      await Store.deleteSprint(sprint.id);
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
      `<span class="type-badge type-${item.item_type}">${Logic.ITEM_TYPE_LABEL[item.item_type]}</span>` +
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
      await Store.scheduleWorkItem(item.id, { sprint: value === 'backlog' ? null : Number(value) });
      await paintBacklogPage(boardId, canManage, sprintsEl, backlogEl);
    } catch (err) { handle(err); }
  });
  return li;
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
  const selected = boardState.selectedIds.has(item.id);
  el.className = `wi-card p${item.priority || 2}` + (selected ? ' is-selected' : '');
  el.tabIndex = 0;

  const parentChip = item.parent_detail
    ? `<span class="parent-chip">${esc(item.parent_detail.key)}</span>` : '';
  const releaseChip = item.release_detail
    ? `<span class="release-chip-sm state-${item.release_detail.status}">${esc(item.release_detail.name)}</span>` : '';
  const who = item.assignee_detail
    ? `<span class="who-chip">${esc(item.assignee_detail.display_name)}</span>` : '';
  const labelChips = (item.labels_detail || [])
    .map(l => `<span class="label-chip label-chip-sm" style="background:${l.color}">${esc(l.name)}</span>`)
    .join('');

  el.innerHTML =
    (boardState.selectMode
      ? `<label class="card-select" data-select-wrap><input type="checkbox" ${selected ? 'checked' : ''}></label>`
      : '') +
    `<div class="wi-top">` +
      `<span class="key-pill">${esc(item.key)}</span>` +
      `<span class="type-badge type-${item.item_type}">${Logic.ITEM_TYPE_LABEL[item.item_type]}</span>` +
    `</div>` +
    `<p class="card-title">${esc(item.title)}</p>` +
    (labelChips ? `<div class="card-labels">${labelChips}</div>` : '') +
    `<div class="card-meta">${parentChip}${releaseChip}${who}</div>`;

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
  return el;
}

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

async function renderBulkBar() {
  const bar = root.querySelector('[data-bulk-bar]');
  if (!bar) return;
  const count = boardState.selectedIds.size;
  if (!boardState.selectMode || count === 0) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;

  let members = [], components = [];
  try {
    [members, components] = await Promise.all([
      Store.listMembers(boardState.projectId),
      Store.listComponents(boardState.projectId),
    ]);
  } catch (err) { /* proceed with what we have */ }

  bar.innerHTML =
    `<span class="bulk-count">${count} selected</span>` +
    `<select data-bulk-status aria-label="Move to status"><option value="">Move to…</option>${
      (boardState.statuses || []).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
    }</select>` +
    `<select data-bulk-assignee aria-label="Set assignee"><option value="">Assignee…</option><option value="__unassign">Unassign</option>${
      members.map(m => `<option value="${m.id}">${esc(m.display_name)}</option>`).join('')
    }</select>` +
    `<select data-bulk-priority aria-label="Set priority"><option value="">Priority…</option><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option></select>` +
    `<input type="text" data-bulk-label placeholder="Add label…" aria-label="Add label">` +
    `<select data-bulk-component aria-label="Add component"><option value="">Add component…</option>${
      components.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
    }</select>` +
    `<button class="btn btn-danger" type="button" data-bulk-delete>Delete</button>` +
    `<button class="btn btn-quiet" type="button" data-bulk-clear>Clear</button>`;

  const ids = () => Array.from(boardState.selectedIds);

  bar.querySelector('[data-bulk-status]').addEventListener('change', async (e) => {
    const statusId = e.target.value;
    if (!statusId) return;
    try {
      const result = await Store.bulkMoveWorkItems(ids(), Number(statusId));
      reportBulkResult(result, 'succeeded');
      await reloadBoard();
    } catch (err) { handle(err); }
    e.target.value = '';
  });

  bar.querySelector('[data-bulk-assignee]').addEventListener('change', async (e) => {
    const value = e.target.value;
    if (!value) return;
    try {
      const result = await Store.bulkUpdateWorkItems(ids(), { assignee: value === '__unassign' ? null : Number(value) });
      reportBulkResult(result, 'succeeded');
      await reloadBoard();
    } catch (err) { handle(err); }
    e.target.value = '';
  });

  bar.querySelector('[data-bulk-priority]').addEventListener('change', async (e) => {
    const value = e.target.value;
    if (!value) return;
    try {
      const result = await Store.bulkUpdateWorkItems(ids(), { priority: Number(value) });
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
      const result = await Store.bulkUpdateWorkItems(ids(), { labels_add: [name] });
      reportBulkResult(result, 'succeeded');
      await reloadBoard();
    } catch (err) { handle(err); }
    labelInput.value = '';
  });

  bar.querySelector('[data-bulk-component]').addEventListener('change', async (e) => {
    const value = e.target.value;
    if (!value) return;
    try {
      const result = await Store.bulkUpdateWorkItems(ids(), { components_add: [Number(value)] });
      reportBulkResult(result, 'succeeded');
      await reloadBoard();
    } catch (err) { handle(err); }
    e.target.value = '';
  });

  bar.querySelector('[data-bulk-delete]').addEventListener('click', async () => {
    if (!confirm(`Delete ${count} work item${count === 1 ? '' : 's'}? This can't be undone.`)) return;
    try {
      const result = await Store.bulkDeleteWorkItems(ids());
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

function reportBulkResult(result, successKey) {
  const okCount = (result[successKey] || []).length;
  const failCount = (result.failed || []).length;
  if (!failCount) { toast(`${okCount} updated`); return; }
  toast(`${okCount} updated, ${failCount} failed: ${result.failed[0].error}`, true);
}

async function openImportModal() {
  const body = `
    <div class="modal-head">
      <p class="eyebrow">Import work items</p>
      <button class="btn btn-quiet" data-close>Close</button>
    </div>
    <p class="hint">
      Paste CSV with a header row. Required column: <code>title</code>. Optional:
      <code>item_type</code> (epic/story/task/bug — never subtask), <code>description</code>,
      <code>status</code> (a status name in this project), <code>priority</code>
      (low/medium/high), <code>assignee</code> (username), <code>due_date</code>
      (YYYY-MM-DD), <code>labels</code>, <code>components</code> (both
      semicolon-separated names). Max 500 rows.
    </p>
    <label class="field">
      <span>CSV</span>
      <textarea data-import-csv rows="8" placeholder="title,item_type,status,priority,assignee,labels&#10;Fix login redirect,bug,To Do,high,asha,urgent;needs-design"></textarea>
    </label>
    <p class="form-error" data-error hidden></p>
    <div class="modal-actions">
      <button class="btn btn-primary" type="button" data-import-submit>Import</button>
      <button class="btn" data-close>Cancel</button>
    </div>
    <div class="import-results" data-import-results hidden></div>`;
  const { modal } = openModal(body);
  const textarea = modal.querySelector('[data-import-csv]');
  const errorEl = modal.querySelector('[data-error]');
  const resultsEl = modal.querySelector('[data-import-results]');

  modal.querySelector('[data-import-submit]').addEventListener('click', async () => {
    errorEl.hidden = true;
    resultsEl.hidden = true;
    const csv = textarea.value.trim();
    if (!csv) { errorEl.textContent = 'Paste some CSV first.'; errorEl.hidden = false; return; }
    try {
      const result = await Store.importWorkItems(boardState.boardId, csv);
      resultsEl.hidden = false;
      const failLines = result.failed.map(f => `Row ${f.row}${f.title ? ` (${esc(f.title)})` : ''}: ${esc(f.error)}`);
      resultsEl.innerHTML =
        `<p>${result.imported} imported${result.failed.length ? `, ${result.failed.length} failed` : ''}.</p>` +
        (failLines.length ? `<ul>${failLines.map(l => `<li>${l}</li>`).join('')}</ul>` : '');
      if (result.imported) await reloadBoard();
    } catch (err) {
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
    }
  });
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
  let item, users, projectComponents, boardItems, members, allLabels, projectReleases;
  try {
    [item, users, projectComponents, boardItems, members, allLabels, projectReleases] = await Promise.all([
      Store.getWorkItem(itemId),
      Store.listUsers(),
      Store.listComponents(boardState.projectId),
      Store.listBoardWorkItems(boardState.boardId),
      Store.listMembers(boardState.projectId),
      Store.listLabels(),
      Store.listReleases(boardState.projectId),
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

  // Any project member can tag a work item with an existing release — an
  // ordinary edit, same tier as Status/Priority/Assignee, not gated behind
  // the Owner/Admin check that creating or renaming one requires.
  const releaseOptions = projectReleases.map(r =>
    `<option value="${r.id}" ${item.release === r.id ? 'selected' : ''}>${esc(r.name)} — ${Logic.RELEASE_STATUS_LABEL[r.status]}</option>`
  ).join('');

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
    <div class="grid-3">
      <label class="field">
        <span>Due</span>
        <input type="date" name="due_date" value="${item.due_date || ''}">
      </label>
      <label class="field">
        <span>Release</span>
        <select name="release"><option value="">No release</option>${releaseOptions}</select>
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
      release: modal.querySelector('[name=release]').value || null,
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
