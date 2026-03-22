# Scheduler Operations

This document explains how TronRelic's scheduler works, how to control individual jobs at runtime, and how to troubleshoot scheduling issues.

## Why This Matters

The scheduler drives market refreshes, blockchain sync, cache cleanup, and alert dispatch. When jobs fail or fall behind, data goes stale silently. This document explains how to control individual jobs at runtime and troubleshoot scheduling issues without restarting the backend.

## Scheduler Architecture

### Global Enable/Disable

The scheduler is controlled globally by the `ENABLE_SCHEDULER` environment variable:

```bash
# Enable scheduler (all jobs run on schedule)
ENABLE_SCHEDULER=true

# Disable scheduler (no jobs run)
ENABLE_SCHEDULER=false
```

**When to disable globally:**
- During development to avoid API rate limits
- During troubleshooting to isolate problems
- When running tests

### Per-Job Configuration

Each scheduler job can be controlled independently **at runtime** without requiring a restart:

```
Job: markets:refresh
├── Enabled: true/false (checkbox in UI)
├── Schedule: */5 * * * * (cron expression, editable)
├── Status: success/failed/running/never_run
├── Last Run: 2025-10-16T14:25:00Z
└── Duration: 1.234 seconds
```

Jobs persist their configuration in MongoDB (`scheduler_configs` collection), so settings survive backend restarts.

## Scheduler Jobs

TronRelic includes six built-in scheduler jobs. Plugins can register additional jobs (e.g., `resource-markets:refresh`).

| Job Name | Default Schedule | Purpose | Impact if Down |
|----------|------------------|---------|-----------------|
| `blockchain:sync` | Every 1 min | Retrieve new TRON blocks and index transactions | Whale alerts, transaction data stale |
| `blockchain:prune` | Every 60 min | Remove old transactions (>7 days) | Database grows unbounded |
| `chain-parameters:fetch` | Every 10 min | Fetch TRON chain parameters (energy costs) | Energy cost calculations become inaccurate |
| `usdt-parameters:fetch` | Every 10 min | Fetch USDT transfer energy cost | USDT transfer pricing becomes inaccurate |
| `cache:cleanup` | Every 60 min | Remove expired cache entries | Memory usage grows unbounded |
| `system-logs:cleanup` | Every 60 min | Remove old system logs beyond retention | Log storage grows unbounded |

**Critical jobs** (disable only if you understand the consequences):
- `blockchain:sync` - Core data pipeline
- `chain-parameters:fetch` - Energy pricing calculations

**Safe to disable temporarily:**
- `cache:cleanup` - Only impacts performance, not functionality
- `system-logs:cleanup` - Only impacts log retention

## Controlling Jobs at Runtime

### Using the System Monitor Dashboard

The easiest way to control scheduler jobs:

1. **Navigate to `/system`** - Requires admin token (set in `ADMIN_API_TOKEN`)
2. **Enter your admin token** in the modal (stored in browser localStorage)
3. **Find the "Scheduled Jobs" section**
4. **For each job:**
   - **Toggle enabled/disabled** - Checkbox shows job state (bright background = enabled, dim = disabled)
   - **Modify schedule** - Click schedule input, enter new cron expression, press Enter
   - **Monitor status** - Badge shows: success (green), failed (red), running (blue), never_run (gray)
   - **View last run** - Timestamp and duration displayed below job name

**Visual indicators:**
- ✅ **Bright background** - Job is enabled and will run on schedule
- ❌ **Dim background** - Job is disabled and will NOT run
- 🟢 **Green badge** - Last execution succeeded
- 🔴 **Red badge** - Last execution failed
- 🔵 **Blue badge** - Currently running
- ⚪ **Gray badge** - Never run since server started

### Using the Admin API

Alternatively, control jobs programmatically:

**Check scheduler status:**
```bash
curl -H "X-Admin-Token: your-token" \
  http://localhost:4000/api/admin/system/scheduler/status
```

Response includes all jobs with their enabled state and last execution details.

**Enable a job:**
```bash
curl -X PATCH \
  -H "X-Admin-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' \
  http://localhost:4000/api/admin/system/scheduler/job/markets:refresh
```

**Disable a job:**
```bash
curl -X PATCH \
  -H "X-Admin-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  http://localhost:4000/api/admin/system/scheduler/job/blockchain:sync
```

**Modify schedule (every 10 minutes instead of every 5):**
```bash
curl -X PATCH \
  -H "X-Admin-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{"schedule": "*/10 * * * *"}' \
  http://localhost:4000/api/admin/system/scheduler/job/markets:refresh
```

**Both enable AND modify schedule:**
```bash
curl -X PATCH \
  -H "X-Admin-Token: your-token" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "schedule": "*/3 * * * *"}' \
  http://localhost:4000/api/admin/system/scheduler/job/markets:refresh
```

## Cron Expression Syntax

Jobs use standard cron format: `minute hour day-of-month month day-of-week`

**Examples:**

```bash
*/5 * * * *      # Every 5 minutes
*/1 * * * *      # Every 1 minute (same as * * * * *)
0 * * * *        # Every hour at :00
0 0 * * *        # Every day at midnight
0 0 * * 0        # Every Sunday at midnight
*/15 9-17 * * *  # Every 15 min, 9 AM to 5 PM
```

**Common modifications:**

