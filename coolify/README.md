# Coolify operations

Local helper scripts for the `deep-search-debate` production application hosted
by the Coolify instance at [http://helium:8000](http://helium:8000). This file is
the operational source of truth for the live Coolify resource.

## Configured resource

| Resource | UUID |
| --- | --- |
| Project | `x4ourxjokp39jfmxfvbw5h1r` |
| Environment | `qbtgd10bxar36onzm3gutnjp` |
| Application | `hgv8mv8vamha35yjrzm2uu03` |

The non-secret URL and UUIDs live in `config.sh`. The API base is
`http://helium:8000/api/v1`.

## Token

`coolify_token` contains the bearer token. Git ignores that filename everywhere
in the repository. Keep it on one line and restrict it to the current user:

```sh
chmod 600 coolify/coolify_token
```

Do not print, commit, paste, or pass the token as a command-line argument. The
scripts load it directly from the file. Replace the file when rotating the token.

The token needs `read` for status and deployment metadata, `read:sensitive` for
logs and secret validation, `write` for configuration, and `deploy` for
deploy/restart/stop operations.

## Requirements

- Network/DNS access to `helium`
- `bash`
- `curl`
- `jq`
- Node.js 22 or newer

Run every command from the repository root.

## One-time production setup

The application is one container: Hono serves `/api`, the built Vite client, and
the React Router fallback on port 3000. Production web searches use Brave. Do not
add `SEARXNG_URL` to this Coolify application.

Before the first deployment:

1. Configure `https://rethinkloop.com` as the primary domain in Coolify. The
   application derives `BETTER_AUTH_URL` from `NODE_ENV=production`.
2. Add a persistent volume named `deep-search-data` with destination path
   `/app/data`. SQLite is stored at `/app/data/data.db`.
3. Add these literal, runtime-only production variables in the Coolify UI:

| Variable | Requirement |
| --- | --- |
| `KDBX_PASSWORD` | Protected master password for `prod.kdbx` |
Set `is_runtime=true`, `is_buildtime=false`, and `is_preview=false`. The
configuration script sets the container and health-check settings. It never
reads, creates, rotates, or prints the KeePass master password.

`prod.kdbx` must contain these exact, case-sensitive entry titles. Each value
must be stored only in the entry's standard `Password` field:

| KeePass title | Purpose |
| --- | --- |
| `BRAVE_SEARCH_API_KEY` | Brave Search production credential |
| `DEEPSEEK_API_KEY` | DeepSeek credential |
| `SCRAPINGANT_API_KEY` | ScrapingAnt credential |
| `BETTER_AUTH_SECRET` | Better Auth signing secret, at least 32 characters |
| `GITHUB_CLIENT_ID` | Production GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | Production GitHub OAuth app client secret |

`AUTH_DEBUG_USER_PASSWORD` is also a supported KeePass title, but production
sets `AUTH_DEBUG_USER_ENABLED=false`, so it is not required there. The loader
recursively searches every group and rejects a missing title, duplicate title,
or blank password before the server starts.

The seven KeePass-backed names above, including `AUTH_DEBUG_USER_PASSWORD`,
remain supported as optional runtime environment overrides. A present
environment variable takes precedence over KeePass; a blank override fails
validation. Do not configure an override when the KeePass value should be used.

Configure the production GitHub OAuth callback as:

```text
https://rethinkloop.com/api/auth/callback/github
```

Then apply and validate the remaining settings:

```sh
./coolify/configure-production.sh
```

The required application settings are:

| Setting | Value |
| --- | --- |
| Build pack | Dockerfile |
| Base directory | `/` |
| Dockerfile | `/Dockerfile` |
| Primary domain | `https://rethinkloop.com` |
| Exposed container port | `3000` |
| Host port mapping | `4479:3000` |
| Health check | enabled |
| Health-check method | `GET` |
| Health-check path | `/api/health` |
| Health-check host | `127.0.0.1` |
| Health-check port | `3000` |
| Health-check expected status | `200` |
| Docker health-check start period | `300s` |
| Traefik/Caddy upstream labels | `3000` |

The host port mapping publishes Coolify's application container on port `4479`
while Hono continues to listen on port `3000` inside the container. Domain
traffic and health checks therefore still target the internal port `3000`.

The encrypted `src/api/secrets/dev.kdbx` and `src/api/secrets/prod.kdbx` files
are committed and copied into the container image with mode `0400`.
`KDBX_PASSWORD` remains a separate runtime-only secret and must never be added
to Git or baked into the image. Anyone with repository or image access can keep
offline copies of both vaults, so use strong master passwords and rotate either
one if it may have been exposed.

The API pins `deep-search-core` to the npm tarball attached to its immutable
GitHub release. Coolify downloads that package during `npm ci`, so the Docker
build does not depend on a sibling checkout or committed vendor files. When the
dependency is intentionally upgraded, update its release URL in
`src/api/package.json` and regenerate the root lockfile with `npm install`.

## Read-only commands

```sh
# Application status and deployed revision
./coolify/status.sh

# Validate port, proxy, health, auth, and KeePass bootstrap configuration
./coolify/check-config.sh

# Last 100 application log lines, or a custom count
./coolify/logs.sh
./coolify/logs.sh 250

# Ten most recent deployments, or a custom count
./coolify/deployments.sh
./coolify/deployments.sh 25

# One deployment, including its deployment log
./coolify/deployment.sh DEPLOYMENT_UUID

# Verify Coolify state and the public health endpoint
./coolify/verify-live.sh
```

Application and deployment logs can contain secrets or user data. Inspect them
locally and do not paste them into tickets or chat without review.

## State-changing commands

These commands act immediately. They do not prompt for confirmation.

```sh
# Apply port and health-check settings
./coolify/configure-production.sh

# Queue a normal deployment
./coolify/deploy.sh

# Rebuild without cache
./coolify/deploy.sh --force

# Skip Coolify's deployment queue (use only when intentional)
./coolify/deploy.sh --instant

# Restart or stop the current application
./coolify/restart.sh
./coolify/stop.sh
```

`deploy.sh` prints the deployment UUID returned by Coolify. Pass it to
`wait-deployment.sh` to wait for completion or `deployment.sh` to inspect full
metadata and logs.

## Deployment procedure

Coolify builds the committed `main` branch from GitHub. Local uncommitted changes
are not deployed. Push the intended commit before starting this procedure.

```sh
# 1. Confirm the image and repository pass locally.
npm run gatekeep
docker build -t deep-search-debate:local .

# 2. Confirm production configuration. Configure it if this fails.
./coolify/check-config.sh || ./coolify/configure-production.sh

# 3. Queue a clean build. Copy deployment_uuid from this response.
./coolify/deploy.sh --force

# 4. Wait for that exact deployment; do not queue duplicates.
./coolify/wait-deployment.sh DEPLOYMENT_UUID

# 5. Verify Coolify and the public endpoint.
./coolify/status.sh
./coolify/verify-live.sh
```

## Generic API requests

`api.sh` supports `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`. It accepts only a
path beginning with one `/` and always targets the configured API base. Use `-`
as the JSON argument to read request bodies from standard input; this keeps
secrets out of process arguments.

```sh
./coolify/api.sh GET "/applications/hgv8mv8vamha35yjrzm2uu03"
printf '%s\n' '{"name":"deep-search-debate"}' | \
  ./coolify/api.sh PATCH "/applications/hgv8mv8vamha35yjrzm2uu03" -
```

The generic helper prints the complete API response. Some endpoints return
sensitive nested configuration, so inspect the endpoint before using or sharing
its output.

## Troubleshooting

- `401`: the token is invalid or expired.
- `403`: the token lacks the required permission.
- `404`: the UUID is wrong or the token belongs to a different Coolify team.
- `exited:unhealthy`: inspect configuration and deployment logs before retrying.
- Database resets after deploy: the `/app/data` persistent volume is missing.
- Startup reports a missing KeePass file: confirm the deployed revision includes
  `src/api/secrets/prod.kdbx` and that the Docker build copied it to
  `/app/src/api/secrets/prod.kdbx`.
- Startup reports a KeePass decryption or entry error: verify `KDBX_PASSWORD`,
  then check exact title casing, duplicate titles across all groups, and that
  the standard `Password` field is nonblank.
- Authentication callback failure: confirm the Coolify primary domain is
  `https://rethinkloop.com` and the GitHub OAuth callback is
  `https://rethinkloop.com/api/auth/callback/github`.
- Connection errors: confirm that `http://helium:8000` is reachable and the API
  is enabled in Coolify under **Settings > Advanced > API Settings**.

API behavior follows the [Coolify API reference](https://coolify.io/docs/api-reference/authorization).
