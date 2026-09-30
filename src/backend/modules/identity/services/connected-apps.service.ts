/**
 * @fileoverview The `IConnectedAppsService` implementation: lists and revokes
 * users' OAuth grants to connected apps.
 *
 * Reads and writes go through Better Auth's own database adapter rather than
 * `IDatabaseService`, for the same reason `auth.ts` takes a raw `Db`: the
 * OAuth tables belong to Better Auth, and the adapter is what maps the plugin's
 * model names (`oauthConsent`, `oauthClient`, ...) onto the renamed
 * `module_user_auth_oauth_*` collections. Nothing outside the identity module
 * touches these tables; everyone else calls this service.
 *
 * Revocation has to do more than Better Auth's own consent deletion. Deleting
 * a consent leaves the app's refresh tokens working, and signing out does not
 * touch refresh tokens that carry `offline_access`. So `revoke` deletes the
 * consent and every refresh and stored access token for that user and app.
 *
 * When each app was last used is not in Better Auth's tables. This service
 * keeps it in its own collection (`module_user_connected_app_usage`), through
 * `IDatabaseService` like the module's other stores, so a list reads every
 * value for a page in one query instead of one query per grant.
 */

import type { Collection } from 'mongodb';
import type {
    IAccountDirectoryService,
    IAccountSummary,
    IConnectedApp,
    IConnectedAppAdminRow,
    IConnectedAppsService,
    IDatabaseService,
    ISystemLogService
} from '@/types';
import { CONNECTED_APP_USAGE_COLLECTION, type IConnectedAppUsageDocument } from '../database/IConnectedAppUsageDocument.js';
import { hostOf, isLoopbackHost } from './hostOf.js';

/**
 * The subset of Better Auth's adapter this service calls. Declared
 * structurally so tests can pass a fake and the service never imports Better
 * Auth's internal types.
 */
export interface IOAuthStoreAdapter {
    findMany<T>(data: {
        model: string;
        where?: Array<{ field: string; value: string | string[]; operator?: 'eq' | 'in' }>;
        limit?: number;
        offset?: number;
        sortBy?: { field: string; direction: 'asc' | 'desc' };
    }): Promise<T[]>;
    count(data: { model: string; where?: Array<{ field: string; value: string }> }): Promise<number>;
    deleteMany(data: { model: string; where: Array<{ field: string; value: string }> }): Promise<number>;
}

/** A stored consent row, as the adapter returns it. */
interface IConsentRow {
    id: string;
    clientId: string;
    userId: string;
    scopes?: string[] | string;
    createdAt: Date | string;
    updatedAt?: Date | string;
}

/** The client fields this service reads. */
interface IClientRow {
    clientId: string;
    name?: string;
    uri?: string;
    redirectUris?: string[] | string;
}

/**
 * How long a `hasGrant` answer is reused. The MCP endpoint asks on every
 * request, so a short cache saves a database read per call while keeping a
 * revocation made on another instance effective within half a minute. A
 * revocation made through this instance clears its entry at once.
 */
const GRANT_CACHE_TTL_MS = 30_000;

/** Upper bound on cached grant answers. */
const GRANT_CACHE_MAX = 10_000;

/**
 * Minimum time between two last-use writes for the same grant. An active
 * client calls the MCP endpoint many times a minute, and a "last used" shown
 * as a relative time does not need to be more precise than this, so the
 * throttle keeps usage tracking to about one write per grant per interval.
 */
const USAGE_WRITE_INTERVAL_MS = 5 * 60_000;

/** Upper bound on remembered last-write times, so many distinct grants cannot grow memory without limit. */
const USAGE_THROTTLE_MAX = 10_000;

/**
 * Singleton store of connected-app grants.
 */
export class ConnectedAppsService implements IConnectedAppsService {
    private static instance: ConnectedAppsService | undefined;

    /**
     * Live grants keyed by user and client, holding when the current consent
     * was created so a token issued before it can be refused.
     */
    private readonly grantCache = new Map<string, { grantedAtMs: number; readAt: number }>();

    /**
     * When this instance last revoked each grant, keyed like the grant cache.
     * A `hasGrant` read that started before a revocation finished may have
     * seen the old consent, and caching that answer would keep a revoked app
     * working for another cache window. `hasGrant` checks this map and skips
     * the cache write for such a read.
     */
    private readonly revokedAt = new Map<string, number>();

