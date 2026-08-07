#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=config.sh
source "${SCRIPT_DIR}/config.sh"

"${SCRIPT_DIR}/api.sh" GET "/applications/${COOLIFY_APPLICATION_UUID}" | jq '{
  uuid,
  name,
  status,
  fqdn,
  git_branch,
  git_commit_sha,
  updated_at
}'
