# SchedulerMonitor Component

An admin diagnostic tool for monitoring BullMQ scheduled job health, execution history, and runtime configuration. Provides real-time job status tracking with inline controls for enabling/disabling jobs and modifying schedules without backend restarts.

## Who This Component Is For

System administrators managing cron job execution, operations engineers troubleshooting scheduler failures, and plugin developers integrating job control into plugin admin pages. Backend developers can use this for debugging scheduler behavior during development.

## Why This Matters

Scheduled jobs fail silently — stale market data or a stalled blockchain sync can go unnoticed for hours. SchedulerMonitor provides real-time visibility into job health and inline controls to enable, disable, or reschedule jobs without restarting the backend.

## Core Features

### Real-Time Job Status Tracking

Displays current execution state for all scheduled jobs with color-coded status badges:

- **Success** (green) - Last execution completed without errors
- **Failed** (red) - Last execution threw an error or timeout
- **Running** (blue) - Job is currently executing
- **Never Run** (gray) - Job has not executed since system startup

Each job card shows last execution timestamp, duration, schedule (cron expression), and error messages for failed runs. Auto-refreshes every 10 seconds for near-real-time monitoring without manual page reloads.

### Scheduler Health Metrics

Global health section displays:

- **Status** - Whether the scheduler is enabled or disabled globally
- **Uptime** - Time since scheduler service started (formatted as "Xh Ym")
- **Success Rate** - Percentage of successful job executions across all jobs

Health metrics help diagnose system-wide scheduler issues (e.g., all jobs failing indicates infrastructure problems, not job-specific bugs).

### Inline Job Control

Each job includes admin controls for runtime configuration:

- **Enable/Disable Toggle** - Checkbox to activate or deactivate job execution without restarting backend
- **Schedule Modification** - Editable cron expression input with validation and blur-to-save behavior
- **Visual Feedback** - Loading states, success confirmations, and error messages for all operations

Changes persist to MongoDB (SchedulerConfigModel) and apply immediately without requiring backend deployment.

### Optional Job Filtering

The `jobFilter` prop enables plugin-scoped views showing only relevant jobs:

- **Array filter** - Pass job names to show specific jobs: `jobFilter={['markets:refresh', 'blockchain:sync']}`
- **Function filter** - Use custom logic for dynamic filtering: `jobFilter={(job) => job.name.startsWith('markets:')}`
- **Hide health section** - Set `hideHealth={true}` to show only job cards without global metrics

Filtering is ideal for plugin admin pages where users only need to control plugin-specific jobs.

## Props Interface

```typescript
interface SchedulerJob {
    name: string;
    schedule: string;
    enabled: boolean;
    lastRun: string | null;
    nextRun: string | null;
    status: 'running' | 'success' | 'failed' | 'never_run';
    duration: number | null;
    error: string | null;
}

interface Props {
    /** Admin authentication token for API requests */
    token: string;
    /** Optional filter to show only specific jobs. Can be job names or a filter function. */
    jobFilter?: string[] | ((job: SchedulerJob) => boolean);
    /** Optional title override for the "Scheduled Jobs" section */
    sectionTitle?: string;
    /** Hide the scheduler health section (useful when showing only specific jobs) */
    hideHealth?: boolean;
}
```

**Prop descriptions:**

- `token` - **Required for backwards compatibility, but typically empty.** The frontend now authorizes admin requests via the signed `tronrelic_uid` cookie carried automatically on same-origin fetches; `useSystemAuth().token` returns `''` and the backend treats an empty `x-admin-token` header as "no token, fall back to cookie". Pass it through as-is. If the cookie path fails (visitor not signed in / not in `admin` group), API calls return 401 — render an `<AuthPrompt href="/system" />` based on `isAuthenticated`, not on token presence.
- `jobFilter` - **Optional**. Array of job names (`['markets:refresh']`) or filter function (`(job) => job.enabled`). When omitted, shows all jobs.
- `sectionTitle` - **Optional**. Custom heading for the jobs section. Defaults to `'Scheduled Jobs'`. Use plugin-specific titles like `'Market Jobs'` for better context.
- `hideHealth` - **Optional**. Boolean to hide global health metrics. Defaults to `false`. Set to `true` in plugin admin pages where scheduler health is irrelevant to plugin users.

## Data Sources

The component fetches data from two admin API endpoints:

1. **`GET /api/admin/system/scheduler/status`** - Returns array of jobs with execution history, status, schedule, and error details
2. **`GET /api/admin/system/scheduler/health`** - Returns global scheduler metrics (enabled state, uptime, success rate)