    /**
     * When this instance last wrote each grant's last-use time, keyed like
     * the grant cache. It is what throttles `recordUse`.
     */
    private readonly usageWrittenAt = new Map<string, number>();

    /** `module_user_connected_app_usage` collection handle. */
    private readonly usage: Collection<IConnectedAppUsageDocument>;

    /**
     * @param getAdapter - Resolves Better Auth's adapter. Asynchronous because
     *   the adapter lives on the auth instance's lazily built context.
     * @param database - Core database, for the last-use collection this
     *   service owns (Better Auth's tables have no place for it).
     * @param accounts - Account directory, used to put an email beside each
     *   grant on the admin list.
     * @param logger - Module logger, used to record revocations and failed
     *   last-use writes.
     */
    private constructor(
        private readonly getAdapter: () => Promise<IOAuthStoreAdapter>,
        database: IDatabaseService,
        private readonly accounts: IAccountDirectoryService,
        private readonly logger: ISystemLogService
    ) {
        this.usage = database.getCollection<IConnectedAppUsageDocument>(CONNECTED_APP_USAGE_COLLECTION);
    }

    /**
     * Configure the singleton. Later calls are ignored, so the first
     * configuration during identity module init wins.
     *
     * @param getAdapter - Resolves Better Auth's adapter.
     * @param database - Core database, for the last-use collection.
     * @param accounts - Account directory service.
     * @param logger - Module logger.
     */
    static setDependencies(
        getAdapter: () => Promise<IOAuthStoreAdapter>,
        database: IDatabaseService,
        accounts: IAccountDirectoryService,
        logger: ISystemLogService
    ): void {
        if (!ConnectedAppsService.instance) {
            ConnectedAppsService.instance = new ConnectedAppsService(getAdapter, database, accounts, logger);
        }
    }

    /**
     * Create the last-use collection's index. The unique `(userId, clientId)`
     * index keeps one row per grant, which the upsert in `recordUse` relies
     * on, and serves the per-page read in `toApps` and the delete in `revoke`.
     *
     * @returns Resolves when the index exists.
     */
    async createIndexes(): Promise<void> {
        await this.usage.createIndex({ userId: 1, clientId: 1 }, { unique: true });
    }

    /**
     * Return the configured singleton.
     *
     * @returns The service instance.
     * @throws {Error} When `setDependencies` has not been called.
     */
    static getInstance(): ConnectedAppsService {
        if (!ConnectedAppsService.instance) {
            throw new Error('ConnectedAppsService.setDependencies() must be called before getInstance().');
        }
        return ConnectedAppsService.instance;
    }

    /** @inheritdoc */
    async listForUser(userId: string): Promise<IConnectedApp[]> {
        const adapter = await this.getAdapter();
        const consents = await adapter.findMany<IConsentRow>({
            model: 'oauthConsent',
            where: [{ field: 'userId', value: userId }],
            sortBy: { field: 'createdAt', direction: 'desc' }
        });
        return this.toApps(adapter, consents);
    }

    /** @inheritdoc */
    async listAll(options: { limit: number; offset: number }): Promise<{ apps: IConnectedAppAdminRow[]; total: number }> {
        const adapter = await this.getAdapter();
        const [total, consents] = await Promise.all([
            adapter.count({ model: 'oauthConsent' }),
            adapter.findMany<IConsentRow>({
                model: 'oauthConsent',
                limit: options.limit,
                offset: options.offset,
                sortBy: { field: 'createdAt', direction: 'desc' }
            })
        ]);
        const [apps, accounts] = await Promise.all([
            this.toApps(adapter, consents),
            this.accounts.getAccountsByIds(consents.map(consent => consent.userId))
        ]);
        const accountsById = new Map<string, IAccountSummary>(accounts.map(account => [account.id, account]));
        const rows = apps.map((app, index): IConnectedAppAdminRow => {
            const userId = consents[index].userId;
            const email = accountsById.get(userId)?.email;
            return { ...app, userId, ...(email ? { userEmail: email } : {}) };
        });
        return { apps: rows, total };
    }

