# Coding style

Ruff is the authority (`pyproject.toml`): line length 100, double quotes,
isort-ordered imports, pyupgrade, bugbear, complexity ≤ 15. `make lint` must be
clean; CI enforces it.

## Where things go

- **Business logic → `boards/services.py`.** Views stay thin. Anything with a
  transaction, a lock, or a rule belongs in services.
- **Permission predicates → `projects/permissions.py`** as pure functions.
- **Validation → serializers or services**, never inline in a view body.

## Comments

This codebase comments *why*, not *what*, and it is unusually good at it. Match
that. In particular, document any non-obvious ordering, lock, or deliberate
non-fix — those comments are load-bearing (see the lock-before-read note in
`move_work_item` and the routing-order note in `config/urls.py`).

## Complexity

Four functions carry `# noqa: C901` with a stated reason. Do not add a fifth
without one, and do not raise `max-complexity` to avoid the conversation.

## Exceptions

Inside an `except`, always chain: `raise ... from err` or `from None`. Use
`from None` when converting a parse error into a user-facing 400 — the original
is noise.

## Magic values

Derive from the model rather than duplicating. `boards/services.py` builds its
priority map from `WorkItem.Priority.choices` precisely so it cannot drift.

## Front end

Four files, and the split is load-bearing:

| File | Rule |
|---|---|
| `logic.js` | **Pure.** No DOM, no network |
| `store.js` | Mock source, enforces the same rules as the server |
| `api.js` | Real source, **same interface as `store.js`** |
| `app.js` | Views, routing, wiring |

Never let `app.js` know which source is in play. Never reach into the DOM from
`logic.js`. Use CSS custom properties, never raw hex — see
`.claude/memory/brand-guidelines.md`.
