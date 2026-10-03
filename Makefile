# Helix: API (FastAPI, Python 3.14) in api/, web (Next.js 16, pnpm) in web/.
#
#   make setup    install both halves
#   make dev      API on :8000 and web on :3000, stopped together with Ctrl-C
#
# Configuration is optional: copy .env.example to .env to change anything.

PYTHON   ?= python3.14
VENV     := api/.venv
API_PORT ?= 8000
WEB_PORT ?= 3000
# Python extras installed by `make setup`: dev, postgres, redis, s3
EXTRAS   ?= dev
# Passed to the seed builder, e.g. make seed SEED_ARGS="--refresh clinvar"
SEED_ARGS ?=
# Passed to the cache warmer, e.g. make warm WARM_ARGS="BTK ADA --passes 2"
WARM_ARGS ?=

UVICORN_FLAGS := --port $(API_PORT)
ifdef RELOAD
UVICORN_FLAGS += --reload --reload-dir helix
endif

# Set API_URL only when the web app should call an API that is not http://localhost:8000
WEB_ENV := $(if $(API_URL),NEXT_PUBLIC_API_URL=$(API_URL))

.DEFAULT_GOAL := help
.PHONY: help setup setup-api setup-web seed warm api worker web dev types build check lint clean

help:
	@echo "make setup    create api/.venv, install the API (EXTRAS=$(EXTRAS)) and the web dependencies"
	@echo "make seed     rebuild data/seed/catalog.json from its sources (SEED_ARGS=\"--refresh all\")"
	@echo "make warm     preload the upstream cache for the flagship genes (WARM_ARGS=\"BTK ADA\")"
	@echo "make api      run the API on port $(API_PORT) (RELOAD=1 restarts it when api/helix changes)"
	@echo "make web      run the web dev server on port $(WEB_PORT) (API_URL=http://host:port for another API)"
	@echo "make dev      run API and web together"
	@echo "make types    regenerate api/openapi.json and web/src/lib/api/schema.ts"
	@echo "make build    production build of the web app"
	@echo "make check    API imports in strict mode, generated types are current, tsc, eslint"
	@echo "make worker   job worker process (Redis queue only)"
	@echo "make lint     ruff over api/"
	@echo "make clean    remove api/var (job database and stored artifacts) and the web build output"

setup: setup-api setup-web

setup-api:
	test -x $(VENV)/bin/python || $(PYTHON) -m venv $(VENV)
	$(VENV)/bin/python -m pip install --quiet --upgrade pip
	$(VENV)/bin/python -m pip install --quiet -e "api[$(EXTRAS)]"

setup-web:
	cd web && pnpm install --frozen-lockfile

seed:
	$(VENV)/bin/python api/scripts/build_seed.py $(SEED_ARGS)

# Uses the API on API_PORT when it is running, otherwise the services in its own process
warm:
	cd api && .venv/bin/python scripts/warm_cache.py --api http://localhost:$(API_PORT) $(WARM_ARGS)

api:
	cd api && exec .venv/bin/uvicorn helix.main:app $(UVICORN_FLAGS)

worker:
	cd api && exec .venv/bin/python -m helix.worker

# scripts/dev.mjs restarts next dev when it exits abnormally
web:
	cd web && $(WEB_ENV) exec node scripts/dev.mjs --port $(WEB_PORT)

# Both servers in one terminal. Ctrl-C, or the exit of either one, stops the other.
dev:
	@(cd api && exec .venv/bin/uvicorn helix.main:app $(UVICORN_FLAGS)) & api_pid=$$!; \
	(cd web && $(WEB_ENV) exec node scripts/dev.mjs --port $(WEB_PORT)) & web_pid=$$!; \
	trap 'kill $$api_pid $$web_pid 2>/dev/null; wait; exit 0' INT TERM; \
	while kill -0 $$api_pid 2>/dev/null && kill -0 $$web_pid 2>/dev/null; do sleep 1; done; \
	kill $$api_pid $$web_pid 2>/dev/null; wait

# The OpenAPI document is the contract: regenerate both files after adding or changing a route or schema.
types:
	cd api && .venv/bin/python -m helix.openapi --strict
	cd web && pnpm exec openapi-typescript ../api/openapi.json -o src/lib/api/schema.ts

build:
	cd web && pnpm build

check:
	mkdir -p api/var
	cd api && .venv/bin/python -m helix.openapi --strict --output var/openapi.check.json
	cmp api/openapi.json api/var/openapi.check.json || (echo "api/openapi.json is out of date: run make types" && exit 1)
	cd web && pnpm exec openapi-typescript ../api/openapi.json -o src/lib/api/schema.ts --check
	cd web && pnpm exec tsc --noEmit
	cd web && pnpm exec eslint src

lint:
	$(VENV)/bin/python -m ruff check api
	$(VENV)/bin/python -m ruff format --check api

# next-env.d.ts points into web/.next, so it goes with it; next dev and next build write it again
clean:
	rm -rf api/var web/.next web/next-env.d.ts web/tsconfig.tsbuildinfo
