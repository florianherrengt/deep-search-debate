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
| Browserless service | `sby755x538nk9u9g1tuw2hj9` |

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
   The image holds a nonblocking `flock` in this directory for its whole
   lifetime, so configure exactly one application replica. A second API process
   sharing the volume exits immediately instead of racing SQLite, migrations,
   or API writes.
3. Add these literal, runtime-only production variables in the Coolify UI:

| Variable | Requirement |
| --- | --- |
| `SERPER_API_KEY` | Serper production credential |
| `SERPER_MAX_QUERIES_PER_SECOND` | Optional Serper rate limit from 1 to 50; defaults to 50 |
| `OPENAI_CODEX_CREDENTIAL_KEY` | Canonical base64 encoding of exactly 32 random bytes used to encrypt user OpenAI Codex credentials and DeepSeek API keys |
| `BROWSERLESS_URL` | `http://rethinkloop-browserless:3000` |
| `BROWSERLESS_TOKEN` | Same token as the private Browserless service |
| `BETTER_AUTH_SECRET` | Better Auth signing secret, at least 32 characters |
| `GITHUB_CLIENT_ID` | Production GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | Production GitHub OAuth app client secret |
| `AUTH_ADMIN_EMAIL` | Required administrator email; set to `contact@florianherrengt.com` for the live application |
| `EXAMPLE_DEBATE_IDS` | Optional ordered, comma-separated public debate UUIDs shown on `/examples` |

Set `is_runtime=true`, `is_buildtime=false`, and `is_preview=false`. The
configuration script sets the container and health-check settings. It validates
the production secrets without printing their values. Missing or blank required
values fail application startup. Do not configure a shared DeepSeek API key;
users save their own key in Settings, encrypted with `OPENAI_CODEX_CREDENTIAL_KEY`.
OpenAI Codex remains available through each user's existing OpenAI connection.
For local Zen testing, set `LLM_PROVIDER=zen` with `LLM_MODEL_NAME` and
`OPENCODE_ZEN_API_KEY`; these settings are not needed in production. Leave
`EXAMPLE_DEBATE_IDS` unset or blank until examples are selected;
changing it requires an application restart so the typed runtime config reloads.
Provision `OPENAI_CODEX_CREDENTIAL_KEY` before deploying code that can create
encrypted provider credentials. Generate it with `openssl rand -base64 32`,
store it as a runtime-only production secret, and retain it for the lifetime of
the encrypted rows. Losing or changing the key makes every saved OpenAI Codex
connection and DeepSeek key unreadable; users must reconnect or re-enter their
key. Pi performs Codex device authentication and generation directly over
HTTPS; the production image does not install or spawn the Codex CLI.

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
Keep this host mapping: Coolify cannot overlap replacement containers that
publish the same host port, so deployment remains stop-first and the old
container releases the SQLite lock before its replacement starts.

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

### Private Browserless

Page fetching uses direct public HTTPS first and Browserless Chromium once when
the document is unusable. Neither path charges extraction credits. Browserless
is a separate Coolify Compose service in the same project/environment, defined
by [browserless.yaml](browserless.yaml). Its pinned image digest is Browserless
`v2.57.1` and includes ARM64 support. There is no public domain or published host
port. RethinkLoop reaches it at `http://rethinkloop-browserless:3000` through
the shared `coolify` network. The service has one browser slot, a 30-second
session limit, a 2 GB memory limit, and 2 GB shared memory. Its health check uses
the authenticated `/active` endpoint without placing the token in arguments.

Coolify generates `SERVICE_PASSWORD_BROWSERLESS`; its resolved value becomes the
container's `TOKEN`. Supply the same value as RethinkLoop's literal, runtime-only
`BROWSERLESS_TOKEN`, alongside `BROWSERLESS_URL`. Never put it in Compose source,
URLs in documentation, command arguments, or logs. The old ScrapingAnt key may
be removed from the application environment only after the replacement code is
released; the previous image still requires it.

The stock Browserless image permits private-network access. The host-level
[egress policy](browserless-egress.nft) is therefore required before starting
the service. It blocks new private/special-address connections and connections
to the host, while permitting responses to incoming RethinkLoop requests. This
also covers public DNS names or redirects that resolve to private addresses.
It changes only the `rethinkloop_browserless` nftables tables in the `inet`
and `bridge` families; both are required because same-bridge frames can bypass
routed IP hooks. Routed hooks reject blocked connections; the bridge hook
drops them.

