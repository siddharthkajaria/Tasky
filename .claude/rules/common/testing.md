# Testing rules

## The bar

554 tests, 98% line coverage. **Both are the floor, not the target.** A change
that lowers either needs a stated reason.

```bash
make test            # all 554, ~3 min
make test-fast       # stop at first failure
make test-coverage   # per-file coverage
make smoke           # tests/ only — settings guard, SPA routing, smoke
```

## Conventions

- One file per feature area: `<app>/tests/test_<area>.py`
- pytest + pytest-django. `@pytest.mark.django_db` on anything touching the DB.
- No `factory_boy` in this project — tests build objects directly. Follow the
  surrounding file rather than introducing a factory library.
- Assert on **status code and body**, not just the status code. The API's error
  bodies are part of the contract documented in `docs/api.md`.

## What to test for every endpoint

1. The happy path.
2. **Unauthenticated → 403** (never 401 — this project's convention).
3. **Non-member → 403; missing id → 404.** Existence is checked before
   membership, so these are genuinely different paths.
4. Each role in the permission matrix that should be refused.
5. The documented error body for each rejection.

## Concurrency

There are **no threaded tests**, by choice — they are flaky against a shared
host MySQL. The two locking paths (key allocation, `move_work_item`) are covered
by deterministic regression tests instead. Do not add threaded tests; extend the
simulations.

## Do not weaken a test to make it pass

If a test fails after your change, the test is probably right. `pytest.raises`
should name the specific exception, never bare `Exception`.
