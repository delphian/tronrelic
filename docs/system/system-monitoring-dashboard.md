# System Monitoring Dashboard

The System Monitoring Dashboard provides real-time visibility into all TronRelic operations through a web-based interface. Access it at `/system` to track blockchain sync status, scheduler jobs, market data quality, and infrastructure health.

## Why This Matters

Without operational visibility, you cannot:

- **Diagnose sync failures** - Blockchain lag means whale alerts stop appearing, but you won't know why
- **Detect stale pricing** - Users see outdated energy prices on the leaderboard without warning
- **Troubleshoot scheduler issues** - Jobs fail silently and critical tasks like market refresh don't run
- **Monitor resource usage** - Memory leaks or database connection failures go unnoticed until the system crashes
- **Control system behavior** - No way to pause jobs, trigger manual refreshes, or adjust thresholds without code deployments
- **Verify integrations** - TronGrid API keys, Telegram bots, or database connections may be misconfigured

The dashboard surfaces these issues immediately and provides point-and-click controls to resolve them without backend restarts.

## Accessing the Dashboard

### Authentication Workflow

1. **Generate an admin token** (if not already set):
   ```bash
   openssl rand -hex 32
   ```

2. **Configure the backend** with your token in `apps/backend/.env`:
   ```bash
   ADMIN_API_TOKEN=your-secure-token-here
   ```

3. **Restart the backend** if already running:
   ```bash
   ./scripts/stop.sh && ./scripts/start.sh
   ```

4. **Navigate to the dashboard** at `http://localhost:3000/system` (or your production domain)

5. **Enter your admin token** in the authentication modal - it will be stored in browser localStorage for subsequent visits

**Security note:** The admin token grants full control over system operations. Never commit it to version control or share it publicly.

## Monitoring Workflows

### Diagnosing Blockchain Sync Issues

**Problem:** Whale alerts stopped appearing on the frontend, or the transactions page shows stale data.

**Workflow:**

1. **Open the Blockchain tab** in the dashboard
2. **Check sync status indicators:**
   - **Current Block** vs **Network Block** - If the difference (lag) is >100 blocks, sync is behind
   - **Processing Rate** - Should show ~3 blocks/minute under normal load
   - **Backfill Queue** - If >0, blocks failed processing and need retry
3. **Review recent errors** - Error messages appear below the status section
4. **Take action:**
   - If lag is high: Click "Trigger Sync Now" to force immediate catch-up
   - If errors show rate limits: Check that `TRONGRID_API_KEY` is set in backend `.env`
   - If queue is growing: Review backend logs for persistent failures

**Expected outcome:** Lag decreases over time, processing rate stabilizes, and new transactions appear in the frontend feed.

### Checking Market Data Quality

**Problem:** Users report that energy rental prices on the leaderboard are hours old or don't match current market rates.

**Workflow:**

1. **Open the Markets tab**
2. **Check data freshness overview:**
   - **Stale Platform Count** - If >3, many platforms have outdated data
   - **Average Data Age** - Should be <10 minutes
   - **Oldest Data Age** - Highlights worst-case staleness
3. **Review platform status table:**
   - Each row shows: status (online/stale/failed), last fetch time, reliability score
   - Red status badges indicate failures
   - Yellow badges indicate stale data (>10 min old)
4. **Take action:**
   - If a few platforms are stale: Wait for next scheduled refresh (every 10 min)
   - If many platforms are stale: Click "Refresh All Markets" to force immediate update
   - If specific platform consistently fails: Check backend logs for API errors from that provider

**Expected outcome:** All platforms show "online" status with fresh timestamps (<10 minutes), and leaderboard displays current pricing.

### Monitoring Scheduler Health

**Problem:** System Monitor shows jobs haven't run recently, or scheduled tasks like market refresh aren't executing on time.

**Workflow:**

1. **Open the Scheduler tab**
2. **Check scheduler health summary:**
   - **Enabled** - Must show "true" (if "false", set `ENABLE_SCHEDULER=true` in `.env` and restart)
   - **Uptime** - Shows how long scheduler has been running
   - **Success Rate** - Should be near 100%
3. **Review individual job status:**
   - Each job card shows: name, schedule (cron expression), enabled state, last run, status badge
   - **Green badge** - Last run succeeded
   - **Red badge** - Last run failed (check error message below)
   - **Gray badge** - Never run (likely disabled or scheduler just started)
4. **Take action:**
   - If job is disabled (dim background): Toggle the enabled checkbox
   - If job failed: Review error message, check logs for root cause
   - If job never ran: Ensure scheduler is globally enabled and wait for next scheduled execution

**Expected outcome:** All critical jobs (`blockchain:sync`, `markets:refresh`) show green status badges with recent timestamps.

### Verifying System Integrations

**Problem:** Features aren't working (e.g., whale alerts not sending, market data not fetching) and you suspect configuration issues.

**Workflow:**

1. **Open the Config tab**
2. **Check integrations section:**
   - **TronGrid API Key** - Must show "Configured" for blockchain sync to work
   - **Telegram Bot** - Shows "Configured" if bot token is set via `/system/plugins` admin UI
   - **Storage** - Shows "Configured" if storage credentials are present
3. **Review feature flags:**
   - **Scheduler Enabled** - Must be "true" for jobs to run
   - **WebSockets Enabled** - Must be "true" for real-time updates
4. **Take action:**
   - If TronGrid key not configured: Add `TRONGRID_API_KEY` to backend `.env` and restart
   - If Telegram Bot not configured: Navigate to `/system/plugins`, enable telegram-bot plugin, configure bot token in settings
   - If scheduler disabled: Set `ENABLE_SCHEDULER=true` and restart
   - If WebSockets disabled: Set `ENABLE_WEBSOCKETS=true` and restart

