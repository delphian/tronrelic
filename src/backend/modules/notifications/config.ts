/**
 * @fileoverview Shared constants for the notifications module — collection
 * names, the registry service name, the built-in toast channel id, and the
 * audit retention window. Centralized here so the document layer, services,
 * controllers, and tests reference one definition instead of drifting copies.
 */

/** Service-registry name the module publishes `INotificationService` under. */
export const NOTIFICATIONS_SERVICE = 'notifications';

/** Per-user preference documents, keyed by Better Auth user id. */
export const PREFERENCES_COLLECTION = 'module_notifications_preferences';

/** Singleton admin-policy document (channel/category kill switches). */
export const POLICY_COLLECTION = 'module_notifications_policy';

/** One audit row per blast — the admin History feed. */
export const AUDIT_COLLECTION = 'module_notifications_audit';

/** Fixed `_id` of the single policy document. */
export const POLICY_DOC_ID = 'singleton';

/** Built-in delivery channel id. The only channel today; email/push are future. */
export const TOAST_CHANNEL_ID = 'toast';

/** Human label for the toast channel, shown in preference and admin UIs. */
export const TOAST_CHANNEL_LABEL = 'In-app toast';

/**
 * Audit retention. A 90-day TTL keeps the History feed useful without growing
 * the collection unbounded. `createdAt` is stored as a `Date`, so a Mongo TTL
 * index enforces this directly — no scheduled sweep needed.
 */
export const AUDIT_RETENTION_DAYS = 90;

/**
 * Cap on how many members a single audience group resolves to. A runaway group
 * (every account in `admin` by misconfiguration) must not fan a notification to
 * an unbounded recipient set; the resolver logs and truncates past this.
 */
export const MAX_AUDIENCE_GROUP_MEMBERS = 5000;

/** Max audit rows the history endpoint returns in one page. */
export const AUDIT_HISTORY_MAX_LIMIT = 200;
