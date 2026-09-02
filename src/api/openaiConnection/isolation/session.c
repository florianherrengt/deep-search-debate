#define _GNU_SOURCE

#include "session.h"

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

#define CODEX_AS_LIMIT (4ULL * 1024ULL * 1024ULL * 1024ULL)
#define CODEX_CPU_LIMIT 600ULL
#define CODEX_FSIZE_LIMIT (64ULL * 1024ULL * 1024ULL)
#define CODEX_NOFILE_LIMIT 128ULL

void isolation_fail(const char *message) {
  int saved_errno = errno;
  if (saved_errno != 0) {
    fprintf(stderr, "rethinkloop-codex: %s: %s\n", message,
            strerror(saved_errno));
  } else {
    fprintf(stderr, "rethinkloop-codex: %s\n", message);
  }
  _exit(126);
}

void copy_required_env(const char *name, char destination[PATH_MAX]) {
  const char *value = getenv(name);
  size_t length;

  if (value == NULL || value[0] != '/') {
    errno = 0;
    isolation_fail("missing or non-absolute session path environment variable");
  }
  length = strnlen(value, PATH_MAX);
  if (length == PATH_MAX) {
    errno = ENAMETOOLONG;
    isolation_fail("session path is too long");
  }
  memcpy(destination, value, length + 1);
}

static void require_exact_directory(const char *path, uid_t uid) {
  struct stat status;
  char resolved[PATH_MAX];

  if (realpath(path, resolved) == NULL || strcmp(path, resolved) != 0) {
    errno = EINVAL;
    isolation_fail("session path must be canonical and may not contain symlinks");
  }
  if (lstat(path, &status) != 0 || !S_ISDIR(status.st_mode) ||
      status.st_uid != uid || (status.st_mode & 0777) != 0700) {
    errno = EACCES;
    isolation_fail(
        "session directories must be owned by the API user with mode 0700");
  }
}

static int has_session_root_prefix(const char *root) {
  static const char *prefixes[] = {
      "/dev/shm/rethinkloop-codex-",
      "/tmp/rethinkloop-codex-",
  };
  size_t index;

  for (index = 0; index < sizeof(prefixes) / sizeof(prefixes[0]); index++) {
    size_t prefix_length = strlen(prefixes[index]);
    const char *suffix;
    if (strncmp(root, prefixes[index], prefix_length) != 0) {
      continue;
    }
    suffix = root + prefix_length;
    if (*suffix != '\0' && strchr(suffix, '/') == NULL) {
      return 1;
    }
  }
  return 0;
}

void validate_layout(const char *home, const char *codex_home,
                     const char *work, const char *control,
                     char root[PATH_MAX]) {
  char expected[PATH_MAX];
  char cwd[PATH_MAX];
  size_t home_length = strlen(home);
  uid_t uid = getuid();

  if (uid == 0 || geteuid() != uid || getegid() != getgid()) {
    errno = EPERM;
    isolation_fail(
        "launcher requires an unprivileged process without set-id credentials");
  }
  if (strcmp(home, codex_home) != 0 || home_length <= strlen("/home") ||
      strcmp(home + home_length - strlen("/home"), "/home") != 0) {
    errno = EINVAL;
    isolation_fail("HOME and CODEX_HOME must be the session home directory");
  }
  if (home_length - strlen("/home") >= PATH_MAX) {
    errno = ENAMETOOLONG;
    isolation_fail("session root is too long");
  }
  memcpy(root, home, home_length - strlen("/home"));
  root[home_length - strlen("/home")] = '\0';
  if (!has_session_root_prefix(root)) {
    errno = EACCES;
    isolation_fail(
        "session root is outside the approved memory-backed or temp base");
  }

  if (snprintf(expected, sizeof(expected), "%s/work", root) >=
          (int)sizeof(expected) ||
      strcmp(expected, work) != 0) {
    errno = EINVAL;
    isolation_fail("TMPDIR must be the session work directory");
  }
  if (snprintf(expected, sizeof(expected), "%s/control", root) >=
          (int)sizeof(expected) ||
      strcmp(expected, control) != 0) {
    errno = EINVAL;
    isolation_fail("control directory must be the session control sibling");
  }
  if (getcwd(cwd, sizeof(cwd)) == NULL || strcmp(cwd, work) != 0) {
    errno = EINVAL;
    isolation_fail("launcher cwd must be the session work directory");
  }

  require_exact_directory(root, uid);
  require_exact_directory(home, uid);
  require_exact_directory(work, uid);
  require_exact_directory(control, uid);
}

