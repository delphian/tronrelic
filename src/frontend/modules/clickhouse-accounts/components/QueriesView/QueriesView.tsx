'use client';

/**
 * @fileoverview The Queries view of a ClickHouse account: what it is running
 * now, what it ran recently, and, for a managed account, a way to stop a
 * running query.
 *
 * Running queries refresh every five seconds while the view is open, because
 * the reason to look at them is usually that something is running now. Recent
 * queries come from ClickHouse's query log, which keeps three days, and are
 * loaded on demand. A failure a limit caused is marked separately from other
 * failures, since it points at the limits rather than at the query.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { OctagonX, RefreshCw } from 'lucide-react';
import type { IClickHouseAccountQuery } from '@/types';
import { Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { IconButton } from '../../../../components/ui/IconButton';
import { useModal } from '../../../../components/ui/ModalProvider';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../../../components/ui/Table';
import { useToast } from '../../../../components/ui/ToastProvider';
import { formatBytes } from '../../../../lib/format';
import { killClickHouseAccountQuery, listClickHouseAccountQueries } from '../../api/client';
import { formatCount, formatMilliseconds } from '../../lib/formatQuantity';
import styles from './QueriesView.module.scss';

/** Which queries the view lists. */
type QueryScope = 'running' | 'recent';

const SCOPE_OPTIONS: ReadonlyArray<{ id: QueryScope; label: string }> = [
    { id: 'running', label: 'Running now' },
    { id: 'recent', label: 'Recent' }
];

/** How often running queries refresh while the view is open. */
const RUNNING_REFRESH_MS = 5_000;

/**
 * Props for the Queries view.
 */
interface IQueriesViewProps {
    /** Account whose queries to list. */
    accountId: string;
    /** Display name, used in the stop confirmation. */
    accountLabel: string;
    /**
     * Whether queries can be stopped from here. Only managed accounts allow
     * it: the observed account runs the chain writer's inserts, and stopping
     * one would leave a gap in the chain data.
     */
    canKill: boolean;
}

/**
 * List an account's running or recent queries.
 *
 * @param props - The account and whether its queries can be stopped.
 * @returns The Queries view.
 */
