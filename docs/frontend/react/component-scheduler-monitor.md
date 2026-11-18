# SchedulerMonitor Component

Admin table of the scheduler's jobs, with inline controls for each one. Lives in `src/frontend/modules/scheduler/`. It is the Jobs tab of `/system/scheduler` (`app/[lang]/(site)/(core)/system/scheduler/SchedulerAdminClient.tsx`) and the Schedules tab on every module and plugin admin page that owns a job.

## Why This Matters

Scheduled jobs fail silently — a stalled `blockchain:sync` or stale `markets:refresh` can go unnoticed for hours. SchedulerMonitor puts failed jobs at the top with the first line of their error, shows when each job last ran, and lets an operator change a schedule, switch a job off, or run it now without redeploying.

## How It Works

On mount the component fetches `getSchedulerStatus()`, and re-fetches every 10 s through `setInterval`, which is cleared on unmount. It calls `getSchedulerHealth()` alongside only when it will show the success rate, which is on the unfiltered monitor with stats showing. Toggling a job or editing its schedule PATCHes `/admin/system/scheduler/job/:jobName` and re-fetches; the result message in that job's details row clears after 3 s.

**Panel.** The monitor draws one core `<Panel>`, the same card and header row the storage browsers on a Database tab draw, so a Schedules tab and a Database tab on one page look alike. `title` is the panel's `<h3>` title in every state, including loading, and is "Scheduled Jobs" when omitted. The meta line beside it gives the job count and, when the rows drop a shared namespace (see Names below), states that namespace once. Do not wrap the monitor in a `<Card>` of its own, which would draw a card inside a card.

**Stats strip.** A `<StatGrid size="sm">` of `<StatTile size="sm" surface={false}>`, unboxed because the panel is already the card. `Total` and `Enabled` always show, and `Running` and `Failed` only when nonzero, all counted over the jobs on screen. `Success rate` is the health endpoint's figure, successful runs over every run recorded in `scheduler_executions` for all jobs together. The status response carries nothing per job to scope it with, so it only appears when `jobFilter` is unset.

**Row order.** Failed jobs first, then the rest, each group in the order the scheduler reported it. Running jobs are not lifted, because a job runs for a few seconds at a time and ranking it would move rows up and back down between refreshes. While a schedule input has focus a refresh keeps the order on screen, because moving the row that holds the focused input would take focus away mid-edit and could commit a half-typed schedule.

**Names.** When `jobFilter` is set and every listed name starts with the same namespace ending in a colon, such as `markets:`, the rows drop it and show `refresh` instead of `markets:refresh`. The panel's meta line states the namespace once, and the full name is in the name's tooltip and in the details row. The unfiltered page always shows full names, because there the namespace is what tells one component's jobs from another's.

**Columns.**

| Column | Shows |
|--------|-------|
| Job | Expand toggle and name. A failed job adds the first line of its error under the name, cut off with an ellipsis, with the full text in its tooltip and in the details row |
| Enabled | On/off switch |
| Schedule | The cron expression as an editable input, monospace, every row the width of the longest schedule on screen plus one character, between 14 and 24 characters. A longer expression scrolls inside the field and shows whole in its tooltip, because sizing every row to it took the width the job names needed |
| Status | Badge |
| Last run | Relative time, or "Never" |
| Next run | Relative time such as "in 10m" (`ClientTime format="relative"`), narrow enough to leave the job names their width at tablet size. The status endpoint takes it from the live cron task, so a disabled job shows none; the column is left out when no job on screen has one |
| Run | Run now |

**Narrow widths.** The table passes `flush`, so it runs to the panel's edges, and `stackAt="mobile"`, so at 768px and below each job becomes a labelled entry. The Enabled and Run cells carry no `label`: the switch, coming straight after the job cell, shares the entry's first line with the name, and the run button sits at the end of the entry's last line. On a phone the schedule input fills its field instead of keeping its desktop width.

The schedule input is **uncontrolled** — it commits its `defaultValue` on blur or Enter. Cron validation only checks for five or six whitespace-separated fields; semantic validity is the backend's problem.

## Props

Props are declared once, in the types package, as `ISchedulerMonitorProps`
(`packages/types/src/scheduler/ISchedulerJobStatus.ts`); the component imports
that type rather than restating it. Do not copy the shape into a second
place — that is what let the plugin-facing declaration drift (see Gotchas).

```typescript
interface ISchedulerMonitorProps {
    jobFilter?: string[] | ((job: ISchedulerJobStatus) => boolean);  // Names or predicate; omit to show all
    title?: string;                                                  // Panel title; 'Scheduled Jobs' when omitted
    hideStats?: boolean;                                             // Hide the stats strip
}
```

## Example

The Jobs tab of `/system/scheduler`, from `SchedulerAdminClient.tsx`, where the panel takes the default title. A search box and a status choice above it build the predicate, and `buildJobFilter` returns `undefined` while neither is set, so the default view keeps the success rate:

