/**
 * @fileoverview Assembles the `/a/<address>` page from the chain reads.
 *
 * The reader answers one bounded question at a time. This service decides
 * how each of the page's sections is asked:
 *
 * - Span sections read the span the visitor picked, one section per request,
 *   so the page reads them in parallel and shows each as soon as it is ready.
 *   When a 21-day read is too large for a busy wallet, the section is read
 *   again over 7 days and marked as narrowed, so the visitor sees something
 *   rather than an error.
 * - The transfers list is read one week at a time, newest first, back to the
 *   start of the stored history. Weeks with no transfers are skipped in the
 *   same request, so "Load older" always shows rows or reaches the end.
 * - Parallel reads cannot overrun the ClickHouse account: its shared reader's
 *   connection pool is the size of the account's concurrency limit, and reads
 *   beyond it wait in this process for a free connection. A read ClickHouse
 *   still refuses because its slots were full, which happens only when an
 *   admin sets the limit below the pool size, is retried once after a pause.
 */

import { mergeAddressExplorerCoverage } from '@/types';
import type {
    AddressExplorerPeriod,
    AddressExplorerSection,
    AddressExplorerSpanSection,
    IAddressActivityQuery,
    IAddressActivityReader,
    IAddressExplorerCoverage,
    IAddressExplorerSpanSections,
    IAddressExplorerTransfers,
    IAddressExplorerTransfersCursor,
    ISystemLogService
} from '@/types';

/** One hour in milliseconds. */
const HOUR_MS = 3_600_000;

/** One week in milliseconds, the widest window one transfers read covers. */
const WEEK_MS = 7 * 24 * HOUR_MS;

/**
 * Most weeks one transfers request reads while skipping empty ones. Three
 * covers the whole 21-day history, so an inactive wallet is answered in one
 * request instead of three clicks.
 */
const MAX_TRANSFER_WEEKS_PER_REQUEST = 3;

/**
 * The shortest window offered as "older". A sliver of a few seconds left
 * between the previous window and the start of retention would be refused by
 * the reader as lying wholly outside the stored data.
 */
const MIN_OLDER_WINDOW_MS = HOUR_MS;

/** How long to wait before retrying a read refused because the account's query slots were full. */
const BUSY_RETRY_DELAY_MS = 500;

/** The spans the page offers, in the order the selector lists them. */
export const ADDRESS_EXPLORER_PERIODS: readonly AddressExplorerPeriod[] = ['24h', '7d', '21d'];

/** The sections read over the visitor's span, each requested on its own. */
export const ADDRESS_EXPLORER_SPAN_SECTIONS: readonly AddressExplorerSpanSection[] = ['profile', 'counterparties', 'delegations', 'permissions'];

/** Reads one span section from the chain for a query. */
type SpanSectionRead<K extends AddressExplorerSpanSection> =
    (query: IAddressActivityQuery) => Promise<AddressExplorerSection<IAddressExplorerSpanSections[K]>>;

/** Clock and pause, injectable so tests run without waiting. */
export interface IAddressExplorerServiceOptions {
    /** The current time. */
    now?: () => Date;
    /** Waits the given number of milliseconds. */
    sleep?: (ms: number) => Promise<void>;
}

/**
 * Reads and assembles the address page's sections for one visitor.
 *
 * Constructed once by the module. It holds no state between requests.
 */
export class AddressExplorerService {
    private readonly now: () => Date;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly spanReads: { [K in AddressExplorerSpanSection]: SpanSectionRead<K> };

    /**
     * @param reader - The chain reads, served by the blockchain module.
     * @param logger - The module's logger, for narrowed reads worth noticing.
     * @param options - Clock and pause overrides for tests.
     */
    constructor(
        private readonly reader: IAddressActivityReader,
        private readonly logger: ISystemLogService,
        options: IAddressExplorerServiceOptions = {}
    ) {
        this.now = options.now ?? (() => new Date());
        this.sleep = options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
        this.spanReads = {
            profile: (query) => this.reader.profile(query),
            counterparties: (query) => this.reader.counterparties(query),
            delegations: (query) => this.reader.delegations(query),
            permissions: (query) => this.reader.permissions(query)
        };
    }

    /**
     * Read one of the page's span sections.
     *
     * @param section - Which section to read.
     * @param address - The wallet, base58, already checksum-verified.
     * @param period - The span the visitor picked.
     * @param quotaKey - The visitor's user id, which the hourly read quota is counted under.
     * @returns The section, read or failed, and marked as narrowed when a 21-day read fell back to 7 days.
     */
    async getSpanSection<K extends AddressExplorerSpanSection>(
        section: K,
        address: string,
        period: AddressExplorerPeriod,
        quotaKey: string
    ): Promise<AddressExplorerSection<IAddressExplorerSpanSections[K]>> {
        const read: SpanSectionRead<K> = this.spanReads[section];
        return await this.readSummary(period, (hours) => read({ address, hours, quotaKey }));
    }