Both endpoints require admin authority via the [dual-track admin gate](../../../src/backend/modules/user/README.md#admin-authentication--dual-track) — for `/system` SPA usage that resolves through the signed `tronrelic_uid` cookie. Data refreshes every 10 seconds automatically.

**Configuration updates use:**

- **`PATCH /api/admin/system/scheduler/job/:jobName`** - Updates `enabled` or `schedule` fields and persists to MongoDB

See [system-api.md](../../system/system-api.md#scheduler-operations) for complete API documentation.

## Usage Examples

### Basic Usage (Full System View)

Show all scheduler jobs with global health metrics (typical /system/scheduler page usage):

```tsx
'use client';

import { SchedulerMonitor, useSystemAuth } from '../../../features/system';

export default function SchedulerPage() {
    const { token } = useSystemAuth();

    return <SchedulerMonitor token={token} />;
}
```

**What this does:**
- Displays all jobs in the system (blockchain:sync, markets:refresh, cache:cleanup, etc.)
- Shows scheduler health section with uptime and success rate
- Uses default "Scheduled Jobs" section title
- Requires the visitor to be a Verified admin (signed `tronrelic_uid` cookie + `admin` group). `useSystemAuth().isAuthenticated` reflects the server-computed `authStatus` snapshot.

### Plugin-Scoped Job Control

Show only plugin-specific jobs in a plugin admin page (recommended pattern for plugins):

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@/types';

interface SchedulerMonitorProps {
    token: string;
    jobFilter?: string[] | ((job: any) => boolean);
    sectionTitle?: string;
    hideHealth?: boolean;
}

export function PluginSchedulerControl({ context }: { context: IFrontendPluginContext }) {
    const [SchedulerMonitor, setSchedulerMonitor] = useState<React.ComponentType<SchedulerMonitorProps> | null>(null);
    const { token, isAuthenticated, isHydrated } = useSystemAuth();

    useEffect(() => {
        async function loadMonitor() {
            const { SchedulerMonitor: Monitor } = await import(
                '../../../../../src/frontend/features/system'
            );
            setSchedulerMonitor(() => Monitor);
        }
        void loadMonitor();
    }, []);

    if (!isHydrated) return <context.ui.Skeleton height="200px" />;

    if (!isAuthenticated) {
        return (
            <context.ui.Card>
                <p>Admin access required. Sign in via <a href="/profile">/profile</a> with a wallet in the admin group.</p>
            </context.ui.Card>
        );
    }

    if (!SchedulerMonitor) return <context.ui.Skeleton height="200px" />;

    return (
        <context.ui.Card>
            <SchedulerMonitor
                token={token}
                jobFilter={['markets:refresh']}
                sectionTitle="Market Refresh Job"
                hideHealth={true}
            />
        </context.ui.Card>
    );
}
```

**What this does:**
- Dynamically imports SchedulerMonitor to avoid build-time workspace dependencies
- Reads `isAuthenticated` from `useSystemAuth()` — the server-computed `authStatus` snapshot, not a localStorage check
- Filters to show only the `markets:refresh` job
- Hides global health metrics (plugin users don't care about system-wide scheduler)
- Shows an auth prompt when the visitor is not a Verified admin, directing them to `/profile`

### Filter by Job Name Prefix

Show all market-related jobs dynamically:

```tsx
<SchedulerMonitor
    token={adminToken}
    jobFilter={(job) => job.name.startsWith('markets:')}
    sectionTitle="Market Jobs"
    hideHealth={true}
/>
```

**What this does:**
- Matches any job starting with `markets:` (e.g., `markets:refresh`, `markets:cleanup`)
- Useful when job names follow plugin-id prefix convention
- Function filter supports complex logic (enabled state, schedule patterns, etc.)

### Filter by Multiple Jobs

Show related jobs together:

```tsx
<SchedulerMonitor
    token={adminToken}
    jobFilter={['blockchain:sync', 'chain-parameters:fetch', 'usdt-parameters:fetch']}
    sectionTitle="Blockchain Data Jobs"
    hideHealth={false}
/>
```

**What this does:**
- Shows three specific jobs related to blockchain data
- Keeps health section visible (useful for debugging sync issues)
- Custom section title provides context

### Empty State Handling

When filtering results in no matches, the component displays:

```
No jobs match the filter criteria.
```

**When this happens:**
- Job name typo in filter array
- Filter function too restrictive (no jobs match logic)
- Jobs not yet registered (backend hasn't initialized scheduler)

To debug, temporarily remove `jobFilter` to see all available jobs.

## Integration Requirements

### Admin Authentication

SchedulerMonitor authorizes through the [dual-track admin gate](../../../src/backend/modules/user/README.md#admin-authentication--dual-track). For SPA usage that resolves to the cookie path: the visitor needs a signed `tronrelic_uid` cookie, `identityState === Verified`, and membership in the `admin` group. Same-origin fetches carry the cookie automatically; the component does not read or write any JS-readable secret.

**Typical flow:**

1. Visitor signs a wallet on `/profile` (moves them to `Verified`).
2. An existing admin adds them to the `admin` group on `/system/users` (or for the first admin, see [Bootstrapping the first admin](../../../src/backend/modules/user/README.md#bootstrapping-the-first-admin)).
3. `useSystemAuth()` exposes `isAuthenticated`, computed from the server-attached `authStatus` snapshot on every `IUser` payload.
4. Component reads `isAuthenticated` and renders the monitor or an auth prompt accordingly. The `token` prop stays as `''` for fetch-site compatibility — the backend ignores empty `x-admin-token` and falls through to the cookie path.

**Notes:**

- No JS-readable admin secret exists on the client; XSS cannot steal an admin token because there isn't one.
- 401 means the cookie path failed (not Verified, or not in `admin` group). 503 means `ADMIN_API_TOKEN` is unset *and* no admin user resolved.
- Sessions expire after `SESSION_TTL_MS` (14 days from the last wallet signature). Recovery is the normal verify-wallet flow on `/profile` — there is no special "stale admin" UI.

### Auto-Refresh Behavior

The component auto-refreshes data every 10 seconds using `setInterval`. This enables near-real-time monitoring without requiring manual page reloads.

**Lifecycle:**
- Interval starts after first successful data fetch
- Continues while component is mounted
- Cleared on unmount to prevent memory leaks

**Considerations:**
- 10-second refresh balances freshness with API load
- Failed requests retry automatically on next interval
- Long-running jobs (>10s) may show stale "running" status briefly

### Cron Expression Validation

Schedule inputs validate cron expressions before saving. Valid expressions have exactly 5 space-separated fields:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

**Examples:**
- `*/10 * * * *` - Every 10 minutes
- `0 * * * *` - Every hour at :00
- `0 0 * * *` - Every day at midnight
- `0 0 * * 0` - Every Sunday at midnight

Invalid expressions show error feedback: `Invalid cron expression. Must have 5 space-separated fields.`

See [system-scheduler-operations.md](../../system/system-scheduler-operations.md#cron-expression-syntax) for complete cron syntax reference.

## Component Behavior

### Update Flow

When users modify job configuration:

1. **Edit Input** - User changes checkbox or cron expression
2. **Blur/Submit** - Input loses focus or user presses Enter
3. **Validation** - Component validates cron syntax (if schedule change)
4. **API Request** - PATCH request sent to `/api/admin/system/scheduler/job/:jobName`
5. **Visual Feedback** - "Updating..." shown, replaced by success/error message
6. **Data Refresh** - `fetchData()` called to reload current state
7. **Feedback Timeout** - Success/error message clears after 3 seconds

**Error handling:**
- Network failures: Show error message with reason
- Validation failures: Show inline error without API call
- Concurrent updates: Last write wins (no optimistic locking)

### State Management

Component uses local React state (not Redux):

- `jobs` - Array of job objects from API
- `health` - Global scheduler health metrics
- `loading` - Initial load state (shows skeleton)
- `updatingJob` - Currently updating job name (disables inputs)
- `feedback` - Success/error message for specific job

**Why local state:**
- Job data is admin-only (not app-wide)
- Auto-refresh makes stale Redux data problematic
- Local state simplifies component lifecycle

### Performance Characteristics

**Initial Load:**
- 2 parallel API requests (status + health)
- Typical response time: <200ms
- First render after ~250ms

**Auto-Refresh:**
- 2 API requests every 10 seconds
- No visual loading state (data updates silently)
- Failed requests logged to console, don't interrupt UI

**Update Operations:**
- Single PATCH request per change
- Typical response time: <100ms
- Immediate visual feedback (optimistic UI)

**Memory:**
- 10-second interval cleared on unmount
- No memory leaks from interval or event listeners

## Styling and Layout

The component uses CSS Modules for scoped styling:

- File: [SchedulerMonitor.module.css](../../../src/frontend/features/system/components/SchedulerMonitor/SchedulerMonitor.module.css)
- Design tokens: All colors, spacing, and sizes use CSS variables from `globals.css`
- Responsive: Grid layout adapts to container width

**Key style variants:**

- `.job_card--success` - Green border for successful jobs
- `.job_card--failed` - Red border for failed jobs
- `.job_card--running` - Blue border for running jobs
- `.job_card--enabled` - Brighter background for enabled jobs
- `.job_card--disabled` - Dimmed opacity for disabled jobs

**Accessibility:**
- Semantic HTML (sections, labels, inputs)
- ARIA labels for toggles and inputs
- Visible focus states (blue outline on keyboard navigation)
- High contrast borders for status indication

## Common Patterns

### Plugin Admin Page Integration

**Problem:** Plugins need job control without depending on system feature exports.

**Solution:** Dynamic import with fallback UI:

```tsx
const [Monitor, setMonitor] = useState<React.ComponentType<any> | null>(null);

useEffect(() => {
    import('../../../../../src/frontend/features/system')
        .then(({ SchedulerMonitor }) => setMonitor(() => SchedulerMonitor))
        .catch(err => console.error('Failed to load SchedulerMonitor:', err));
}, []);

if (!Monitor) return <LoadingFallback />;
return <Monitor token={token} jobFilter={['my-job']} />;
```

**Benefits:**
- No build-time dependency on system feature
- Graceful degradation if import fails
- Code splitting (SchedulerMonitor loaded on demand)

### Conditional Rendering Based on Auth

**Problem:** Component requires admin authority but plugin pages need to render an auth-required state for non-admin visitors.

**Solution:** Read `isAuthenticated` from `useSystemAuth()` and render an auth prompt directing the user to sign in:

```tsx
const { token, isAuthenticated, isHydrated } = useSystemAuth();

if (!isHydrated) return <Skeleton />;
if (!isAuthenticated) return <AuthPrompt href="/profile" />;

return <SchedulerMonitor token={token} />;
```

**Benefits:**
- Single source of truth — `isAuthenticated` is the server-computed `authStatus.isVerified && authStatus.isAdmin`, not a local heuristic
- No JS-readable admin secret to leak via XSS
- Hydration flag prevents flashing the not-admin UI while the bootstrap call is in flight

### Monitoring Specific Job Type

**Problem:** Need to monitor all jobs of a certain category.

**Solution:** Use function filter with job name pattern:

```tsx
<SchedulerMonitor
    token={token}
    jobFilter={(job) => job.name.includes('blockchain') || job.name.includes('chain-parameters')}
    sectionTitle="Blockchain Jobs"
/>
```

**Benefits:**
- Flexible matching logic
- Easy to extend (add more patterns)
- No hardcoded job names

## Troubleshooting

### "No jobs match the filter criteria"

**Cause:** Filter too restrictive or jobs not registered.

**Fix:**
1. Remove `jobFilter` temporarily to see all jobs
2. Verify job names match filter exactly (case-sensitive)
3. Check backend logs for scheduler initialization errors

### Authentication errors (401 or 503)

**401:** cookie path failed (no signed cookie, not Verified, or not in `admin` group) and no valid service token was presented. Fix by signing a wallet on `/profile` and confirming admin-group membership on `/system/users`.

**503:** `ADMIN_API_TOKEN` is unset *and* no admin user resolved — the admin surface is disabled entirely. Fix by either configuring the service token in backend `.env` or completing the cookie-path sign-in above.

See [system-dashboard.md → Cannot Access Dashboard](../../system/system-dashboard.md#cannot-access-dashboard-401-unauthorized) for the full recovery flow.

### Stale data (not auto-refreshing)

**Cause:** Component unmounted or API errors.

**Fix:**
1. Check browser console for fetch errors
2. Verify network connectivity to backend
3. Ensure component stays mounted (not hidden by parent logic)

### Schedule update not persisting

**Cause:** Invalid cron expression or API error.

**Fix:**
1. Verify cron expression has 5 space-separated fields
2. Check browser console for API error responses
3. Confirm MongoDB connection (backend logs)

## Pre-Implementation Checklist

Before integrating SchedulerMonitor, verify:

- [ ] Cookie-based admin path operational: `SESSION_SECRET` set in backend `.env`, at least one user is a Verified member of the `admin` group
- [ ] Service-token path available for CI/scripts: `ADMIN_API_TOKEN` set in backend `.env`
- [ ] Backend scheduler service initialized and registered jobs
- [ ] MongoDB running (scheduler config persistence requires database)
- [ ] Component rendered client-side (uses `useSystemAuth` and fetch)
- [ ] `useSystemAuth().isAuthenticated` consulted before rendering the monitor; `token` passed through but not relied on

## Further Reading

**Related documentation:**
- [system-scheduler-operations.md](../../system/system-scheduler-operations.md) - Complete scheduler control guide with job management, troubleshooting, and cron syntax
- [system-api.md](../../system/system-api.md#scheduler-operations) - API reference for scheduler endpoints with request/response examples
- [system-dashboard.md](../../system/system-dashboard.md) - Web dashboard usage (where SchedulerMonitor is used in production)

**Related components:**
- [useSystemAuth](../features/system/contexts/SystemAuthContext.tsx) - Hook for retrieving admin token with validation
- [SchedulerService](../../../src/backend/src/services/scheduler.service.ts) - Backend scheduler implementation with BullMQ

**Related topics:**
- [plugins.md](../../plugins/plugins.md) - Plugin system overview (why plugins need isolated job control)
- [frontend-architecture.md](../frontend-architecture.md) - Feature module patterns (where SchedulerMonitor fits in system feature)
