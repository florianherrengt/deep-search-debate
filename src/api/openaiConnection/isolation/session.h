#ifndef RETHINKLOOP_CODEX_ISOLATION_SESSION_H
#define RETHINKLOOP_CODEX_ISOLATION_SESSION_H

#include <limits.h>

#ifndef CODEX_BINARY_PATH
#define CODEX_BINARY_PATH "/usr/local/libexec/rethinkloop/codex-0.149.1"
#endif

void isolation_fail(const char *message);
void copy_required_env(const char *name, char destination[PATH_MAX]);
void validate_layout(const char *home, const char *codex_home,
                     const char *work, const char *control,
                     char root[PATH_MAX]);
void close_inherited_file_descriptors(void);
void apply_resource_limits(void);
void establish_lifetime_boundary(void);
void write_control_pid(const char *control);
void install_safe_environment(const char *home, const char *work);

#endif
