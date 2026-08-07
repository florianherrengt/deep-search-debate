#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source "${SCRIPT_DIR}/config.sh"

readonly LINES="${1:-100}"

if [[ ! "${LINES}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Usage: ./coolify/logs.sh [positive-line-count]" >&2
  exit 2
fi

"${SCRIPT_DIR}/api.sh" GET "/applications/${COOLIFY_APPLICATION_UUID}/logs?lines=${LINES}" | jq -r '.logs'
