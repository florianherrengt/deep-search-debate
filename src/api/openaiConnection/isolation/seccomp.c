#define _GNU_SOURCE

#include "seccomp.h"

#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/sched.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <sys/syscall.h>

#include "session.h"

#define SC_DENY(syscall_number)                                                \
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (syscall_number), 0, 1),                 \
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)

void apply_seccomp(void) {
  static const struct sock_filter filter[] = {
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
#if defined(__x86_64__)
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
#elif defined(__aarch64__)
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_AARCH64, 1, 0),
#else
#error "unsupported launcher architecture"
#endif
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
#if defined(__x86_64__)
      /* The x32 ABI shares AUDIT_ARCH_X86_64 but offsets syscall numbers. */
      BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, 0x40000000U, 0, 1),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
#endif
#ifdef __NR_ptrace
      SC_DENY(__NR_ptrace),
#endif
#ifdef __NR_process_vm_readv
      SC_DENY(__NR_process_vm_readv),
#endif
#ifdef __NR_process_vm_writev
      SC_DENY(__NR_process_vm_writev),
#endif
#ifdef __NR_pidfd_getfd
      SC_DENY(__NR_pidfd_getfd),
#endif
#ifdef __NR_pidfd_send_signal
      SC_DENY(__NR_pidfd_send_signal),
#endif
#ifdef __NR_kcmp
      SC_DENY(__NR_kcmp),
#endif
#ifdef __NR_bpf
      SC_DENY(__NR_bpf),
#endif
#ifdef __NR_perf_event_open
      SC_DENY(__NR_perf_event_open),
#endif
#ifdef __NR_add_key
      SC_DENY(__NR_add_key),
#endif
#ifdef __NR_request_key
      SC_DENY(__NR_request_key),
#endif
#ifdef __NR_keyctl
      SC_DENY(__NR_keyctl),
#endif
#ifdef __NR_mount
      SC_DENY(__NR_mount),
#endif
#ifdef __NR_umount2
      SC_DENY(__NR_umount2),
#endif
#ifdef __NR_pivot_root
      SC_DENY(__NR_pivot_root),
#endif
#ifdef __NR_setns
      SC_DENY(__NR_setns),
#endif
#ifdef __NR_unshare
      SC_DENY(__NR_unshare),
#endif
#ifdef __NR_chroot
      SC_DENY(__NR_chroot),
#endif
#ifdef __NR_init_module
      SC_DENY(__NR_init_module),
#endif
#ifdef __NR_finit_module
      SC_DENY(__NR_finit_module),
#endif
#ifdef __NR_delete_module
      SC_DENY(__NR_delete_module),
#endif
#ifdef __NR_reboot
      SC_DENY(__NR_reboot),
#endif
#ifdef __NR_open_by_handle_at
      SC_DENY(__NR_open_by_handle_at),
#endif
#ifdef __NR_name_to_handle_at
      SC_DENY(__NR_name_to_handle_at),
#endif
#ifdef __NR_fork
      SC_DENY(__NR_fork),
#endif
#ifdef __NR_vfork
      SC_DENY(__NR_vfork),
#endif
#ifdef __NR_clone3
      SC_DENY(__NR_clone3),
#endif
#ifdef __NR_kexec_load
      SC_DENY(__NR_kexec_load),
#endif
#ifdef __NR_kexec_file_load
      SC_DENY(__NR_kexec_file_load),
#endif
#ifdef __NR_iopl
      SC_DENY(__NR_iopl),
#endif
#ifdef __NR_ioperm
      SC_DENY(__NR_ioperm),
#endif
#ifdef __NR_userfaultfd
      SC_DENY(__NR_userfaultfd),
#endif
#ifdef __NR_io_uring_setup
      SC_DENY(__NR_io_uring_setup),
#endif
#ifdef __NR_io_uring_enter
      SC_DENY(__NR_io_uring_enter),
#endif
#ifdef __NR_io_uring_register
      SC_DENY(__NR_io_uring_register),
#endif
#ifdef __NR_memfd_create
      SC_DENY(__NR_memfd_create),
#endif
#ifdef __NR_execveat
      SC_DENY(__NR_execveat),
#endif
#ifdef __NR_kill
      SC_DENY(__NR_kill),
#endif
#ifdef __NR_tkill
      SC_DENY(__NR_tkill),
#endif
#ifdef __NR_tgkill
      SC_DENY(__NR_tgkill),
#endif
#ifdef __NR_rt_sigqueueinfo
      SC_DENY(__NR_rt_sigqueueinfo),
#endif
#ifdef __NR_rt_tgsigqueueinfo
      SC_DENY(__NR_rt_tgsigqueueinfo),
#endif
#ifdef __NR_socket
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socket, 0, 5),
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
               offsetof(struct seccomp_data, args[0])),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 2 /* AF_INET */, 2, 0),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 10 /* AF_INET6 */, 1, 0),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
#endif
#ifdef __NR_clone
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone, 0, 5),
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
               offsetof(struct seccomp_data, args[0])),
      BPF_STMT(BPF_ALU | BPF_AND | BPF_K, CLONE_VM | CLONE_THREAD),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, CLONE_VM | CLONE_THREAD, 1, 0),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
#endif
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  static const struct sock_fprog program = {
      .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
      .filter = (struct sock_filter *)filter,
  };

  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0) {
    isolation_fail("could not enforce seccomp filter");
  }
}
