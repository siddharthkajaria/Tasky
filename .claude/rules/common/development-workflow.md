# Development workflow

## The two-phase rule comes first

Before writing production code for a sub-project, check whether its design is
signed off. `design/README.md` is the register. Sub-projects 1–11 are signed off
and shipped; 12 (Notifications) and 13 (Reporting) are spec-only and **behind the
gate**. See the hard rule in `CLAUDE.md`.

Wiring an already-signed-off sub-project into `ui/` is Phase 2 work on an
approved design — not new design work, and not gated.

## The loop

1. **Plan.** For anything beyond a one-file change, write the plan into
   `docs/superpowers/plans/` before touching code.
2. **Test first.** The suite is the safety net: 554 tests, 98% coverage.
   Write the failing test, then the code.
3. **Implement.** Business logic in `boards/services.py`, not in views.
4. **`make test`.** All 554 must pass. Not "the ones I touched".
5. **`make lint`.** Must be clean — CI enforces it.
6. **Update `docs/api.md`** if the API surface changed. It is the contract the
   front end is built against.
7. **Review, then commit.** One logical change per commit.

## Never

- Never leave the suite red or the linter dirty.
- Never commit `print()`, `breakpoint()`, or `# TODO: remove`.
- Never widen a permission "temporarily".
- Never introduce npm, a build step, or a front-end framework — see `CLAUDE.md`.
- Never add a queue, cron job, or worker without it being an explicit decision.
