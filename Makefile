# Tasky — the developer interface. Every daily command lives here.
#
# Local dev runs Django's runserver in Docker against MySQL native on the Mac.
# Staging and production run gunicorn behind Apache behind Cloudflare, from
# docker-compose.prod.yml. Which environment a target acts on is decided by
# ENV_FILE, never by guessing from the host.

DC       := docker compose
DC_PROD  := docker compose -f docker-compose.prod.yml
RUN      := $(DC) run --rm web
COMPOSE_HTTP_TIMEOUT := 180
export COMPOSE_HTTP_TIMEOUT

.DEFAULT_GOAL := help
.PHONY: help run run-d stop restart logs shell dbshell ps \
        test test-fast test-coverage smoke lint lint-fix format format-check \
        migrate makemigrations showmigrations createsuperuser collectstatic \
        build check-deploy cf-ips \
        deploy-stage deploy-stage-here stage-up stage-down stage-migrate stage-logs stage-shell \
        deploy-prod prod-up prod-down prod-migrate prod-logs prod-shell prod-verify prod-certs prod-backup \
        clean

help:  ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS=":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Local development ─────────────────────────────────────────────────────────
run:  ## Start the app in the foreground (http://localhost:8000)
	$(DC) up

run-d:  ## Start the app in the background
	$(DC) up -d

stop:  ## Stop and remove the local containers
	$(DC) down

restart:  ## Recreate the containers — required after editing .env
	$(DC) up -d --force-recreate

logs:  ## Follow local logs
	$(DC) logs -f

ps:  ## Show container status
	$(DC) ps

shell:  ## Django shell
	$(RUN) python manage.py shell

dbshell:  ## MySQL shell against the local database
	$(RUN) python manage.py dbshell

# ── Tests and quality ─────────────────────────────────────────────────────────
test:  ## Run the full suite (554 tests, ~3 min)
	$(RUN) pytest

test-fast:  ## Stop at the first failure
	$(RUN) pytest -x -q

test-coverage:  ## Run with a coverage report
	$(RUN) pytest -q --cov=accounts --cov=boards --cov=projects --cov=config \
		--cov-report=term-missing

smoke:  ## Fast sanity check — settings guard, SPA routing, smoke
	$(RUN) pytest tests/ -q

lint:  ## Lint
	$(RUN) ruff check .

lint-fix:  ## Lint and autofix
	$(RUN) ruff check . --fix

format:  ## Apply ruff's formatter (NOT enforced — large diff, see .github/workflows/ci.yml)
	$(RUN) ruff format .

format-check:  ## Report what the formatter would change
	$(RUN) ruff format --check .

check-deploy:  ## Django's own production readiness audit against .env.prod
	ENV_FILE=.env.prod $(DC) run --rm web python manage.py check --deploy

# ── Database ──────────────────────────────────────────────────────────────────
migrate:  ## Apply migrations locally
	$(RUN) python manage.py migrate

makemigrations:  ## Generate migrations
	$(RUN) python manage.py makemigrations

showmigrations:  ## List migrations and their state
	$(RUN) python manage.py showmigrations

createsuperuser:  ## Create a Django admin superuser
	$(RUN) python manage.py createsuperuser

collectstatic:  ## Gather static files into staticfiles/
	$(RUN) python manage.py collectstatic --noinput

build:  ## Rebuild the local image
	$(DC) build

cf-ips:  ## Refresh the Cloudflare trusted-proxy ranges
	@{ \
	  echo "# Cloudflare edge IP ranges — the ONLY proxies Apache will trust to set"; \
	  echo "# CF-Connecting-IP. Without this anyone could spoof their client IP by"; \
	  echo "# sending the header directly."; \
	  echo "#"; \
	  echo "# Snapshot taken $$(date +%Y-%m-%d) from https://www.cloudflare.com/ips-v4 and ips-v6."; \
	  echo "# Refresh with: make cf-ips"; \
	  echo ""; \
	  echo "RemoteIPHeader CF-Connecting-IP"; \
	  echo ""; \
	  curl -sf --max-time 20 https://www.cloudflare.com/ips-v4 | sed 's/^/RemoteIPTrustedProxy /'; \
	  echo ""; \
	  curl -sf --max-time 20 https://www.cloudflare.com/ips-v6 | sed 's/^/RemoteIPTrustedProxy /'; \
	} > deploy/apache/cloudflare-ips.conf
	@echo "Refreshed deploy/apache/cloudflare-ips.conf — rebuild the proxy to apply."

