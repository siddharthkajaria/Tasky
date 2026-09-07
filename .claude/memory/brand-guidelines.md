# Tasky — brand guidelines

Extracted from `ui/static/css/app.css` (canonical) and verified identical in
`design/css/app.css`. Both files define the same `:root` token block — the only
difference is that `design/` splits it across two `:root` rules. **There is no
brand drift in this codebase.**

## The thesis (do not dilute this)

> Black is the given; red is the one accent allowed to mean something.

Red marks exactly five things: In Progress, overdue, a Bug, the brand mark, and a
primary button responding to a click. Everything else — type badges, done work,
metadata — stays in the ink/grey family **on purpose**. Adding a second accent
colour, or spending red on decoration, breaks the system. Rethemed 2026-09 from
an earlier palette; the old one is gone, not coexisting.

## Colour palette

| Token | Hex | Usage |
|---|---|---|
| `--paper` | `#0D0D0F` | Page background (near-black) |
| `--surface` | `#1A1A1E` | Cards, modals, raised panels |
| `--sunk` | `#050506` | Recessed wells, inputs, board columns |
| `--ink` | `#F3F1EC` | Primary text (warm off-white) |
| `--ink-2` | `#9D9A93` | Secondary text, labels, most type badges |
| `--ink-3` | `#68655D` | Tertiary/disabled text, Subtask badge |
| `--rule` | `#232226` | Default hairline borders |
| `--rule-2` | `#35333A` | Emphasised borders, hover states |
| `--accent` | `#E4362C` | The one accent — In Progress, overdue, brand, primary button |
| `--accent-rgb` | `228, 54, 44` | For `rgba()` composition |
| `--accent-w` | `#271210` | Accent wash — tinted background behind accent content |
| `--danger` | `#E4362C` | Destructive actions. **Same red as accent, deliberately** |
| `--danger-w` | `#271210` | Danger wash |

**Work item type colours** — only Bug gets the accent:

| Token | Value |
|---|---|
| `--type-epic` / `--type-story` / `--type-task` | `var(--ink-2)` |
| `--type-bug` | `var(--accent)` |
| `--type-subtask` | `var(--ink-3)` |

## Typography

System stacks only — no webfonts, no network fetch, no FOUT.

| Token | Stack | Used for |
|---|---|---|
| `--sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | Body, UI chrome |
| `--mono` | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace` | **Every date, count, id and key** |

- Body: `13px` / `line-height 1.5`
- `h1` `21px`, weight `600`, `letter-spacing -.011em`; `h2`/`h3` same weight
- Monospace elements also set `font-variant-numeric: tabular-nums`

**Why monospace for data:** the audience is engineers; aligned digits scan faster
in a dense list. It is functional, not stylistic — do not "clean it up" to sans.

## Shape and motion

| Token | Value |
|---|---|
| `--r` | `3px` — the only border radius. Tasky is not a rounded product. |
| `--shadow-lift` | `0 10px 28px rgba(0,0,0,.55)` — modals and dragged cards only |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` |

## The left edge rule (the signature device)

Every work item card carries a vertical rule on its left edge:

- **Thickness = priority** — 1px low, 2px medium, 4px high
- **Colour = urgency** — turns `--accent` red when overdue

One device carries two dimensions and stays legible in a dense column, which a
row of coloured dots does not. This is the most distinctive thing about the UI.

## Component conventions

| Class | Meaning |
|---|---|
| `.btn` | Base button |
| `.btn-primary` | The single affirmative action on a screen |
| `.btn-danger` | Destructive — delete, remove, revoke |
| `.btn-quiet` | Tertiary/cancel — no fill |
| `.wi-card` | Work item card (carries the left edge rule) |
| `.column` / `.column-active` / `.column-done` | Board columns; `-active` is the only saturated one |
| `.key-pill` | Monospace `TASKY-12` identifier pill |
| `.type-badge` / `.type-dot` | Work item type indicator |
| `.role-badge` | owner / admin / member |
| `.status-tag` | Status chip, coloured by its category not its name |
| `.chip-check` / `.comp-chip` | Multi-select chips (components, labels) |
| `.modal` / `.modal-wide` / `.scrim` | Dialogs |
| `.skeleton-row` / `.skeleton-wrap` | Loading placeholders |
| `.toast` | Transient confirmation |
| `.mock-badge` | Bottom-right badge shown when running on the mock store |

## Logos and icons

The in-app brand mark is still the `.brand` CSS class — type, not a file. There
is no Tasky logo image; the user has deferred that.

The **favicon** is the Tailwebs corporate mark (white "tw" on red), taken from
tailwebs.com on 2026-09-07:

| File | Used as |
|---|---|
| `ui/static/img/favicon-150.png` | 32×32 icon, and the `/favicon.ico` redirect target |
| `ui/static/img/favicon-300.png` | 192×192 icon and `apple-touch-icon` |
| `design/img/favicon-*.png` | the prototype's own copies |

`design/` keeps duplicates on purpose: it is opened straight from the filesystem
with no server, so it cannot reach `ui/static/`.

Its red is `#E12B34`, near-identical to this app's `--accent` `#E4362C`. Close
enough that the two never look like different reds side by side — worth
preserving if the icon is ever re-cut.

`config/urls.py` redirects `/favicon.ico` to the 150px file, above the SPA
catch-all. Browsers request that path regardless of the `<link rel="icon">`
tags — `/admin/` especially, which renders no template of ours — and without the
route the catch-all would answer with the SPA shell, handing the browser HTML
where it asked for an image.

## Email vs web

Not applicable — Tasky sends no email. No SMTP, no templates, no notification
delivery of any kind exists (sub-project 12 Notifications is spec-only).

## Brand debt

Effectively none. The full hex census across both stylesheets:

- [ ] One bare `#fff` literal, outside the token system. Should be `var(--ink)`
      or a token of its own.

Every other colour in both files resolves through a `:root` token. When adding
UI, use tokens — never a raw hex.
