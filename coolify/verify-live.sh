#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source "${SCRIPT_DIR}/config.sh"

application_json="$("${SCRIPT_DIR}/api.sh" GET "/applications/${COOLIFY_APPLICATION_UUID}")"
application_status="$(jq -r '.status' <<<"${application_json}")"
public_url="$(jq -r '.fqdn | split(",")[0]' <<<"${application_json}")"
public_url="${public_url%/}"

if [[ "${application_status}" != "running" && "${application_status}" != running:* ]]; then
  echo "Coolify does not report the application as running: ${application_status}" >&2
  exit 1
fi

if [[ "${public_url}" != https://* ]]; then
  echo "Coolify returned a non-HTTPS production URL: ${public_url}" >&2
  exit 1
fi

curl --silent --show-error --fail --connect-timeout 10 --max-time 20 "${public_url}/api/health" | jq -e '.status == "ok"' >/dev/null

echo "Coolify status: ${application_status}"
echo "Public health check: ${public_url}/api/health (ok)"