Coolify attaches both the shared `coolify` network and its service UUID network.
The policy covers both; preserve all of these allocations on replacement:

| Network | Browserless source addresses |
| --- | --- |
| `coolify` | `10.0.1.37`, `fd78:b3fe:2167::37` (fixed in Compose) |
| `sby755x538nk9u9g1tuw2hj9` | `10.37.0.0/24`, `fd78:b3fe:37::/64` (dedicated network) |

For a fresh host, first check that these networks/addresses do not overlap its
existing allocations. On the Coolify host as root, install the policy and the
[systemd unit](rethinkloop-browserless-egress.service) before starting the service:

```sh
install -D -m 644 coolify/browserless-egress.nft /etc/nftables.d/rethinkloop-browserless.nft
install -D -m 644 coolify/rethinkloop-browserless-egress.service /etc/systemd/system/rethinkloop-browserless-egress.service
nft --check --file /etc/nftables.d/rethinkloop-browserless.nft
systemctl daemon-reload
systemctl enable --now rethinkloop-browserless-egress.service
docker network create --attachable --ipv6 --subnet 10.37.0.0/24 --subnet fd78:b3fe:37::/64 sby755x538nk9u9g1tuw2hj9
```

Create the service from the base64-encoded `browserless.yaml` through `api.sh`
`POST /services`, with the configured project/environment/server/destination,
`instant_deploy=false`, and no public URL. Leave `connect_to_docker_network`
disabled: Compose already declares the shared network. For the existing service,
use `PATCH /services/<uuid>` to update `docker_compose_raw`, preserving its token.
The service UUID network must already exist with the dedicated allocations
above; do not let Docker allocate an unprotected replacement subnet.

```sh
./coolify/api.sh POST /services/sby755x538nk9u9g1tuw2hj9/start
./coolify/api.sh GET /services/sby755x538nk9u9g1tuw2hj9
```

After replacement, verify container health, both network addresses, absence of
published ports, token rejection, authenticated HTML rendering, and blocked
private-address/host connections. Check `systemctl is-enabled` and
`systemctl is-active rethinkloop-browserless-egress.service`; inspect counters
with `nft list table inet rethinkloop_browserless` and
`nft list table bridge rethinkloop_browserless`. The policy is loaded before
Docker at boot and remains in place during container replacements. Reapply it
with `systemctl reload rethinkloop-browserless-egress.service` after any host
firewall operation that flushes nftables tables.

For local development, tunnel a loopback port to `10.0.1.37:3000` over an
authorized SSH connection to the Coolify host, then set that loopback URL and the
same token in the ignored API `.env`. Local fetching still applies its own
public-address DNS/redirect validation. The Browserless host policy remains
necessary when the caller runs on another computer.

### RethinkLoop application

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

### Diagnosing LLM failures

Failed generations emit one JSON record with `event = llm_generation_failed`.
Find these records with:

```sh
./coolify/logs.sh 1000 | rg '"event":"llm_generation_failed"'
```

Use `generationId` and the owning job ID to match a record to the saved workflow.
`failureKind` distinguishes stream, finish-reason, empty-output, and terminal
persistence failures. The safe `failure` details distinguish local validation
or database errors from provider failures. `diagnostics.attempts` contains HTTP
statuses, request IDs, timings, provider retry hints, and network error codes;
`bodyObserver` shows whether the response body was inspected as SSE, HTTP error
JSON, or neither.
`diagnostics.failures` contains safe upstream error codes and SSE event types.
It also records a failed terminal response status when the provider sends one.
An HTTP 200 followed by `response.failed` means the provider accepted the
request and then reported a failure inside the stream. `attemptCount` includes
the first request; `maxRetries` is the permitted retries after it. Inspect
`attempts` to see the actual request history; an accepted stream's failure does
not imply that Pi retried it. Attempt timings exclude backoff;
`retryAfterMs` records the provider's hint, not the actual wait. A `truncated`
flag means capture hit its diagnostic limit, not that the provider response
itself was truncated.

These diagnostics stay in server logs. The public generation error remains
safe and concise, and logs omit credentials, request content, model output,
and free-form provider error messages. Older failures cannot gain diagnostics
retroactively; reproduce or resume the owning workflow after deployment to
capture a new attempt.

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
