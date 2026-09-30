/**
 * @fileoverview Persistence and caching for the MCP endpoint's kill switch.
 *
 * The MCP module is always loaded, so the only way to take the endpoint
 * offline at runtime is this setting. It is read on every MCP request, so the
 * store keeps a short-lived copy in memory and refreshes it from MongoDB at
 * most every few seconds. A change made through this store updates the copy at
 * once; a change made by another backend instance reaches this one within the
 * cache window.
 */

import type { IDatabaseService, IMcpSettings, ISystemLogService } from '@/types';

/** Collection holding the single settings document. */
export const MCP_SETTINGS_COLLECTION = 'module_mcp_settings';

/** Fixed id of the one settings document. */
const SETTINGS_DOC_ID = 'settings';

/**
 * How long a cached copy is trusted before the next read goes to MongoDB.
 * Short enough that turning the switch off on one instance stops every
 * instance within seconds; long enough that a busy endpoint does not read the
 * database on every call.
 */
const CACHE_TTL_MS = 5_000;

/** Settings a fresh deployment starts with: the endpoint is off. */
const DEFAULT_SETTINGS: IMcpSettings = { enabled: false };

/** Stored shape of the settings document. */
interface IMcpSettingsDocument {
    _id: string;
    enabled: boolean;
    updatedAt?: Date;
    updatedBy?: string;
}

/**
 * Reads and writes the MCP kill switch.
 */
export class McpSettingsStore {
    private cached: IMcpSettings | null = null;
    private cachedAt = 0;

    /**
     * Counts writes made through this store. A `get()` whose read was already
     * in flight when an admin switched the endpoint off may return the old
     * document, and caching it would keep the endpoint on for another cache
     * window. `get()` skips its cache write when this counter moved during
     * its read and returns the value the write stored instead.
     */
    private writeGeneration = 0;

    /**
     * @param database - Core database service, used for the settings collection.
     * @param logger - Module logger, used to record every change of the switch.
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Return the current settings, from the in-memory copy when it is fresh.
     *
     * A read failure is not swallowed into "enabled": it propagates, and the
     * request handler answers 503, because an endpoint that cannot tell whether
     * it is switched on must behave as switched off.
     *
     * @returns The current settings, defaulting to disabled when none are stored.
     */
    async get(): Promise<IMcpSettings> {
        const now = Date.now();
        if (!this.cached || now - this.cachedAt >= CACHE_TTL_MS) {
            const generation = this.writeGeneration;
            const doc = await this.database.getCollection<IMcpSettingsDocument>(MCP_SETTINGS_COLLECTION)
                .findOne({ _id: SETTINGS_DOC_ID });
            if (generation === this.writeGeneration || !this.cached) {
                this.cached = doc ? toSettings(doc) : { ...DEFAULT_SETTINGS };
                this.cachedAt = now;
            }
        }
        return { ...this.cached };
    }

    /**
     * Turn the endpoint on or off and record who did it.
     *
     * @param enabled - The new state of the kill switch.
     * @param actor - Better Auth user id of the admin making the change, kept
     *   for the audit line and shown on the admin page.
     * @returns The settings as stored.
     */
    async setEnabled(enabled: boolean, actor: string | undefined): Promise<IMcpSettings> {
        const updatedAt = new Date();
        // A change without a named actor (the service-token path) clears the
        // stored `updatedBy`, so the page never credits the previous admin
        // with a change they did not make.
        await this.database.getCollection<IMcpSettingsDocument>(MCP_SETTINGS_COLLECTION).updateOne(
            { _id: SETTINGS_DOC_ID },
            actor
                ? { $set: { enabled, updatedAt, updatedBy: actor } }
                : { $set: { enabled, updatedAt }, $unset: { updatedBy: '' } },
            { upsert: true }
        );
        this.writeGeneration++;
        this.cached = { enabled, updatedAt: updatedAt.toISOString(), ...(actor ? { updatedBy: actor } : {}) };
        this.cachedAt = Date.now();
        this.logger.warn(
            { enabled, actor: actor ?? 'unattributed' },
            `MCP endpoint ${enabled ? 'ENABLED' : 'DISABLED'} by kill switch`
        );
        return { ...this.cached };
    }
}

/**
 * Convert the stored document into the public settings shape.
 *
 * @param doc - The stored settings document.
 * @returns The settings with dates as ISO strings.
 */
function toSettings(doc: IMcpSettingsDocument): IMcpSettings {
    const settings: IMcpSettings = { enabled: doc.enabled === true };
    if (doc.updatedAt) {
        settings.updatedAt = new Date(doc.updatedAt).toISOString();
    }
    if (doc.updatedBy) {
        settings.updatedBy = doc.updatedBy;
    }
    return settings;
}
