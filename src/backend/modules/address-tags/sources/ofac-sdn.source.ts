/**
 * @fileoverview OFAC SDN snapshot source — asserts `ofac:sdn` on every TRON
 * address the U.S. Treasury's Specially Designated Nationals list names.
 *
 * The export runs to roughly 120MB of XML, so the parse streams: chunks are
 * scanned as they arrive with a bounded carry-over tail, and the document is
 * never held in memory whole (that much XML expands considerably as a DOM). The
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

/**
 * Treasury's advanced SDN export. The export name in this path must stay
 * `SDN_ADVANCED.XML`: that endpoint answers `302` and redirects to a short-lived
 * presigned S3 object holding the real document, which `fetch` follows on its
 * own. The similar-looking `.../exports/ADVANCED_XML` is the export's *XML
 * namespace* URI rather than a download endpoint, and requesting it returns
 * `HTTP 200` with an empty body — which reaches the scanner as a document
 * containing nothing at all, and so fails the completeness check below.
 */
const OFAC_EXPORT_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN_ADVANCED.XML';

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
 * The scanner is event-ordered rather than tree-parsed: each round finds entity
 * anchors (`<sdnEntry><uid>` or `<DistinctParty FixedRef=…>`), digital-currency
 * FeatureType declarations, advanced-format Feature open and close tags, and
 * TRON address matches in both formats, sorts them by position, and replays
 * them in order. Every address is therefore attributed to the entity and the
 * Feature type most recently opened before it. That is exactly the flat scan
 * the plan calls for — one entity can carry many addresses across many chains,
 * so walking the entity tree buys nothing here.
 *
 * Attribution through replayed state, rather than through one regex spanning
 * from a Feature to its address, is what keeps the count right: the blocks are
 * adjacent, and a spanning match starting at one block can run past its own
 * close tag and consume the next block's address, dropping it silently.
 */
export class OfacXmlScanner {
    /** Rolling text buffer: unprocessed tail plus the newest chunk. */
    private buffer = '';

    /** Entity id most recently opened before the current scan position. */
    private currentEntityRef: string | null = null;

    /** Advanced-format FeatureType ids declared for the two TRON currencies. */
    private readonly tronFeatureTypeIds = new Set<string>();

    /**
     * FeatureType id of the advanced-format Feature block currently open, so an
     * address found inside it can be tested against the TRON type table. Null
     * between blocks.
     */
    private currentFeatureTypeId: string | null = null;

    /** One assertion per address; the first citing entity wins. */
    private readonly found = new Map<string, IAddressTagAssertion>();

    /** True once the export's root element opened, in either published shape. */
    private sawRootOpen = false;

    /** True once that root element closed — the end-of-document marker. */
    private sawRootClose = false;

