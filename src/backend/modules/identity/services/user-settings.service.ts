/**
 * @fileoverview Central per-user settings store, keyed by Better Auth user id.
 *
 * The single home for user-centric settings and preferences. Solves the problem
 * of preference data scattering across modules and plugins, each minting its own
 * collection: here every consumer stores under one collection addressed by
 * `(userId, namespace, key)`, and reaches it through one registered service
 * (`'user-settings'`) rather than touching storage directly.
 *
 * **Envelope vs payload.** The store owns only the address; each provider owns
 * the JSON value it writes under its namespace and reads back unchanged. A new
 * setting needs no change here — the same idiom the platform's content-type and
 * notification stores follow.
 *
 * **Two trust levels.** The programmatic methods serve trusted server callers
 * (a module persisting a choice, the notification dispatcher batch-reading
 * opt-outs) and do not validate values. The self-service HTTP surface a
 * logged-in user drives is untrusted: it may write only settings a provider has
 * registered as `userWritable`, and only after that definition's validator
 * accepts the value. Without the allow-list a user could write arbitrary
 * `(namespace, key)` rows and exhaust storage — so registration is the gate that
 * makes a setting safe to expose.
 *
 * **Singleton.** Follows the project's `setDependencies()` / `getInstance()`
 * pattern because the store is shared application state configured once at
 * bootstrap, mirroring {@link WalletService}.
 */

import { ObjectId, type Collection } from 'mongodb';
import type {
    IDatabaseService,
    ISystemLogService,
    IUserSettingsService,
    IUserSettingDefinition
} from '@/types';
import { USER_SETTINGS_COLLECTION, type IUserSettingDocument } from '../database/IUserSettingDocument.js';

/**
 * Compose the in-memory registry key for a setting definition. Kept private so
 * `(namespace, key)` is always combined the same way for lookup and storage.
 *
 * @param namespace - Provider namespace.
 * @param key - Setting key within the namespace.
 * @returns The combined registry key.
 */
function definitionKey(namespace: string, key: string): string {
    return JSON.stringify([namespace, key]);
}

/**
 * Central per-user settings service. Configured during `IdentityModule.init()`
 * via {@link UserSettingsService.setDependencies} and published on the service
 * registry as `'user-settings'`.
 */
export class UserSettingsService implements IUserSettingsService {
    /** Singleton instance. `null` until {@link setDependencies} runs. */
    private static instance: UserSettingsService | null = null;

    /** `module_user_settings` collection handle. */
    private readonly collection: Collection<IUserSettingDocument>;

    /** Logger scoped to this service. */
    private readonly logger: ISystemLogService;

    /**
     * Registered setting definitions keyed by a tuple-safe, JSON-encoded
     * `(namespace, key)` so a colon in either part cannot collide two distinct
     * settings. Drives the safe self-service surface; the programmatic methods
     * ignore it.
     */
    private readonly definitions = new Map<string, IUserSettingDefinition>();

    /**
     * @param database - Database abstraction (Tier-1 collection access).
     * @param logger - Derives a `component: 'user-settings-service'` child.
     */
    private constructor(database: IDatabaseService, logger: ISystemLogService) {
        this.collection = database.getCollection<IUserSettingDocument>(USER_SETTINGS_COLLECTION);
        this.logger = logger.child({ component: 'user-settings-service' });
    }