static void set_limit(int resource, rlim_t value) {
  struct rlimit limit = {.rlim_cur = value, .rlim_max = value};
  if (setrlimit(resource, &limit) != 0) {
    isolation_fail("could not set process resource limit");
  }
}

void apply_resource_limits(void) {
  set_limit(RLIMIT_CORE, 0);
  set_limit(RLIMIT_AS, CODEX_AS_LIMIT);
  set_limit(RLIMIT_CPU, CODEX_CPU_LIMIT);
  set_limit(RLIMIT_NOFILE, CODEX_NOFILE_LIMIT);
  set_limit(RLIMIT_FSIZE, CODEX_FSIZE_LIMIT);
}

void close_inherited_file_descriptors(void) {
#ifdef __NR_close_range
  if (syscall(__NR_close_range, 3U, ~0U, 0U) == 0) {
    return;
  }
  if (errno != ENOSYS) {
    isolation_fail("could not close inherited file descriptors");
  }
#endif
  {
    struct rlimit limit;
    rlim_t descriptor;
    if (getrlimit(RLIMIT_NOFILE, &limit) != 0) {
      isolation_fail("could not read file descriptor limit");
    }
    for (descriptor = 3; descriptor < limit.rlim_cur; descriptor++) {
      close((int)descriptor);
    }
  }
}

void establish_lifetime_boundary(void) {
  pid_t parent = getppid();
  pid_t process = getpid();

  if (parent == 1) {
    errno = ESRCH;
    isolation_fail("API parent disappeared before launcher initialization");
  }
  if (setpgid(0, 0) != 0 && getpgrp() != process) {
    isolation_fail("could not create an isolated process group");
  }
  if (getpgrp() != process) {
    errno = EPERM;
    isolation_fail("launcher is not the leader of its process group");
  }
  if (prctl(PR_SET_PDEATHSIG, SIGKILL) != 0) {
    isolation_fail("could not configure parent-death signal");
  }
  if (getppid() != parent) {
    kill(process, SIGKILL);
    _exit(126);
  }
  if (prctl(PR_SET_DUMPABLE, 0) != 0) {
    isolation_fail("could not disable process dumps");
  }
}

void write_control_pid(const char *control) {
  char path[PATH_MAX];
  char contents[64];
  int descriptor;
  int length;
  ssize_t written;

  if (snprintf(path, sizeof(path), "%s/pid", control) >= (int)sizeof(path)) {
    errno = ENAMETOOLONG;
    isolation_fail("control pid path is too long");
  }
  descriptor = open(path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
                    0600);
  if (descriptor < 0) {
    isolation_fail("could not create control pid file");
  }
  length = snprintf(contents, sizeof(contents), "%ld\n", (long)getpid());
  written = write(descriptor, contents, (size_t)length);
  if (written != length || fsync(descriptor) != 0 || close(descriptor) != 0) {
    isolation_fail("could not persist control pid");
  }
}

void install_safe_environment(const char *home, const char *work) {
  if (setenv("HOME", home, 1) != 0 || setenv("CODEX_HOME", home, 1) != 0 ||
      setenv("TMPDIR", work, 1) != 0 ||
      setenv("PATH", "/nonexistent", 1) != 0 ||
      setenv("LANG", "C.UTF-8", 1) != 0 ||
      setenv("RUST_LOG", "error", 1) != 0 ||
      setenv("SSL_CERT_FILE", "/etc/ssl/certs/ca-certificates.crt", 1) != 0) {
    isolation_fail("could not construct safe Codex environment");
  }
}
