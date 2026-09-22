#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_ci-common.sh
source "${SCRIPT_DIR}/_ci-common.sh"

init_specmatic_cmd
init_colors

REPO_URL="$(git -C "${SCRIPT_DIR}" config --get remote.origin.url | sed -E 's#^git@github.com:#https://github.com/#; s#\.git$##')"
REPO_SLUG="${REPO_URL#https://github.com/}"
export SPECMATIC_REPO_ID="$(gh api "repos/${REPO_SLUG}" --jq .id)"
export SPECMATIC_REPO_NAME="${REPO_SLUG##*/}"
export SPECMATIC_REPO_URL="${REPO_URL}"
export SPECMATIC_BUILD_ID="${SPECMATIC_BUILD_ID:-${GITHUB_RUN_ID:-local-central-report}}"
export SPECMATIC_BRANCH_NAME="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-main}}"
export SPECMATIC_RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT:-1}"

SPECS_DIR="${SCRIPT_DIR}/specs"

if [[ ! -d "${SPECS_DIR}" ]]; then
  echo "Specs directory not found: ${SPECS_DIR}" >&2
  exit 1
fi

cd "${SPECS_DIR}"

echo "${C_BLUE}Generating central contract repo report from ${SPECS_DIR}${C_RESET}"
"${SPECMATIC_CMD[@]}" central-contract-repo-report 2>&1 | prefix_output "$C_GREEN" "central-repo-report"
