# Helix Boltz worker for a Linux host with an NVIDIA GPU. Run with `--gpus all`.
FROM python:3.12.7-slim-bookworm

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    BOLTZ_CACHE=/models/boltz \
    BOLTZ_WORKER_DATA=/data/jobs \
    BOLTZ_ACCELERATOR=gpu \
    BOLTZ_DEVICES=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /worker
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY server.py fetch_weights.py ./

# Checkpoints (about 6.2 GB) live in a volume, fetched once with fetch_weights.py
VOLUME ["/models/boltz", "/data/jobs"]
EXPOSE 8200
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8200"]
