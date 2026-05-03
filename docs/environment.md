# Environment Variable Behaviors

`src/backend/config/env.ts` is the authoritative inventory of every variable the backend reads, with types, defaults, and Zod validation. `tronrelic/.env.example` is the template. This document covers only the *non-obvious behaviors* — cases where presence, absence, or specific values change runtime semantics in ways the schema alone doesn't reveal.

## Why This Matters

Validation catches typos but not *missing-but-optional* vars whose absence silently downgrades behavior — disabled cookie signing, unprotected metrics, an admin surface that 503s instead of authenticating. The traps below are the ones that have actually bitten us; check them before changing `.env` in any non-local environment.

## Production Gating

`ENV` and `NODE_ENV` are independent and either set to `production` triggers production-grade safety checks. `NODE_ENV` is set by Node tooling — don't put it in `.env`. `ENV` describes the deployment.

## Site URLs and the Universal Image

There are no `NEXT_PUBLIC_*` vars by design. Production builds inline build-time values, which would break the universal Docker image (one image, many domains). The Next.js server resolves `SITE_BACKEND` and `SITE_WS` during SSR; the client auto-detects from `window.location`. See [system-runtime-config.md](./system/system-runtime-config.md).

`SITE_URL` is runtime config stored in MongoDB and editable from `/system`. The env var only seeds the initial value on first boot — changing it later does nothing. `SITE_BACKEND` is required for SSR; the frontend throws on its first server request if unset.

## Admin Surface Disable

`ADMIN_API_TOKEN` unset is the intended way to disable `/system`, `/admin/markets`, and `/admin/moderation` entirely — every admin endpoint returns 503. There is no separate disable flag, so an empty token in production is a deliberate operational choice, not a misconfiguration to fix.

## SESSION_SECRET

Without a real secret the `tronrelic_uid` cookie is a bare UUID. Any client that learns a UUID can forge `Cookie: tronrelic_uid=<uuid>` and impersonate that user. Signing turns the wire value into `s:<uuid>.<HMAC>`, which forgery cannot produce without the secret.

If the variable is unset, production (`NODE_ENV=production` or `ENV=production`) refuses to start, while dev and test fall back to a placeholder and emit `console.warn`. Rotating the secret invalidates every existing cookie: anonymous and registered visitors get a fresh UUID on next bootstrap, and verified users re-anchor through link-wallet identity-swap on their next signature. There is no session table to flush.

## TronGrid Rate Limits

With no key the backend uses TronGrid's shared 100 req/s IP pool, which the blockchain sync can saturate during catch-up. Each populated key (`TRONGRID_API_KEY`, `TRONGRID_API_KEY_2`, `TRONGRID_API_KEY_3`) lifts the ceiling to 1,000 req/s on its own account, and the rotator round-robins across whichever slots are filled. Add as many as you have.

Disable `ENABLE_SCHEDULER` during local dev to avoid this pressure entirely — the cron pulls blocks every minute and refreshes markets every ten, which is rude to a shared key.

## Notification Throttle Asymmetry

`NOTIFICATION_EMAIL_THROTTLE_MS` defaults to 300000 (5 minutes) where `NOTIFICATION_WEBSOCKET_THROTTLE_MS` defaults to 5000. Email costs more per send and inbox tolerance is much lower than UI tolerance — don't equalize them without thinking about user experience and provider cost.

## Object Storage Fallback

If `STORAGE_BUCKET` is unset, page module file uploads silently fall back to a local filesystem provider rather than failing. Set the full S3 family (`STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, key, secret) to switch backends. Use `STORAGE_FORCE_PATH_STYLE=true` for MinIO, Backblaze B2, and other path-style providers.

## Validation Is Fail-Fast

`env.ts` parses `process.env` with Zod at startup. On failure the backend logs per-field errors and exits — there is no degraded mode. Missing `MONGODB_URI` or `REDIS_URL` always blocks startup. Optional vars produce warnings only when their absence is dangerous (e.g. `SESSION_SECRET` in dev).

## Further Reading

- Schema (authoritative inventory): `src/backend/config/env.ts`
- Template: `tronrelic/.env.example`
- Runtime config: [system-runtime-config.md](./system/system-runtime-config.md)
- Scheduler control: [system-scheduler-operations.md](./system/system-scheduler-operations.md)
- Deployment: [tronrelic-ops/docs/operations/operations.md](../../docs/operations/operations.md)
