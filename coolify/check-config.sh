#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source "${SCRIPT_DIR}/config.sh"

application_json="$("${SCRIPT_DIR}/api.sh" GET "/applications/${COOLIFY_APPLICATION_UUID}")"
environment_json="$("${SCRIPT_DIR}/api.sh" GET "/applications/${COOLIFY_APPLICATION_UUID}/envs")"

configuration_ok=true

if ! jq -e '
  .build_pack == "dockerfile" and
  .base_directory == "/" and
  .dockerfile_location == "/Dockerfile" and
  .ports_exposes == "3000" and
  .ports_mappings == "4479:3000" and
  .health_check_enabled == true and
  .health_check_path == "/api/health" and
  .health_check_port == "3000" and
  .health_check_host == "127.0.0.1" and
  .health_check_method == "GET" and
  .health_check_scheme == "http" and
  .health_check_return_code == 200 and
  .health_check_start_period == 300
' >/dev/null <<<"${application_json}"; then
  configuration_ok=false
  echo "Coolify application configuration is incorrect:" >&2
  jq '{
    build_pack,
    base_directory,
    dockerfile_location,
    ports_exposes,
    ports_mappings,
    health_check_enabled,
    health_check_path,
    health_check_port,
    health_check_host,
    health_check_method,
    health_check_scheme,
    health_check_return_code,
    health_check_start_period
  }' <<<"${application_json}" >&2
fi

public_url="$(jq -r '.fqdn | split(",")[0]' <<<"${application_json}")"
public_url="${public_url%/}"
if [[ "${public_url}" != "${COOLIFY_APPLICATION_URL}" ]]; then
  configuration_ok=false
  echo "The primary Coolify domain must be ${COOLIFY_APPLICATION_URL}; found ${public_url}." >&2
fi

raw_proxy_labels="$(jq -r '.custom_labels // ""' <<<"${application_json}")"
proxy_labels="${raw_proxy_labels}"
if decoded_proxy_labels="$(printf '%s' "${raw_proxy_labels}" | base64 --decode 2>/dev/null)" &&
  grep -Eq '(^|\n)(traefik\.|caddy_)' <<<"${decoded_proxy_labels}"; then
  proxy_labels="${decoded_proxy_labels}"
fi

if [[ -z "${proxy_labels}" ]]; then
  configuration_ok=false
  echo "Coolify proxy labels are missing." >&2
else
  if ! grep -Eq 'traefik\.http\.services\..*\.loadbalancer\.server\.port=3000$' <<<"${proxy_labels}" ||
    ! grep -Eq 'caddy_.*reverse_proxy=\{\{upstreams 3000\}\}$' <<<"${proxy_labels}" ||
    grep -E 'loadbalancer\.server\.port=|reverse_proxy=\{\{upstreams ' <<<"${proxy_labels}" | grep -Ev 'server\.port=3000$|upstreams 3000\}\}$' >/dev/null; then
    configuration_ok=false
    echo "Coolify proxy labels do not exclusively target port 3000." >&2
  fi
fi

required_runtime_keys=(
  KDBX_PASSWORD
)

for key in "${required_runtime_keys[@]}"; do
  if ! jq -e --arg key "${key}" '
    any(.[];
      .key == $key and
      .is_preview == false and
      .is_buildtime == false and
      .is_runtime == true and
      .is_literal == true and
      (((.real_value // .value // "") | tostring | length) > 0)
    )
  ' >/dev/null <<<"${environment_json}"; then
    configuration_ok=false
    echo "${key} is missing, empty, or is not a literal production runtime variable." >&2
  fi
done

check_optional_environment() {
  local key="$1"
  local expected_value="$2"

  if jq -e --arg key "${key}" '
    any(.[]; .key == $key and .is_preview == false)
  ' >/dev/null <<<"${environment_json}" && ! jq -e --arg key "${key}" --arg value "${expected_value}" '
    any(.[];
      .key == $key and
      .is_preview == false and
      .is_buildtime == false and
      .is_runtime == true and
      .is_literal == true and
      (.real_value // .value // "") == $value
    )
  ' >/dev/null <<<"${environment_json}"; then
    configuration_ok=false
    echo "${key} overrides the image or inferred production default with an invalid value." >&2
  fi
}

check_optional_environment "NODE_ENV" "production"
check_optional_environment "API_HOST" "0.0.0.0"
check_optional_environment "PORT" "3000"
check_optional_environment "DATABASE_URL" "/app/data/data.db"
check_optional_environment "AUTH_DEBUG_USER_ENABLED" "false"

if jq -e 'any(.[]; .key == "BETTER_AUTH_URL" and .is_preview == false)' >/dev/null <<<"${environment_json}" &&
  ! jq -e --arg public_url "${public_url}" '
    any(.[];
      .key == "BETTER_AUTH_URL" and
      .is_preview == false and
      ((.real_value // .value // "") | rtrimstr("/")) == $public_url
    )
  ' >/dev/null <<<"${environment_json}"; then
  configuration_ok=false
  echo "BETTER_AUTH_URL overrides the configured production default but does not match the primary Coolify HTTPS domain." >&2
fi

if jq -e 'any(.[]; .key == "SEARXNG_URL" and .is_preview == false)' >/dev/null <<<"${environment_json}"; then
  configuration_ok=false
  echo "SEARXNG_URL must not be configured in production; this deployment uses Brave." >&2
fi

if [[ "${configuration_ok}" != true ]]; then
  exit 1
fi

echo "Coolify production configuration is valid."
