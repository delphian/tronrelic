/**
 * @fileoverview Per-zone flexbox layout store.
 *
 * Internal collaborator (no public exposure — reached only through
 * `WidgetsService`) that owns the `module_widgets_zone_layouts`
 * collection. It keeps every operator override in an in-memory cache so
 * `WidgetsService.listZones()` stays synchronous: the cache is loaded
 * once at `init()` and updated on every `set()`, mirroring how the zone
 * registry holds descriptors in memory.
 *
 * Zones with no override are not stored here; the default they fall back
 * to is derived from the descriptor's coarse `layout` hint by
 * {@link defaultLayoutConfigFor}, so the collection stays small and a
 * fresh deploy carries no rows.
 *
 * @module backend/modules/widgets/zones/zone-layout.service
 */

import type {
    IDatabaseService,
    ISystemLogService,
    IZoneLayoutConfig,
    ZoneLayout
} from '@/types';
import type { IZoneLayoutDocument } from '../database/IZoneLayoutDocument.js';
import { ZONE_LAYOUT_COLLECTION } from '../database/IZoneLayoutDocument.js';

/**
 * Callback fired after a successful layout write so `WidgetsModule` can
 * broadcast a refetch signal. Errors thrown by it are swallowed by the
 * caller so a broadcast failure never rolls back the persisted change.
 *
 * @param zoneId - Zone whose layout changed.
 */
export type ZoneLayoutBroadcastCallback = (zoneId: string) => void;

/**
 * Derive the default flexbox config for a zone from its coarse `layout`
 * hint. This is what a zone renders with before any operator override:
 * `'vertical'` reproduces the historical stacked column (so untouched
 * zones look identical to the pre-flex renderer), `'horizontal'` is a
 * centered row, and `'grid'` approximates a dashboard with a wrapping
 * row. Centralised here so the renderer default and the admin editor's
 * seed agree.
 *
 * @param hint - The descriptor's coarse layout hint.
 * @returns A full {@link IZoneLayoutConfig} default for the hint.
 */
export function defaultLayoutConfigFor(hint: ZoneLayout): IZoneLayoutConfig {
    switch (hint) {
        case 'horizontal':
            return {
                preset: 'row-left',
                flexDirection: 'row',
                justifyContent: 'flex-start',
                alignItems: 'center',
                flexWrap: 'nowrap',
                gap: 'md'
            };
        case 'grid':
            return {
                preset: 'row-wrap',
                flexDirection: 'row',
                justifyContent: 'flex-start',
                alignItems: 'stretch',
                flexWrap: 'wrap',
                gap: 'md'
            };
        case 'vertical':
        default:
            return {
                preset: 'column',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                alignItems: 'stretch',
                flexWrap: 'nowrap',
                gap: 'md'
            };
    }
}

/**
 * Singleton zone-layout store. Configured once during
 * `WidgetsModule.init()` via {@link setDependencies}, loaded via
 * {@link load}, and consumed by `WidgetsService` for both reads (merged
 * into the zone snapshot) and writes (the admin layout endpoint).
 */
export class ZoneLayoutService {
    private static instance: ZoneLayoutService;
    private readonly database: IDatabaseService;
    private readonly logger: ISystemLogService;
    /** zoneId → persisted override. Absent key means "use the default". */
    private readonly cache: Map<string, IZoneLayoutConfig> = new Map();
    private broadcast: ZoneLayoutBroadcastCallback | null = null;

    private constructor(database: IDatabaseService, logger: ISystemLogService) {
        this.database = database;
        this.logger = logger;
    }

