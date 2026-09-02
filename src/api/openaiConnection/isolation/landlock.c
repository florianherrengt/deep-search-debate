#define _GNU_SOURCE

#include "landlock.h"

#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#include "session.h"

#ifndef O_PATH
#define O_PATH 010000000
#endif

/* Keep these definitions local so the launcher handles newer Landlock ABIs
 * while being compiled by Debian bookworm's older userspace headers. */
#define RL_CREATE_RULESET_VERSION (1U << 0)
#define RL_RULE_PATH_BENEATH 1
#define RL_FS_EXECUTE (1ULL << 0)
#define RL_FS_WRITE_FILE (1ULL << 1)
#define RL_FS_READ_FILE (1ULL << 2)
#define RL_FS_READ_DIR (1ULL << 3)
#define RL_FS_REMOVE_DIR (1ULL << 4)
#define RL_FS_REMOVE_FILE (1ULL << 5)
#define RL_FS_MAKE_CHAR (1ULL << 6)
#define RL_FS_MAKE_DIR (1ULL << 7)
#define RL_FS_MAKE_REG (1ULL << 8)
#define RL_FS_MAKE_SOCK (1ULL << 9)
#define RL_FS_MAKE_FIFO (1ULL << 10)
#define RL_FS_MAKE_BLOCK (1ULL << 11)
#define RL_FS_MAKE_SYM (1ULL << 12)
#define RL_FS_REFER (1ULL << 13)
#define RL_FS_TRUNCATE (1ULL << 14)
#define RL_FS_IOCTL_DEV (1ULL << 15)
#define RL_SCOPE_ABSTRACT_UNIX_SOCKET (1ULL << 0)
#define RL_SCOPE_SIGNAL (1ULL << 1)

#define RL_ABI_MIN 3
#define RL_ABI_MAX_AUDITED 6

struct rl_ruleset_attr {
  uint64_t handled_access_fs;
  uint64_t handled_access_net;
  uint64_t scoped;
};

struct rl_path_beneath_attr {
  uint64_t allowed_access;
  int32_t parent_fd;
  uint32_t reserved;
};

static void add_landlock_path_rule(int ruleset, const char *path,
                                   uint64_t allowed_access) {
  struct rl_path_beneath_attr rule = {0};
  int path_fd = open(path, O_PATH | O_CLOEXEC);
  if (path_fd < 0) {
    isolation_fail("could not open a required Landlock path");
  }
  rule.allowed_access = allowed_access;
  rule.parent_fd = path_fd;
  if (syscall(__NR_landlock_add_rule, ruleset, RL_RULE_PATH_BENEATH, &rule, 0) !=
      0) {
    close(path_fd);
    isolation_fail("could not add a Landlock path rule");
  }
  close(path_fd);
}

void apply_landlock(const char *home, const char *work) {
  static const char *read_only_files[] = {
      "/etc/host.conf",
      "/etc/hosts",
      "/etc/nsswitch.conf",
      "/etc/resolv.conf",
      "/etc/ssl/certs/ca-certificates.crt",
  };
  struct rl_ruleset_attr ruleset_attr = {0};
  uint64_t handled_access =
      RL_FS_EXECUTE | RL_FS_WRITE_FILE | RL_FS_READ_FILE | RL_FS_READ_DIR |
      RL_FS_REMOVE_DIR | RL_FS_REMOVE_FILE | RL_FS_MAKE_CHAR | RL_FS_MAKE_DIR |
      RL_FS_MAKE_REG | RL_FS_MAKE_SOCK | RL_FS_MAKE_FIFO | RL_FS_MAKE_BLOCK |
      RL_FS_MAKE_SYM | RL_FS_REFER | RL_FS_TRUNCATE;
  uint64_t writable_access;
  int abi;
  int ruleset;
  size_t ruleset_size;
  size_t index;

  abi = (int)syscall(__NR_landlock_create_ruleset, NULL, 0,
                     RL_CREATE_RULESET_VERSION);
  if (abi < RL_ABI_MIN || abi > RL_ABI_MAX_AUDITED) {
    errno = EOPNOTSUPP;
    isolation_fail("kernel Landlock ABI is outside the audited range 3 through 6");
  }
  if (abi >= 5) {
    handled_access |= RL_FS_IOCTL_DEV;
  }
  ruleset_attr.handled_access_fs = handled_access;
  if (abi >= 6) {
    ruleset_attr.scoped = RL_SCOPE_ABSTRACT_UNIX_SOCKET | RL_SCOPE_SIGNAL;
    ruleset_size = sizeof(ruleset_attr);
  } else if (abi >= 4) {
    ruleset_size = offsetof(struct rl_ruleset_attr, scoped);
  } else {
    ruleset_size = offsetof(struct rl_ruleset_attr, handled_access_net);
  }
  ruleset = (int)syscall(__NR_landlock_create_ruleset, &ruleset_attr,
                         ruleset_size, 0);
  if (ruleset < 0) {
    isolation_fail("could not create Landlock ruleset");
  }

  writable_access = handled_access & ~(RL_FS_EXECUTE | RL_FS_IOCTL_DEV);
  add_landlock_path_rule(ruleset, home, writable_access);
  add_landlock_path_rule(ruleset, work, writable_access);
  add_landlock_path_rule(ruleset, CODEX_BINARY_PATH,
                         RL_FS_EXECUTE | RL_FS_READ_FILE);
  for (index = 0;
       index < sizeof(read_only_files) / sizeof(read_only_files[0]); index++) {
    add_landlock_path_rule(ruleset, read_only_files[index], RL_FS_READ_FILE);
  }

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    close(ruleset);
    isolation_fail("could not enable no-new-privileges");
  }
  if (syscall(__NR_landlock_restrict_self, ruleset, 0) != 0) {
    close(ruleset);
    isolation_fail("could not enforce Landlock ruleset");
  }
  close(ruleset);
}
