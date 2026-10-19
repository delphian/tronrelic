/**
 * @fileoverview Bot networks service — the operator-managed list of automated networks.
 *
 * ## Why This Service Exists
 *
 * Some automated traffic defeats every per-request check the bot classifier
 * has. A pool of remotely controlled browsers sends a stock Chrome User-Agent,
 * runs the page's JavaScript, and hides `navigator.webdriver`, so its rows are
 * written as `human` and counted as visitors. What such a pool cannot hide is
 * the network it runs on. Cloudflare reports the autonomous system number (ASN)
 * of every request, and the client cannot change it.
 *
 * This service holds the ASNs an operator has confirmed as automated. When a
 * request arrives from one of them, the classifier downgrades a `human`
 * verdict to `bot_other`.
 *
 * ## Design Decisions
 *
 * - **Write-time classification.** The list feeds `bot_class` when a row is
 *   written, like every other classifier signal. Rows written before a network
 *   was added keep the label they were written with.
 * - **Labels, never blocks.** A listed network is still served every page.
 *   Only the analytics label changes, so a mistaken entry costs miscounted rows,
 *   not lost visitors.
 * - **Operator-confirmed, not imported.** The list holds networks someone has
 *   checked, rather than a published datacenter list, because real VPN users
 *   browse from datacenter networks too.
 * - **Cached in memory.** Every traffic event checks the list, so the ASN set
 *   is loaded at init and reloaded after each change, and the check is a
 *   synchronous set lookup with no database read.
 * - **Singleton** matching {@link IgnoredUsersService} for consistent DI.
 */

import type { Collection } from 'mongodb';
import type { IDatabaseService, ISystemLogService } from '@/types';
import { parseAsn } from './traffic.service.js';

/** Physical collection name for the automated-network list. */
const COLLECTION_NAME = 'module_traffic_bot_networks';

/** Longest operator note stored with an entry. */
const MAX_NOTE_LENGTH = 200;

/**
 * One network the operator has marked as automated.
 */
export interface IBotNetworkDocument {
    /** Autonomous system number — the key matched against each request's `asn`. */
    asn: number;
    /** Operator's note on why the network was listed, such as its owner. Null when none was given. */
    note: string | null;
    /** When the network was added to the list. */
    addedAt: Date;
}

/**
 * The read side of the list that event ingestion needs. Declared separately so
 * the ingestion path depends on the one check it makes rather than on the
 * whole service, and tests can supply a stub.
 */
export interface IBotNetworkLookup {
    /**
     * Answer whether a request's network is on the automated-network list.
     *
     * @param asn - The request's autonomous system number.
     * @returns True when the operator has listed the network as automated.
     */
    isBotNetwork(asn: number): boolean;
}

/**
 * Thrown when an add carries an ASN that cannot be stored. The controller maps
 * it to HTTP 400 so the operator sees which value was rejected.
 */
export class BotNetworkValidationError extends Error {
    /**
     * @param message - Operator-readable description of the rejected input.
     */
    constructor(message: string) {
        super(message);
        this.name = 'BotNetworkValidationError';
    }
}

/**
 * Manages the automated-network list and answers the per-event membership
 * check from an in-memory copy of it.
 */
export class BotNetworksService implements IBotNetworkLookup {
    private static instance: BotNetworksService;
    private readonly collection: Collection<IBotNetworkDocument>;

    /**
     * In-memory copy of the listed ASNs. Event ingestion reads it on every
     * request, so it must never wait on the database.
     */
    private asnSet: ReadonlySet<number> = new Set();

