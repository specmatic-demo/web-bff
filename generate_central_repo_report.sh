#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "${SCRIPT_DIR}"

echo "Generating central contract repo report"
docker run --rm -i \
  -v "${SCRIPT_DIR}:/usr/src/app" \
  -v "${HOME}/.specmatic:/root/.specmatic" \
  -w /usr/src/app/specs \
  --network=host \
  specmatic/specmatic \
  central-contract-repo-report
