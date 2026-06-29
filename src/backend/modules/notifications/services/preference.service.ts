/**
 * @fileoverview Per-user notification preferences, persisted in the central
 * user-settings store.
 *
 * Keyed by Better Auth user id. The dispatch pipeline reads a recipient's
 * preferences before delivering on any channel — server-side enforcement is the
 * only place per-user silencing can be honored without trusting the client. A
 * user with no stored row takes every category default and mutes nothing.
 *
 * **Storage moved, semantics stayed.** The opt-out data lives in the identity
 * module's central `'user-settings'` store under the `'notifications'` namespace,
 * not in a notifications-owned collection. This module keeps the
 * notification-specific shape, the catalog-aware validation (in the controller),
 * and the dispatch-time read; only persistence delegates outward. The service is
 * resolved lazily from the registry — identity publishes `'user-settings'` in its
 * own `run()`, which precedes any dispatch, so there is no boot-order race.
 */

import type { ISystemLogService, IUserSettingsService, INotificationPreferences, INotificationPreferenceUpdate } from '@/types';

/** Namespace the notification opt-outs occupy in the central user-settings store. */
export const NOTIFICATION_PREFS_NAMESPACE = 'notifications';

/** Key the single opt-out value is stored under within the namespace. */
export const NOTIFICATION_PREFS_KEY = 'preferences';

/**
 * The stored opt-out value — the notification-specific payload the central store
 * holds opaquely under `(userId, 'notifications', 'preferences')`. Equivalent to
 * {@link INotificationPreferences} without the `userId` (implied by the address).
 */
export interface INotificationPreferencesValue {
    /** Global mute — suppresses every mutable category on every channel. */
    mutedAll: boolean;
    /** category id → channel id → enabled. Missing entry falls back to the category default. */
    overrides: Record<string, Record<string, boolean>>;
}

/**
 * Reads and writes per-user notification preferences through the central
 * user-settings store. Not a singleton — the module constructs exactly one and
 * injects it into the dispatcher and the user controller; it implements no public
 * `IXxxService` contract.
 */
export class PreferenceService {
    /**
     * @param getUserSettings - Lazy resolver for the published `'user-settings'`
     *   service. Lazy because identity registers it in its own `run()`; resolving
     *   per call tolerates that boot order and operator churn, mirroring how the
     *   recipient resolver reaches `'user-groups'`.
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly getUserSettings: () => IUserSettingsService | undefined,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Resolve the central settings store or fail loudly. A miss is a wiring error
     * (identity is a core module, always present at runtime), not a recoverable
     * condition, so callers should not paper over it.
     *
     * @returns The published user-settings service.
     * @throws {Error} When `'user-settings'` is not registered.
     */
    private settings(): IUserSettingsService {
        const service = this.getUserSettings();
        if (!service) {
            throw new Error("Notification preferences require the 'user-settings' service to be registered");
        }
        return service;
    }

    /**
     * Read one user's preferences, defaulting a missing row to "nothing muted".
     *
     * @param userId - Better Auth user id.
     * @returns The user's preferences (never null).
     */
    async get(userId: string): Promise<INotificationPreferences> {
        const value = await this.settings().get<INotificationPreferencesValue>(
            userId,
            NOTIFICATION_PREFS_NAMESPACE,
            NOTIFICATION_PREFS_KEY
        );
        return { userId, mutedAll: value?.mutedAll ?? false, overrides: value?.overrides ?? {} };
    }

    /**
     * Batch-read preferences for a set of recipients in one query, so a blast to
     * N users costs one round-trip rather than N. Users without a row are absent
     * from the map; the dispatcher treats absence as "all defaults".
     *
     * @param userIds - Recipient user ids.
     * @returns Map of userId → stored opt-out value for those that have one.
     */
    async getForUsers(userIds: string[]): Promise<Map<string, INotificationPreferencesValue>> {
        return this.settings().getForUsers<INotificationPreferencesValue>(
            userIds,
            NOTIFICATION_PREFS_NAMESPACE,
            NOTIFICATION_PREFS_KEY
        );
    }

    /**
     * Apply a preference patch, upserting the value. `mutedAll` replaces; the
     * `overrides` map is shallow-merged at the category level so toggling one
     * (category, channel) pair leaves the user's other choices intact.
     *
     * @param userId - Better Auth user id.
     * @param patch - Fields to change.
     * @returns The resulting preferences.
     */
    async update(userId: string, patch: INotificationPreferenceUpdate): Promise<INotificationPreferences> {
        const settings = this.settings();
        const current = await settings.get<INotificationPreferencesValue>(
            userId,
            NOTIFICATION_PREFS_NAMESPACE,
            NOTIFICATION_PREFS_KEY
        );

        const mutedAll = patch.mutedAll ?? current?.mutedAll ?? false;
        const overrides: Record<string, Record<string, boolean>> = { ...(current?.overrides ?? {}) };
        if (patch.overrides) {
            for (const [categoryId, channelMap] of Object.entries(patch.overrides)) {
                overrides[categoryId] = { ...(overrides[categoryId] ?? {}), ...channelMap };
            }
        }

        const value: INotificationPreferencesValue = { mutedAll, overrides };
        await settings.set(userId, NOTIFICATION_PREFS_NAMESPACE, NOTIFICATION_PREFS_KEY, value);

        this.logger.info({ userId }, 'Notification preferences updated');
        return { userId, mutedAll, overrides };
    }
}