**Expected outcome:** All required integrations show "Configured" and feature flags match expected state.

### Monitoring Infrastructure Health

**Problem:** System is slow, unresponsive, or showing connection errors.

**Workflow:**

1. **Open the Health tab**
2. **Check database status:**
   - **Connected** - Must be "true"
   - **Response Time** - Should be <50ms
   - **Recent Errors** - Should be empty
3. **Check Redis cache status:**
   - **Connected** - Must be "true"
   - **Response Time** - Should be <10ms
   - **Evictions** - If >0, Redis is running out of memory
4. **Check server metrics:**
   - **Memory Usage** - Heap used vs. total (should be <80%)
   - **CPU Usage** - Should be <50% under normal load
5. **Take action:**
   - If database disconnected: Check MongoDB container status with `docker ps`
   - If Redis disconnected: Check Redis container status
   - If memory usage high: Look for memory leaks in backend logs, consider restarting
   - If CPU high: Check for runaway jobs or processing bottlenecks

**Expected outcome:** All services show "Connected" status, response times are low, and resource usage is within acceptable ranges.

## Dashboard Reference

The dashboard is organized into six tabs:

### Overview Tab

At-a-glance summary of all system metrics:
- Blockchain sync status (current block, lag, health indicator)
- Transaction statistics (total indexed, today's count)
- Scheduler status (enabled/disabled, uptime)
- Market data freshness (stale count, average age)
- Database and Redis connection status
- Server uptime and memory usage

**Refresh rate:** Every 10 seconds

### Blockchain Tab

Detailed blockchain sync monitoring:
- Current vs. network block height
- Lag in blocks and estimated catch-up time
- Processing rate (blocks per minute)
- Transaction indexing stats (total, today, by type)
- Block processing performance metrics
- Manual "Trigger Sync Now" button

**Refresh rate:** Every 5 seconds

### Scheduler Tab

Scheduler job control and monitoring:
- Global scheduler health (enabled, uptime, success rate)
- Individual job cards with:
  - Name and cron schedule
  - Enable/disable checkbox
  - Last run timestamp and duration
  - Status badge (success/failed/running/never_run)
  - Error message (if failed)

**Refresh rate:** Every 10 seconds

### Markets Tab

Market data quality monitoring:
- Freshness overview (stale count, average age, oldest age)
- Platform status table with:
  - Status indicator (online/stale/failed/disabled)
  - Last fetch timestamp
  - Reliability score (percentage)
  - Consecutive failures count
- Manual "Refresh All Markets" and "Force Refresh" buttons

**Refresh rate:** Every 10 seconds

### Health Tab

Infrastructure health monitoring:
- **MongoDB:** Connection status, ping time, database size, collection count
- **Redis:** Connection status, ping time, key count, memory usage, evictions
- **Server:** Uptime, heap/RSS memory, CPU usage

**Refresh rate:** Every 10 seconds

### Config Tab

System configuration display:
- Environment (development/production) and port
- Feature flags (scheduler, WebSockets, telemetry)
- Operational thresholds (whale amounts, delegation/stake minimums)
- Rate limits (comments/day, chat messages/day)
- Integration status (TronGrid key, Telegram bot, storage)

**Refresh rate:** Manual refresh only

## Troubleshooting

### Cannot Access Dashboard (401 Unauthorized)

**Cause:** Invalid or missing admin token.

**Solution:**
1. Verify `ADMIN_API_TOKEN` is set in backend `.env`
2. Clear browser localStorage and re-enter the token
3. Check token doesn't have extra whitespace or quotes
4. Restart backend after changing token

### Dashboard Shows "No Data" or Empty Metrics

**Cause:** Scheduler hasn't run yet (fresh install) or jobs are disabled.

**Solution:**
1. Check Scheduler tab - verify scheduler is enabled
2. Wait 1-10 minutes for jobs to execute on schedule
3. Manually trigger blockchain sync and market refresh
4. Review backend logs for job execution errors

### Job Enable/Disable Toggle Not Working

**Cause:** Scheduler is globally disabled via `ENABLE_SCHEDULER=false`.

**Solution:**
1. Set `ENABLE_SCHEDULER=true` in backend `.env`
2. Restart backend: `./scripts/stop.sh && ./scripts/start.sh`
3. Return to dashboard and toggle jobs

### Blockchain Lag Not Decreasing

**Cause:** Processing rate is lower than network block production rate (20 blocks/min).

**Solution:**
1. Check backend logs for errors during block processing
2. Verify TronGrid API keys are valid and not rate-limited
3. Check database performance (slow writes can delay processing)
4. Ensure no observers are blocking the sync pipeline

### Market Data Stays Stale After Manual Refresh

**Cause:** Upstream market provider APIs are down or rate-limiting requests.

**Solution:**
1. Wait 5-10 minutes for retry logic to recover
2. Check backend logs for specific API error messages
3. Use "Force Refresh" button to bypass cache
4. If one platform consistently fails, it may be temporarily unavailable

### High Memory Usage in Server Metrics

**Cause:** Potential memory leak or excessive caching.

**Solution:**
1. Check Redis memory usage (may need to increase limit)
2. Review observer queue depths (high queues indicate processing lag)
3. Check for long-running scheduler jobs
4. Consider restarting backend if heap usage exceeds 1GB
5. Monitor for growth over time to identify leaks

## Related Documentation

- [system.md](./system.md) - System architecture overview
- [system-api.md](./system-api.md) - Complete API reference for all admin endpoints
- [system-scheduler-operations.md](./system-scheduler-operations.md) - Detailed scheduler control and troubleshooting
- [system-blockchain-sync-architecture.md](./system-blockchain-sync-architecture.md) - Blockchain sync implementation details
- [environment.md](../environment.md) - Environment variable configuration
