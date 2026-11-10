#!/usr/bin/env bash
# Measures processor throughput and peak memory (runs inside the processor test image). Output is a Markdown table.
set -euo pipefail
cd "$(dirname "$0")/../.."
docker build -q --target test -t docint-processor-test services/document-processor >/dev/null
docker run --rm -v "$PWD/services/document-processor/tools:/srv/tools:ro" -e PROCESSOR_SERVICE_TOKEN=unused-token-0123456789 -e PROCESSING_TIMEOUT_SECONDS=1800 -w /srv docint-processor-test python -m tools.bench
