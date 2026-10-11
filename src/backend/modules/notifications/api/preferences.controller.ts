/**
 * @fileoverview User-facing notification preferences controller.
 *
 * Backs the per-user opt-out surface — any logged-in user manages which
 * notifications reach them. Reads are gated on login only (not admin): an
 * ordinary user owns their own preferences. The userId is taken from the
 * resolved Better Auth session, never from the request body, so a user can only
 * read or write their own row. The catalog is narrowed to the categories whose
 * audience includes the caller, so an ordinary user is not offered opt-outs
 * for admin-only notifications that can never reach them.
 */

import type { Request, Response } from 'express';
import { isLoggedIn } from '@/types';
import type { IHasAuthSession, ISystemLogService, INotificationCategory, INotificationPreferenceUpdate } from '@/types';
import type { NotificationService } from '../services/notification.service.js';
import type { PreferenceService } from '../services/preference.service.js';
import type { RecipientResolver } from '../services/recipient-resolver.js';

/**
 * Serves and updates the current user's notification preferences.
 */
export class PreferencesController {
    /**
     * @param notifications - Published service, for the category/channel catalog.
     * @param preferences - Per-user preference store.
     * @param recipients - Audience resolver, the same one dispatch uses, so the
     *        categories a user is shown match the categories that can reach them.
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly notifications: NotificationService,
        private readonly preferences: PreferenceService,
        private readonly recipients: RecipientResolver,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * List the user-configurable categories whose default audience includes
     * this user.
     *
     * Both the read and the write path call this, so the keys a user can write
     * are exactly the keys they are shown. The check uses the category's
     * `defaultAudience`, because that is who receives it unless a `notify()`
     * call overrides the audience for one blast.
     *
     * The resolver is asked for one reusable audience test rather than being
     * called per category, so the caller's group membership is read once per
     * request no matter how many categories modules and plugins have
     * registered.
     *
     * @param userId - Better Auth id of the caller.
     * @returns The categories this user may opt in or out of.
     */
    private async visibleCategories(userId: string): Promise<INotificationCategory[]> {
        const configurable = this.notifications.listCategories().filter((c) => c.userConfigurable !== false);
        const includesCaller = await this.recipients.audienceTest(userId);
        return configurable.filter((category) => includesCaller(category.defaultAudience));
    }

    /**
     * Resolve the caller's Better Auth user id, or null when not logged in.
     *
     * @param req - The request carrying the resolved session.
     * @returns The user id, or null.
     */
    private userId(req: Request): string | null {
        if (!isLoggedIn(req as unknown as IHasAuthSession)) {
            return null;
        }
        return (req as unknown as IHasAuthSession).authSession?.user?.id ?? null;
    }

    /**
     * GET `/` — the caller's preferences plus the catalog the UI renders the
     * opt-out matrix from (the user-configurable categories that can reach the
     * caller, and the channel list).
     */
    getPreferences = async (req: Request, res: Response): Promise<void> => {
        const userId = this.userId(req);
        if (!userId) {
            res.status(401).json({ success: false, error: 'Authentication required' });
            return;
        }

        try {
            const preferences = await this.preferences.get(userId);
            const categories = await this.visibleCategories(userId);
            const channels = this.notifications.listChannels();
            res.json({ success: true, preferences, categories, channels });
        } catch (error) {
            this.logger.error({ error, userId }, 'Failed to read notification preferences');
            res.status(500).json({ success: false, error: 'Failed to read preferences' });
        }
    };

    /**
     * PUT `/` — merge a preference patch (`mutedAll` and/or per-pairing
     * `overrides`). Validates shapes before writing; an invalid body is rejected
     * rather than coerced.
     */
    updatePreferences = async (req: Request, res: Response): Promise<void> => {
        const userId = this.userId(req);
        if (!userId) {
            res.status(401).json({ success: false, error: 'Authentication required' });
            return;
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const patch: INotificationPreferenceUpdate = {};

        if (body.mutedAll !== undefined) {
            if (typeof body.mutedAll !== 'boolean') {
                res.status(400).json({ success: false, error: 'mutedAll must be a boolean' });
                return;
            }
            patch.mutedAll = body.mutedAll;
        }

        try {
            if (body.overrides !== undefined) {
                const validCategoryIds = new Set((await this.visibleCategories(userId)).map((c) => c.id));
                const overrides = this.validateOverrides(body.overrides, validCategoryIds);
                if (!overrides) {
                    res.status(400).json({ success: false, error: 'overrides must be a map of categoryId → { channelId: boolean }' });
                    return;
                }
                patch.overrides = overrides;
            }

            const preferences = await this.preferences.update(userId, patch);
            res.json({ success: true, preferences });
        } catch (error) {
            this.logger.error({ error, userId }, 'Failed to update notification preferences');
            res.status(500).json({ success: false, error: 'Failed to update preferences' });
        }
    };

    /**
     * Validate the `overrides` payload into a strict category→channel→boolean
     * map. Rejects (returns null) on any non-boolean leaf or non-object level so
     * model-free client input cannot smuggle unexpected types into storage, and
     * rejects any `categoryId`/`channelId` that is not a registered,
     * user-configurable pairing the caller is shown — otherwise an
     * authenticated user could bloat their single preferences document with
     * arbitrary keys toward MongoDB's document-size limit (a storage-exhaustion
     * DoS). The allow-list is the catalog `getPreferences` returns to the same
     * user, so writable keys equal readable keys.
     *
     * @param raw - The untrusted `overrides` value from the request body.
     * @param validCategories - Ids of the categories visible to the caller,
     *        from {@link visibleCategories}.
     * @returns A clean overrides map, or null when the shape or a key is invalid.
     */
    private validateOverrides(raw: unknown, validCategories: Set<string>): Record<string, Record<string, boolean>> | null {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            return null;
        }
        const validChannels = new Set(this.notifications.listChannels().map((c) => c.id));
        const result: Record<string, Record<string, boolean>> = {};
        for (const [categoryId, channelMap] of Object.entries(raw as Record<string, unknown>)) {
            if (!validCategories.has(categoryId)) {
                return null;
            }
            if (typeof channelMap !== 'object' || channelMap === null || Array.isArray(channelMap)) {
                return null;
            }
            const clean: Record<string, boolean> = {};
            for (const [channelId, enabled] of Object.entries(channelMap as Record<string, unknown>)) {
                if (!validChannels.has(channelId)) {
                    return null;
                }
                if (typeof enabled !== 'boolean') {
                    return null;
                }
                clean[channelId] = enabled;
            }
            result[categoryId] = clean;
        }
        return result;
    }
}
