'use client';

/**
 * @fileoverview The Changes view of a managed ClickHouse account: every admin
 * action recorded against it, newest first.
 *
 * This is the account's accountability record. Each entry says who acted,
 * when, what changed, why they said they changed it, and whether ClickHouse
 * accepted it. A refused change is listed too, because an attempt to raise a
 * limit that failed is still something the next admin should be able to see.
 */

import { useCallback, useEffect, useState } from 'react';
import type { IClickHouseAccountAuditEntry, IClickHouseAccountLimits } from '@/types';
import { Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../../../components/ui/Table';
import { listClickHouseAccountAudit } from '../../api/client';
import { LIMIT_FIELDS } from '../../lib/limitFields';
import styles from './ChangesView.module.scss';

/**
 * Props for the Changes view.
 */
interface IChangesViewProps {
    /** Account whose audit trail to show. */
    accountId: string;
    /**
     * Changes whenever the parent saves or applies the account, so the list
     * reloads and the admin sees their own action appear.
     */
    refreshKey: number;
}

/**
 * Describe what one audit entry did, in plain words.
 *
 * A limit change lists each field that moved as "label: before → after",
 * using the same names and units as the gauges.
 *
 * @param entry - The audit entry.
 * @returns One line per change.
 */
function describe(entry: IClickHouseAccountAuditEntry): string[] {
    let lines: string[];
    if (entry.action === 'update-limits' && entry.before && entry.after) {
        const before = entry.before as IClickHouseAccountLimits;
        const after = entry.after as IClickHouseAccountLimits;
        lines = LIMIT_FIELDS
            .filter(field => before[field.key] !== after[field.key])
            .map(field => `${field.label}: ${field.format(before[field.key])} → ${field.format(after[field.key])}`);
    } else if (entry.action === 'apply') {
        lines = ['Applied the account to ClickHouse again'];
    } else {
        lines = [`Stopped query ${entry.detail ?? ''}`.trim()];
    }

    return lines;
}

/**
 * List the admin actions recorded against an account.
 *
 * @param props - The account and a key that reloads the list.
 * @returns The Changes view.
 */
export function ChangesView({ accountId, refreshKey }: IChangesViewProps) {
    const [entries, setEntries] = useState<IClickHouseAccountAuditEntry[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    /**
     * Load the audit trail.
     */
    const load = useCallback(async () => {
        try {
            setEntries(await listClickHouseAccountAudit(accountId));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [accountId]);

    useEffect(() => {
        void load();
    }, [load, refreshKey]);

    return (
        <Stack gap="md">
            {error && <p className="alert" role="alert">{error}</p>}
            {entries !== null && entries.length === 0 && (
                <p className={styles.empty}>No admin has changed this account yet. It is running on the limits set in code.</p>
            )}
            {entries !== null && entries.length > 0 && (
                <div className={styles.scroll}>
                    <Table variant="compact">
                        <Thead>
                            <Tr>
                                <Th>When</Th>
                                <Th>Admin</Th>
                                <Th>What changed</Th>
                                <Th>Reason</Th>
                                <Th>Result</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {entries.map(entry => (
                                <Tr key={`${entry.at}-${entry.action}`} hasError={!entry.succeeded}>
                                    <Td><ClientTime date={entry.at} format="datetime" /></Td>
                                    <Td><code className={styles.actor}>{entry.actorId}</code></Td>
                                    <Td>
                                        <ul className={styles.lines}>
                                            {describe(entry).map(line => <li key={line}>{line}</li>)}
                                        </ul>
                                    </Td>
                                    <Td>{entry.reason ?? <span className={styles.none}>None given</span>}</Td>
                                    <Td>
                                        {entry.succeeded
                                            ? <Badge tone="success" size="xs">Done</Badge>
                                            : <Badge tone="danger" size="xs">Refused</Badge>}
                                        {!entry.succeeded && entry.detail && <span className={styles.detail}>{entry.detail}</span>}
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
