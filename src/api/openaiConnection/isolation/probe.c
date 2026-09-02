#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/sched.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/ptrace.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

extern char **environ;

static void die(const char *message) {
  fprintf(stderr, "isolation probe failed: %s (errno=%d: %s)\n", message, errno,
          strerror(errno));
  _exit(1);
}

static void expect_denied_open(const char *path, int flags) {
  int descriptor;
  errno = 0;
  descriptor = open(path, flags, 0600);
  if (descriptor >= 0) {
    close(descriptor);
    errno = 0;
    die("forbidden path was accessible");
  }
  if (errno != EACCES && errno != EPERM) {
    die("forbidden path failed for an unexpected reason");
  }
}

static void expect_readable(const char *path) {
  int descriptor = open(path, O_RDONLY | O_CLOEXEC);
  if (descriptor < 0) {
    die("required read-only runtime file was inaccessible");
  }
  close(descriptor);
}

static int is_safe_environment_name(const char *entry) {
  static const char *names[] = {
      "HOME=", "CODEX_HOME=", "TMPDIR=", "PATH=", "LANG=", "RUST_LOG=",
      "SSL_CERT_FILE=",
  };
  size_t index;
  for (index = 0; index < sizeof(names) / sizeof(names[0]); index++) {
    if (strncmp(entry, names[index], strlen(names[index])) == 0) {
      return 1;
    }
  }
  return 0;
}

static void check_environment(void) {
  char **entry;
  size_t count = 0;
  for (entry = environ; *entry != NULL; entry++) {
    if (!is_safe_environment_name(*entry)) {
      errno = 0;
      die("unexpected inherited environment variable survived");
    }
    count++;
  }
  if (count != 7 || getenv("SECRET_SHOULD_NOT_LEAK") != NULL ||
      strcmp(getenv("PATH"), "/nonexistent") != 0) {
    errno = 0;
    die("safe environment did not have the exact expected shape");
  }
}

static void check_limits(void) {
  struct rlimit limit;
  if (getrlimit(RLIMIT_CORE, &limit) != 0 || limit.rlim_cur != 0 ||
      limit.rlim_max != 0) {
    die("core dump limit is not zero");
  }
  if (getrlimit(RLIMIT_NOFILE, &limit) != 0 || limit.rlim_cur != 128 ||
      limit.rlim_max != 128) {
    die("file descriptor limit is not locked to 128");
  }
  if (getrlimit(RLIMIT_FSIZE, &limit) != 0 ||
      limit.rlim_cur != 64ULL * 1024ULL * 1024ULL ||
      limit.rlim_max != limit.rlim_cur) {
    die("file size limit is not locked to 64 MiB");
  }
}

static void check_syscall_denials(void) {
  char byte = 'x';
  struct iovec local = {.iov_base = &byte, .iov_len = 1};
  struct iovec remote = {.iov_base = &byte, .iov_len = 1};
  int descriptor;

  errno = 0;
  if (fork() != -1 || errno != EPERM) {
    die("fork was not denied by seccomp");
  }
#ifdef __NR_clone3
  {
    struct clone_args arguments = {0};
    errno = 0;
    if (syscall(__NR_clone3, &arguments, sizeof(arguments)) != -1 ||
        errno != EPERM) {
      die("clone3 was not denied by seccomp");
    }
  }
#endif
  errno = 0;
  if (process_vm_readv(getpid(), &local, 1, &remote, 1, 0) != -1 ||
      errno != EPERM) {
    die("process_vm_readv was not denied by seccomp");
  }
  errno = 0;
  if (ptrace(PTRACE_TRACEME, 0, NULL, NULL) != -1 || errno != EPERM) {
    die("ptrace was not denied by seccomp");
  }
  errno = 0;
  if (kill(getppid(), 0) != -1 || errno != EPERM) {
    die("external signal syscall was not denied by seccomp");
  }
#ifdef __NR_tgkill
  errno = 0;
  if (syscall(__NR_tgkill, getppid(), getppid(), 0) != -1 || errno != EPERM) {
    die("thread-directed external signal was not denied by seccomp");
  }
#endif
  errno = 0;
  if (socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0) != -1 || errno != EPERM) {
    die("Unix socket creation was not denied by seccomp");
  }
  descriptor = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (descriptor < 0) {
    die("parent Codex network socket capability was unexpectedly removed");
  }
  close(descriptor);
}

static void copy_self_and_expect_noexec(const char *work) {
  char destination[4096];
  char buffer[16384];
  char *replacement_argv[] = {(char *)"copied-probe", NULL};
  int source;
  int target;
  ssize_t count;

  if (snprintf(destination, sizeof(destination), "%s/copied-probe", work) >=
      (int)sizeof(destination)) {
    errno = ENAMETOOLONG;
    die("probe destination is too long");
  }
  source = open("/usr/local/libexec/rethinkloop/codex-isolation-probe",
                O_RDONLY | O_CLOEXEC);
  if (source < 0) {
    die("probe could not read its exact executable");
  }
  target = open(destination, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0700);
  if (target < 0) {
    die("probe could not create an allowed work file");
  }
  while ((count = read(source, buffer, sizeof(buffer))) > 0) {
    ssize_t offset = 0;
    while (offset < count) {
      ssize_t written = write(target, buffer + offset, (size_t)(count - offset));
      if (written <= 0) {
        die("probe could not write allowed work file");
      }
      offset += written;
    }
  }
  if (count < 0 || close(source) != 0 || close(target) != 0) {
    die("probe copy failed");
  }
  errno = 0;
  execve(destination, replacement_argv, environ);
  if (errno != EACCES && errno != EPERM) {
    die("work directory execution failed for an unexpected reason");
  }
}

int main(int argc, char **argv) {
  char path[4096];
  int descriptor;
  int parent_death_signal = 0;

  if (argc != 3) {
    errno = EINVAL;
    die("expected session root and sibling root arguments");
  }
  check_environment();
  check_limits();
  if (getpgrp() != getpid()) {
    errno = 0;
    die("probe is not its process-group leader");
  }
  if (prctl(PR_GET_PDEATHSIG, &parent_death_signal) != 0 ||
      parent_death_signal != SIGKILL) {
    die("parent-death boundary is missing");
  }
  errno = 0;
  if (fcntl(9, F_GETFD) != -1 || errno != EBADF) {
    die("inherited non-stdio descriptor remained open");
  }

  if (snprintf(path, sizeof(path), "%s/home/allowed", argv[1]) >=
      (int)sizeof(path)) {
    die("allowed path is too long");
  }
  descriptor = open(path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (descriptor < 0 || write(descriptor, "ok", 2) != 2 ||
      close(descriptor) != 0) {
    die("Codex home was not writable");
  }

  expect_readable("/etc/ssl/certs/ca-certificates.crt");
  expect_readable("/etc/resolv.conf");
  expect_denied_open("/app/package.json", O_RDONLY | O_CLOEXEC);
  expect_denied_open("/app/data", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  expect_denied_open("/proc/self/status", O_RDONLY | O_CLOEXEC);
  if (snprintf(path, sizeof(path), "%s/home", argv[2]) >= (int)sizeof(path)) {
    die("sibling path is too long");
  }
  expect_denied_open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (snprintf(path, sizeof(path), "%s/control/pid", argv[1]) >=
      (int)sizeof(path)) {
    die("control path is too long");
  }
  expect_denied_open(path, O_RDONLY | O_CLOEXEC);

  check_syscall_denials();
  copy_self_and_expect_noexec(getenv("TMPDIR"));
  puts("codex isolation probe passed");
  return 0;
}
