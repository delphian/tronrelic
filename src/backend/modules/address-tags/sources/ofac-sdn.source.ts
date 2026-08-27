/**
 * @fileoverview OFAC SDN snapshot source — asserts `ofac:sdn` on every TRON
 * address the U.S. Treasury's Specially Designated Nationals list names.
 *
 * The export runs to roughly 80MB of XML, so the parse streams: chunks are
 * scanned as they arrive with a bounded carry-over tail, and the document is
 * never held in memory whole (80MB of XML expands considerably as a DOM). The
 * scanner recognises both shapes Treasury publishes — the classic
 * `<sdnEntry>`/`<idType>` form and the advanced `<Feature>`/`<VersionDetail>`
 * form with its FeatureType reference table — because the plan's endpoint
 * serves the advanced export while the classic shape is the widely mirrored
 * one, and a format assumption that guessed wrong would silently yield zero
 * assertions. A zero-assertion snapshot against held state is refused by
 * `syncSource`'s floor rather than read as a mass delisting, and the
 * per-source status panel shows the counts either way.
 *
 * The sanctioned entity's uid is kept as each assertion's `ref`, and the `url`
 * points at that entity on Treasury's public search — the citation is the
 * entire reason the tag is safe to show.
 */

import type { IAddressTagAssertion } from '@/types';
import type { ITagSource, ITagSourceResult } from './ITagSource.js';

/** The source id written into `sources[].id` on tagged documents. */
export const OFAC_SOURCE_ID = 'ofac-sdn';

/** The reserved tag this source asserts. */
export const OFAC_TAG = 'ofac:sdn';

/** Treasury's advanced SDN export, per the ingestion plan. */
const OFAC_EXPORT_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ADVANCED_XML';

/** Human-viewable entity page an assertion's `url` cites. */
const OFAC_ENTITY_URL = 'https://sanctionssearch.ofac.treas.gov/Details.aspx?id=';

/**
 * Carry-over tail kept between chunk scans. It must exceed the longest span a
 * single match can cover so a match split across a chunk boundary completes on
 * the next scan; matches re-found inside the retained tail are deduplicated by
 * address, so reprocessing costs nothing.
 */
const TAIL_KEEP = 8192;

/** Base58 TRON address shape, anchored inside larger scans. */
const TRON_ADDRESS = 'T[1-9A-HJ-NP-Za-km-z]{33}';

/**
 * Streaming scanner over the SDN XML. Feed decoded text with {@link push};
 * collect the result with {@link assertions}.
 *
 * The scanner is event-ordered rather than tree-parsed: each round finds
 * entity anchors (`<sdnEntry><uid>` or `<DistinctParty FixedRef=…>`),
 * digital-currency FeatureType declarations, and TRON address matches in both
 * formats, sorts them by position, and replays them in order so every address
 * is attributed to the entity most recently opened before it. That is exactly
 * the flat scan the plan calls for — one entity can carry many addresses
 * across many chains, so walking the entity tree buys nothing here.
 */
export class OfacXmlScanner {
    /** Rolling text buffer: unprocessed tail plus the newest chunk. */
    private buffer = '';

    /** Entity id most recently opened before the current scan position. */
    private currentEntityRef: string | null = null;

    /** Advanced-format FeatureType ids declared for the two TRON currencies. */
    private readonly tronFeatureTypeIds = new Set<string>();

    /** One assertion per address; the first citing entity wins. */
    private readonly found = new Map<string, IAddressTagAssertion>();

