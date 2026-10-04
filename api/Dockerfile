# Helix API and job worker. Build from the repository root:
#   docker build -f api/Dockerfile -t helix-api .
FROM python:3.14-slim-bookworm

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# RDKit drawing needs these shared libraries
RUN apt-get update \
    && apt-get install -y --no-install-recommends libxrender1 libxext6 libexpat1 \
    && rm -rf /var/lib/apt/lists/*

# The package finds data/seed and data/examples relative to itself, so the image keeps the repository layout
WORKDIR /app
COPY api/pyproject.toml api/README.md api/
COPY api/helix api/helix
RUN pip install -e "api[postgres,redis,s3]"

COPY data/seed data/seed
COPY data/examples data/examples

# The lab as the API reads it: recorded runs, the agent manifest and the benchmark result. The
# launcher and lab/.venv are left out on purpose, so starting a new run reports "not configured"
# (helix.services.lab.start_run) instead of failing where Omnigent cannot be installed.
COPY lab/runs lab/runs
COPY lab/agents lab/agents
COPY lab/experiments/results lab/experiments/results

# Recorded upstream responses, loaded into the cache at startup. Optional: the image builds and the
# API runs without it, the first visitor just waits on the sources instead.
COPY api/scripts api/scripts
COPY data/cache data/cache

WORKDIR /app/api
EXPOSE 8000
CMD ["sh", "-c", "python scripts/seed_http_cache.py ../data/cache/chembl-http-cache.db.gz; exec uvicorn helix.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
