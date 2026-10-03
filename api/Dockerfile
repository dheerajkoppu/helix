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

WORKDIR /app/api
EXPOSE 8000
CMD ["uvicorn", "helix.main:app", "--host", "0.0.0.0", "--port", "8000"]