    /** @inheritdoc */
    async revoke(userId: string, clientId: string): Promise<boolean> {
        const adapter = await this.getAdapter();
        const where = [{ field: 'userId', value: userId }, { field: 'clientId', value: clientId }];
        const [consents, refreshTokens, accessTokens] = await Promise.all([
            adapter.deleteMany({ model: 'oauthConsent', where }),
            adapter.deleteMany({ model: 'oauthRefreshToken', where }),
            adapter.deleteMany({ model: 'oauthAccessToken', where }),
            // A reconnected app starts with no last-use time rather than
            // inheriting the revoked grant's.
            this.usage.deleteMany({ userId, clientId })
        ]);
        const key = grantKey(userId, clientId);
        this.grantCache.delete(key);
        this.usageWrittenAt.delete(key);
        if (this.revokedAt.size >= GRANT_CACHE_MAX) {
            this.revokedAt.clear();
        }
        this.revokedAt.set(key, Date.now());
        const revoked = consents + refreshTokens + accessTokens > 0;
        if (revoked) {
            this.logger.info({ userId, clientId, consents, refreshTokens, accessTokens }, 'Connected app revoked');
        }
        return revoked;
    }

    /** @inheritdoc */
    async revokeAllForUser(userId: string): Promise<number> {
        const adapter = await this.getAdapter();
        const where = [{ field: 'userId', value: userId }];
        // Tokens can outlive their consent row, so every table is read for
        // client ids, not only the consents.
        const rows = await Promise.all([
            adapter.findMany<{ clientId: string }>({ model: 'oauthConsent', where }),
            adapter.findMany<{ clientId: string }>({ model: 'oauthRefreshToken', where }),
            adapter.findMany<{ clientId: string }>({ model: 'oauthAccessToken', where })
        ]);
        const clientIds = [...new Set(rows.flat().map(row => row.clientId))];
        // Each app goes through `revoke`, so the grant cache and the last-use
        // rows are cleared the same way as a revocation from the profile page.
        const results = await Promise.all(clientIds.map(clientId => this.revoke(userId, clientId)));
        return results.filter(Boolean).length;
    }

    /** @inheritdoc */
    async hasGrant(userId: string, clientId: string, issuedAt?: number): Promise<boolean> {
        const key = grantKey(userId, clientId);
        const now = Date.now();
        const cached = this.grantCache.get(key);
        let grantedAtMs: number | null;
        if (cached && now - cached.readAt < GRANT_CACHE_TTL_MS) {
            grantedAtMs = cached.grantedAtMs;
        } else {
            const adapter = await this.getAdapter();
            const [consent] = await adapter.findMany<IConsentRow>({
                model: 'oauthConsent',
                where: [{ field: 'userId', value: userId }, { field: 'clientId', value: clientId }],
                sortBy: { field: 'createdAt', direction: 'desc' },
                limit: 1
            });
            grantedAtMs = consent ? new Date(consent.createdAt).getTime() : null;
            // Only a live grant is cached. A cached "no grant" would keep
            // refusing a user who reconnects the same app within the window,
            // because the revoked app's retries with its old token are what
            // wrote that answer. A read that began before a revocation on
            // this instance finished is not cached either, since it may have
            // seen the consent the revocation deleted.
            const revokedDuringRead = (this.revokedAt.get(key) ?? -1) >= now;
            if (grantedAtMs !== null && !revokedDuringRead) {
                if (this.grantCache.size >= GRANT_CACHE_MAX) {
                    this.grantCache.clear();
                }
                this.grantCache.set(key, { grantedAtMs, readAt: now });
            }
        }
        return grantedAtMs !== null && !issuedBeforeGrant(issuedAt, grantedAtMs);
    }

    /** @inheritdoc */
    async recordUse(userId: string, clientId: string): Promise<void> {
        const key = grantKey(userId, clientId);
        const now = Date.now();
        const lastWrite = this.usageWrittenAt.get(key);
        if (lastWrite === undefined || now - lastWrite >= USAGE_WRITE_INTERVAL_MS) {
            // Claim the slot before writing, so concurrent requests from the
            // same client do not all write.
            if (this.usageWrittenAt.size >= USAGE_THROTTLE_MAX) {
                this.usageWrittenAt.clear();
            }
            this.usageWrittenAt.set(key, now);
            try {
                // `$max` keeps the newest time when two instances write the
                // same grant close together.
                await this.usage.updateOne(
                    { userId, clientId },
                    { $max: { lastUsedAt: new Date(now) } },
                    { upsert: true }
                );
            } catch (error) {
                // Release the slot so the next call retries the write.
                this.usageWrittenAt.delete(key);
                this.logger.warn({ err: error, userId, clientId }, 'Failed to record connected app use');
            }
        }
    }

