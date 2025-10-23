# TronRelic TODO

## Implement Centralized Database Migration System

TronRelic currently lacks a centralized way to track and apply required database schema changes. When code removes features (like the recent chat and comment system removal), orphaned MongoDB collections remain in the database with no systematic cleanup mechanism. This creates inconsistencies across environments (dev, staging, production) and makes deployments risky since there's no audit trail of what database changes were applied or when.

Implement a TypeScript-based migration system in `apps/backend/src/migrations/` that runs automatically on application startup. Each migration should be a timestamped TypeScript file (e.g., `001-drop-chat-collections.ts`) that uses existing Mongoose models and the dependency injection system. The system should track which migrations have been applied by storing records in a `migration_history` MongoDB collection, preventing duplicate executions and allowing rollback capability. This approach integrates seamlessly with the backend's existing architecture, leverages the logger for audit trails, and eliminates the need for manual database maintenance scripts.

## Implement Centralized Error and Warning Logging to MongoDB

TronRelic currently logs errors and warnings only to Pino transports (console and file-based logs in `.run/backend.log`). While this is useful for development and immediate debugging, there is no persistent database storage of errors and warnings that can be surfaced to administrators through the `/system` monitoring dashboard.

**Problem:**
- Errors and warnings are ephemeral (lost when log files rotate or containers restart)
- No admin interface to view historical errors, warning trends, or error frequency
- Debugging production issues requires SSH access to servers and manual log file inspection
- No way to correlate errors with specific plugin failures, API requests, or blockchain sync issues

**Proposed Solution:**

Create a centralized error/warning logging system that:

1. **Captures structured log entries** at ERROR and WARN levels from Pino logger
2. **Stores entries in MongoDB** collection `system_logs` with schema:
   ```typescript
   {
       timestamp: Date,
       level: 'error' | 'warn',
       message: string,
       service: string,           // e.g., 'tronrelic-backend', plugin ID
       context: object,            // Structured metadata (error stack, request details, etc.)
       resolved: boolean,          // Flag for marking issues as resolved
       resolvedAt?: Date,
       resolvedBy?: string
   }
   ```
3. **Provides admin API endpoints** under `/api/admin/system/logs`:
   - `GET /api/admin/system/logs` - List recent errors/warnings with filtering (level, service, date range, resolved status)
   - `PATCH /api/admin/system/logs/:id/resolve` - Mark error as resolved
   - `DELETE /api/admin/system/logs` - Clear old logs (with retention policy)
4. **Adds System Monitor dashboard tab** showing:
   - Error/warning counts by service and time period
   - Recent unresolved errors with expandable details
   - Trend charts showing error frequency over time
   - Quick actions to mark errors as resolved or clear old logs

**Implementation Notes:**
- Use Pino custom transport/destination to write ERROR and WARN logs to MongoDB asynchronously
- Implement log retention policy (e.g., keep last 10,000 entries or 30 days)
- Add indexes on `timestamp`, `level`, `service`, and `resolved` for efficient querying
- Ensure logging to MongoDB does not block request processing or introduce performance overhead
- Consider rate limiting to prevent log spam from filling MongoDB (e.g., deduplicate identical errors within 1-minute windows)

**Benefits:**
- Admins can monitor system health without SSH access
- Historical error trends help identify recurring issues
- Plugin-specific errors can be tracked and correlated with plugin enable/disable events
- Production debugging becomes faster with searchable, filterable error logs