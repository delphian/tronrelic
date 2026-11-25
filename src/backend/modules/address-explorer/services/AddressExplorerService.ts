/**
 * @fileoverview Assembles the `/a/<address>` page from the chain reads.
 *
 * The reader answers one bounded question at a time. This service decides
 * which questions the page asks and in what order:
 *
 * - Summary sections read the span the visitor picked. When a 21-day read is
 *   too large for a busy wallet, the section is read again over 7 days and
 *   marked as narrowed, so the visitor sees something rather than an error.
 * - The transfers list is read one week at a time, newest first, back to the
 *   start of the stored history. Weeks with no transfers are skipped in the
 *   same request, so "Load older" always shows rows or reaches the end.
 * - Reads run one after another. The page's ClickHouse account allows only a
 *   few queries at once across all visitors, and one visitor's page load
 *   should hold one of those slots, not all of them. A read refused because
 *   the slots were full is retried once after a short pause.
 */

import { mergeAddressExplorerCoverage } from '@/types';
import type {
    AddressExplorerPeriod,
    AddressExplorerSection,
    IAddressActivityReader,
    IAddressExplorerCounterparties,
    IAddressExplorerCoverage,
    IAddressExplorerDelegations,
    IAddressExplorerOverview,
    IAddressExplorerPermissions,
    IAddressExplorerProfile,
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
    }

    /**
     * Read every section of the address page.
     *
     * @param address - The wallet, base58, already checksum-verified.
     * @param period - The span for the summary sections.
     * @param quotaKey - The visitor's user id, which the hourly read quota is counted under.
     * @returns The page's sections, each read or failed on its own.
     */
    async getOverview(address: string, period: AddressExplorerPeriod, quotaKey: string): Promise<IAddressExplorerOverview> {
        const profile = await this.readSummary<IAddressExplorerProfile>(period, (hours) => this.reader.profile({ address, hours, quotaKey }));
        const counterparties = await this.readSummary<IAddressExplorerCounterparties>(period, (hours) => this.reader.counterparties({ address, hours, quotaKey }));
        const transfers = await this.getTransfers(address, quotaKey);
        const delegations = await this.readSummary<IAddressExplorerDelegations>(period, (hours) => this.reader.delegations({ address, hours, quotaKey }));
        const permissions = await this.readSummary<IAddressExplorerPermissions>(period, (hours) => this.reader.permissions({ address, hours, quotaKey }));
        return { address, period, profile, counterparties, transfers, delegations, permissions };
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
