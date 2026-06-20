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
        await this.database
            .getCollection<INotificationPolicyDocument>(POLICY_COLLECTION)
            .updateOne(
                { _id: POLICY_DOC_ID },
                { $set: { [`channels.${channelId}`]: enabled, updatedAt: new Date() } },
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
        await this.database
            .getCollection<INotificationPolicyDocument>(POLICY_COLLECTION)
            .updateOne(
                { _id: POLICY_DOC_ID },
                { $set: { [`categories.${categoryId}`]: enabled, updatedAt: new Date() } },
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
