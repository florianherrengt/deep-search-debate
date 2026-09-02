#define _GNU_SOURCE

#include <errno.h>
#include <limits.h>
#include <stddef.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

#include "landlock.h"
#include "seccomp.h"
#include "session.h"

extern char **environ;

int main(int argc, char **argv) {
  char home[PATH_MAX];
  char codex_home[PATH_MAX];
  char work[PATH_MAX];
  char control[PATH_MAX];
  char root[PATH_MAX];
  char **codex_argv;
  int index;

  if (argc < 2) {
    errno = EINVAL;
    isolation_fail("expected Codex arguments");
  }

  copy_required_env("HOME", home);
  copy_required_env("CODEX_HOME", codex_home);
  copy_required_env("TMPDIR", work);
  copy_required_env("RETHINKLOOP_CODEX_CONTROL_DIR", control);
  if (clearenv() != 0) {
    isolation_fail("could not clear inherited environment");
  }

  umask(077);
  validate_layout(home, codex_home, work, control, root);
  close_inherited_file_descriptors();
  apply_resource_limits();
  establish_lifetime_boundary();
  write_control_pid(control);
  install_safe_environment(home, work);
  apply_landlock(home, work);
  apply_seccomp();

  codex_argv = calloc((size_t)argc + 1, sizeof(*codex_argv));
  if (codex_argv == NULL) {
    isolation_fail("could not allocate Codex argument vector");
  }
  codex_argv[0] = (char *)CODEX_BINARY_PATH;
  for (index = 1; index < argc; index++) {
    codex_argv[index] = argv[index];
  }
  codex_argv[argc] = NULL;

  execve(CODEX_BINARY_PATH, codex_argv, environ);
  isolation_fail("could not execute pinned native Codex binary");
}
