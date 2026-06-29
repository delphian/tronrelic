/**
 * @fileoverview Published contract for the central per-user settings store.
 *
 * The identity module registers its `UserSettingsService` on the service
 * registry as `'user-settings'`; modules and plugins consume it through
 * `services.get<IUserSettingsService>('user-settings')`. It is the single home
 * for user-centric settings and preferences, keyed by the Better Auth user id —
 * the same opaque hex string the rest of the platform uses (see the wallet and
 * account contracts in this barrel).
 *
 * **Why one store, addressed by namespace.** A central collection would
 * otherwise become a typed grab-bag that every new setting must edit. Instead
 * the store owns only the *envelope* — the `(userId, namespace, key)` address —
 * while each provider owns the *payload* it stores under its own namespace. This
 * mirrors the platform's content-type and notification idioms: core addresses,
 * the provider gives meaning. A provider stores arbitrary JSON and reads it back
 * with the same shape it wrote.
 *
 * **Two access paths, different trust.** The programmatic methods
 * (`get`/`getNamespace`/`getForUsers`/`set`/`delete`) are for trusted server
 * callers — a module persisting a user's choice, the dispatch pipeline batch-
 * reading opt-outs — and perform no value validation. The self-service HTTP
 * surface a logged-in user drives is **not** trusted: it may only write
 * settings a provider has registered as user-writable via
 * {@link IUserSettingDefinition}, and only after the registered validator
 * accepts the value. Without that allow-list an authenticated user could write
 * arbitrary `(namespace, key)` pairs and bloat their rows toward MongoDB's
 * document limits — a storage-exhaustion vector. Registration is what makes a
 * setting safe to expose.
 */

/**
 * Declares a setting a provider is willing to expose on the user self-service
 * surface. Registered at boot (module init / plugin enable) so the central
 * service can offer a generic, safe `/api/user/settings` endpoint without
 * understanding any provider's payload.
 *
 * A provider that only ever writes server-side (e.g. a derived flag) does not
 * register a definition — it uses the programmatic `set`/`get` directly.
 */
export interface IUserSettingDefinition {
    /** Provider namespace this setting lives under (e.g. `'core'`, `'notifications'`). */
    namespace: string;

    /** Setting key within the namespace. Unique per namespace. */
    key: string;

    /** Human label for the self-service UI catalog. */
    label: string;

    /** Optional longer description for the self-service UI. */
    description?: string;

    /**
     * Whether the self-service HTTP surface may write this setting. `false`
     * registers the setting for catalog/read purposes while reserving writes to
     * trusted server callers.
     */
    userWritable: boolean;

    /**
     * Guard a candidate value before it is stored from the untrusted self-service
     * surface. Returns `false` to reject. The programmatic `set` bypasses this —
     * its callers are trusted.
     *
     * @param value - The untrusted candidate value from the request body.
     * @returns Whether the value is acceptable to store.
     */
    validate: (value: unknown) => boolean;

    /** Value returned by `get` when the user has no stored row for this setting. */
    defaultValue?: unknown;
}

/**
 * Central per-user settings store. Published as `'user-settings'`.
 *
 * Every method takes the resolved Better Auth user id — the service never reads
 * cookies or sessions; the HTTP layer resolves identity and calls in.
 */
export interface IUserSettingsService {
    /** Create the collection's indexes. Idempotent; called at module init. */
    createIndexes(): Promise<void>;

    /**
     * Register a user-writable (or read-only catalog) setting definition. Safe to
     * call repeatedly with the same `(namespace, key)`; the latest definition
     * wins. Providers call this during their init/enable phase.
     *
     * @param definition - The setting the provider exposes to self-service.
     */
    registerDefinition(definition: IUserSettingDefinition): void;

    /**
     * All registered definitions. The self-service controller projects these
     * (minus the validator) into the catalog it returns to the UI.
     *
     * @returns Every registered definition.
     */
    listDefinitions(): IUserSettingDefinition[];

    /**
     * Read one setting value, or `null` when the user has no row and the
     * definition declares no default.
     *
     * @param userId - Better Auth user id.
     * @param namespace - Provider namespace.
     * @param key - Setting key.
     * @returns The stored value (or registered default), else `null`.
     */
    get<T = unknown>(userId: string, namespace: string, key: string): Promise<T | null>;

    /**
     * Read every key a user has *stored* under one namespace in a single query.
     * Stored values only — registered defaults are not merged in (mirroring
     * `getForUsers`; contrast `get`, which falls back to a single key's default).
     * A caller hydrating a namespace applies its own defaults for keys absent
     * here, so a present key means the user explicitly set it.
     *
     * @param userId - Better Auth user id.
     * @param namespace - Provider namespace.
     * @returns Map of key → stored value for that namespace (empty when none).
     */
    getNamespace(userId: string, namespace: string): Promise<Record<string, unknown>>;

    /**
     * Batch-read one `(namespace, key)` setting for many users in one query, so a
     * fan-out (e.g. a notification blast reading opt-outs) costs one round-trip
     * rather than N. Users without a stored row are absent from the map.
     *
     * @param userIds - Better Auth user ids.
     * @param namespace - Provider namespace.
     * @param key - Setting key.
     * @returns Map of userId → stored value for those that have one.
     */
    getForUsers<T = unknown>(userIds: string[], namespace: string, key: string): Promise<Map<string, T>>;

    /**
     * Write one setting value, upserting the row. Trusted path — performs no
     * validation; the self-service controller validates before calling.
     *
     * @param userId - Better Auth user id.
     * @param namespace - Provider namespace.
     * @param key - Setting key.
     * @param value - Provider-owned JSON value to store.
     */
    set<T = unknown>(userId: string, namespace: string, key: string, value: T): Promise<void>;

    /**
     * Remove one setting row, reverting the user to the registered default.
     *
     * @param userId - Better Auth user id.
     * @param namespace - Provider namespace.
     * @param key - Setting key.
     */
    delete(userId: string, namespace: string, key: string): Promise<void>;
}
