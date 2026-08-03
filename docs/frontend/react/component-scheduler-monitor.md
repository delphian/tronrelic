# SchedulerMonitor Component

Admin diagnostic table for BullMQ scheduled jobs. Lives in `src/frontend/modules/scheduler/`. Mounted in production at `/system/scheduler` via `app/(core)/system/scheduler/page.tsx`.

## Why This Matters

Scheduled jobs fail silently — a stalled `blockchain:sync` or stale `markets:refresh` can go unnoticed for hours. SchedulerMonitor surfaces last-run status, error text, next-run time, and inline enable/schedule controls, so operators can diagnose and recover without redeploying.

## How It Works

The component fetches `getSchedulerStatus()` and `getSchedulerHealth()` in parallel on mount, renders a stats bar plus an expandable job table, and re-fetches every 10 s via `setInterval` (cleared on unmount). Toggling enabled or editing the schedule field PATCHes `/admin/system/scheduler/job/:jobName` and re-fetches; per-job feedback clears after 3 s.

The schedule input is **uncontrolled** — it commits its `defaultValue` on blur or Enter. Cron validation is a 5-field syntactic check (`schedule.split(/\s+/).length === 5`); semantic validity is the backend's problem.

The stats bar is **conditional**: `Total` and `Enabled` always show; `Running` and `Failed` only render when nonzero; `Success Rate` only renders when the health endpoint responded. Three different environments can produce three different stat-bar layouts — that's by design.

## Props

Props are declared once, in the types package, as `ISchedulerMonitorProps`
(`packages/types/src/scheduler/ISchedulerJobStatus.ts`); the component imports
that type rather than restating it. Do not copy the shape into a second
place — that is what let the plugin-facing declaration drift (see Gotchas).

```typescript
interface ISchedulerMonitorProps {
    jobFilter?: string[] | ((job: ISchedulerJobStatus) => boolean);  // Names or predicate; omit to show all
    title?: string;                                                  // Section title; defaults to 'Scheduled Jobs'
    hideStats?: boolean;                                             // Hide the stats bar (e.g. when embedding)
}
```

## Example

The canonical mount, copied from `app/(core)/system/scheduler/page.tsx`:

```tsx
'use client';
import { SchedulerMonitor } from '../../../../modules/scheduler';

export default function SchedulerMonitorPage() {
    return <SchedulerMonitor />;
}
```

Filtered embedding (e.g. on a market-jobs panel):

```tsx
<SchedulerMonitor
    jobFilter={['markets:refresh']}                           // or: (job) => job.name.startsWith('markets:')
    title="Market Jobs"
    hideStats
/>
```

## Gotchas

**There is no `token` prop — do not pass one.** It was removed when scheduler admin calls moved to the Better Auth session cookie; `modules/scheduler/api/client.ts` sends a bare `fetch` with no `Authorization` header. Callers that still pass `token` are silently ignored, and gating render on a `localStorage` admin token guards nothing. Gate on `useSystemAuth().isAuthenticated` if you need a gate at all. See [system-auth.md](../../system/system-auth.md).

**One props definition, imported by both sides.** The shape used to live in three places — this doc, a local `Props` interface in the component, and an inline literal in `ISystemComponents` — and two of the three drifted from the implementation without any compiler complaint (an all-optional props type makes the structural check between a declaration and an implementation nearly vacuous). The types package is now the single definition. If you add a prop, add it there.

**Schedule input is uncontrolled.** `defaultValue` only initializes; React state is not the source of truth while typing. Don't try to drive it from a parent — the field commits on blur/Enter and only fires `onScheduleChange` if the trimmed value differs from `job.schedule`.

**Cron validation only counts fields.** `0 99 99 99 99` passes the client check. Real validation happens server-side; expect 200/4xx round-trip to surface bad expressions, not inline rejection.

**Status tone ≠ "blue".** `running` maps to the `warning` Badge tone, not info — it shows in whatever color theme tokens render warnings as (typically yellow/orange).

**No virtualization.** Every filtered job renders a `<JobRow>` to the DOM. The system has fewer than ~30 jobs in practice — fine — but don't drop this into a hypothetical thousand-job context expecting Lazy Lists.

**Plugins consume this through `context.system`, never a deep import.** The component is republished to plugins as `context.system.SchedulerMonitor` with the same props — that is the supported path, and a plugin admin page wanting a Schedules tab should use it:

```tsx
const { system } = context;
<system.SchedulerMonitor jobFilter={['my-plugin:refresh']} title="My Plugin Schedules" hideStats />
```

Pulling `SchedulerMonitor` across the workspace by relative path instead violates the plugin-isolation rule in [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md). Falling back to `context.api` against `/admin/system/scheduler/...` is only warranted when you need controls this component does not offer.

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
- [ ] No `token` prop passed — the component has none; admin authority is the session cookie
- [ ] `jobFilter` strings are exact, case-sensitive job names — typos render an empty state, not an error
- [ ] If embedding, pass `hideStats` to suppress the global stats bar

## Further Reading

- [react.md](./react.md) — Provider composition and `useSystemAuth` location
- [system-api-scheduler.md](../../system/system-api-scheduler.md) — Endpoint contracts
- [system-scheduler-operations.md](../../system/system-scheduler-operations.md) — Cron syntax, operations runbook
- [system-dashboard.md](../../system/system-dashboard.md) — Where SchedulerMonitor mounts in production
- [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md) — Why plugins should not deep-import this component
- [system-auth.md](../../system/system-auth.md) — admin gate (Better Auth session or `ADMIN_API_TOKEN` service token)
