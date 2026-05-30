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

`SESSION_SECRET` is the secret `loaders/express.ts` hands to `cookie-parser`, so Express can verify `req.signedCookies`. It no longer signs an identity cookie — the legacy `tronrelic_uid` cookie was removed in the Better Auth cutover, and identity now rides the Better Auth session cookie, which Better Auth signs independently with `BETTER_AUTH_SECRET`. The current analytics cookies (`tronrelic_tid`, `tronrelic_ref`) are unsigned by design. `SESSION_SECRET` is retained as a defensive keep so any future signed cookie is verifiable.

If the variable is unset, production (`NODE_ENV=production` or `ENV=production`) refuses to start, while dev and test fall back to a placeholder and emit `console.warn`. Rotating it only affects signed cookies parsed by `cookie-parser`; it does not touch Better Auth sessions (those rotate with `BETTER_AUTH_SECRET`).

## TronGrid Rate Limits

With no key the backend uses TronGrid's shared 100 req/s IP pool, which the blockchain sync can saturate during catch-up. Each populated key (`TRONGRID_API_KEY`, `TRONGRID_API_KEY_2`, `TRONGRID_API_KEY_3`) lifts the ceiling to 1,000 req/s on its own account, and the rotator round-robins across whichever slots are filled. Add as many as you have.

Disable `ENABLE_SCHEDULER` during local dev to avoid this pressure entirely — the cron pulls blocks every minute and refreshes markets every ten, which is rude to a shared key.

## Notification Throttle Asymmetry

`NOTIFICATION_EMAIL_THROTTLE_MS` defaults to 300000 (5 minutes) where `NOTIFICATION_WEBSOCKET_THROTTLE_MS` defaults to 5000. Email costs more per send and inbox tolerance is much lower than UI tolerance — don't equalize them without thinking about user experience and provider cost.

## Object Storage Reserved Vars

Page module file uploads currently always use the local filesystem provider — `PagesModule` instantiates `LocalStorageProvider` unconditionally. The `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, and `STORAGE_FORCE_PATH_STYLE` env vars are reserved for a future S3-style provider that has not yet been wired up. Setting them today has no effect.

## Validation Is Fail-Fast

`env.ts` parses `process.env` with Zod at startup. On failure the backend logs per-field errors and exits — there is no degraded mode. Missing `MONGODB_URI` or `REDIS_URL` always blocks startup. Optional vars produce warnings only when their absence is dangerous (e.g. `SESSION_SECRET` in dev).

## Further Reading

- Schema (authoritative inventory): `src/backend/config/env.ts`
- Template: `tronrelic/.env.example`
- Runtime config: [system-runtime-config.md](./system/system-runtime-config.md)
- Scheduler control: [system-scheduler-operations.md](./system/system-scheduler-operations.md)
- Deployment: [tronrelic-ops/docs/operations/operations.md](../../docs/operations/operations.md)
