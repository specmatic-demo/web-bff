#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_NAME="$(gh repo view --json name -q .name)"
REPO_ID="$(gh api 'repos/{owner}/{repo}' --jq .id)"
REPO_URL="$(gh repo view --json url -q .url)"

cd "${SCRIPT_DIR}"

echo "Submitting contract test report for ${REPO_NAME}"
docker run --rm -i \
  -v "${SCRIPT_DIR}:/usr/src/app" \
  -v "${HOME}/.specmatic:/root/.specmatic" \
  -w /usr/src/app \
  --network=host \
  specmatic/specmatic \
  send-report \
  --branch-name=main \
  --repo-name="${REPO_NAME}" \
  --repo-id="${REPO_ID}" \
  --repo-url="${REPO_URL}"