    /**
     * Read one page of the transfers list.
     *
     * Reads the week ending at `position.before` (now on the first page),
     * continuing inside it from `position.cursor` when given. An empty week
     * with older weeks still stored is skipped, up to the whole history.
     *
     * A page that skipped weeks reports the window and coverage of every week
     * it scanned. A week can look empty precisely because its blocks or
     * receipts are missing, so dropping a skipped week's coverage would hide
     * the gap the visitor needs to be told about.
     *
     * @param address - The wallet, base58, already checksum-verified.
     * @param quotaKey - The visitor's user id.
     * @param position - Where the previous page said to continue, or undefined for the newest page.
     * @returns The page, with where older transfers continue.
     */
    async getTransfers(
        address: string,
        quotaKey: string,
        position?: IAddressExplorerTransfersCursor
    ): Promise<AddressExplorerSection<IAddressExplorerTransfers>> {
        const nowMs = this.now().getTime();
        const retentionStartMs = nowMs - this.reader.retentionDays * 24 * HOUR_MS;
        let toMs = position ? Math.min(Date.parse(position.before), nowMs) : nowMs;
        let cursor = position?.cursor;
        let section: AddressExplorerSection<IAddressExplorerTransfers> | null = null;
        let skippedCoverage: IAddressExplorerCoverage | null = null;
        let scanEnd: string | null = null;

        for (let week = 0; week < MAX_TRANSFER_WEEKS_PER_REQUEST && section === null; week += 1) {
            const fromMs = Math.max(toMs - WEEK_MS, retentionStartMs);
            const windowEnd = toMs;
            const windowCursor = cursor;
            const page = await this.retryWhenBusy(() => this.reader.transfers({
                address,
                from: new Date(fromMs).toISOString(),
                to: new Date(windowEnd).toISOString(),
                cursor: windowCursor,
                quotaKey
            }));
            if (page.status === 'error') {
                section = page;
            } else {
                const olderRemains = fromMs - retentionStartMs >= MIN_OLDER_WINDOW_MS;
                const next: IAddressExplorerTransfersCursor | null = page.data.nextCursor
                    ? { before: new Date(windowEnd).toISOString(), cursor: page.data.nextCursor }
                    : olderRemains ? { before: new Date(fromMs).toISOString() } : null;
                const lastWeek = week === MAX_TRANSFER_WEEKS_PER_REQUEST - 1;
                const coverage: IAddressExplorerCoverage = skippedCoverage ? mergeAddressExplorerCoverage(skippedCoverage, page.coverage) : page.coverage;
                scanEnd = scanEnd ?? page.window.to;
                if (page.data.transfers.length > 0 || next === null || next.cursor || lastWeek) {
                    section = {
                        ...page,
                        window: { from: page.window.from, to: scanEnd },
                        coverage,
                        data: { transfers: page.data.transfers, next }
                    };
                } else {
                    skippedCoverage = coverage;
                    toMs = fromMs;
                    cursor = undefined;
                }
            }
        }

        // The loop always assigns on its last pass, so the fallback is never used.
        return section ?? { status: 'error', reason: 'failed' };
    }

    /**
     * How many hours a summary span covers. `21d` follows the stored history,
     * so a change to the retention changes the span with it.
     *
     * @param period - The span.
     * @returns The span in hours.
     */
    periodHours(period: AddressExplorerPeriod): number {
        const hours: Record<AddressExplorerPeriod, number> = {
            '24h': 24,
            '7d': 168,
            '21d': this.reader.retentionDays * 24
        };
        return hours[period];
    }

    /**
     * Read one summary section, narrowing a too-large 21-day read to 7 days.
     *
     * @param period - The span the visitor asked for.
     * @param read - Reads the section over a number of hours.
     * @returns The section, marked as narrowed when the shorter span was used.
     */
    private async readSummary<T>(
        period: AddressExplorerPeriod,
        read: (hours: number) => Promise<AddressExplorerSection<T>>
    ): Promise<AddressExplorerSection<T>> {
        let section = await this.retryWhenBusy(() => read(this.periodHours(period)));
        if (section.status === 'error' && section.reason === 'too-large' && period === '21d') {
            this.logger.info({ period }, 'Address page read too large for 21 days; reading 7 days instead');
            const narrowed = await this.retryWhenBusy(() => read(this.periodHours('7d')));
            section = narrowed.status === 'ok' ? { ...narrowed, narrowedFrom: period } : narrowed;
        }
        return section;
    }

    /**
     * Run a read, and run it once more after a short pause if it was refused
     * because the account's query slots were full at that moment.
     *
     * @param read - The read to run.
     * @returns The read's result, from the second attempt when the first was refused as busy.
     */
    private async retryWhenBusy<T>(read: () => Promise<AddressExplorerSection<T>>): Promise<AddressExplorerSection<T>> {
        let section = await read();
        if (section.status === 'error' && section.reason === 'busy') {
            await this.sleep(BUSY_RETRY_DELAY_MS);
            section = await read();
        }
        return section;
    }
}
