/**
 * @fileoverview Storage for sign-in events: writes from the audit hook, and
 * filtered reads for the identity AI tools.
 *
 * Each event is one document in `module_user_sign_in_events`. MongoDB deletes
 * a document 90 days after its `occurredAt`, through a time-to-live index, so
 * no scheduler job is needed for retention.
 */

import type { Collection, Filter } from 'mongodb';
import type { IDatabaseService, ISystemLogService } from '@/types';
import {
    SIGN_IN_EVENTS_COLLECTION,
    SIGN_IN_EVENT_RETENTION_DAYS,
    type ISignInEventDocument,
    type SignInEventKind
} from '../database/ISignInEventDocument.js';
import type { ISignInEventRecorder } from './ISignInEventRecorder.js';

/** Which events a read should return. Every field is optional and they combine with AND. */
export interface ISignInEventQuery {
    /** Exact address, compared lowercased. */
    email?: string;

    /** Better Auth user id; matches successful sign-ins only, since only those carry one. */
    userId?: string;

    /** Exact caller network address. */
    ip?: string;

    /** Exact method, such as `email-otp` or `oauth:github`. */
    method?: string;

    /** One event kind. */
    kind?: SignInEventKind;

    /** Only events at or after this time. */
    since?: Date;

    /** Only events at or before this time. */
    until?: Date;
}

/**
 * Turn a query into a MongoDB filter.
 *
 * Exported so the mapping can be tested without a database. Every value is
 * matched by equality or a date range, so a caller-supplied string is never
 * interpreted as an operator or a pattern.
 *
 * @param query - The fields to filter on.
 * @returns The filter; empty when the query names nothing.
 */
export function buildSignInEventFilter(query: ISignInEventQuery): Filter<ISignInEventDocument> {
    const filter: Filter<ISignInEventDocument> = {};
    if (query.email) {
        filter.email = query.email.trim().toLowerCase();
    }
    if (query.userId) {
        filter.userId = query.userId;
    }
    if (query.ip) {
        filter.ip = query.ip;
    }
    if (query.method) {
        filter.method = query.method;
    }
    if (query.kind) {
        filter.kind = query.kind;
    }
    if (query.since || query.until) {
        filter.occurredAt = {
            ...(query.since ? { $gte: query.since } : {}),
            ...(query.until ? { $lte: query.until } : {})
        };
    }
    return filter;
}

/**
 * Sign-in event storage. One instance is built in `IdentityModule.init()` and
 * handed to the audit hook as its recorder and to the AI tools as their reader.
 */
export class SignInEventStore implements ISignInEventRecorder {
    /** `module_user_sign_in_events` collection handle. */
    private readonly collection: Collection<ISignInEventDocument>;

    /** Logger scoped to this store. */
    private readonly logger: ISystemLogService;

    /**
     * @param database - Database service the collection is reached through.
     * @param logger - The identity module's logger.
     */
    constructor(database: IDatabaseService, logger: ISystemLogService) {
        this.collection = database.getCollection<ISignInEventDocument>(SIGN_IN_EVENTS_COLLECTION);
        this.logger = logger.child({ component: 'sign-in-event-store' });
    }

    /**
     * Create the indexes. The time-to-live index on `occurredAt` is what
     * enforces retention. The other three back the lookups an investigation
     * makes: by address, by account, and by caller, each newest first.
     */
    async createIndexes(): Promise<void> {
        await this.collection.createIndex(
            { occurredAt: 1 },
            { expireAfterSeconds: SIGN_IN_EVENT_RETENTION_DAYS * 24 * 60 * 60, name: 'occurredAt_ttl' }
        );
        await this.collection.createIndex({ email: 1, occurredAt: -1 }, { name: 'email_occurredAt' });
        await this.collection.createIndex({ userId: 1, occurredAt: -1 }, { name: 'userId_occurredAt' });
        await this.collection.createIndex({ ip: 1, occurredAt: -1 }, { name: 'ip_occurredAt' });
        this.logger.info('Sign-in event indexes created');
    }

    /**
     * Store one event.
     *
     * @param event - The finished sign-in code request or sign-in attempt.
     */
    async record(event: ISignInEventDocument): Promise<void> {
        await this.collection.insertOne({ ...event });
    }

    /**
     * Read one page of events, newest first, with the number that match.
     *
     * @param query - Which events to return.
     * @param page - How many to return and how many to skip; the caller bounds both.
     * @returns The page of events and the total matching the query.
     */
    async list(
        query: ISignInEventQuery,
        page: { limit: number; offset: number }
    ): Promise<{ events: ISignInEventDocument[]; total: number }> {
        const filter = buildSignInEventFilter(query);
        const [events, total] = await Promise.all([
            this.collection.find(filter).sort({ occurredAt: -1 }).skip(page.offset).limit(page.limit).toArray(),
            this.collection.countDocuments(filter)
        ]);
        return { events: events as ISignInEventDocument[], total };
    }
}
