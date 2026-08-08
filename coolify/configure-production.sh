#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source "${SCRIPT_DIR}/config.sh"

jq -n --arg name "${COOLIFY_PROJECT_NAME}" '{name: $name}' |
  "${SCRIPT_DIR}/api.sh" PATCH "/projects/${COOLIFY_PROJECT_UUID}" - >/dev/null

application_json="$("${SCRIPT_DIR}/api.sh" GET "/applications/${COOLIFY_APPLICATION_UUID}")"

public_url="$(jq -r '.fqdn | split(",")[0]' <<<"${application_json}")"
public_url="${public_url%/}"

if [[ "${public_url}" != "${COOLIFY_APPLICATION_URL}" ]]; then
  echo "Production requires ${COOLIFY_APPLICATION_URL} as the primary Coolify domain." >&2
  exit 1
fi

jq -n --arg name "${COOLIFY_APPLICATION_NAME}" '{
    name: $name,
    ports_exposes: "3000",
    ports_mappings: "4479:3000",
    health_check_enabled: true,
    health_check_path: "/api/health",
    health_check_port: "3000",
    health_check_host: "127.0.0.1",
    health_check_method: "GET",
    health_check_scheme: "http",
    health_check_return_code: 200,
    health_check_start_period: 300
  }' | "${SCRIPT_DIR}/api.sh" PATCH "/applications/${COOLIFY_APPLICATION_UUID}" - >/dev/null

echo "Configured the RethinkLoop resource names, host port 4479 to map to container port 3000, and the /api/health check. Runtime defaults come from the image and typed application config."
"${SCRIPT_DIR}/sync-proxy-labels.sh"
"${SCRIPT_DIR}/check-config.sh"
