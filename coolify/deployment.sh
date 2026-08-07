#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if (( $# != 1 )); then
  echo "Usage: ./coolify/deployment.sh DEPLOYMENT_UUID" >&2
  exit 2
fi

readonly DEPLOYMENT_UUID="$1"

"${SCRIPT_DIR}/api.sh" GET "/deployments/${DEPLOYMENT_UUID}" | jq '{
  deployment_uuid,
  application_name,
  status,
  commit,
  commit_message,
  force_rebuild,
  restart_only,
  created_at,
  updated_at,
  finished_at,
  logs
}'
