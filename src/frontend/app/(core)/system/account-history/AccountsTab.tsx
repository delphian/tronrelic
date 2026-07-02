'use client';

/**
 * @fileoverview Tracked-accounts tab for /system/account-history.
 *
 * The control surface a plugin's enable/disable would otherwise provide: add or
 * remove tracked accounts, pause/resume an individual backfill, and watch
 * per-account progress. Stats are owned by the page (fed live off the
 * `account-history:stats` socket event) and passed in; mutations call back via
 * `onChanged` so the page refetches. Like the sibling system surfaces this is an
 * admin client surface, not SSR-first public content.
 */

import { useState, useCallback } from 'react';
import { Plus, Play, Trash2, Pause, PlayCircle, RefreshCw } from 'lucide-react';
import { Stack } from '../../../../components/layout';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { Input } from '../../../../components/ui/Input';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { useToast } from '../../../../components/ui/ToastProvider';
import {
    addTrackedAccount,
    removeTrackedAccount,
    setAccountPaused,
    runIngestion,
    runForwardSync,
    type IAccountHistoryStatsView,
    type AccountIngestionStatus
} from '../../../../modules/account-history';
import styles from './page.module.scss';

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
    const [address, setAddress] = useState('');
    const [label, setLabel] = useState('');
    const [busy, setBusy] = useState(false);
    const { push } = useToast();

    const add = useCallback(async () => {
        setBusy(true);
        try {
            await addTrackedAccount(address.trim(), label.trim() || undefined);
            setAddress('');
            setLabel('');
            push({ tone: 'success', title: 'Account tracked' });
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to add account', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusy(false);
        }
    }, [address, label, onChanged, push]);

    const remove = useCallback(async (addr: string) => {
        try {
            await removeTrackedAccount(addr);
            push({ tone: 'info', title: 'Account removed', description: 'Stored history is retained.' });
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to remove account', description: err instanceof Error ? err.message : String(err) });
        }
    }, [onChanged, push]);

    const togglePause = useCallback(async (addr: string, paused: boolean) => {
        try {
            await setAccountPaused(addr, paused);
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to update account', description: err instanceof Error ? err.message : String(err) });
        }
    }, [onChanged, push]);

    const runNow = useCallback(async () => {
        try {
            await runIngestion();
            push({ tone: 'success', title: 'Backfill tick started' });
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to run ingestion', description: err instanceof Error ? err.message : String(err) });
        }
    }, [push]);

    const runForwardNow = useCallback(async () => {
        try {
            await runForwardSync();
            push({ tone: 'success', title: 'Forward-sync tick started', description: 'Refreshing completed accounts with new transactions.' });
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to run forward sync', description: err instanceof Error ? err.message : String(err) });
        }
    }, [push]);

    const accounts = stats?.accounts ?? [];

    return (
        <Stack gap="md">
            <div className={styles.toolbar}>
                <Input
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="TRON address (T...)"
                    aria-label="Account address to track"
                    disabled={busy}
                />
                <Input
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Label (optional)"
                    aria-label="Account label"
                    disabled={busy}
                />
                <Button variant="primary" size="sm" loading={busy} disabled={!address.trim()} onClick={() => { void add(); }}>
                    <Plus size={16} /> Track
                </Button>
                <Button variant="secondary" size="sm" onClick={() => { void runNow(); }}>
                    <Play size={16} /> Run backfill
                </Button>
                <Button variant="secondary" size="sm" onClick={() => { void runForwardNow(); }}>
                    <RefreshCw size={16} /> Run forward sync
                </Button>
            </div>

            <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-body-sm)' }}>
                Backfill walks each account&apos;s full history newest-first, bounded per tick — no percentage, since the total count is
                unknown until the walk ends. Once complete, forward sync keeps the account current: &ldquo;Newest tx&rdquo; is the latest
                transaction stored, and a <em>catching up</em> tag means forward sync is still draining a backlog larger than one tick.
            </p>

            {accounts.length === 0
                ? <div className="text-muted">No accounts tracked yet.</div>
                : (
                    <div className="table-scroll">
                        <Table>
                            <Thead>
                                <Tr>
                                    <Th>Account</Th>
                                    <Th width="shrink">Status</Th>
                                    <Th width="shrink">Rows</Th>
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
                                        <Td data-label="Account">
                                            <div className={styles.account_addr}>{account.label ?? account.address}</div>
                                            {account.label && <div className="text-muted">{account.address}</div>}
                                            {progress.lastError && <div className={styles.account_error}>{progress.lastError}</div>}
                                        </Td>
                                        <Td data-label="Status">
                                            <div className={styles.badge_stack}>
                                                <Badge tone={statusTone(progress.status)}>{account.paused ? 'paused' : progress.status}</Badge>
                                                {progress.catchingUp && !account.paused && <Badge tone="warning">catching up</Badge>}
                                            </div>
                                        </Td>
                                        <Td data-label="Rows" muted>{progress.rowsIngested.toLocaleString()}</Td>
                                        <Td data-label="Oldest reached" muted>
                                            {progress.oldestTimestampReached ? <ClientTime date={progress.oldestTimestampReached} format="datetime" /> : '—'}
                                        </Td>
                                        <Td data-label="Newest tx" muted>
                                            {progress.newestTimestampSeen ? <ClientTime date={progress.newestTimestampSeen} format="relative" /> : '—'}
                                        </Td>
                                        <Td data-label="Snapshot" muted>
                                            {/* A bare UTC day, not a timestamp — rendered verbatim, so no
                                                ClientTime is needed and server/client HTML always match. */}
                                            {progress.lastSnapshotDay ?? '—'}
                                        </Td>
                                        <Td data-label="Last run" muted>
                                            {progress.lastRunAt ? <ClientTime date={progress.lastRunAt} format="datetime" /> : '—'}
                                            {progress.lastForwardRunAt && (
                                                <div className={styles.forward_run}>
                                                    refreshed <ClientTime date={progress.lastForwardRunAt} format="relative" />
                                                </div>
                                            )}
                                        </Td>
                                        <Td data-label="Actions">
                                            <div className={styles.row_actions}>
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    onClick={() => { void togglePause(account.address, !account.paused); }}
                                                    aria-label={account.paused ? 'Resume account' : 'Pause account'}
                                                >
                                                    {account.paused ? <PlayCircle size={14} /> : <Pause size={14} />}
                                                    {account.paused ? 'Resume' : 'Pause'}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    onClick={() => { void remove(account.address); }}
                                                    aria-label="Remove account"
                                                >
                                                    <Trash2 size={14} /> Remove
                                                </Button>
                                            </div>
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </div>
                )}
        </Stack>
    );
}
