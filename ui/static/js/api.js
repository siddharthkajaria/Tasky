/* Real data source — the same interface as Store, against the live Django API.
   `app.js` picks one at boot; append ?data=store to any URL to force the mock.
   Serve this directory from the same origin as Django so the session cookie
   works. Every path here is checked against docs/api.md. */

const Api = (() => {

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : null;
  }

  async function parseBody(res) {
    try { return await res.json(); } catch { return null; }
  }

  async function request(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') {
      const token = getCookie('csrftoken');
      if (token) headers['X-CSRFToken'] = token;
    }

    const res = await fetch(path, {
      method, headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return null;
    if (res.ok) return parseBody(res);

    const data = await parseBody(res);

    /* 403 is ambiguous: an expired session, or a legitimate permission denial
       such as deleting someone else's comment, or touching a project you are
       not a member of. Treating every 403 as a logout would eject the user
       for clicking the wrong button. Raw fetch for the recheck — going back
       through request() would recurse forever once the session is gone. */
    if (res.status === 403) {
      const me = await fetch('/api/auth/me/', { credentials: 'same-origin' });
      const err = Object.assign(new Error('Forbidden'), { status: 403, data });
      err.sessionExpired = (me.status === 403);
      throw err;
    }

    throw Object.assign(new Error('API ' + res.status), { status: res.status, data });
  }

  /* `GET /api/boards/` hands back every board in every project I belong to,
     with no project filter of its own, so the scoping happens here. Doing it
     in one place keeps every caller working in terms of "this project's
     boards" the way the mock store natively does. */
  async function listBoards(projectId) {
    const boards = await request('/api/boards/');
    return boards.filter(b => Number(b.project) === Number(projectId));
  }

  return {
    getCsrf:  ()                   => request('/api/auth/csrf/'),
    login:    (username, password) => request('/api/auth/login/', { method: 'POST', body: { username, password } }),
    logout:   ()                   => request('/api/auth/logout/', { method: 'POST' }),
    getMe:    ()                   => request('/api/auth/me/'),

    /* Projects ---------------------------------------------------------- */
    listProjects:  ()          => request('/api/projects/'),
    getProject:    (id)        => request(`/api/projects/${id}/`),
    createProject: (fields)    => request('/api/projects/', { method: 'POST', body: fields }),
    deleteProject: (id)        => request(`/api/projects/${id}/`, { method: 'DELETE' }),

    /* Membership. "Leave" is not an endpoint of its own — it is removing
       your own membership, and the server applies the same owner rule. */
    listMembers:  (projectId)                  => request(`/api/projects/${projectId}/members/`),
    removeMember: (projectId, userId)          => request(`/api/projects/${projectId}/members/${userId}/`, { method: 'DELETE' }),
    changeRole:   (projectId, userId, role)    => request(`/api/projects/${projectId}/members/${userId}/role/`, { method: 'POST', body: { role } }),
    transferOwnership: (projectId, userId)     => request(`/api/projects/${projectId}/transfer-ownership/`, { method: 'POST', body: { user_id: userId } }),
    inviteMember: (projectId, userId)          => request(`/api/projects/${projectId}/invite/`, { method: 'POST', body: { user_id: userId } }),

    /* Invitations ------------------------------------------------------- */
    listMyInvitations: ()   => request('/api/invitations/'),
    acceptInvitation:  (id) => request(`/api/invitations/${id}/accept/`, { method: 'POST' }),
    declineInvitation: (id) => request(`/api/invitations/${id}/decline/`, { method: 'POST' }),

    /* Boards ------------------------------------------------------------ */
    listBoards,
    getBoard:    (id)     => request(`/api/boards/${id}/`),
    createBoard: (fields) => request('/api/boards/', { method: 'POST', body: fields }),
    getBoardWorkItems: (id) => request(`/api/boards/${id}/work-items/`),

    /* Work item statuses. Per-project and configurable (sub-project 3,
       Workflows) — not the fixed three-value enum the board used to assume.
       `status` on a work item is one of these ids, never a string. */
    listStatuses: (projectId) => request(`/api/projects/${projectId}/statuses/`),

    /* Work items -------------------------------------------------------- */
    getWorkItem:    (id)         => request(`/api/work-items/${id}/`),
    createWorkItem: (fields)     => request('/api/work-items/', { method: 'POST', body: fields }),
    // No `status`, no `board`, no `item_type`, no `key` — the API rejects a
    // change to any of them with 400.
    updateWorkItem: (id, fields) => request(`/api/work-items/${id}/`, { method: 'PATCH', body: fields }),
    deleteWorkItem: (id)         => request(`/api/work-items/${id}/`, { method: 'DELETE' }),
    postMove:       (id, payload) => request(`/api/work-items/${id}/move/`, { method: 'POST', body: payload }),
    listChildren:   (id)         => request(`/api/work-items/${id}/children/`),

    /* Components. The project id is part of the path even on the detail
       routes, so it travels with every call. */
    listComponents:   (projectId)             => request(`/api/projects/${projectId}/components/`),
    createComponent:  (projectId, name)       => request(`/api/projects/${projectId}/components/`, { method: 'POST', body: { name } }),
    renameComponent:  (projectId, id, name)   => request(`/api/projects/${projectId}/components/${id}/`, { method: 'PATCH', body: { name } }),
    deleteComponent:  (projectId, id)         => request(`/api/projects/${projectId}/components/${id}/`, { method: 'DELETE' }),

    /* "Relates to" links. The list is symmetric: each row carries
       `item_detail`, already resolved to the other side by the server. */
    listLinks:  (itemId)          => request(`/api/work-items/${itemId}/links/`),
    createLink: (itemId, otherId) => request(`/api/work-items/${itemId}/links/`, { method: 'POST', body: { item: otherId } }),
    deleteLink: (linkId)          => request(`/api/work-item-links/${linkId}/`, { method: 'DELETE' }),

    /* Comments ---------------------------------------------------------- */
    listComments:  (itemId)       => request(`/api/work-items/${itemId}/comments/`),
    createComment: (itemId, body) => request(`/api/work-items/${itemId}/comments/`, { method: 'POST', body: { body } }),
    deleteComment: (id)           => request(`/api/comments/${id}/`, { method: 'DELETE' }),

    listUsers: () => request('/api/users/'),
    myTasks:   () => request('/api/me/tasks/'),
  };
})();
