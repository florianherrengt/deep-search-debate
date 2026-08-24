# Coolify operations

Local helper scripts for the `rethinkloop` production application hosted
by the Coolify instance at [http://helium:8000](http://helium:8000). This file is
the operational source of truth for the live Coolify resource.

## Configured resource

| Resource | UUID |
| --- | --- |
| Project | `x4ourxjokp39jfmxfvbw5h1r` |
| Environment | `qbtgd10bxar36onzm3gutnjp` |
| Application | `uk9l7wyulny8bxcrkysddlws` |

The non-secret URL and UUIDs live in `config.sh`, together with the Docker Hub
image name. The API base is `http://helium:8000/api/v1`.

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
- Node.js 26 or newer

Run every command from the repository root.

## One-time production setup

The application is one container: Hono serves `/api`, the built Vite client, and
the React Router fallback on port 3000. Production web searches use Serper. Do not
add `SEARXNG_URL` to this Coolify application.

Before the first deployment:

1. Configure `https://rethinkloop.com` as the primary domain in Coolify. The
   application derives `BETTER_AUTH_URL` from `NODE_ENV=production`.
2. Store SQLite outside Docker's volume area: create `/data/rethinkloop/data`
   on the server owned by uid/gid `1000`, then add a persistent storage binding
   that host path to `/app/data`. SQLite lives at
   `/data/rethinkloop/data/data.db`.
3. Add these literal, runtime-only production variables in the Coolify UI:

| Variable | Requirement |
| --- | --- |
| `SERPER_API_KEY` | Serper production credential |
| `SERPER_MAX_QUERIES_PER_SECOND` | Optional Serper rate limit from 1 to 50; defaults to 50 |
| `LLM_PROVIDER` | `deepseek` or `zen` |
| `LLM_MODEL_NAME` | Model ID accepted by the selected provider |
| `DEEPSEEK_API_KEY` | Required when `LLM_PROVIDER=deepseek` |
| `OPENCODE_ZEN_API_KEY` | Required when `LLM_PROVIDER=zen` |
| `SCRAPINGANT_API_KEY` | ScrapingAnt credential |
| `BETTER_AUTH_SECRET` | Better Auth signing secret, at least 32 characters |
| `GITHUB_CLIENT_ID` | Production GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | Production GitHub OAuth app client secret |
| `AUTH_ADMIN_EMAIL` | Required administrator email; set to `contact@florianherrengt.com` for the live application |
| `EXAMPLE_DEBATE_IDS` | Optional ordered, comma-separated public debate UUIDs shown on `/examples` |

Set `is_runtime=true`, `is_buildtime=false`, and `is_preview=false`. The
configuration script sets the container and health-check settings. It validates
the common variables and the selected LLM provider's credential without
printing secret values. Missing or blank required values fail application
startup. Leave `EXAMPLE_DEBATE_IDS` unset or blank until examples are selected;
changing it requires an application restart so the typed runtime config reloads.

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
| Build pack | Docker image (`dockerimage`) |
| Docker registry image | `florianherrengt/rethinkloop` |
| Deployed tag | Full commit SHA of the release; set by the release procedure |
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
remain committed as operator-managed vaults, but the application does not read
them and Docker excludes them from the build context. Production receives only
the runtime environment variables listed above.

The API pins `deep-search-core` to the npm tarball attached to its immutable
GitHub release. That package is downloaded while the image is built locally by
Dagger, so server-side deployments only pull a ready image. When the dependency
is intentionally upgraded, update its release URL in `src/api/package.json` and
regenerate the root lockfile with `npm install`.

## Deployment procedure

Coolify pulls the released tag from Docker Hub instead of building on the
server. The tag is a full commit SHA published by Dagger, so publish from a
tree whose committed state is what you intend to ship.

```sh
# 1. Confirm the repository passes locally, then commit the release.
npm run gatekeep

# 2. Build the production image from the Dockerfile and push it,
#    tagged with the current commit SHA.
dagger -m dagger call publish --tag "$(git rev-parse HEAD)"

# 3. Point Coolify at that tag.
TAG="$(git rev-parse HEAD)"
printf '{"docker_registry_image_tag":"%s"}\n' "${TAG}" |
  ./coolify/api.sh PATCH "/applications/$(source coolify/config.sh && printf '%s' "${COOLIFY_APPLICATION_UUID}")" -

# 4. Queue the deployment. Copy deployment_uuid from this response.
./coolify/deploy.sh

# 5. Wait for that exact deployment; do not queue duplicates.
./coolify/wait-deployment.sh DEPLOYMENT_UUID

# 6. Verify Coolify state and the public endpoint.
./coolify/status.sh
./coolify/verify-live.sh
```

## Read-only commands

```sh
# Application status and deployed revision
./coolify/status.sh

# Validate port, proxy, health, auth, and required runtime secrets
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

# Re-pull the configured tag without reusing cached layers
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

## Generic API requests

`api.sh` supports `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`. It accepts only a
path beginning with one `/` and always targets the configured API base. Use `-`
as the JSON argument to read request bodies from standard input; this keeps
secrets out of process arguments.

```sh
./coolify/api.sh GET "/applications/uk9l7wyulny8bxcrkysddlws"
printf '%s\n' '{"name":"rethinkloop"}' | \
  ./coolify/api.sh PATCH "/applications/uk9l7wyulny8bxcrkysddlws" -
```

The generic helper prints the complete API response. Some endpoints return
sensitive nested configuration, so inspect the endpoint before using or sharing
its output.

## Troubleshooting

- `401`: the token is invalid or expired.
- `403`: the token lacks the required permission.
- `404`: the UUID is wrong or the token belongs to a different Coolify team.
- `exited:unhealthy`: inspect configuration and deployment logs before retrying.
- Database resets after deploy: the `/app/data` bind mount (host path
  `/data/rethinkloop/data`) is missing or not writable by uid `1000`.
- Startup reports a missing or invalid secret: confirm all required runtime
  variables are configured in Coolify as nonblank literal production values.
- Authentication callback failure: confirm the Coolify primary domain is
  `https://rethinkloop.com` and the GitHub OAuth callback is
  `https://rethinkloop.com/api/auth/callback/github`.
- Connection errors: confirm that `http://helium:8000` is reachable and the API
  is enabled in Coolify under **Settings > Advanced > API Settings**.

API behavior follows the [Coolify API reference](https://coolify.io/docs/api-reference/authorization).
