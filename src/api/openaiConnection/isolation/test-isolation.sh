#!/bin/sh
set -eu

launcher="${1:?usage: test-isolation.sh LAUNCHER}"
session_root="$(mktemp -d /dev/shm/rethinkloop-codex-XXXXXX)"
sibling_root="$(mktemp -d /dev/shm/rethinkloop-codex-XXXXXX)"

cleanup() {
  rm -rf "${session_root}" "${sibling_root}"
}
trap cleanup EXIT HUP INT TERM

mkdir "${session_root}/home" "${session_root}/work" "${session_root}/control"
mkdir "${sibling_root}/home" "${sibling_root}/work" "${sibling_root}/control"
chmod 0700 "${session_root}" "${session_root}/home" \
  "${session_root}/work" "${session_root}/control" \
  "${sibling_root}" "${sibling_root}/home" \
  "${sibling_root}/work" "${sibling_root}/control"

(
  cd "${session_root}/work"
  HOME="${session_root}/home" \
    CODEX_HOME="${session_root}/home" \
    TMPDIR="${session_root}/work" \
    RETHINKLOOP_CODEX_CONTROL_DIR="${session_root}/control" \
    SECRET_SHOULD_NOT_LEAK="production-secret" \
    "${launcher}" "${session_root}" "${sibling_root}" \
    9</app/package.json
)

test "$(stat -c '%a' "${session_root}/control/pid")" = "600"
grep -Eq '^[1-9][0-9]*$' "${session_root}/control/pid"