    /**
     * Join consent rows with their clients and last-use times, using one
     * query for the clients and one for the last-use rows whatever the page
     * size.
     *
     * @param adapter - Better Auth's adapter.
     * @param consents - Consent rows to describe, in the order to return them.
     * @returns One app per consent, in the same order.
     */
    private async toApps(adapter: IOAuthStoreAdapter, consents: IConsentRow[]): Promise<IConnectedApp[]> {
        const clientIds = [...new Set(consents.map(consent => consent.clientId))];
        const userIds = [...new Set(consents.map(consent => consent.userId))];
        const [clients, usageRows] = await Promise.all([
            clientIds.length > 0
                ? adapter.findMany<IClientRow>({ model: 'oauthClient', where: [{ field: 'clientId', value: clientIds, operator: 'in' }] })
                : Promise.resolve([]),
            // Reads every usage row for the page's users. A user holds few
            // grants, so rows for apps outside the page are cheap to ignore.
            userIds.length > 0
                ? this.usage.find({ userId: { $in: userIds } }).toArray()
                : Promise.resolve([])
        ]);
        const clientsById = new Map(clients.map(client => [client.clientId, client]));
        const lastUsedByGrant = new Map(usageRows.map(row => [grantKey(row.userId, row.clientId), row.lastUsedAt]));
        return consents.map((consent): IConnectedApp => {
            const client = clientsById.get(consent.clientId);
            const redirectHosts = hostsOf(toStringList(client?.redirectUris));
            const lastUsedAt = lastUsedByGrant.get(grantKey(consent.userId, consent.clientId));
            const app: IConnectedApp = {
                clientId: consent.clientId,
                clientName: client?.name || consent.clientId,
                redirectHosts,
                loopbackOnly: redirectHosts.length > 0 && redirectHosts.every(isLoopbackHost),
                scopes: toStringList(consent.scopes),
                grantedAt: new Date(consent.createdAt).toISOString()
            };
            if (client?.uri) {
                app.clientUri = client.uri;
            }
            if (lastUsedAt) {
                app.lastUsedAt = new Date(lastUsedAt).toISOString();
            }
            return app;
        });
    }
}

/**
 * Build the cache key for one user's grant to one app.
 *
 * @param userId - Better Auth user id.
 * @param clientId - OAuth client id.
 * @returns A key unique to the pair.
 */
function grantKey(userId: string, clientId: string): string {
    return `${userId}\u0000${clientId}`;
}

/**
 * Decide whether a token predates the consent it is being checked against.
 *
 * Revoking an app deletes its consent, and reconnecting creates a new one. A
 * token issued before the new consent therefore belongs to the revoked grant
 * and must stay dead. The token's `iat` has one-second precision, so the
 * consent time is rounded down to the second before comparing; otherwise a
 * token issued in the same second as its consent would be refused.
 *
 * @param issuedAt - The token's `iat` in seconds, or undefined when the caller
 *   is not checking a token (the check is then skipped).
 * @param grantedAtMs - When the current consent was created, in milliseconds.
 * @returns True when the token was issued before the consent existed.
 */
function issuedBeforeGrant(issuedAt: number | undefined, grantedAtMs: number): boolean {
    let before = false;
    if (issuedAt !== undefined && Number.isFinite(grantedAtMs)) {
        before = issuedAt * 1000 < Math.floor(grantedAtMs / 1000) * 1000;
    }
    return before;
}

/**
 * Normalize a list field the adapter may return as an array or as a
 * space-separated or JSON string, depending on the column type.
 *
 * @param value - The raw field value.
 * @returns The list of strings.
 */
function toStringList(value: string[] | string | undefined): string[] {
    let list: string[] = [];
    if (Array.isArray(value)) {
        list = value.filter(item => typeof item === 'string');
    } else if (typeof value === 'string' && value.length > 0) {
        try {
            const parsed: unknown = JSON.parse(value);
            list = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : value.split(/\s+/);
        } catch {
            list = value.split(/\s+/).filter(item => item.length > 0);
        }
    }
    return list;
}

/**
 * Extract the distinct host names from a list of redirect URIs.
 *
 * @param uris - Registered redirect URIs.
 * @returns Each URI's host name once, skipping any that do not parse.
 */
function hostsOf(uris: string[]): string[] {
    const hosts = new Set<string>();
    for (const uri of uris) {
        // A malformed stored URI yields null and is skipped rather than failing the list.
        const host = hostOf(uri);
        if (host) {
            hosts.add(host);
        }
    }
    return [...hosts];
}