```tsx
const jobFilter = useMemo(() => buildJobFilter(jobQuery, jobStatus), [jobQuery, jobStatus]);

<JobFilterBar query={jobQuery} status={jobStatus} onQueryChange={setJobQuery} onStatusChange={setJobStatus} />
<SchedulerMonitor jobFilter={jobFilter} />
```

A Schedules tab, filtered by name prefix so a job registered later appears without a change to the page:

```tsx
const isMarketsJob = (job: SchedulerJob) => job.name.startsWith('markets:');

<SchedulerMonitor jobFilter={isMarketsJob} title="Market Schedules" hideStats />
```

## Gotchas

**There is no `token` prop — do not pass one.** It was removed when scheduler admin calls moved to the Better Auth session cookie; `modules/scheduler/api/client.ts` sends a bare `fetch` with no `Authorization` header. Callers that still pass `token` are silently ignored, and gating render on a `localStorage` admin token guards nothing. Gate on `useSystemAuth().isAuthenticated` if you need a gate at all. See [system-auth.md](../../system/system-auth.md).

**One props definition, imported by both sides.** The shape used to live in three places — this doc, a local `Props` interface in the component, and an inline literal in `ISystemComponents` — and two of the three drifted from the implementation without any compiler complaint (an all-optional props type makes the structural check between a declaration and an implementation nearly vacuous). The types package is now the single definition. If you add a prop, add it there.

**Schedule input is uncontrolled.** `defaultValue` only initializes; React state is not the source of truth while typing. Don't try to drive it from a parent — the field commits on blur/Enter and only fires `onScheduleChange` if the trimmed value differs from `job.schedule`.

**Cron validation only counts fields.** `0 99 99 99 99` passes the client check. Real validation happens server-side; expect 200/4xx round-trip to surface bad expressions, not inline rejection.

**Status tone ≠ "blue".** `running` maps to the `warning` Badge tone, not info — it shows in whatever color theme tokens render warnings as (typically yellow/orange).

**No virtualization.** Every filtered job renders a `<JobRow>` to the DOM. The system has fewer than ~30 jobs in practice — fine — but don't drop this into a hypothetical thousand-job context expecting Lazy Lists.

**Any component owning a scheduler job owes its admin page a Schedules tab.** A module or plugin that registers a job must embed this component filtered to its own jobs, rather than leaving an operator to find them on `/system/scheduler` among every other component's. See the rule in [frontend.md](../frontend.md#a-component-that-owns-schedules-or-storage-surfaces-them).

**Plugins consume this through `context.system`, never a deep import.** The component is republished to plugins as `context.system.SchedulerMonitor` with the same props — that is the supported path, and a plugin admin page building its Schedules tab must use it:

```tsx
const { system } = context;
<system.SchedulerMonitor jobFilter={(job) => job.name.startsWith('my-plugin:')} title="My Plugin Schedules" hideStats />
```

Pulling `SchedulerMonitor` across the workspace by relative path instead violates the plugin-isolation rule in [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md). Falling back to `context.api` against `/admin/system/scheduler/...` is only warranted when you need controls this component does not offer.

## Data Sources

| Endpoint | Method | Used by |
|----------|--------|---------|
| `/admin/system/scheduler/status` | GET | Initial load + 10 s refresh |
| `/admin/system/scheduler/health` | GET | Initial load + 10 s refresh, only when `jobFilter` is unset and stats show |
| `/admin/system/scheduler/job/:jobName` | PATCH | Toggle / schedule edit |
| `/admin/system/scheduler/job/:jobName/run` | POST | Run now |

Full endpoint reference: [system-api-scheduler.md](../../system/system-api-scheduler.md). Cron syntax + operations runbook: [system-scheduler-operations.md](../../system/system-scheduler-operations.md).

## Pre-Use Checklist

- [ ] Caller is a client component and inside the global provider tree (`useSystemAuth` will throw otherwise)
- [ ] Visitor is `Verified` and a member of the `admin` group, or `ADMIN_API_TOKEN` is set in backend `.env` and a service token is provided
- [ ] No `token` prop passed — the component has none; admin authority is the session cookie
- [ ] `jobFilter` strings are exact, case-sensitive job names — typos render an empty state, not an error. Prefer a prefix predicate
- [ ] `title` names the component when the monitor is a tab, and the host does not wrap the monitor in a `<Card>`

## Further Reading

- [react.md](./react.md) — Provider composition and `useSystemAuth` location
- [system-api-scheduler.md](../../system/system-api-scheduler.md) — Endpoint contracts
- [system-scheduler-operations.md](../../system/system-scheduler-operations.md) — Cron syntax, operations runbook
- [system-dashboard.md](../../system/system-dashboard.md) — Where SchedulerMonitor mounts in production
- [plugins-frontend-context.md](../../plugins/plugins-frontend-context.md) — Why plugins should not deep-import this component
- [system-auth.md](../../system/system-auth.md) — admin gate (Better Auth session or `ADMIN_API_TOKEN` service token)
