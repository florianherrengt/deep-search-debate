#!/bin/sh
set -eu

launcher="${1:-/usr/local/bin/rethinkloop-codex}"

new_session() {
  session_root="$(mktemp -d /dev/shm/rethinkloop-codex-XXXXXX)"
  mkdir "${session_root}/home" "${session_root}/work" \
    "${session_root}/control"
  chmod 0700 "${session_root}" "${session_root}/home" \
    "${session_root}/work" "${session_root}/control"
}

run_codex() {
  (
    cd "${session_root}/work"
    HOME="${session_root}/home" \
      CODEX_HOME="${session_root}/home" \
      TMPDIR="${session_root}/work" \
      RETHINKLOOP_CODEX_CONTROL_DIR="${session_root}/control" \
      "${launcher}" "$@"
  )
}

new_session
version="$(run_codex --version)"
test "${version}" = "codex-cli 0.149.1"
rm -rf "${session_root}"

new_session
rpc_output="$({
  printf '%s\n' \
    '{"id":0,"method":"initialize","params":{"clientInfo":{"name":"rethinkloop-build-smoke","title":"RethinkLoop build smoke","version":"1.0.0"}}}' \
    '{"method":"initialized","params":{}}' \
    '{"id":1,"method":"model/list","params":{"limit":1}}'
  sleep 2
} | run_codex app-server --listen stdio://)"
if ! printf '%s\n' "${rpc_output}" | grep -Fq '"id":0,"result":' || \
    ! printf '%s\n' "${rpc_output}" | grep -Fq '/0.149.1 '; then
  printf '%s\n' "${rpc_output}" >&2
  exit 1
fi
if ! printf '%s\n' "${rpc_output}" | grep -Fq '"id":1,"result":{"data":['; then
  printf '%s\n' "${rpc_output}" >&2
  exit 1
fi
rm -rf "${session_root}"

printf '%s\n' "codex launcher smoke passed"
