/**
 * @fileoverview Admin notification policy — the global channel and category
 * kill switches. A single document holds two maps; a `false` entry disables
 * that channel or category for everyone, evaluated before any per-user
 * preference. A missing entry means enabled, so the default stance is on and an
 * admin only ever records explicit disables.
 */

import type { IDatabaseService, ISystemLogService, INotificationPolicy } from '@/types';
import type { INotificationPolicyDocument } from '../database/index.js';
import { POLICY_COLLECTION, POLICY_DOC_ID } from '../config.js';

/**
 * Reads and writes the singleton policy document. Plain class — one instance,
 * module-constructed, no public `IXxxService` contract.
 */
export class PolicyService {
    /**
     * @param database - Core database service (module-prefixed collection).
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Read the current policy, defaulting to "everything enabled" when no
     * document has been written yet.
     *
     * @returns The policy maps.
     */
    async get(): Promise<INotificationPolicy> {
        const doc = await this.database
            .getCollection<INotificationPolicyDocument>(POLICY_COLLECTION)
            .findOne({ _id: POLICY_DOC_ID });
        return { channels: doc?.channels ?? {}, categories: doc?.categories ?? {} };
    }

    /**
     * Enable or disable a channel globally.
     *
     * @param channelId - Channel id to toggle.
     * @param enabled - New enabled state.
     * @returns The updated policy.
     */
    async setChannel(channelId: string, enabled: boolean): Promise<INotificationPolicy> {
        // Read-modify-write the whole channels map rather than a dotted `$set`
        // field path: a channel id containing `.` would otherwise be expanded
        // into nested Mongo fields, while every read treats the id as a flat
        // literal key. Storing the map keeps the literal-key contract intact.
        const current = await this.get();
        const channels = { ...current.channels, [channelId]: enabled };
        await this.database
            .getCollection<INotificationPolicyDocument>(POLICY_COLLECTION)
            .updateOne(
                { _id: POLICY_DOC_ID },
                { $set: { channels, updatedAt: new Date() } },
                { upsert: true }
            );
        this.logger.info({ channelId, enabled }, 'Notification channel policy updated');
        return this.get();
    }

    /**
     * Enable or disable a category globally.
     *
     * @param categoryId - Category id to toggle.
     * @param enabled - New enabled state.
     * @returns The updated policy.
     */
    async setCategory(categoryId: string, enabled: boolean): Promise<INotificationPolicy> {
        // Read-modify-write the whole categories map rather than a dotted `$set`
        // field path. A category id containing `.` (the built-in
        // `ai-tools.scheduled-prompt-run`) would otherwise be expanded into
        // nested Mongo fields, while dispatch and the admin read path check the
        // flat literal key `categories[categoryId]` — the disable would silently
        // never take effect. Storing the map keeps the literal-key contract.
        const current = await this.get();
        const categories = { ...current.categories, [categoryId]: enabled };
        await this.database
            .getCollection<INotificationPolicyDocument>(POLICY_COLLECTION)
            .updateOne(
                { _id: POLICY_DOC_ID },
                { $set: { categories, updatedAt: new Date() } },
                { upsert: true }
            );
        this.logger.info({ categoryId, enabled }, 'Notification category policy updated');
        return this.get();
    }

    /**
     * Whether a channel is enabled under a policy snapshot. Missing = enabled.
     *
     * @param policy - A policy snapshot from {@link get}.
     * @param channelId - Channel id.
     * @returns True unless explicitly disabled.
     */
    isChannelEnabled(policy: INotificationPolicy, channelId: string): boolean {
        return policy.channels[channelId] !== false;
    }

    /**
     * Whether a category is enabled under a policy snapshot. Missing = enabled.
     *
     * @param policy - A policy snapshot from {@link get}.
     * @param categoryId - Category id.
     * @returns True unless explicitly disabled.
     */
    isCategoryEnabled(policy: INotificationPolicy, categoryId: string): boolean {
        return policy.categories[categoryId] !== false;
    }
}
