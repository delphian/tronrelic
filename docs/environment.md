# Environment Variable Behaviors

`src/backend/config/env.ts` is the authoritative inventory of every variable the backend reads, along with its type, default, and validation rule. `tronrelic/.env.example` is the template you copy when setting up a new environment. This document covers only the *non-obvious behaviors* — the cases where setting a variable, leaving it unset, or giving it a particular value changes how the application behaves at runtime in a way the schema alone does not reveal.

## Why This Matters

Schema validation catches typos in variable names and values. It cannot catch an optional variable that changes how the application behaves when you leave it out. Leaving one out can disable cookie signing, expose metrics that should be protected, or make the admin interface return an error instead of asking for credentials. Every case described below has caused a problem here at least once, so check this document before changing `.env` in any environment other than your own machine.

## Production Gating

`ENV` and `NODE_ENV` are independent variables, and setting *either* one to `production` turns on the stricter production safety checks.

Node tooling sets `NODE_ENV` on its own, so do not put it in `.env`. Use `ENV` to describe the deployment.

## Site URLs and the Universal Docker Image

There are deliberately no `NEXT_PUBLIC_*` variables in this project. Next.js substitutes the value of a `NEXT_PUBLIC_*` variable directly into the JavaScript bundle when the production build runs, which would freeze one specific domain into the image. That defeats the goal of a universal Docker image: one image built once and deployed to many domains.

Instead, the Next.js server reads `SITE_BACKEND` and `SITE_WS` while rendering pages on the server, and the browser works out the equivalent values from `window.location` after the page loads. See [system-runtime-config.md](./system/system-runtime-config.md) for the full mechanism.

`SITE_URL` is different again. It is runtime configuration stored in MongoDB and edited from the `/system` admin interface. The environment variable only seeds the initial value the first time the application boots; changing it afterwards has no effect. `SITE_BACKEND` is required for server-side rendering, and the frontend throws an error on its first server request if the variable is unset.

## Disabling the Admin Surface

Leaving `ADMIN_API_TOKEN` unset is the supported way to switch off `/system`, `/admin/markets`, and `/admin/moderation` completely. With no token configured, every admin endpoint responds `503 Service Unavailable` rather than prompting for credentials.

There is no separate flag for this. If you find an empty token in production, treat it as a deliberate choice to switch the admin interface off, and check with whoever owns the deployment before setting one.

## SESSION_SECRET

`SESSION_SECRET` is the value that `loaders/express.ts` passes to the `cookie-parser` middleware, which lets Express verify cookies it has signed and expose them on `req.signedCookies`.

It does not sign an identity cookie. User identity travels in the Better Auth session cookie, which Better Auth signs independently using `BETTER_AUTH_SECRET`. The two analytics cookies, `tronrelic_tid` and `tronrelic_ref`, are unsigned by design. `SESSION_SECRET` is kept in place so that any signed cookie added later can be verified straight away.

If the variable is unset, production — meaning `NODE_ENV=production` or `ENV=production` — refuses to start. Development and test environments fall back to a placeholder value and emit a `console.warn`.

Rotating the secret invalidates any signed cookies that `cookie-parser` reads. It also changes the analytics source hashes described in the next section, but only when `TRAFFIC_IP_HASH_SALT` is unset. It has no effect on Better Auth sessions, which rotate with `BETTER_AUTH_SECRET` instead.

## TRAFFIC_IP_HASH_SALT

The traffic module never stores raw visitor IP addresses. It stores hashes of them, in the `ip_hash` and `subnet_hash` columns of the ClickHouse `traffic_events` table. A salt is an extra secret value mixed into the input before hashing, so that identical addresses cannot be recognized without knowing the secret. `TRAFFIC_IP_HASH_SALT` supplies that value.

When it is unset, the module falls back to `SESSION_SECRET`, which is why production needs no additional wiring. The cost of that fallback is that the two become coupled: rotating `SESSION_SECRET` then also breaks the ability to correlate analytics activity from the same source across the rotation. Set a dedicated salt when the analytics value needs to rotate on its own schedule.

Rotating the salt does not break anything. It only means events recorded before and after the change can no longer be matched to the same source.

## TronGrid Rate Limits

With no API key configured, the backend uses TronGrid's shared pool for anonymous callers, capped at 100 requests per second across every user of that pool by IP address. The blockchain sync can saturate that limit on its own while catching up on a backlog of blocks.

