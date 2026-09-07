# Git workflow

## Never commit directly to a deployment branch

**`main` and `stage` receive code through a pull request only.** No direct
commits, no direct pushes, no exceptions — this holds even for a one-line fix
and even when the change is obviously safe.

Every piece of work starts by branching off whichever branch it targets:

```bash
git checkout main && git pull      # or stage, or the feature branch
git checkout -b <type>/<slug>
# ...work...
git push -u origin <type>/<slug>
gh pr create --base main           # or --base stage
```

Branch off the branch you intend to merge back into. Work that targets staging
branches from `stage`; work stacked on an unmerged feature branches from that
feature branch and PRs back into it.

## Branches

| Prefix | For |
|---|---|
| `feat/` | new feature |
| `fix/` | bug fix |
| `chore/` | deps, config, tooling |
| `docs/` | documentation only |
| `test/` | tests only |
| `refactor/` | restructuring, no behaviour change |
| `hotfix/` | urgent production fix |

**Deployment branches:** `main` → production. `stage` → staging *(not created
yet — use `make deploy-stage-here` until it exists)*.

Set upstream explicitly on the first push, or git may inherit `origin/main`:

```bash
git push -u origin <branch-name>
git branch -vv        # must show [origin/<branch-name>], not [origin/main]
```

## Commits — Conventional Commits

```
<type>(<scope>): <imperative, lowercase, no period, <=72 chars>

Why, not what. The diff shows what.
```

Types: `feat` `fix` `docs` `test` `chore` `refactor` `perf` `ci` `build` `revert`

## Stage deliberately

**Never `git add .` or `git add -A`.**

```bash
git status            # what changed
git diff              # review it
git add <file>        # stage only what you touched
git diff --staged     # review what will be committed
git commit
```

If `git status` shows a file you did not touch, investigate rather than stage it.
One logical change per commit.

## Merging

| Flow | Strategy |
|---|---|
| feature → `main` | squash and merge, after review |
| `hotfix/` → `main` | merge commit, preserves context |

`main` is the production branch. Until GitHub Actions is enabled for this org,
the gate is local: **run `make test` and `make lint` yourself** before merging.
`.github/workflows/ci.yml` is committed but parked (`workflow_dispatch` only).
Enable branch protection and required status checks when Actions works.

## Deploys build from the working tree

`make deploy-prod` and `make deploy-stage` refuse to run on the wrong branch or
a dirty tree — the Docker image is built from whatever is checked out, so a
stray edit would ship.
