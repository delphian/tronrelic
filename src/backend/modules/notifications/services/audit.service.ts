/**
 * @fileoverview Notification audit store — one durable row per blast, backing
 * the admin History tab. Every dispatch appends a record snapshotting the
 * category label, audience, and per-channel delivered/suppressed counts, so an
 * operator can answer "what fired, to whom, and what was silenced" even after
 * the firing plugin (and its category) is gone.
 */

import { ObjectId } from 'mongodb';
import type { IDatabaseService, ISystemLogService, INotificationAuditRecord, INotificationAuditQuery } from '@/types';
import type { INotificationAuditDocument } from '../database/index.js';
import { AUDIT_COLLECTION, AUDIT_RETENTION_DAYS, AUDIT_HISTORY_MAX_LIMIT } from '../config.js';

/**
 * Appends and queries audit rows. Plain class — module-constructed, single
 * instance.
 */
export class AuditService {
    /**
     * @param database - Core database service (module-prefixed collection).
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Ensure the query and retention indexes. The TTL index on `createdAt`
     * (a real `Date`) enforces the {@link AUDIT_RETENTION_DAYS} window directly,
     * so no scheduled sweep is needed. Idempotent.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(AUDIT_COLLECTION, { createdAt: -1 }, { name: 'createdAt_desc' });
        await this.database.createIndex(AUDIT_COLLECTION, { categoryId: 1, createdAt: -1 }, { name: 'category_createdAt' });
        await this.database.createIndex(
            AUDIT_COLLECTION,
            { createdAt: 1 },
            { name: 'audit_ttl', expireAfterSeconds: AUDIT_RETENTION_DAYS * 86400 }
        );
    }

    /**
     * Mint an id ahead of delivery so the same id labels the client-side
     * notification and the audit row. Generating it up front lets the toast
     * payload carry the audit id without a second write.
     *
     * @returns A fresh ObjectId.
     */
    nextId(): ObjectId {
        return new ObjectId();
    }

    /**
     * Persist a finished blast.
     *
     * @param doc - The fully-tallied audit document (with the pre-minted `_id`).
     */
    async record(doc: INotificationAuditDocument): Promise<void> {
        try {
            await this.database.getCollection<INotificationAuditDocument>(AUDIT_COLLECTION).insertOne(doc);
        } catch (error) {
            // Audit is best-effort relative to delivery: a write failure must not
            // unwind a notification that already reached users. Log and move on.
            this.logger.error({ error, categoryId: doc.categoryId }, 'Failed to persist notification audit row');
        }
    }

    /**
     * Query audit history, newest first.
     *
     * @param query - Optional category/source filters and pagination.
     * @returns Matching records plus the unpaginated total for the filter.
     */
    async query(query: INotificationAuditQuery = {}): Promise<{ records: INotificationAuditRecord[]; total: number }> {
        const filter: Record<string, unknown> = {};
        if (query.categoryId) {
            filter.categoryId = query.categoryId;
        }
        if (query.source) {
            filter.source = query.source;
        }

        const limit = Math.min(Math.max(query.limit ?? 50, 1), AUDIT_HISTORY_MAX_LIMIT);
        const skip = Math.max(query.skip ?? 0, 0);

        const collection = this.database.getCollection<INotificationAuditDocument>(AUDIT_COLLECTION);
        const [docs, total] = await Promise.all([
            collection.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
            collection.countDocuments(filter)
        ]);

        return { records: docs.map((d) => this.toPublic(d)), total };
    }

    /**
     * Project a stored audit document to its public record shape.
     *
     * @param doc - Stored document.
     * @returns Public audit record with a string id.
     */
    private toPublic(doc: INotificationAuditDocument): INotificationAuditRecord {
        return {
            id: doc._id ? doc._id.toHexString() : '',
            categoryId: doc.categoryId,
            categoryLabel: doc.categoryLabel,
            source: doc.source,
            severity: doc.severity,
            title: doc.title,
            body: doc.body,
            audience: doc.audience,
            recipientCount: doc.recipientCount,
            suppressedCount: doc.suppressedCount,
            channels: doc.channels,
            firedBy: doc.firedBy,
            createdAt: doc.createdAt
        };
    }
}
