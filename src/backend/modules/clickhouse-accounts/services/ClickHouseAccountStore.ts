/**
 * @fileoverview MongoDB storage for admin-tuned account limits and the audit
 * trail of admin actions.
 *
 * Limits are stored so an admin's change survives a restart: at startup the
 * platform applies the stored limits, not the code defaults. The audit trail
 * is stored beside them so every change can be traced to the admin who made
 * it.
 */

import type { IClickHouseAccountAuditEntry, IClickHouseAccountLimits, IDatabaseService } from '@/types';

/** Collection holding one document of limits per managed account. */
export const LIMITS_COLLECTION = 'module_clickhouse-accounts_limits';

/** Collection holding one document per admin action. */
export const AUDIT_COLLECTION = 'module_clickhouse-accounts_audit';

/**
 * Stored limits for one account.
 */
interface ILimitsDocument {
    accountId: string;
    limits: IClickHouseAccountLimits;
    updatedAt: Date;
    updatedBy: string;
}

/**
 * Stored audit entry. The same fields as the API shape, with a real date so
 * the collection can be sorted and indexed by time.
 */
interface IAuditDocument extends Omit<IClickHouseAccountAuditEntry, 'at'> {
    at: Date;
}

/**
 * Reads and writes account limits and audit entries.
 */
export class ClickHouseAccountStore {
    /**
     * @param database - Core database service the module received at init.
     */
    constructor(private readonly database: IDatabaseService) {}

    /**
     * Create the indexes the store's queries rely on: one limits document per
     * account, and audit entries read newest first per account.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(LIMITS_COLLECTION, { accountId: 1 }, { unique: true });
        await this.database.createIndex(AUDIT_COLLECTION, { accountId: 1, at: -1 });
    }

    /**
     * Read the limits an admin stored for an account.
     *
     * @param accountId - The account.
     * @returns The stored limits, or null when no admin has changed them.
     */
    async getLimits(accountId: string): Promise<IClickHouseAccountLimits | null> {
        const doc = await this.database.findOne<ILimitsDocument>(LIMITS_COLLECTION, { accountId });

        return doc?.limits ?? null;
    }

    /**
     * Store an account's limits, replacing any stored before.
     *
     * @param accountId - The account.
     * @param limits - The complete limits now in force.
     * @param actorId - The admin who set them.
     */
    async saveLimits(accountId: string, limits: IClickHouseAccountLimits, actorId: string): Promise<void> {
        await this.database.getCollection<ILimitsDocument>(LIMITS_COLLECTION).updateOne(
            { accountId },
            { $set: { accountId, limits, updatedAt: new Date(), updatedBy: actorId } },
            { upsert: true }
        );
    }

    /**
     * Record one admin action.
     *
     * @param entry - The action, with `at` as an ISO timestamp.
     */
    async appendAudit(entry: IClickHouseAccountAuditEntry): Promise<void> {
        await this.database.insertOne<IAuditDocument>(AUDIT_COLLECTION, { ...entry, at: new Date(entry.at) });
    }

    /**
     * Read an account's audit trail.
     *
     * @param accountId - The account.
     * @param limit - Most entries to return.
     * @returns Newest first.
     */
    async listAudit(accountId: string, limit: number): Promise<IClickHouseAccountAuditEntry[]> {
        const docs = await this.database.find<IAuditDocument>(AUDIT_COLLECTION, { accountId }, { sort: { at: -1 }, limit });

        return docs.map(doc => ({
            accountId: doc.accountId,
            action: doc.action,
            actorId: doc.actorId,
            at: new Date(doc.at).toISOString(),
            reason: doc.reason ?? null,
            before: doc.before ?? null,
            after: doc.after ?? null,
            detail: doc.detail ?? null,
            succeeded: doc.succeeded
        }));
    }
}
