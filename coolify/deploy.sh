#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source "${SCRIPT_DIR}/config.sh"

force=false
instant=false

for option in "$@"; do
  case "${option}" in
    --force) force=true ;;
    --instant) instant=true ;;
    *)
      echo "Usage: ./coolify/deploy.sh [--force] [--instant]" >&2
      exit 2
      ;;
  esac
done

"${SCRIPT_DIR}/api.sh" POST "/applications/${COOLIFY_APPLICATION_UUID}/start?force=${force}&instant_deploy=${instant}" | jq .