    /**
     * Private constructor enforces the singleton. Use setDependencies() and
     * getInstance().
     *
     * @param database - Database service holding the list's collection.
     * @param logger - Traffic-module logger, so list changes appear on its Logs tab.
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {
        this.collection = database.getCollection<IBotNetworkDocument>(COLLECTION_NAME);
    }

    /**
     * Initialize the singleton with its dependencies. Must be called before
     * getInstance(); the traffic module calls it during init().
     *
     * @param database - Database service.
     * @param logger - Traffic-module logger.
     */
    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!BotNetworksService.instance) {
            BotNetworksService.instance = new BotNetworksService(database, logger);
        }
    }

    /**
     * Return the one shared instance, so the admin routes and the ingestion
     * path read and write the same cached list.
     *
     * @throws Error if setDependencies() has not been called first.
     * @returns The singleton instance.
     */
    public static getInstance(): BotNetworksService {
        if (!BotNetworksService.instance) {
            throw new Error('BotNetworksService.setDependencies() must be called before getInstance()');
        }
        return BotNetworksService.instance;
    }

    /**
     * Clear the singleton so each test starts from a fresh instance with its
     * own mocked dependencies. Test-only.
     */
    public static resetInstance(): void {
        BotNetworksService.instance = undefined as unknown as BotNetworksService;
    }

    /**
     * Create the unique index on `asn` so a repeated add updates the existing
     * entry instead of listing the same network twice. Called once during init().
     */
    async createIndexes(): Promise<void> {
        await this.collection.createIndex({ asn: 1 }, { unique: true, name: 'bot_network_asn_unique' });
    }

    /**
     * Number of the most recent load() call to have started. Two overlapping
     * admin mutations each reload the list, and their queries can finish in
     * either order, so without this counter an older query's result can
     * replace a newer one's and leave a just-removed ASN in the cached set
     * until the next change or a restart. Each load() takes the next number
     * and writes the set only while it still holds the latest one.
     */
    private loadGeneration = 0;

    /**
     * Load the listed ASNs into memory. Called during init(), so classification
     * uses the list from the first event, and again after every change.
     *
     * The generation check discards the result of an earlier reload that
     * finishes late. Every reload starts only after its own write has been
     * acknowledged, so the reload that started last saw every write that
     * completed before it, and its snapshot is the one the cache should keep.
     */
    async load(): Promise<void> {
        const generation = ++this.loadGeneration;
        const rows = await this.collection.find({}, { projection: { _id: 0, asn: 1 } }).toArray();
        if (generation === this.loadGeneration) {
            this.asnSet = new Set(rows.map(row => row.asn));
        }
    }

    /**
     * Answer the per-event membership check from the in-memory copy.
     *
     * @param asn - The request's autonomous system number.
     * @returns True when the network is on the list.
     */
    isBotNetwork(asn: number): boolean {
        return this.asnSet.has(asn);
    }

    /**
     * List the networks for the admin panel, newest addition first.
     *
     * @returns Every listed network with its note and the time it was added.
     */
    async list(): Promise<IBotNetworkDocument[]> {
        return this.collection.find({}, { projection: { _id: 0 } }).sort({ addedAt: -1 }).toArray();
    }

    /**
     * Add a network to the list, or replace the note of one already on it.
     * Re-adding keeps the original `addedAt`. Rows recorded from the network
     * after this call are labeled `bot_other`; earlier rows are unchanged.
     *
     * @param entry - The ASN as the operator typed it, and an optional note.
     * @returns The stored ASN, so the caller can report what was saved.
     * @throws BotNetworkValidationError when the ASN is not a valid 32-bit network number.
     */
    async add(entry: { asn: unknown; note?: unknown }): Promise<number> {
        const asn = parseAsn(entry.asn === undefined || entry.asn === null ? undefined : String(entry.asn));
        if (asn === null) {
            throw new BotNetworkValidationError('asn must be a whole number between 1 and 4294967295');
        }
        const note = typeof entry.note === 'string' && entry.note.trim()
            ? entry.note.trim().slice(0, MAX_NOTE_LENGTH)
            : null;

        await this.collection.updateOne(
            { asn },
            {
                $set: { note },
                $setOnInsert: { asn, addedAt: new Date() }
            },
            { upsert: true }
        );
        await this.load();
        this.logger.info({ asn }, 'Added network to the automated-network list');
        return asn;
    }

    /**
     * Remove a network from the list. Later rows from it are classified
     * normally again; rows already written keep their label. A no-op when the
     * network is not listed.
     *
     * @param asn - The ASN to remove, already parsed by the caller.
     */
    async remove(asn: number): Promise<void> {
        await this.collection.deleteOne({ asn });
        await this.load();
        this.logger.info({ asn }, 'Removed network from the automated-network list');
    }
}
