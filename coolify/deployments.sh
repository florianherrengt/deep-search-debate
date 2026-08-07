#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source "${SCRIPT_DIR}/config.sh"

readonly TAKE="${1:-10}"

if [[ ! "${TAKE}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Usage: ./coolify/deployments.sh [positive-count]" >&2
  exit 2
fi

"${SCRIPT_DIR}/api.sh" GET "/deployments/applications/${COOLIFY_APPLICATION_UUID}?skip=0&take=${TAKE}" | jq '{
  count,
  deployments: [.deployments[] | {
    deployment_uuid,
    status,
    commit,
    commit_message,
    restart_only,
    created_at,
    updated_at,
    finished_at
  }]
}'
