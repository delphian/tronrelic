/**
 * @fileoverview Storage shape for the central per-user settings store.
 *
 * One row per `(userId, namespace, key)` triple — the *envelope* the
 * `UserSettingsService` owns. The `value` is opaque provider-owned JSON: the
 * store never interprets it, so a new setting needs no schema change here. This
 * is the "core owns the address, provider owns the payload" idiom the wallet and
 * notification stores also follow, applied to user settings. Keyed by the Better
 * Auth user id (the opaque hex string the rest of the platform uses — see
 * `services/user-id.ts`).
 */

import type { ObjectId } from 'mongodb';

/**
 * Physical collection name for the central per-user settings store.
 *
 * Uses the identity module's historical `module_user_*` prefix (shared with
 * `module_user_wallets` / `module_user_groups`), the convention this module
 * carried out of the former omnibus user module. Renaming is a breaking change
 * for persisted rows — coordinate with a migration.
 */
export const USER_SETTINGS_COLLECTION = 'module_user_settings';

/**
 * One stored setting. The unique `(userId, namespace, key)` index makes this the
 * single row for that address; `value` carries the provider's JSON verbatim.
 */
export interface IUserSettingDocument {
    /** Mongo identity. */
    _id: ObjectId;

    /** Better Auth user id (opaque hex string) this row belongs to. */
    userId: string;

    /** Provider namespace (e.g. `'notifications'`, `'core'`). */
    namespace: string;

    /** Setting key within the namespace. */
    key: string;

    /** Opaque provider-owned value. The store never interprets it. */
    value: unknown;

    /** Last write time. */
    updatedAt: Date;
}
