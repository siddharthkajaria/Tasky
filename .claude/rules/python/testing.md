# pytest conventions here

```python
import pytest

@pytest.mark.django_db
def test_non_member_cannot_open_project(auth_client, other_project):
    response = auth_client.get(f"/api/projects/{other_project.id}/")
    assert response.status_code == 403
```

- Fixtures live in `conftest.py` at the repo root.
- `@pytest.mark.django_db` on anything touching the database.
- No `factory_boy` — objects are built directly. Follow the surrounding file.
- Name tests for the behaviour, not the method: `test_owner_cannot_leave_project`,
  not `test_leave_400`.
- `pytest.raises` must name the specific exception. Bare `Exception` is caught by
  ruff (B017).
- Assert on the response **body** as well as the status, for anything whose error
  shape is documented in `docs/api.md`.

Run with `make test`. Coverage floor is 98% — `make test-coverage` to check.
