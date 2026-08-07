#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source "${SCRIPT_DIR}/config.sh"

application_json="$("${SCRIPT_DIR}/api.sh" GET "/applications/${COOLIFY_APPLICATION_UUID}")"
environment_json="$("${SCRIPT_DIR}/api.sh" GET "/applications/${COOLIFY_APPLICATION_UUID}/envs")"

public_url="$(jq -r '.fqdn | split(",")[0]' <<<"${application_json}")"
public_url="${public_url%/}"

if [[ "${public_url}" != https://* ]]; then
  echo "Production requires an HTTPS domain. Configure the application's primary domain in Coolify first." >&2
  exit 1
fi

upsert_runtime_environment() {
  local key="$1"
  local value="$2"
  local method="POST"

  if jq -e --arg key "${key}" 'any(.[]; .key == $key and .is_preview == false)' >/dev/null <<<"${environment_json}"; then
    method="PATCH"
  fi

  jq -n \
    --arg key "${key}" \
    --arg value "${value}" \
    '{
      key: $key,
      value: $value,
      is_preview: false,
      is_literal: true,
      is_multiline: false,
      is_shown_once: false,
      is_buildtime: false,
      is_runtime: true
    }' | "${SCRIPT_DIR}/api.sh" "${method}" "/applications/${COOLIFY_APPLICATION_UUID}/envs" - >/dev/null
}

upsert_runtime_environment "NODE_ENV" "production"
upsert_runtime_environment "API_HOST" "0.0.0.0"
upsert_runtime_environment "PORT" "3000"
upsert_runtime_environment "DATABASE_URL" "/app/data/data.db"
upsert_runtime_environment "AUTH_DEBUG_USER_ENABLED" "false"
upsert_runtime_environment "BETTER_AUTH_URL" "${public_url}"

jq -n '{
  ports_exposes: "3000",
  ports_mappings: "",
  health_check_enabled: true,
  health_check_path: "/api/health",
  health_check_port: "3000",
  health_check_host: "127.0.0.1",
  health_check_method: "GET",
  health_check_scheme: "http",
  health_check_return_code: 200
}' | "${SCRIPT_DIR}/api.sh" PATCH "/applications/${COOLIFY_APPLICATION_UUID}" - >/dev/null

echo "Configured container port 3000, the /api/health check, the auth URL, and non-secret production runtime defaults."
"${SCRIPT_DIR}/sync-proxy-labels.sh"
"${SCRIPT_DIR}/check-config.sh"
