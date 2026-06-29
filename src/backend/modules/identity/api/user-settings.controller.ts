/**
 * @fileoverview HTTP interface for the central per-user settings store.
 *
 * The self-service surface a logged-in user drives to read and change their own
 * settings. Login-gated, never admin: a user owns their own settings. The userId
 * is taken from the resolved Better Auth session, never the request body, so a
 * user can only touch their own rows.
 *
 * This surface is untrusted, so it is deliberately narrow: it serves and writes
 * only settings a provider has registered as `userWritable`, and a write must
 * pass that definition's validator. An unregistered or non-writable
 * `(namespace, key)`, or a value the validator rejects, is a 400 — never stored.
 * That allow-list is what prevents an authenticated user from writing arbitrary
 * keys and exhausting their storage.
 */

import type { Request, Response } from 'express';
import { isLoggedIn } from '@/types';
import type { IHasAuthSession, ISystemLogService } from '@/types';
import type { UserSettingsService } from '../services/user-settings.service.js';

/**
 * Serves and updates the current user's registered, user-writable settings.
 *
 * Constructed in `IdentityModule.init()` with the {@link UserSettingsService}
 * singleton and the module logger.
 */
export class UserSettingsController {
    /**
     * @param settings - Central settings store.
     * @param logger - Module logger; a `component: 'user-settings-controller'` child is derived.
     */
    constructor(
        private readonly settings: UserSettingsService,
        private readonly logger: ISystemLogService
    ) {
        this.logger = logger.child({ component: 'user-settings-controller' });
    }

    /**
     * Resolve the caller's Better Auth user id, or `null` when not logged in.
     *
     * @param req - Request carrying the resolved session.
     * @returns The user id, or `null`.
     */
    private userId(req: Request): string | null {
        if (!isLoggedIn(req as unknown as IHasAuthSession)) {
            return null;
        }
        return (req as unknown as IHasAuthSession).authSession?.user?.id ?? null;
    }

    /**
     * GET `/` — the caller's stored values for every user-writable setting plus
     * the catalog the UI renders the form from. The validator function is dropped
     * from the catalog projection because it cannot cross the wire.
     */
    get = async (req: Request, res: Response): Promise<void> => {
        const userId = this.userId(req);
        if (!userId) {
            res.status(401).json({ success: false, error: 'Authentication required' });
            return;
        }

        try {
            const definitions = this.settings.listDefinitions().filter((d) => d.userWritable);
            const catalog = definitions.map((d) => ({
                namespace: d.namespace,
                key: d.key,
                label: d.label,
                description: d.description
            }));
            const values = await Promise.all(
                definitions.map(async (d) => ({
                    namespace: d.namespace,
                    key: d.key,
                    value: await this.settings.get(userId, d.namespace, d.key)
                }))
            );
            res.json({ success: true, catalog, values });
        } catch (error) {
            this.logger.error({ error, userId }, 'Failed to read user settings');
            res.status(500).json({ success: false, error: 'Failed to read settings' });
        }
    };

    /**
     * PUT `/` — write one setting. Body: `{ namespace, key, value }`. Rejects an
     * unregistered or non-writable pairing, or a value the registered validator
     * refuses, with a 400 so model-free client input cannot smuggle unexpected
     * shapes or keys into storage.
     */
    put = async (req: Request, res: Response): Promise<void> => {
        const userId = this.userId(req);
        if (!userId) {
            res.status(401).json({ success: false, error: 'Authentication required' });
            return;
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const namespace = body.namespace;
        const key = body.key;
        if (typeof namespace !== 'string' || typeof key !== 'string') {
            res.status(400).json({ success: false, error: 'namespace and key are required strings' });
            return;
        }

        const definition = this.settings.getDefinition(namespace, key);
        if (!definition || !definition.userWritable) {
            res.status(400).json({ success: false, error: 'Unknown or read-only setting' });
            return;
        }
        if (!definition.validate(body.value)) {
            res.status(400).json({ success: false, error: 'Invalid value for setting' });
            return;
        }

        try {
            await this.settings.set(userId, namespace, key, body.value);
            res.json({ success: true, namespace, key, value: body.value });
        } catch (error) {
            this.logger.error({ error, userId, namespace, key }, 'Failed to write user setting');
            res.status(500).json({ success: false, error: 'Failed to write setting' });
        }
    };

    /**
     * DELETE `/` — clear one setting, reverting the user to the registered
     * default. Body: `{ namespace, key }`. Only registered, user-writable
     * settings may be cleared, mirroring the write allow-list.
     */
    remove = async (req: Request, res: Response): Promise<void> => {
        const userId = this.userId(req);
        if (!userId) {
            res.status(401).json({ success: false, error: 'Authentication required' });
            return;
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const namespace = body.namespace;
        const key = body.key;
        if (typeof namespace !== 'string' || typeof key !== 'string') {
            res.status(400).json({ success: false, error: 'namespace and key are required strings' });
            return;
        }

        const definition = this.settings.getDefinition(namespace, key);
        if (!definition || !definition.userWritable) {
            res.status(400).json({ success: false, error: 'Unknown or read-only setting' });
            return;
        }

        try {
            await this.settings.delete(userId, namespace, key);
            res.json({ success: true, namespace, key });
        } catch (error) {
            this.logger.error({ error, userId, namespace, key }, 'Failed to delete user setting');
            res.status(500).json({ success: false, error: 'Failed to delete setting' });
        }
    };
}
