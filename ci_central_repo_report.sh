#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_ci-common.sh
source "${SCRIPT_DIR}/_ci-common.sh"

init_specmatic_cmd
init_colors

SPECS_DIR="${SCRIPT_DIR}/specs"

if [[ ! -d "${SPECS_DIR}" ]]; then
  echo "Specs directory not found: ${SPECS_DIR}" >&2
  exit 1
fi

cd "${SPECS_DIR}"

echo "${C_BLUE}Generating central contract repo report from ${SPECS_DIR}${C_RESET}"
"${SPECMATIC_CMD[@]}" central-contract-repo-report 2>&1 | prefix_output "$C_GREEN" "central-repo-report"