| Current | Change To | Effect | When to Use |
|---------|-----------|--------|-------------|
| `*/5 * * * *` | `*/2 * * * *` | Run twice as often (every 2 min instead of 5) | Catching up after downtime, need faster updates |
| `*/5 * * * *` | `*/10 * * * *` | Run half as often (every 10 min instead of 5) | Reducing API load, data doesn't need frequent updates |
| `*/1 * * * *` | `0 * * * *` | Run once per hour instead of every minute | Maintenance window, temporarily reduce frequency |
| `* * * * *` | `0 9 * * *` | Run once daily at 9 AM instead of every minute | Job only needs to run once per day |

**Validation:** Invalid cron expressions are rejected with an error message. The expression must have exactly 5 space-separated fields.

## Troubleshooting

### Market Data Not Updating

**Symptoms:**
- Market leaderboard shows old prices
- `lastUpdated` timestamp is more than 10 minutes old

**Diagnosis:**

- [ ] Check if scheduler is globally enabled:
   ```bash
   echo $ENABLE_SCHEDULER
   ```

- [ ] Check market job status in `/system`:
   - Find `markets:refresh` job card
   - Check if it's enabled (bright background) or disabled (dim)
   - Look at "Last run" timestamp and status badge

- [ ] Check logs for errors:
   ```bash
   tail -100 .run/backend.log | grep -i market
   ```

**Resolution:**

- **If globally disabled:** Set `ENABLE_SCHEDULER=true` and restart backend
- **If job disabled:** Toggle the checkbox in `/system` to enable
- **If job failed:** Check logs for API errors, verify market endpoints are accessible
- **If job never ran:** Wait 5 minutes for next scheduled execution, or manually trigger via API

### Blockchain Data Stale

**Symptoms:**
- `/system` shows blockchain lag (current block far behind network block)
- New whale transactions don't appear immediately
- Whale alerts are delayed

**Diagnosis:**

- [ ] Check blockchain job status in `/system`:
   - Find `blockchain:sync` job card
   - Verify it's enabled (bright background)
   - Check if status is "success" (green) or "failed" (red)

- [ ] Check blockchain sync metrics in `/system`:
   - Under "Blockchain Status" section
   - Compare "Current Block" vs "Network Block"
   - Check "Processing Rate" (blocks per minute)

- [ ] Check logs:
   ```bash
   tail -100 .run/backend.log | grep -i blockchain
   ```

**Resolution:**

- **If job disabled:** Enable in `/system` dashboard
- **If lag is high:** Verify TronGrid API key is set (`TRONGRID_API_KEY` in `.env`)
- **If status is "failed":** Check logs for network errors, TronGrid rate limits
- **If job never ran:** Wait 1 minute for next execution

### Job Schedule Too Aggressive

**Symptoms:**
- Excessive API requests (hitting rate limits)
- High database load
- Backend CPU usage is very high

**Resolution:**

Increase the job schedule interval in `/system`:

- Find the job (e.g., `markets:refresh`)
- Click the schedule input field
- Change `*/5 * * * *` to `*/10 * * * *` (now runs every 10 min instead of 5)
- Press Enter to save

Changes take effect immediately without restarting the backend.

### Need to Pause a Job Temporarily

**Example scenario:** Running database maintenance, don't want job to interfere

**Solution:**

1. Open `/system`
2. Find the job
3. Uncheck the "Enabled" checkbox
4. Do your maintenance
5. Re-enable the job when done

No restart needed. Job resumes normally.

### Scheduler Jobs Never Execute

**Symptoms:**
- All jobs show status "never_run"
- No execution timestamps

**Diagnosis:**

- [ ] Is scheduler globally enabled?
   ```bash
   echo $ENABLE_SCHEDULER
   ```

- [ ] Check backend logs for initialization:
   ```bash
   tail -50 .run/backend.log | grep -i scheduler
   ```
   Should show: "Scheduler started with configuration from MongoDB"

**Resolution:**

1. If scheduler disabled globally: Set `ENABLE_SCHEDULER=true`
2. Check that `ENABLE_SCHEDULER` is set **before** backend starts
3. Restart backend (Ctrl+C then `npm run dev`)
4. Wait for jobs to execute on their schedule

### Job Execution Takes Too Long

**Symptoms:**
- Job status shows "running" for extended period
- "Duration" field shows very high value (e.g., 30+ seconds)

**Diagnosis:**

- [ ] Check what job is slow:
   - Find job in `/system` dashboard
   - Note the duration value

- [ ] Check logs:
   ```bash
   tail -100 .run/backend.log | grep "jobName"
   ```

**Common causes:**
- **Market fetch:** Upstream API is slow or network is congested
- **Blockchain sync:** Processing many transactions in a full block
- **Database query:** MongoDB is slow or overloaded

**Resolution:**

- For market fetch: Check market API status, verify network connectivity
- For blockchain sync: Check database performance, consider increasing job interval if lag is acceptable
- Generally: Monitor and wait, most slow executions recover on next run

## Configuration Persistence

**Important:** When you enable/disable a job or modify its schedule in `/system`, the change is **persisted to MongoDB** and **survives backend restarts**.

```
User clicks "enable" in /system
    ↓
PATCH request to /api/admin/system/scheduler/job/{jobName}
    ↓
Backend updates scheduler_configs MongoDB collection
    ↓
Job takes effect immediately (no restart needed)
    ↓
On backend restart: Config is loaded from MongoDB
    ↓
Job state preserved as configured
```

## Related Documentation

- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) - How the `blockchain:sync` job processes transactions
- [environment.md](../environment.md) - `ENABLE_SCHEDULER` and `TRONGRID_API_KEY` configuration
