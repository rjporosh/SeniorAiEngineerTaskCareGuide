#!/usr/bin/env bash
# Regenerates fixtures/synthetic (deterministic, seeded). Runs inside the processor test image: no host Python needed.
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -q --target test -t docint-processor-test services/document-processor >/dev/null
docker run --rm -v "$PWD/fixtures/synthetic:/out" -v "$PWD/services/document-processor/tools:/srv/tools:ro" \
  -e PROCESSOR_SERVICE_TOKEN=unused-token-0123456789 -w /srv docint-processor-test \
  python tools/generate_dataset.py /out