export function QueriesView({ accountId, accountLabel, canKill }: IQueriesViewProps) {
    const { open, close } = useModal();
    const { push } = useToast();
    const [scope, setScope] = useState<QueryScope>('running');
    const [queries, setQueries] = useState<IClickHouseAccountQuery[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    // Sequence number of the latest request, so a slow response for a scope
    // the admin has already left cannot overwrite the list for the new one.
    const latestRequest = useRef(0);

    /**
     * Load the chosen list of queries, ignoring the answer if a newer request
     * has started since, so the list always matches the selected scope.
     */
    const load = useCallback(async () => {
        const request = ++latestRequest.current;
        setRefreshing(true);
        try {
            const result = await listClickHouseAccountQueries(accountId, scope);
            if (request === latestRequest.current) {
                setQueries(result);
                setError(null);
            }
        } catch (err) {
            if (request === latestRequest.current) {
                setError(err instanceof Error ? err.message : String(err));
            }
        } finally {
            if (request === latestRequest.current) {
                setRefreshing(false);
            }
        }
    }, [accountId, scope]);

    useEffect(() => {
        setQueries(null);
        void load();
        let interval: ReturnType<typeof setInterval> | null = null;
        if (scope === 'running') {
            interval = setInterval(() => void load(), RUNNING_REFRESH_MS);
        }
        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [load, scope]);

    /**
     * Ask the admin to confirm, then stop a running query and report whether
     * it was still running.
     *
     * @param query - The running query to stop.
     */
    const confirmKill = (query: IClickHouseAccountQuery) => {
        const id = open({
            title: 'Stop query',
            size: 'sm',
            content: (
                <ConfirmDialog
                    label={`query ${query.queryId}`}
                    confirmLabel="Stop query"
                    message={`ClickHouse will cancel this ${accountLabel} query. Whoever ran it gets an error. The stop is recorded in the account's changes.`}
                    onCancel={() => close(id)}
                    onConfirm={async () => {
                        try {
                            const killed = await killClickHouseAccountQuery(accountId, query.queryId);
                            push(killed
                                ? { tone: 'success', title: 'Query stopped' }
                                : { tone: 'info', title: 'Query had already finished' });
                            await load();
                        } catch (err) {
                            push({ tone: 'danger', title: 'Query not stopped', description: err instanceof Error ? err.message : String(err) });
                        } finally {
                            close(id);
                        }
                    }}
                />
            )
        });
    };

    return (
        <Stack gap="md">
            <div className={styles.toolbar}>
                <SegmentedControl label="Which queries" options={SCOPE_OPTIONS} value={scope} onChange={setScope} />
                <IconButton aria-label="Refresh queries" onClick={() => void load()} disabled={refreshing}>
                    <RefreshCw size={16} aria-hidden="true" />
                </IconButton>
            </div>

            {error && <p className="alert" role="alert">{error}</p>}

            {queries !== null && queries.length === 0 && (
                <p className={styles.empty}>
                    {scope === 'running'
                        ? 'Nothing is running as this account right now. This list refreshes every five seconds.'
                        : 'No queries in the last three days, which is as far back as ClickHouse keeps its query log.'}
                </p>
            )}

            {queries !== null && queries.length > 0 && (
                <div className={styles.scroll}>
                    <Table variant="compact">
                        <Thead>
                            <Tr>
                                <Th>Started</Th>
                                <Th numeric>{scope === 'running' ? 'Running for' : 'Took'}</Th>
                                <Th numeric>Rows scanned</Th>
                                <Th numeric>Data scanned</Th>
                                <Th numeric>Memory</Th>
                                <Th>Result</Th>
                                <Th>Query</Th>
                                {canKill && scope === 'running' && <Th width="shrink" aria-label="Actions" />}
                            </Tr>
                        </Thead>
                        <Tbody>
                            {queries.map(query => (
                                <Tr key={query.queryId} hasError={query.status === 'failed'}>
                                    <Td><ClientTime date={query.startedAt} format="relative" /></Td>
                                    <Td numeric>{formatMilliseconds(query.durationMs)}</Td>
                                    <Td numeric>{formatCount(query.readRows)}</Td>
                                    <Td numeric>{formatBytes(query.readBytes)}</Td>
                                    <Td numeric>{formatBytes(query.memoryBytes)}</Td>
                                    <Td><QueryResult query={query} /></Td>
                                    <Td>
                                        <code className={styles.sql} title={query.sql}>{query.sql}</code>
                                        {query.error && <span className={styles.error}>{query.error}</span>}
                                    </Td>
                                    {canKill && scope === 'running' && (
                                        <Td width="shrink">
                                            <IconButton variant="danger" aria-label={`Stop query ${query.queryId}`} onClick={() => confirmKill(query)}>
                                                <OctagonX size={16} aria-hidden="true" />
                                            </IconButton>
                                        </Td>
                                    )}
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                </div>
            )}
        </Stack>
    );
}

/**
 * The outcome of one query as a badge, naming a limit stop separately from
 * any other failure.
 *
 * @param props - The query.
 * @returns A badge.
 */
function QueryResult({ query }: { query: IClickHouseAccountQuery }) {
    let badge;
    if (query.status === 'running') {
        badge = <Badge tone="info" size="xs" showLiveIndicator>Running</Badge>;
    } else if (query.status === 'finished') {
        badge = <Badge tone="success" size="xs">Finished</Badge>;
    } else if (query.hitLimit) {
        badge = <Badge tone="warning" size="xs">Stopped by a limit</Badge>;
    } else {
        badge = <Badge tone="danger" size="xs">Failed</Badge>;
    }

    return badge;
}
