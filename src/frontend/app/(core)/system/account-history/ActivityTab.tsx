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

import { Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import type { IAccountHistoryStatsView, IAccountHistoryTickOutcomeView } from '../../../../modules/account-history';
import styles from './page.module.scss';

/**
 * Shorten a base58 address for the dense per-account breakdown lines, keeping
 * the ends an operator recognizes an account by.
 *
 * @param address - Full base58 TRON address.
 * @returns A `Txxxxx…xxxx` display form.
 */
function shortAddress(address: string): string {
    return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * Human label and badge tone for a tick's result column, folding the skip
 * reasons and error states into one at-a-glance status.
 *
 * @param tick - The tick outcome to describe.
 * @returns The label text and Badge tone.
 */
function tickResult(tick: IAccountHistoryTickOutcomeView): { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' } {
    let result: { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' };
    if (tick.error) {
        result = { label: 'aborted', tone: 'danger' };
    } else if (tick.skippedReason) {
        result = { label: `skipped (${tick.skippedReason})`, tone: 'neutral' };
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
        <Stack gap="md">
            <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-body-sm)' }}>
                Every backfill and forward-sync tick reports what it actually did: which accounts it advanced, how many TronGrid
                requests it spent (page walks plus per-transaction token-event reads), and how many rows landed. Multiply calls per
                tick by the job cadence on the Schedules tab to read the current API burn rate. This is in-process telemetry — it
                resets when the backend restarts.
            </p>

            {ticks.length === 0
                ? <div className="text-muted">No ticks recorded since the backend last started.</div>
                : (
                    <div className="table-scroll">
                        <Table>
                            <Thead>
                                <Tr>
                                    <Th width="shrink">Tick</Th>
                                    <Th width="shrink">Started</Th>
                                    <Th width="shrink">Duration</Th>
                                    <Th width="shrink">Calls</Th>
                                    <Th width="shrink">Rows</Th>
                                    <Th>Accounts</Th>
                                    <Th width="shrink">Result</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {ticks.map((tick) => {
                                    const result = tickResult(tick);
                                    return (
                                        <Tr key={`${tick.kind}-${tick.startedAt}`} hasError={Boolean(tick.error)}>
                                            <Td data-label="Tick">
                                                <Badge tone={tick.kind === 'ingest' ? 'info' : 'neutral'}>
                                                    {tick.kind === 'ingest' ? 'backfill' : 'forward sync'}
                                                </Badge>
                                            </Td>
                                            <Td data-label="Started" muted>
                                                <ClientTime date={tick.startedAt} format="datetime" />
                                            </Td>
                                            <Td data-label="Duration" muted>{(tick.durationMs / 1000).toFixed(1)}s</Td>
                                            <Td data-label="Calls" muted>{tick.totals.providerCalls.toLocaleString()}</Td>
                                            <Td data-label="Rows" muted>{tick.totals.rowsWritten.toLocaleString()}</Td>
                                            <Td data-label="Accounts">
                                                {tick.accounts.length === 0
                                                    ? <span className="text-muted">—</span>
                                                    : tick.accounts.map((account) => (
                                                        <div key={account.address} className={styles.tick_account}>
                                                            <span className={styles.tick_account_addr}>{shortAddress(account.address)}</span>
                                                            {' — '}
                                                            {account.providerCalls.toLocaleString()} calls
                                                            {' (tx '}{account.pages.tx}{' · trc20 '}{account.pages.trc20}{' · int '}{account.pages.internal}{')'}
                                                            {', '}{account.rowsWritten.toLocaleString()} rows
                                                            {account.error && <div className={styles.account_error}>{account.error}</div>}
                                                        </div>
                                                    ))}
                                            </Td>
                                            <Td data-label="Result">
                                                <Badge tone={result.tone}>{result.label}</Badge>
                                                {tick.error && <div className={styles.account_error}>{tick.error}</div>}
                                            </Td>
                                        </Tr>
                                    );
                                })}
                            </Tbody>
                        </Table>
                    </div>
                )}
        </Stack>
    );
}
