#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if (( $# < 1 || $# > 2 )); then
  echo "Usage: ./coolify/wait-deployment.sh DEPLOYMENT_UUID [timeout-seconds]" >&2
  exit 2
fi

readonly DEPLOYMENT_UUID="$1"
readonly TIMEOUT_SECONDS="${2:-900}"

if [[ ! "${TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Timeout must be a positive number of seconds." >&2
  exit 2
fi

readonly DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))
last_status=""

while (( $(date +%s) < DEADLINE )); do
  deployment_json="$("${SCRIPT_DIR}/api.sh" GET "/deployments/${DEPLOYMENT_UUID}")"
  deployment_status="$(jq -r '.status' <<<"${deployment_json}")"

  if [[ "${deployment_status}" != "${last_status}" ]]; then
    echo "Deployment status: ${deployment_status}"
    last_status="${deployment_status}"
  fi

  case "${deployment_status}" in
    finished)
      jq '{deployment_uuid, status, commit, commit_message, force_rebuild, created_at, updated_at, finished_at}' <<<"${deployment_json}"
      exit 0
      ;;
    failed | cancelled | cancelled-by-user)
      jq '{deployment_uuid, status, commit, commit_message, updated_at, finished_at}' <<<"${deployment_json}" >&2
      echo "Deployment did not finish successfully. Inspect it with ./coolify/deployment.sh ${DEPLOYMENT_UUID}" >&2
      exit 1
      ;;
  esac

  sleep 5
done

echo "Timed out waiting for deployment ${DEPLOYMENT_UUID}." >&2
exit 1
