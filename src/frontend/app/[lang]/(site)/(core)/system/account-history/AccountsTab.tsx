'use client';

/**
 * @fileoverview Tracked-accounts tab for /system/account-history.
 *
 * The control surface a plugin's enable/disable would otherwise provide: add or
 * remove tracked accounts, pause/resume an individual backfill, and watch
 * per-account progress. The figures for the whole tracked set sit at the top of
 * the same panel, because they describe the rows beneath them. Stats are owned
 * by the page (fed live off the `account-history:stats` socket event) and
 * passed in; mutations call back via `onChanged` so the page refetches. Like
 * the sibling system surfaces this is an admin client surface, not SSR-first
 * public content.
 */

import { useState, useCallback } from 'react';
import { Plus, Play, Trash2, Pause, PlayCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '../../../../../../components/ui/Button';
import { IconButton } from '../../../../../../components/ui/IconButton';
import { Badge } from '../../../../../../components/ui/Badge';
import { Input } from '../../../../../../components/ui/Input';
import { Panel } from '../../../../../../components/ui/Panel';
import { StatGrid, StatTile } from '../../../../../../components/ui/StatTile';
import { TronAddress } from '../../../../../../components/ui/TronAddress';
import { AddressSelector } from '../../../../../../components/ui/AddressSelector';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { useToast } from '../../../../../../components/ui/ToastProvider';
import {
    addTrackedAccount,
    removeTrackedAccount,
    resetAccountHistory,
    setAccountPaused,
    runIngestion,
    runForwardSync,
    type IAccountHistoryStatsView,
    type IAccountHistoryTickOutcomeView,
    type IAccountHistorySourceFlags,
    type AccountIngestionStatus
} from '../../../../../../modules/account-history';
import { describeSkipReason } from './describeSkipReason';
import styles from './page.module.scss';

/**
 * Summarize a completed tick for the trigger buttons' toast, so the operator
 * learns what the tick actually did (or why it did nothing) without opening
 * the Activity tab.
 *
 * @param outcome - The tick outcome the trigger endpoint returned.
 * @returns A one-line human summary.
 */
function describeOutcome(outcome: IAccountHistoryTickOutcomeView): string {
    let description: string;
    if (outcome.skippedReason) {
        description = `Skipped. ${describeSkipReason(outcome.skippedReason)}`;
    } else {
        const errors = outcome.totals.errors > 0 ? `, ${outcome.totals.errors} error${outcome.totals.errors === 1 ? '' : 's'}` : '';
        description = `${outcome.totals.accountsTouched} account${outcome.totals.accountsTouched === 1 ? '' : 's'}, `
            + `${outcome.totals.providerCalls.toLocaleString()} API calls, `
            + `${outcome.totals.rowsWritten.toLocaleString()} rows${errors}.`;
    }
    return description;
}

/**
 * Render the per-source walk status line under an in-progress account's status
 * badge: a check for an exhausted walk, an ellipsis for one still descending.
 */
function describeSources(flags: IAccountHistorySourceFlags): string {
    const mark = (done: boolean) => (done ? '✓' : '…');
    return `tx ${mark(flags.tx)} · trc20 ${mark(flags.trc20)} · internal ${mark(flags.internal)}`;
}

/**
 * Name the source walks currently mid-drain in forward sync, for the catching-up
 * detail line (e.g. `draining trc20`).
 */
function describeDraining(flags: IAccountHistorySourceFlags): string {
    const names = (['tx', 'trc20', 'internal'] as const).filter((source) => flags[source]);
    return names.length > 0 ? `draining ${names.join(' + ')}` : '';
}

/**
 * Map a backfill status to a Badge tone so an operator reads progress at a glance.
 *
 * @param status - The account's ingestion status.
 * @returns The Badge tone.
 */
function statusTone(status: AccountIngestionStatus): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
    switch (status) {
        case 'complete': return 'success';
        case 'failed': return 'danger';
        case 'running': return 'warning';
        case 'paused': return 'neutral';
        default: return 'info';
    }
}

/**
 * Tracked-accounts tab content.
 *
 * @param props.stats - The current stats snapshot, or null before first load.
 * @param props.onChanged - Called after a mutation so the page refetches stats.
 * @returns The tab.
 */