    /**
     * Configure the singleton's injected dependencies. Idempotent —
     * called once during `WidgetsModule.init()`.
     */
    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!ZoneLayoutService.instance) {
            ZoneLayoutService.instance = new ZoneLayoutService(database, logger);
        }
    }

    /**
     * Retrieve the configured singleton.
     *
     * @throws Error if `setDependencies` has not been called yet.
     */
    public static getInstance(): ZoneLayoutService {
        if (!ZoneLayoutService.instance) {
            throw new Error('ZoneLayoutService.setDependencies() must be called first');
        }
        return ZoneLayoutService.instance;
    }

    /**
     * Test-only reset so a fresh injection can occur between unit tests.
     */
    public static __resetForTests(): void {
        // @ts-expect-error — clearing the private static for tests
        ZoneLayoutService.instance = undefined;
    }

    /**
     * Wire the broadcast callback fired after every successful write.
     *
     * @param callback - Function invoked post-write, or null to disable.
     */
    public setBroadcast(callback: ZoneLayoutBroadcastCallback | null): void {
        this.broadcast = callback;
    }

    /**
     * Ensure the unique index exists and warm the in-memory cache from
     * MongoDB. Called once during `WidgetsModule.init()`. `createIndex`
     * is idempotent so this doubles as first-boot schema creation — the
     * collection needs no migration because it is brand new.
     */
    async load(): Promise<void> {
        await this.database.createIndex(ZONE_LAYOUT_COLLECTION, { zoneId: 1 }, { unique: true });

        const collection = this.database.getCollection<IZoneLayoutDocument>(ZONE_LAYOUT_COLLECTION);
        const docs = await collection.find({}).toArray();
        this.cache.clear();
        for (const doc of docs) {
            this.cache.set(doc.zoneId, toConfig(doc));
        }
        this.logger.debug({ zoneLayoutCount: this.cache.size }, 'Zone layout overrides loaded');
    }

    /**
     * Read a zone's persisted override, or `undefined` when none exists
     * (the caller then falls back to {@link defaultLayoutConfigFor}).
     * Synchronous — served from the in-memory cache.
     *
     * @param zoneId - Zone id to look up.
     * @returns The override config, or `undefined`.
     */
    get(zoneId: string): IZoneLayoutConfig | undefined {
        return this.cache.get(zoneId);
    }

    /**
     * Persist a zone's layout override (upsert), refresh the cache, and
     * fire the broadcast. Returns the stored config.
     *
     * @param zoneId - Zone id to write.
     * @param config - Full flexbox config to persist.
     * @returns The persisted config.
     */
    async set(zoneId: string, config: IZoneLayoutConfig): Promise<IZoneLayoutConfig> {
        const collection = this.database.getCollection<IZoneLayoutDocument>(ZONE_LAYOUT_COLLECTION);
        const now = new Date();
        const setOps: Partial<IZoneLayoutDocument> = {
            flexDirection: config.flexDirection,
            justifyContent: config.justifyContent,
            alignItems: config.alignItems,
            flexWrap: config.flexWrap,
            gap: config.gap,
            updatedAt: now
        };
        if (config.preset !== undefined) {
            setOps.preset = config.preset;
        }

        await collection.updateOne(
            { zoneId },
            { $set: setOps, $setOnInsert: { zoneId } },
            { upsert: true }
        );

        const stored: IZoneLayoutConfig = {
            preset: config.preset,
            flexDirection: config.flexDirection,
            justifyContent: config.justifyContent,
            alignItems: config.alignItems,
            flexWrap: config.flexWrap,
            gap: config.gap
        };
        this.cache.set(zoneId, stored);

        this.fireBroadcast(zoneId);
        this.logger.debug({ zoneId, preset: config.preset }, 'Zone layout override persisted');
        return stored;
    }

    /**
     * Invoke the broadcast callback if wired, swallowing any error so a
     * notification failure never surfaces as a write failure.
     *
     * @param zoneId - Zone whose layout changed.
     */
    private fireBroadcast(zoneId: string): void {
        if (!this.broadcast) return;
        try {
            this.broadcast(zoneId);
        } catch (err) {
            this.logger.warn(
                { err: err instanceof Error ? err.message : String(err), zoneId },
                'Zone layout broadcast callback threw — write succeeded but the notification was not delivered'
            );
        }
    }
}

/**
 * Map a stored document to the public {@link IZoneLayoutConfig} shape,
 * dropping Mongo-only fields (`_id`, `zoneId`, `updatedAt`).
 *
 * @param doc - Stored zone-layout document.
 * @returns The flexbox config the renderer and editor consume.
 */
function toConfig(doc: IZoneLayoutDocument): IZoneLayoutConfig {
    return {
        preset: doc.preset,
        flexDirection: doc.flexDirection,
        justifyContent: doc.justifyContent,
        alignItems: doc.alignItems,
        flexWrap: doc.flexWrap,
        gap: doc.gap
    };
}