    /**
     * Scan one decoded chunk. Events found inside the retained tail are seen
     * again on the next call, which is safe: entity anchors just re-set the
     * same state and address matches deduplicate by address.
     *
     * @param chunk - The next piece of decoded XML text.
     */
    public push(chunk: string): void {
        this.buffer += chunk;
        const events: Array<{ index: number; apply: () => void }> = [];

        // Classic format: the entity uid is the first child of <sdnEntry>, so
        // anchoring on the pair skips the per-alias uids that follow it.
        for (const match of this.buffer.matchAll(/<sdnEntry>\s*<uid>(\d+)<\/uid>/g)) {
            const ref = match[1];
            events.push({ index: match.index ?? 0, apply: () => { this.currentEntityRef = ref; } });
        }

        // Advanced format: each party block carries its id on the opening tag.
        for (const match of this.buffer.matchAll(/<DistinctParty\b[^>]*FixedRef="(-?\d+)"/g)) {
            const ref = match[1];
            events.push({ index: match.index ?? 0, apply: () => { this.currentEntityRef = ref; } });
        }

        // Advanced format reference table: learn which FeatureType ids mean a
        // TRON digital-currency address, so Feature blocks can be filtered.
        for (const match of this.buffer.matchAll(/<FeatureType\b[^>]*ID="(\d+)"[^>]*>\s*Digital Currency Address - (?:TRX|USDT)\s*<\/FeatureType>/g)) {
            const id = match[1];
            events.push({ index: match.index ?? 0, apply: () => { this.tronFeatureTypeIds.add(id); } });
        }

        // Classic format address: a typed id entry on the sanctioned entity.
        const classicAddress = new RegExp(
            `<idType>\\s*Digital Currency Address - (?:TRX|USDT)\\s*</idType>[\\s\\S]{0,100}?<idNumber>\\s*(${TRON_ADDRESS})\\s*</idNumber>`,
            'g'
        );
        for (const match of this.buffer.matchAll(classicAddress)) {
            const address = match[1];
            events.push({ index: match.index ?? 0, apply: () => { this.recordAddress(address); } });
        }

        // Advanced format address: a Feature of a TRON FeatureType whose
        // VersionDetail holds the address text.
        const advancedAddress = new RegExp(
            `<Feature\\b[^>]*FeatureTypeID="(\\d+)"[\\s\\S]{0,800}?<VersionDetail[^>]*>\\s*(${TRON_ADDRESS})\\s*</VersionDetail>`,
            'g'
        );
        for (const match of this.buffer.matchAll(advancedAddress)) {
            const [, typeId, address] = match;
            events.push({
                index: match.index ?? 0,
                apply: () => {
                    if (this.tronFeatureTypeIds.has(typeId)) {
                        this.recordAddress(address);
                    }
                }
            });
        }

        events.sort((a, b) => a.index - b.index);
        for (const event of events) {
            event.apply();
        }

        if (this.buffer.length > TAIL_KEEP) {
            this.buffer = this.buffer.slice(-TAIL_KEEP);
        }
    }

    /**
     * The assertions collected so far — call after the last chunk.
     *
     * @returns One `ofac:sdn` assertion per distinct TRON address found.
     */
    public assertions(): IAddressTagAssertion[] {
        return [...this.found.values()];
    }

    /**
     * Record one address against the entity currently open, first citation
     * winning so re-scans of the retained tail cannot flap the attribution.
     *
     * @param address - The base58 TRON address found in the export.
     */
    private recordAddress(address: string): void {
        if (this.found.has(address)) {
            return;
        }
        const assertion: IAddressTagAssertion = { address, tag: OFAC_TAG };
        if (this.currentEntityRef) {
            assertion.ref = this.currentEntityRef;
            assertion.url = `${OFAC_ENTITY_URL}${this.currentEntityRef}`;
        }
        this.found.set(address, assertion);
    }
}

/**
 * The OFAC SDN source. Snapshot mode: every run hands `syncSource` the list's
 * complete current TRON slice, and the reconcile's diff withdraws whatever was
 * delisted since the previous run.
 */
export class OfacSdnSource implements ITagSource {
    public readonly id = OFAC_SOURCE_ID;
    public readonly mode = 'snapshot' as const;
    public readonly publish = 'direct' as const;
    /** Daily at 06:00 UTC — Treasury updates the list on business days. */
    public readonly cron = '0 0 6 * * *';

    /**
     * @param fetchImpl - HTTP implementation, injectable so tests feed recorded
     *                    fixtures instead of downloading 80MB from Treasury.
     */
    constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    /** @inheritdoc */
    public async fetch(): Promise<ITagSourceResult> {
        const response = await this.fetchImpl(OFAC_EXPORT_URL);
        if (!response.ok) {
            throw new Error(`OFAC export request failed: HTTP ${response.status}`);
        }
        if (!response.body) {
            throw new Error('OFAC export response carried no body');
        }
        const scanner = new OfacXmlScanner();
        const decoder = new TextDecoder();
        // Web ReadableStreams are async iterable in Node; the cast bridges the
        // DOM-typed `response.body` to that runtime reality.
        const body = response.body as unknown as AsyncIterable<Uint8Array>;
        for await (const chunk of body) {
            scanner.push(decoder.decode(chunk, { stream: true }));
        }
        scanner.push(decoder.decode());
        return { assertions: scanner.assertions() };
    }
}
