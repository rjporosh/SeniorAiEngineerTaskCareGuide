FROM python:3.13-slim AS base
# OMP_THREAD_LIMIT=1: Tesseract's OpenMP otherwise spawns one thread per host CPU even in a CPU-limited container,
# which made OCR time out on small CI runners. Parallelism comes from PROCESSOR_CONCURRENCY instead.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 OMP_THREAD_LIMIT=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng fonts-dejavu-core curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

FROM base AS test
COPY requirements-dev.txt .
RUN pip install -r requirements-dev.txt
COPY app app
COPY tests tests
CMD ["pytest", "-q", "--timeout=300", "-p", "no:cacheprovider"]

FROM base AS runtime
RUN useradd --system --uid 10001 --home /nonexistent --shell /usr/sbin/nologin processor
COPY app app
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --retries=10 CMD curl -fsS http://127.0.0.1:8000/health/live || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