Each key you populate — `TRONGRID_API_KEY`, `TRONGRID_API_KEY_2`, and `TRONGRID_API_KEY_3` — raises the ceiling to 1,000 requests per second on that key's own account. The backend cycles through whichever slots are filled, one request at a time in turn, so add as many keys as you have.

During local development, set `ENABLE_SCHEDULER=false` to avoid the problem entirely. The scheduler pulls new blocks every fifteen seconds and refreshes market data every ten minutes, which is a lot of traffic to aim at a shared key.

## Block Sync Timing Variables

`BLOCK_SYNC_LOCK_TTL` (14 seconds) is not an independent knob. It is sized just under the `blockchain:sync` cron period so the Redis lock self-releases before the next tick even when a run dies. A TTL longer than the period makes ticks find the lock held and skip silently; a much shorter one lets two runs race the block cursor. The schedule itself is not an environment variable — it lives in `scheduler_configs` and is edited at `/system/scheduler`.

**The emit buffer is not configured here.** The five settings that shape the block feed's playout buffer were once `BLOCKCHAIN_EMIT_BUFFER_*` variables and are now stored on the `system_config` document, edited from the Configuration tab of `/system/system`, and applied to the running feed the moment they are saved. Setting a variable by that name today does nothing at all.

They moved because the loop for tuning them did not close. The only reliable evidence that a lead is too small is the underrun count on the `/system` blockchain console, which is a reading taken from a running deployment, and acting on it used to mean editing this file, adding the variable to the backend service in `docker-compose.yml`, and recreating the container. See [system-blockchain-sync-architecture.md](./system/system-blockchain-sync-architecture.md#buffer-settings) for what each setting does, and `src/backend/config/emit-buffer.ts` for the defaults a fresh deployment starts with.

`BLOCKCHAIN_BLOCK_INTERVAL_SECONDS` (3) stays an environment variable and is deliberately not on that form. It states how fast TRON produces blocks, which is a property of the chain rather than an operator preference, and the buffer's own rules are checked against it.

## Why the Two Notification Throttles Differ

`NOTIFICATION_EMAIL_THROTTLE_MS` defaults to 300000, or five minutes, while `NOTIFICATION_WEBSOCKET_THROTTLE_MS` defaults to 5000, or five seconds.

The difference between the two defaults is intentional. Each email costs money to send, and users tolerate fewer interruptions in an inbox than in a page they already have open. Do not make the two values match without considering both the user experience and the cost of sending.

## DOCKER_API_URL

This variable powers the per-container CPU, memory, and health table in the Server section of the `/system` console. Leaving it unset is fully supported: the console reports container metrics as unavailable and every other health probe carries on unaffected. That is why local development needs no configuration for it.

In Docker deployments the value is written directly into `docker-compose.yml` as `http://docker-proxy:2375` rather than read from `.env`. That is deliberate. The droplet's `.env` file is generated once during provisioning and `droplet-update.sh` never rewrites it, so a value read from `.env` would leave the feature switched off in production permanently, with nothing to indicate why.

Never point this variable at an unrestricted Docker daemon. Full access to the Docker API is equivalent to root access on the host, and this backend terminates public traffic and runs plugin code. The deployed target is `tecnativa/docker-socket-proxy`, configured with `CONTAINERS=1` and with `POST` left at its disabled default, on an `internal` Docker network that only the proxy and the backend join.

Mounting the Docker socket read-only with `:ro` does not help. That flag applies to the mount itself, and it does not restrict the requests sent through the socket.

## Reserved Object Storage Variables

File uploads in the pages module always use the local filesystem today, because `PagesModule` instantiates `LocalStorageProvider` unconditionally. The `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, and `STORAGE_FORCE_PATH_STYLE` variables are reserved for a future S3-compatible provider that has not been built yet. Setting them today does nothing.

## Validation Stops Startup on Failure

At startup, `env.ts` validates `process.env` against a schema defined with Zod, a TypeScript schema validation library. If validation fails, the backend logs an error for each offending field and exits rather than starting with partial configuration.

Missing `MONGODB_URI` or `REDIS_URL` always blocks startup. Optional variables produce a warning only when their absence is genuinely dangerous, such as a missing `SESSION_SECRET` in development.

## Further Reading

- Authoritative inventory of every variable: `src/backend/config/env.ts`
- Template to copy: `tronrelic/.env.example`
- Runtime configuration and the universal image: [system-runtime-config.md](./system/system-runtime-config.md)
- Scheduler control and troubleshooting: [system-scheduler-operations.md](./system/system-scheduler-operations.md)
- Deployment procedures: [tronrelic-ops/docs/operations/operations.md](../../docs/operations/operations.md)