    /**
     * Scan one decoded chunk. Events found inside the retained tail are seen
     * again on the next call, which is safe: entity anchors just re-set the
     * same state and address matches deduplicate by address.
     *
     * @param chunk - The next piece of decoded XML text.
     */
    public push(chunk: string): void {
        this.buffer += chunk;

        // Completeness markers, recorded before the tail is trimmed so the
        // opening root is still seen even when the first chunk is large. Both
        // published shapes are covered; an unrecognised root simply leaves
        // these false, which downgrades the check rather than failing a good
        // download.
        if (!this.sawRootOpen && /<(?:sdnList|Sanctions)\b/.test(this.buffer)) {
            this.sawRootOpen = true;
        }
        if (!this.sawRootClose && /<\/(?:sdnList|Sanctions)>/.test(this.buffer)) {
            this.sawRootClose = true;
        }

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
        // TRON digital-currency address, so Feature blocks can be filtered. The
        // `\bID="` is load-bearing: the real tag is
        // `<FeatureType ID="992" FeatureTypeGroupID="1">`, and without the word
        // boundary the attribute scan runs on to the trailing
        // `FeatureTypeGroupID` and captures the group id instead of the type id,
        // which leaves no Feature block ever matching a known TRON type.
        for (const match of this.buffer.matchAll(/<FeatureType\b[^>]*?\bID="(\d+)"[^>]*>\s*Digital Currency Address - (?:TRX|USDT)\s*<\/FeatureType>/g)) {
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
        // VersionDetail holds the address text. The open tag, the close tag and
        // the address are three separate events replayed in document order,
        // rather than one regex spanning from Feature to VersionDetail.
        //
        // A single spanning regex loses addresses. The Feature blocks sit back
        // to back, so a non-TRON block's opening tag can reach forward across
        // its own close and match the *next* block's VersionDetail. The engine
        // then resumes after that consumed text, the TRON block never gets
        // offered on its own, and the address is dropped while the run still
        // looks successful. Splitting the events removes the span entirely.
        for (const match of this.buffer.matchAll(/<Feature\b[^>]*?\bFeatureTypeID="(\d+)"/g)) {
            const typeId = match[1];
            events.push({ index: match.index ?? 0, apply: () => { this.currentFeatureTypeId = typeId; } });
        }

        // Closing a Feature clears the type, so a VersionDetail that somehow sat
        // outside any Feature cannot inherit the previous block's type. The `>`
        // is literal, so this cannot match `</FeatureVersion>`.
        for (const match of this.buffer.matchAll(/<\/Feature>/g)) {
            events.push({ index: match.index ?? 0, apply: () => { this.currentFeatureTypeId = null; } });
        }

        const advancedAddress = new RegExp(
            `<VersionDetail[^>]*>\\s*(${TRON_ADDRESS})\\s*</VersionDetail>`,
            'g'
        );
        for (const match of this.buffer.matchAll(advancedAddress)) {
            const address = match[1];
            events.push({
                index: match.index ?? 0,
                apply: () => {
                    if (this.currentFeatureTypeId && this.tronFeatureTypeIds.has(this.currentFeatureTypeId)) {
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
     * Whether the scanned text held a complete SDN export rather than an error
     * page, an empty body, or a document that stopped part-way. Treasury's
     * endpoint answers HTTP 200 for content this scanner cannot read — a
     * maintenance page, a schema change, a half-generated export — and every
     * one of those arrives here as zero or partial assertions. The reconcile
     * cannot tell that apart from a genuine delisting, and on a first run,
     * where there are no holdings to compare against, its snapshot floor does
     * not apply at all. So the caller has to refuse the download itself.
     *
     * The test is structural rather than count-based: at least one entity
     * record must have been seen, and when a recognised root element opened it
     * must also have closed.
     *
     * @returns True when the text can be trusted as the list's complete
     *          current state, so the caller knows whether handing it to
     *          `syncSource` as a snapshot is safe.
     */
    public isCompleteExport(): boolean {
        const sawEntity = this.currentEntityRef !== null;
        const result = sawEntity && (!this.sawRootOpen || this.sawRootClose);

        return result;
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
        if (!scanner.isCompleteExport()) {
            throw new Error(
                'OFAC export did not parse as a complete SDN document: no entity records were found, '
                + 'or the document ended before its closing element. Refusing to reconcile it as a snapshot'
            );
        }
        const assertions = scanner.assertions();
        // A structurally complete export that yields no addresses means the
        // address markup moved, not that Treasury delisted every TRON wallet at
        // once — the list has carried hundreds for years. On an established
        // deployment `syncSource`'s floor would already refuse this, but on a
        // first run there are no holdings to compare against and the empty
        // result would be recorded as a clean sync, which is how a silent parse
        // break stays invisible. Refuse it here so the failure names itself.
        if (assertions.length === 0) {
            throw new Error(
                'OFAC export parsed as a complete SDN document but held no TRON addresses. '
                + 'Treat this as a change to the export format rather than a delisting, and check the '
                + 'FeatureType reference table and Feature markup before reconciling it as a snapshot'
            );
        }
        return { assertions };
    }
}
