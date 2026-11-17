'use client';

/**
 * @fileoverview Tick-activity tab for /system/account-history.
 *
 * Renders the recent tick outcomes the backend retains in its bounded
 * in-memory telemetry ring: one row per backfill or forward-sync tick, with
 * the provider-call spend, rows written, and per-account breakdown. This is
 * the call-level accountability surface for the pacing dials — an operator
 * reads TronGrid budget per tick here instead of diffing /stats snapshots.
 * Stats are owned by the page (refetched on the `account-history:stats`
 * socket nudge) and passed in, so the table updates live as ticks land.
 */

import { Badge } from '../../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { Panel } from '../../../../../../components/ui/Panel';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
import { TronAddress } from '../../../../../../components/ui/TronAddress';
import type { IAccountHistoryStatsView, IAccountHistoryTickOutcomeView } from '../../../../../../modules/account-history';
import { describeSkipReason } from './describeSkipReason';
import styles from './page.module.scss';

/**
 * Human label and badge tone for a tick's result column, folding the skip
 * and error states into one at-a-glance status. A skip says only "skipped"
 * here; the reason is written out in the row's Accounts cell, which a
 * skipped tick leaves empty, so the badge stays narrow enough for the table
 * to fit a tablet.
 *
 * @param tick - The tick outcome to describe.
 * @returns The label text and Badge tone.
 */
function tickResult(tick: IAccountHistoryTickOutcomeView): { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' } {
    let result: { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' };
    if (tick.error) {
        result = { label: 'aborted', tone: 'danger' };
    } else if (tick.skippedReason) {
        result = { label: 'skipped', tone: 'neutral' };
    } else if (tick.totals.errors > 0) {
        result = { label: `${tick.totals.errors} error${tick.totals.errors === 1 ? '' : 's'}`, tone: 'warning' };
    } else {
        result = { label: 'ok', tone: 'success' };
    }
    return result;
}

/**
 * Tick-activity tab content.
 *
 * @param props.stats - The current stats snapshot (carries `recentTicks`), or
 *   null before first load.
 * @returns The tab.
 */
export function ActivityTab({ stats }: { stats: IAccountHistoryStatsView | null }) {
    const ticks = stats?.recentTicks ?? [];

    return (
        <Panel title="Recent ticks" meta="Held in memory, so the list resets when the backend restarts">
            {ticks.length === 0
                ? <p className="text-muted">No ticks recorded since the backend last started.</p>
                : (
                    /* Seven columns fit a tablet's 976px content column, so the
                       rows stack only on a phone. The kind and the result come
                       first and carry no label, so a stacked entry opens with
                       both badges on one line. */
                    <Table flush stackAt="mobile">
                        <Thead>
                            <Tr>
                                <Th width="shrink">Tick</Th>
                                <Th width="shrink">Result</Th>
                                <Th width="shrink">Started</Th>
                                <Th width="shrink" numeric>Duration</Th>
                                <Th width="shrink" numeric>Calls</Th>
                                <Th width="shrink" numeric>Rows</Th>
                                <Th>Accounts</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {ticks.map((tick) => {
                                const result = tickResult(tick);
                                return (
                                    <Tr key={`${tick.kind}-${tick.startedAt}`} hasError={Boolean(tick.error)}>
                                        <Td>
                                            <Badge tone={tick.kind === 'ingest' ? 'info' : 'neutral'}>
                                                {tick.kind === 'ingest' ? 'backfill' : 'forward sync'}
                                            </Badge>
                                        </Td>
                                        <Td>
                                            <Badge tone={result.tone}>{result.label}</Badge>
                                        </Td>
                                        <Td label="Started" muted>
                                            <ClientTime date={tick.startedAt} format="relative" />
                                        </Td>
                                        <Td label="Duration" muted numeric>{(tick.durationMs / 1000).toFixed(1)}s</Td>
                                        <Td label="Calls" muted numeric>{tick.totals.providerCalls.toLocaleString()}</Td>
                                        <Td label="Rows" muted numeric>{tick.totals.rowsWritten.toLocaleString()}</Td>
                                        <Td label="Accounts" stackSpan="full">
                                            {tick.error && <div className={styles.tick_error}>{tick.error}</div>}
                                            {tick.skippedReason && (
                                                <div className={styles.tick_account}>{describeSkipReason(tick.skippedReason)}</div>
                                            )}
                                            {tick.accounts.length === 0 && !tick.skippedReason && !tick.error && (
                                                <span className="text-muted">—</span>
                                            )}
                                            {tick.accounts.map((account) => (
                                                <div key={account.address} className={styles.tick_account}>
                                                    <div className={styles.tick_account_line}>
                                                        <TronAddress address={account.address} />
                                                        <span>
                                                            {account.providerCalls.toLocaleString()} calls
                                                            {' (tx '}{account.pages.tx}{' · trc20 '}{account.pages.trc20}{' · int '}{account.pages.internal}{')'}
                                                            {', '}{account.rowsWritten.toLocaleString()} rows
                                                        </span>
                                                    </div>
                                                    {account.error && <div className={styles.tick_error}>{account.error}</div>}
                                                </div>
                                            ))}
                                        </Td>
                                    </Tr>
                                );
                            })}
                        </Tbody>
                    </Table>
                )}
        </Panel>
    );
}