export function AccountsTab({ stats, onChanged }: { stats: IAccountHistoryStatsView | null; onChanged: () => void }) {
    // Null rather than '' because AddressSelector only ever hands back a
    // validated address or nothing — there is no partial value to hold.
    const [address, setAddress] = useState<string | null>(null);
    const [label, setLabel] = useState('');
    const [busy, setBusy] = useState(false);
    const { push } = useToast();

    /**
     * Start tracking the selected address, then clear the form so the next
     * address can be entered straight away. The page refetches stats through
     * `onChanged`, which is what makes the new row appear.
     */
    const add = useCallback(async () => {
        setBusy(true);
        try {
            await addTrackedAccount(address ?? '', label.trim() || undefined);
            setAddress(null);
            setLabel('');
            push({ tone: 'success', title: 'Account tracked' });
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to add account', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusy(false);
        }
    }, [address, label, onChanged, push]);

    /**
     * Stop tracking one account. The toast says the stored history stays,
     * because an operator removing a row may expect it to be deleted.
     *
     * @param addr - Base58 address to stop tracking.
     */
    const remove = useCallback(async (addr: string) => {
        try {
            await removeTrackedAccount(addr);
            push({ tone: 'info', title: 'Account removed', description: 'Stored history is retained.' });
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to remove account', description: err instanceof Error ? err.message : String(err) });
        }
    }, [onChanged, push]);

    /**
     * Purge all stored history for one account and requeue its backfill, after
     * an explicit confirmation — the delete is irreversible and the re-ingest
     * costs real TronGrid budget, so a stray click must not trigger it.
     *
     * @param addr - Base58 address whose history to reset.
     */
    const reset = useCallback(async (addr: string) => {
        const confirmed = window.confirm(
            `Delete ALL stored history for ${addr} and re-ingest from scratch?\n\n` +
            'This removes the account\'s transactions, value ledger, and balance snapshots, ' +
            'then requeues the backfill to start fresh. This cannot be undone.'
        );
        if (!confirmed) {
            return;
        }
        try {
            await resetAccountHistory(addr);
            push({ tone: 'success', title: 'Account history reset', description: 'Stored history purged — backfill requeued from scratch.' });
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to reset account history', description: err instanceof Error ? err.message : String(err) });
        }
    }, [onChanged, push]);

    /**
     * Pause or resume one account's ingestion while keeping its cursors, so a
     * resumed account carries on from where it stopped.
     *
     * @param addr - Base58 address to change.
     * @param paused - True to pause, false to resume.
     */
    const togglePause = useCallback(async (addr: string, paused: boolean) => {
        try {
            await setAccountPaused(addr, paused);
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to update account', description: err instanceof Error ? err.message : String(err) });
        }
    }, [onChanged, push]);

    /**
     * Run one backfill tick now instead of waiting for its schedule, and
     * report in a toast what the tick did.
     */
    const runNow = useCallback(async () => {
        try {
            const outcome = await runIngestion();
            push({
                tone: outcome.skippedReason || outcome.totals.errors > 0 ? 'info' : 'success',
                title: 'Backfill tick finished',
                description: describeOutcome(outcome)
            });
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to run ingestion', description: err instanceof Error ? err.message : String(err) });
        }
    }, [push]);

    /**
     * Run one forward-sync tick now, so completed accounts pick up new
     * transactions without waiting for the schedule, and report the outcome.
     */
    const runForwardNow = useCallback(async () => {
        try {
            const outcome = await runForwardSync();
            push({
                tone: outcome.skippedReason || outcome.totals.errors > 0 ? 'info' : 'success',
                title: 'Forward-sync tick finished',
                description: describeOutcome(outcome)
            });
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to run forward sync', description: err instanceof Error ? err.message : String(err) });
        }
    }, [push]);

    const accounts = stats?.accounts ?? [];
    const totals = stats?.totals;

    return (
        <Panel
            title="Tracked accounts"
            actions={(
                <>
                    <Button variant="secondary" icon={<Play size={16} />} onClick={() => { void runNow(); }}>
                        Run backfill
                    </Button>
                    <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={() => { void runForwardNow(); }}>
                        Run forward sync
                    </Button>
                </>
            )}
        >
            {totals && (
                <StatGrid size="sm">
                    <StatTile
                        size="sm"
                        surface={false}
                        label="Tracked"
                        value={totals.trackedAccounts.toLocaleString()}
                        note={`${totals.snapshottedTodayAccounts.toLocaleString()} snapshotted today`}
                    />
                    <StatTile size="sm" surface={false} label="Rows stored" value={totals.rowsIngested.toLocaleString()} />
                    <StatTile size="sm" surface={false} label="Complete" value={totals.completeAccounts.toLocaleString()} />
                    <StatTile
                        size="sm"
                        surface={false}
                        label="Catching up"
                        value={totals.catchingUpAccounts.toLocaleString()}
                        note="Forward sync draining a backlog"
                        tone={totals.catchingUpAccounts > 0 ? 'warning' : 'neutral'}
                    />
                    <StatTile
                        size="sm"
                        surface={false}
                        label="Failed"
                        value={totals.failedAccounts.toLocaleString()}
                        tone={totals.failedAccounts > 0 ? 'danger' : 'neutral'}
                    />
                    <StatTile
                        size="sm"
                        surface={false}
                        label="Current to"
                        value={<ClientTime date={totals.oldestNewestTimestamp} format="relative" />}
                        note="Least current complete account"
                    />
                </StatGrid>
            )}

            <div className={styles.add_form}>
                <div className={styles.add_form__address}>
                    <AddressSelector
                        value={address}
                        onChange={setAddress}
                        aria-label="Account address to track"
                        disabled={busy}
                    />
                </div>
                <Input
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Label (optional)"
                    aria-label="Account label"
                    disabled={busy}
                    className={styles.add_form__label}
                />
                <Button variant="primary" icon={<Plus size={16} />} loading={busy} disabled={!address} onClick={() => { void add(); }}>
                    Track
                </Button>
            </div>

            {accounts.length === 0
                ? <p className="text-muted">No accounts tracked yet.</p>
                : (
                    /* Eight columns need about 1,250px, more than a tablet's
                       976px content column, so each account stacks into an
                       entry headed by its address and label, with its buttons
                       on the entry's last line. */
                        <Table flush stackAt="tablet">
                            <Thead>
                                <Tr>
                                    <Th>Account</Th>
                                    <Th width="shrink">Status</Th>
                                    <Th width="shrink" numeric>Rows</Th>
                                    <Th width="shrink">Oldest reached</Th>
                                    <Th width="shrink">Newest tx</Th>
                                    <Th width="shrink">Snapshot</Th>
                                    <Th width="shrink">Last run</Th>
                                    <Th width="shrink">Actions</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {accounts.map(({ account, progress }) => (
                                    <Tr key={account.address} hasError={progress.status === 'failed'}>
                                        <Td>
                                            <div className={styles.account_identity}>
                                                <TronAddress address={account.address} />
                                                {account.label && <span className={styles.account_label}>{account.label}</span>}
                                            </div>
                                            {/* One line, with the full message in the
                                                tooltip and on the Activity and Logs
                                                tabs, so a long TronGrid error does not
                                                make its row four lines tall. */}
                                            {progress.lastError && (
                                                <div className={styles.account_error} title={progress.lastError}>
                                                    {progress.lastError}
                                                </div>
                                            )}
                                        </Td>
                                        <Td label="Status">
                                            <div className={styles.badge_stack}>
                                                <Badge tone={statusTone(progress.status)}>{account.paused ? 'paused' : progress.status}</Badge>
                                                {progress.catchingUp && !account.paused && <Badge tone="warning">catching up</Badge>}
                                            </div>
                                            {progress.status !== 'complete' && progress.sourcesComplete && (
                                                <div className={styles.source_flags}>{describeSources(progress.sourcesComplete)}</div>
                                            )}
                                            {progress.catchingUp && progress.forwardDraining && describeDraining(progress.forwardDraining) && (
                                                <div className={styles.source_flags}>{describeDraining(progress.forwardDraining)}</div>
                                            )}
                                        </Td>
                                        <Td label="Rows" muted numeric>{progress.rowsIngested.toLocaleString()}</Td>
                                        <Td label="Oldest reached" muted>
                                            {progress.oldestTimestampReached ? <ClientTime date={progress.oldestTimestampReached} format="short" /> : '—'}
                                        </Td>
                                        <Td label="Newest tx" muted>
                                            {progress.newestTimestampSeen ? <ClientTime date={progress.newestTimestampSeen} format="relative" /> : '—'}
                                        </Td>
                                        <Td label="Snapshot" muted>
                                            {/* A bare UTC day, not a timestamp — rendered verbatim, so no
                                                ClientTime is needed and server/client HTML always match. */}
                                            {progress.lastSnapshotDay ?? '—'}
                                        </Td>
                                        <Td label="Last run" muted>
                                            {progress.lastRunAt ? <ClientTime date={progress.lastRunAt} format="short" /> : '—'}
                                            {progress.lastForwardRunAt && (
                                                <div className={styles.forward_run}>
                                                    refreshed <ClientTime date={progress.lastForwardRunAt} format="relative" />
                                                </div>
                                            )}
                                        </Td>
                                        <Td>
                                            {/* Icon-only actions, each named by its aria-label and
                                                hover title, so the three fit on one line in the
                                                row's shrink column instead of widening the table
                                                past its card. */}
                                            <div className={styles.row_actions}>
                                                <IconButton
                                                    onClick={() => { void togglePause(account.address, !account.paused); }}
                                                    aria-label={account.paused ? 'Resume account' : 'Pause account'}
                                                    title={account.paused ? 'Resume' : 'Pause'}
                                                >
                                                    {account.paused ? <PlayCircle size={16} /> : <Pause size={16} />}
                                                </IconButton>
                                                <IconButton
                                                    onClick={() => { void reset(account.address); }}
                                                    aria-label="Reset account history"
                                                    title="Reset"
                                                >
                                                    <RotateCcw size={16} />
                                                </IconButton>
                                                <IconButton
                                                    variant="danger"
                                                    onClick={() => { void remove(account.address); }}
                                                    aria-label="Remove account"
                                                    title="Remove"
                                                >
                                                    <Trash2 size={16} />
                                                </IconButton>
                                            </div>
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                )}
        </Panel>
    );
}