# ── Deploy pipeline ───────────────────────────────────────────────────────────
# Staging and production run the SAME steps. The only differences are the
# compose file, the env file, the git branch, and whether TLS is on.
#
#   branch check -> build -> migrate -> collectstatic -> up -> health -> prune
#
# Certificates are never a manual step: the proxy entrypoint generates a
# self-signed pair on first boot if none is present. Staging runs with TLS off
# entirely, so it needs no certificates at all.

DC_STAGE := docker compose -f docker-compose.stage.yml

# Compose only substitutes ${VAR} from the shell or the default .env — never
# from a service's env_file. TASKY_TLS is a compose-level variable (it selects
# the proxy's vhost), so setting it in .env.prod would otherwise be silently
# ignored. Lift it into the environment of every compose call instead, so the
# value documented in docs/deployment.md is the value that takes effect.
# Empty or absent falls through to the ${TASKY_TLS:-on} default in the compose file.
tls_from = TASKY_TLS=$(shell grep -sE '^TASKY_TLS=' $(1) | tail -1 | cut -d= -f2- | tr -d ' "'"'"'')
PROD_VARS  = ENV_FILE=.env.prod $(call tls_from,.env.prod)
STAGE_VARS = ENV_FILE=.env.stage

PROD_BRANCH  := main
STAGE_BRANCH := stage

# $(1) label  $(2) compose cmd  $(3) env file  $(4) health url  $(5) curl flags
define deploy
	@echo ""
	@echo "==> [$(1)] 1/6  building images"
	ENV_FILE=$(3) $(call tls_from,$(3)) $(2) build
	@echo ""
	@echo "==> [$(1)] 2/6  checking for unapplied model changes"
	@ENV_FILE=$(3) $(call tls_from,$(3)) $(2) run --rm web python manage.py makemigrations --check --dry-run \
		|| { echo "FATAL: models have changes with no migration. Run 'make makemigrations' and commit them."; exit 1; }
	@echo ""
	@echo "==> [$(1)] 3/6  applying migrations"
	ENV_FILE=$(3) $(call tls_from,$(3)) $(2) run --rm web python manage.py migrate --noinput
	@echo ""
	@echo "==> [$(1)] 4/6  collecting static files"
	ENV_FILE=$(3) $(call tls_from,$(3)) $(2) run --rm web python manage.py collectstatic --noinput
	@echo ""
	@echo "==> [$(1)] 5/6  starting the app"
	ENV_FILE=$(3) $(call tls_from,$(3)) $(2) up -d --remove-orphans
	@echo ""
	@echo "==> [$(1)] 6/6  waiting for a healthy response from $(4)"
	@ok=0; for i in 1 2 3 4 5 6 7 8 9 10 11 12; do \
		if curl -sf $(5) --max-time 5 "$(4)" >/dev/null 2>&1; then ok=1; break; fi; \
		sleep 5; \
	done; \
	if [ "$$ok" != "1" ]; then \
		echo ""; echo "FAILED: no healthy response after 60s. Recent logs:"; \
		ENV_FILE=$(3) $(call tls_from,$(3)) $(2) logs --tail 40; \
		exit 1; \
	fi
	@echo ""
	@echo "==> [$(1)] cleaning up build cache and dangling images"
	@docker image prune -f >/dev/null 2>&1 || true
	@docker builder prune -f >/dev/null 2>&1 || true
	@docker container prune -f >/dev/null 2>&1 || true
	@echo ""
	@echo "  [$(1)] deploy complete and healthy."
	@ENV_FILE=$(3) $(call tls_from,$(3)) $(2) ps
