#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source "${SCRIPT_DIR}/config.sh"

usage() {
  cat <<'EOF'
Usage: ./coolify/api.sh METHOD /endpoint [JSON|-]

Examples:
  ./coolify/api.sh GET /applications
  ./coolify/api.sh GET /applications/uk9l7wyulny8bxcrkysddlws
  printf '%s\n' '{"name":"rethinkloop"}' | \
    ./coolify/api.sh PATCH /applications/uk9l7wyulny8bxcrkysddlws -

The endpoint must start with /. It is always sent to the configured Coolify API
base, so the bearer token cannot be redirected to another host.

Use - to read a JSON body from standard input. Prefer that form for secrets so
they do not appear in process arguments.
EOF
}

if (( $# < 2 || $# > 3 )); then
  usage >&2
  exit 2
fi

METHOD="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
readonly METHOD
readonly ENDPOINT="$2"
readonly JSON_BODY="${3-}"
readonly TOKEN_FILE="${SCRIPT_DIR}/coolify_token"

case "${METHOD}" in
  GET | POST | PUT | PATCH | DELETE) ;;
  *)
    echo "Unsupported HTTP method: ${METHOD}" >&2
    exit 2
    ;;
esac

if [[ "${ENDPOINT}" != /* || "${ENDPOINT}" == //* ]]; then
  echo "Endpoint must be an API path beginning with one /: ${ENDPOINT}" >&2
  exit 2
fi

if [[ ! -s "${TOKEN_FILE}" ]]; then
  echo "Missing or empty token file: ${TOKEN_FILE}" >&2
  exit 1
fi

readonly TOKEN="$(tr -d '\r\n' < "${TOKEN_FILE}")"

if [[ -z "${TOKEN}" ]]; then
  echo "Token file contains no usable token: ${TOKEN_FILE}" >&2
  exit 1
fi

curl_args=(
  --silent
  --show-error
  --fail-with-body
  --connect-timeout 10
  --max-time 120
  --request "${METHOD}"
  --url "${COOLIFY_API_BASE}${ENDPOINT}"
  --header @/dev/fd/3
  --header "Accept: application/json"
)

if [[ "${JSON_BODY}" == "-" ]]; then
  curl_args+=(
    --header "Content-Type: application/json"
    --data-binary @-
  )
elif [[ -n "${JSON_BODY}" ]]; then
  curl_args+=(
    --header "Content-Type: application/json"
    --data-binary "${JSON_BODY}"
  )
fi

curl "${curl_args[@]}" 3<<<"Authorization: Bearer ${TOKEN}"
