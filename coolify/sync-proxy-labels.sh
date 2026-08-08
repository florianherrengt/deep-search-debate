#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source "${SCRIPT_DIR}/config.sh"

application_json="$("${SCRIPT_DIR}/api.sh" GET "/applications/${COOLIFY_APPLICATION_UUID}")"
raw_labels="$(jq -r '.custom_labels // ""' <<<"${application_json}")"
current_labels="${raw_labels}"
if decoded_labels="$(printf '%s' "${raw_labels}" | base64 --decode 2>/dev/null)" &&
  grep -Eq '(^|\n)(traefik\.|caddy_)' <<<"${decoded_labels}"; then
  current_labels="${decoded_labels}"
fi

if [[ -z "${current_labels}" ]]; then
  echo "Coolify has no generated proxy labels to synchronize." >&2
  exit 1
fi

updated_labels="$(printf '%s\n' "${current_labels}" | awk '
  /traefik\.http\.services\..*\.loadbalancer\.server\.port=/ { sub(/=[0-9]+$/, "=3000") }
  /caddy_.*reverse_proxy=/ { sub(/upstreams [0-9]+/, "upstreams 3000") }
  { print }
')"

if ! grep -Eq 'traefik\.http\.services\..*\.loadbalancer\.server\.port=3000$' <<<"${updated_labels}" ||
  ! grep -Eq 'caddy_.*reverse_proxy=\{\{upstreams 3000\}\}$' <<<"${updated_labels}"; then
  echo "Could not identify the expected generated Traefik and Caddy labels." >&2
  exit 1
fi

if [[ "${updated_labels}" == "${current_labels}" ]]; then
  echo "Coolify proxy labels already target port 3000."
  exit 0
fi

encoded_labels="$(printf '%s' "${updated_labels}" | base64 | tr -d '\n')"
jq -n --arg custom_labels "${encoded_labels}" '{custom_labels: $custom_labels}' |
  "${SCRIPT_DIR}/api.sh" PATCH "/applications/${COOLIFY_APPLICATION_UUID}" - >/dev/null

echo "Updated generated Traefik and Caddy labels to target port 3000."