endef

# Refuse to deploy from the wrong branch or a dirty tree — the image is built
# from the working directory, so whatever is checked out is what ships.
define require_branch
	@current=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$current" != "$(1)" ]; then \
		echo "FATAL: on branch '$$current', but $(2) deploys from '$(1)'."; \
		echo "       git checkout $(1) && git pull"; exit 1; \
	fi
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "FATAL: working tree is dirty. The image is built from these files."; \
		git status --short; exit 1; \
	fi
endef

# ── Staging (this Mac, staging RDS, no TLS) ───────────────────────────────────
# The 'stage' branch does not exist yet. Until it does, use deploy-stage-here,
# which runs the identical pipeline against whatever is checked out.
deploy-stage:  ## Full staging deploy from the 'stage' branch
	@test -f .env.stage || { echo "FATAL: .env.stage is missing. See docs/.env.staging.example"; exit 1; }
	$(call require_branch,$(STAGE_BRANCH),staging)
	$(call deploy,staging,$(DC_STAGE),.env.stage,http://127.0.0.1:8000/api/auth/csrf/,)

deploy-stage-here:  ## Staging deploy from the current branch (until 'stage' exists)
	@test -f .env.stage || { echo "FATAL: .env.stage is missing. See docs/.env.staging.example"; exit 1; }
	@echo "NOTE: deploying staging from '$$(git rev-parse --abbrev-ref HEAD)', not '$(STAGE_BRANCH)'."
	$(call deploy,staging,$(DC_STAGE),.env.stage,http://127.0.0.1:8000/api/auth/csrf/,)

stage-up:  ## Start staging without rebuilding
	ENV_FILE=.env.stage $(DC_STAGE) up -d

stage-down:  ## Stop staging
	ENV_FILE=.env.stage $(DC_STAGE) down

stage-migrate:  ## Migrate the staging database
	ENV_FILE=.env.stage $(DC_STAGE) run --rm web python manage.py migrate

stage-logs:  ## Follow staging logs
	ENV_FILE=.env.stage $(DC_STAGE) logs -f

stage-shell:  ## Django shell against staging
	ENV_FILE=.env.stage $(DC_STAGE) run --rm web python manage.py shell

# ── Production (tasky.tailwebs.com, TLS on) ───────────────────────────────────
deploy-prod:  ## Full production deploy from 'main' (prompts first)
	@test -f .env.prod || { echo "FATAL: .env.prod is missing. See docs/.env.production.example"; exit 1; }
	$(call require_branch,$(PROD_BRANCH),production)
	@echo ""
	@echo "  Deploying to PRODUCTION — tasky.tailwebs.com"
	@echo "  Branch $(PROD_BRANCH) @ $$(git rev-parse --short HEAD)"
	@echo "  This migrates the production RDS database and restarts the live site."
	@echo ""
	@read -p "  Continue? [y/N] " ok; [ "$$ok" = "y" ] || { echo "Aborted."; exit 1; }
	$(call deploy,production,$(DC_PROD),.env.prod,https://127.0.0.1/api/auth/csrf/,-k)
	@$(MAKE) --no-print-directory prod-verify

prod-up:  ## Start production without rebuilding
	$(PROD_VARS) $(DC_PROD) up -d

prod-down:  ## Stop production
	$(PROD_VARS) $(DC_PROD) down

prod-migrate:  ## Migrate the production database
	$(PROD_VARS) $(DC_PROD) run --rm web python manage.py migrate

prod-logs:  ## Follow production logs
	$(PROD_VARS) $(DC_PROD) logs -f

prod-shell:  ## Django shell against production
	$(PROD_VARS) $(DC_PROD) run --rm web python manage.py shell

prod-verify:  ## Post-deploy checks — run this after every production deploy
	@echo ""
	@echo "── Post-deploy verification ─────────────────────────────────────────"
	@fail=0; \
	printf "  %-46s" "containers running"; \
	  n=$$($(PROD_VARS) $(DC_PROD) ps --status running -q | wc -l | tr -d ' '); \
	  if [ "$$n" = "2" ]; then echo "PASS  web + proxy"; else echo "FAIL  $$n of 2 running"; fail=1; fi; \
	printf "  %-46s" "gunicorn NOT published to the host"; \
	  if $(PROD_VARS) $(DC_PROD) port web 8000 >/dev/null 2>&1; then echo "FAIL  port 8000 is published"; fail=1; else echo "PASS"; fi; \
	printf "  %-46s" "SPA shell answers"; \
	  c=$$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://127.0.0.1/ 2>/dev/null || curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1/); \
	  if [ "$$c" = "200" ]; then echo "PASS  200"; else echo "FAIL  got $$c"; fail=1; fi; \
	printf "  %-46s" "unauthenticated API returns 403 not 401"; \
	  c=$$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://127.0.0.1/api/projects/ 2>/dev/null || curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1/api/projects/); \
	  if [ "$$c" = "403" ]; then echo "PASS  403"; else echo "FAIL  got $$c"; fail=1; fi; \
	printf "  %-46s" "static served by Apache"; \
	  s=$$(curl -skI --max-time 10 https://127.0.0.1/static/js/app.js 2>/dev/null | grep -i '^server:' || curl -sI --max-time 10 http://127.0.0.1/static/js/app.js | grep -i '^server:'); \
	  case "$$s" in *Apache*) echo "PASS  $$s";; *) echo "FAIL  $$s"; fail=1;; esac; \
	printf "  %-46s" "DEBUG is off (404 is not a traceback)"; \
	  b=$$(curl -sk --max-time 10 https://127.0.0.1/api/nope/ 2>/dev/null || curl -s --max-time 10 http://127.0.0.1/api/nope/); \
	  case "$$b" in *Traceback*|*DEBUG*) echo "FAIL  traceback leaked"; fail=1;; *) echo "PASS";; esac; \
	printf "  %-46s" "no unapplied migrations"; \
	  if $(PROD_VARS) $(DC_PROD) run --rm web python manage.py migrate --check >/dev/null 2>&1; then echo "PASS"; else echo "FAIL  run: make prod-migrate"; fail=1; fi; \
	printf "  %-46s" "Django deployment audit"; \
	  o=$$($(PROD_VARS) $(DC_PROD) run --rm web python manage.py check --deploy --fail-level WARNING 2>&1 | tail -1); \
	  case "$$o" in *"no issues"*) echo "PASS";; *) echo "FAIL  $$o"; fail=1;; esac; \
	echo "─────────────────────────────────────────────────────────────────────"; \
	if [ "$$fail" = "0" ]; then echo "  All checks passed."; else echo "  SOME CHECKS FAILED — see docs/deployment.md"; exit 1; fi

prod-certs:  ## Show the certificate the proxy is currently serving
	$(PROD_VARS) $(DC_PROD) exec proxy \
		openssl x509 -noout -subject -issuer -dates -in /usr/local/apache2/conf/certs/origin.pem

prod-backup:  ## Dump the production database to ./backups/
	@mkdir -p backups
	@set -a; . ./.env.prod; set +a; \
	out="backups/tasky_prod_$$(date +%Y%m%d_%H%M%S).sql"; \
	mysqldump -h "$$MYSQL_HOST" -P "$$MYSQL_PORT" -u "$$MYSQL_USER" -p"$$MYSQL_PASSWORD" \
		--single-transaction --routines --triggers "$$MYSQL_DATABASE" > "$$out"; \
	echo "Wrote $$out"

# ── Housekeeping ──────────────────────────────────────────────────────────────
clean:  ## Reclaim Docker disk on this machine (safe — keeps named volumes)
	docker image prune -f
	docker builder prune -f
	docker container prune -f
	@echo "Named volumes (media, static, databases) were NOT touched."
