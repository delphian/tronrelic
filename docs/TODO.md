# TronRelic TODO

## Implement Centralized Database Migration System

TronRelic currently lacks a centralized way to track and apply required database schema changes. When code removes features (like the recent chat and comment system removal), orphaned MongoDB collections remain in the database with no systematic cleanup mechanism. This creates inconsistencies across environments (dev, staging, production) and makes deployments risky since there's no audit trail of what database changes were applied or when.

Implement a TypeScript-based migration system in `apps/backend/src/migrations/` that runs automatically on application startup. Each migration should be a timestamped TypeScript file (e.g., `001-drop-chat-collections.ts`) that uses existing Mongoose models and the dependency injection system. The system should track which migrations have been applied by storing records in a `migration_history` MongoDB collection, preventing duplicate executions and allowing rollback capability. This approach integrates seamlessly with the backend's existing architecture, leverages the logger for audit trails, and eliminates the need for manual database maintenance scripts.