    /**
     * Configure the singleton with its dependencies. Idempotent — a second call
     * keeps the first instance so consumers cannot swap dependencies mid-flight.
     *
     * @param database - Database service injected by the module.
     * @param logger - Identity-module child logger.
     */
    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!UserSettingsService.instance) {
            UserSettingsService.instance = new UserSettingsService(database, logger);
        }
    }

    /**
     * Resolve the configured singleton.
     *
     * @returns The shared {@link UserSettingsService} instance.
     * @throws {Error} When called before {@link setDependencies}.
     */
    public static getInstance(): UserSettingsService {
        if (!UserSettingsService.instance) {
            throw new Error('UserSettingsService.setDependencies() must be called before getInstance().');
        }
        return UserSettingsService.instance;
    }

    /**
     * Reset the singleton. Test-only escape hatch.
     *
     * @internal
     */
    public static resetForTests(): void {
        UserSettingsService.instance = null;
    }

    /**
     * Create the collection indexes. The unique `(userId, namespace, key)` index
     * makes each address a single row and backs per-user reads/writes; the
     * `(namespace, key)` index backs the cross-user batch read the notification
     * dispatcher relies on (`{ namespace, key, userId: { $in } }`).
     */
    public async createIndexes(): Promise<void> {
        await this.collection.createIndex(
            { userId: 1, namespace: 1, key: 1 },
            { unique: true, name: 'userId_namespace_key_unique' }
        );
        await this.collection.createIndex({ namespace: 1, key: 1 }, { name: 'namespace_key' });
        this.logger.info('User-settings indexes created');
    }

    /**
     * Register (or replace) a setting definition. The latest definition for a
     * `(namespace, key)` wins, so a redeploy that tweaks a label or validator is
     * safe. Providers call this during their init/enable phase.
     *
     * @param definition - The setting a provider exposes to self-service.
     */
    public registerDefinition(definition: IUserSettingDefinition): void {
        this.definitions.set(definitionKey(definition.namespace, definition.key), definition);
        this.logger.info(
            { namespace: definition.namespace, key: definition.key, userWritable: definition.userWritable },
            'User-setting definition registered'
        );
    }

    /**
     * All registered definitions, for the self-service catalog projection.
     *
     * @returns Every registered definition (order unspecified).
     */
    public listDefinitions(): IUserSettingDefinition[] {
        return Array.from(this.definitions.values());
    }

    /**
     * Look up a registered definition, or `undefined`. Used by the self-service
     * controller to enforce the write allow-list.
     *
     * @param namespace - Provider namespace.
     * @param key - Setting key.
     * @returns The definition, or `undefined` when unregistered.
     */
    public getDefinition(namespace: string, key: string): IUserSettingDefinition | undefined {
        return this.definitions.get(definitionKey(namespace, key));
    }

    /**
     * Read one setting value, falling back to the registered default and then to
     * `null` when neither a row nor a default exists.
     *
     * @param userId - Better Auth user id.
     * @param namespace - Provider namespace.
     * @param key - Setting key.
     * @returns The stored value (or registered default), else `null`.
     */
    public async get<T = unknown>(userId: string, namespace: string, key: string): Promise<T | null> {
        const doc = await this.collection.findOne({ userId, namespace, key });
        if (doc) {
            return doc.value as T;
        }
        const definition = this.getDefinition(namespace, key);
        const fallback = definition?.defaultValue !== undefined ? (definition.defaultValue as T) : null;
        return fallback;
    }

    /**
     * Read every key a user has *stored* under one namespace in a single query.
     * Stored values only — registered defaults are not merged in, mirroring
     * {@link getForUsers}; a caller that wants defaults applies them itself
     * (unlike {@link get}, which falls back to a single key's default). The
     * result is therefore empty when the user has stored nothing, and a present
     * key means the user explicitly set it.
     *
     * @param userId - Better Auth user id.
     * @param namespace - Provider namespace.
     * @returns Map of key → stored value for that namespace (empty when none).
     */
    public async getNamespace(userId: string, namespace: string): Promise<Record<string, unknown>> {
        const docs = await this.collection.find({ userId, namespace }).toArray();
        const result: Record<string, unknown> = {};
        for (const doc of docs) {
            result[doc.key] = doc.value;
        }
        return result;
    }

    /**
     * Batch-read one `(namespace, key)` setting for many users in one query, so a
     * fan-out (a notification blast reading opt-outs) costs one round-trip. Users
     * without a stored row are absent from the map — the caller applies its own
     * default for them.
     *
     * @param userIds - Better Auth user ids.
     * @param namespace - Provider namespace.
     * @param key - Setting key.
     * @returns Map of userId → stored value for those that have one.
     */
    public async getForUsers<T = unknown>(
        userIds: string[],
        namespace: string,
        key: string
    ): Promise<Map<string, T>> {
        const map = new Map<string, T>();
        if (userIds.length === 0) {
            return map;
        }
        const docs = await this.collection
            .find({ namespace, key, userId: { $in: userIds } })
            .toArray();
        for (const doc of docs) {
            map.set(doc.userId, doc.value as T);
        }
        return map;
    }

    /**
     * Write one setting value, upserting the row. Trusted path — performs no
     * validation; the self-service controller validates against the registered
     * definition before calling.
     *
     * @param userId - Better Auth user id.
     * @param namespace - Provider namespace.
     * @param key - Setting key.
     * @param value - Provider-owned JSON value to store.
     */
    public async set<T = unknown>(userId: string, namespace: string, key: string, value: T): Promise<void> {
        await this.collection.updateOne(
            { userId, namespace, key },
            { $set: { userId, namespace, key, value, updatedAt: new Date() } },
            { upsert: true }
        );
        this.logger.info({ userId, namespace, key }, 'User setting written');
    }

    /**
     * Remove one setting row, reverting the user to the registered default.
     *
     * @param userId - Better Auth user id.
     * @param namespace - Provider namespace.
     * @param key - Setting key.
     */
    public async delete(userId: string, namespace: string, key: string): Promise<void> {
        await this.collection.deleteOne({ userId, namespace, key });
        this.logger.info({ userId, namespace, key }, 'User setting deleted');
    }
}
