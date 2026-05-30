# SchedulerMonitor Component

Admin diagnostic table for BullMQ scheduled jobs. Lives in `src/frontend/modules/scheduler/`. Mounted in production at `/system/scheduler` via `app/(core)/system/scheduler/page.tsx`.

## Why This Matters

Scheduled jobs fail silently — a stalled `blockchain:sync` or stale `markets:refresh` can go unnoticed for hours. SchedulerMonitor surfaces last-run status, error text, next-run time, and inline enable/schedule controls, so operators can diagnose and recover without redeploying.

## How It Works

The component fetches `getSchedulerStatus()` and `getSchedulerHealth()` in parallel on mount, renders a stats bar plus an expandable job table, and re-fetches every 10 s via `setInterval` (cleared on unmount). Toggling enabled or editing the schedule field PATCHes `/admin/system/scheduler/job/:jobName` and re-fetches; per-job feedback clears after 3 s.

The schedule input is **uncontrolled** — it commits its `defaultValue` on blur or Enter. Cron validation is a 5-field syntactic check (`schedule.split(/\s+/).length === 5`); semantic validity is the backend's problem.

The stats bar is **conditional**: `Total` and `Enabled` always show; `Running` and `Failed` only render when nonzero; `Success Rate` only renders when the health endpoint responded. Three different environments can produce three different stat-bar layouts — that's by design.

## Props

```typescript
interface Props {
    token: string;                                                // Empty string in normal use — see Gotchas
    jobFilter?: string[] | ((job: SchedulerJob) => boolean);      // Names or predicate; omit to show all
    title?: string;                                               // Section title; defaults to 'Scheduled Jobs'
    hideStats?: boolean;                                          // Hide the stats bar (e.g. when embedding)
}
```

## Example

The canonical mount, copied from `app/(core)/system/scheduler/page.tsx`:

```tsx
'use client';
import { useSystemAuth } from '../../../../features/system';
import { SchedulerMonitor } from '../../../../modules/scheduler';

export default function SchedulerMonitorPage() {
    const { token } = useSystemAuth();
    return <SchedulerMonitor token={token} />;
}
```

Filtered embedding (e.g. on a market-jobs panel):

```tsx
<SchedulerMonitor
    token={token}
    jobFilter={['markets:refresh']}                           // or: (job) => job.name.startsWith('markets:')
    title="Market Jobs"
    hideStats
/>
```

## Gotchas

**The `token` prop is transitional and intended to be `''`.** `useSystemAuth().token` returns an empty string. Admin authority resolves at the API through the Better Auth session cookie; the backend treats empty `x-admin-token` as "no service token, use the session." Do not gate rendering on `token` truthiness — gate on `useSystemAuth().isAuthenticated`. See [system-auth.md](../../system/system-auth.md).

**Schedule input is uncontrolled.** `defaultValue` only initializes; React state is not the source of truth while typing. Don't try to drive it from a parent — the field commits on blur/Enter and only fires `onScheduleChange` if the trimmed value differs from `job.schedule`.

**Cron validation only counts fields.** `0 99 99 99 99` passes the client check. Real validation happens server-side; expect 200/4xx round-trip to surface bad expressions, not inline rejection.

**Status tone ≠ "blue".** `running` maps to the `warning` Badge tone, not info — it shows in whatever color theme tokens render warnings as (typically yellow/orange).

**No virtualization.** Every filtered job renders a `<JobRow>` to the DOM. The system has fewer than ~30 jobs in practice — fine — but don't drop this into a hypothetical thousand-job context expecting Lazy Lists.

**Plugin admin pages should not deep-import this component.** Pulling `SchedulerMonitor` across the workspace from a plugin violates the plugin-isolation rule in [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md). The right options for a plugin that needs job control: (1) link operators to `/system/scheduler?filter=<plugin-id>` (the core admin page filtered by URL convention), or (2) build a minimal control surface inside the plugin using `context.api` to call `/admin/system/scheduler/...` directly.

## Data Sources

| Endpoint | Method | Used by |
|----------|--------|---------|
| `/admin/system/scheduler/status` | GET | Initial load + 10 s refresh |
| `/admin/system/scheduler/health` | GET | Initial load + 10 s refresh |
| `/admin/system/scheduler/job/:jobName` | PATCH | Toggle / schedule edit |

Full endpoint reference: [system-api-scheduler.md](../../system/system-api-scheduler.md). Cron syntax + operations runbook: [system-scheduler-operations.md](../../system/system-scheduler-operations.md).

## Pre-Use Checklist

- [ ] Caller is a client component and inside the global provider tree (`useSystemAuth` will throw otherwise)
- [ ] Visitor is `Verified` and a member of the `admin` group, or `ADMIN_API_TOKEN` is set in backend `.env` and a service token is provided
- [ ] `token` plumbed through but not gated on
- [ ] `jobFilter` strings are exact, case-sensitive job names — typos render an empty state, not an error
- [ ] If embedding, pass `hideStats` to suppress the global stats bar

## Further Reading

- [react.md](./react.md) — Provider composition and `useSystemAuth` location
- [system-api-scheduler.md](../../system/system-api-scheduler.md) — Endpoint contracts
- [system-scheduler-operations.md](../../system/system-scheduler-operations.md) — Cron syntax, operations runbook
- [system-dashboard.md](../../system/system-dashboard.md) — Where SchedulerMonitor mounts in production
- [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md) — Why plugins should not deep-import this component
- [system-auth.md](../../system/system-auth.md) — admin gate (Better Auth session or `ADMIN_API_TOKEN` service token)
