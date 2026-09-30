'use client';

/**
 * @fileoverview Table of OAuth-connected apps with a revoke action per row.
 *
 * Shared by the user's own profile tab and the admin page on `/system/mcp`,
 * which adds a user column. An app's name is its own claim, so each row also
 * shows the host sign-in results go to, flagging apps that send them only to
 * this computer.
 */

import { Unplug } from 'lucide-react';
import type { IConnectedApp, IConnectedAppAdminRow } from '@/types';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { displayHost } from '../../lib/displayHost';
import styles from './ConnectedAppsTable.module.scss';

/**
 * A connected app row, optionally carrying the user it belongs to. The user
 * fields come from {@link IConnectedAppAdminRow}, made optional because the
 * profile view lists only the signed-in user's own apps and has no user column.
 */
export type IConnectedAppRow = IConnectedApp & Partial<Pick<IConnectedAppAdminRow, 'userId' | 'userEmail'>>;

/**
 * Props for {@link ConnectedAppsTable}.
 */
export interface IConnectedAppsTableProps {
    /** Rows to show, already ordered. */
    apps: IConnectedAppRow[];

    /** Show the user column (admin view). */
    showUser?: boolean;

    /** Called when the revoke button of a row is pressed. */
    onRevoke: (app: IConnectedAppRow) => void;

    /** Key of the row currently being revoked, to show its button as busy. */
    revokingKey?: string | null;

    /** Text shown when there are no rows. */
    emptyMessage: string;
}

/**
 * Build a stable key for a row: one user's grant to one app.
 *
 * @param app - The row.
 * @returns A key unique per user and client.
 */
export function connectedAppKey(app: IConnectedAppRow): string {
    return `${app.userId ?? 'me'}::${app.clientId}`;
}

/**
 * Render the connected-apps table.
 *
 * @param props - {@link IConnectedAppsTableProps}.
 * @returns The table, or the empty message when there are no rows.
 */
export function ConnectedAppsTable({ apps, showUser = false, onRevoke, revokingKey, emptyMessage }: IConnectedAppsTableProps) {
    return apps.length === 0 ? (
        <p className={styles.empty}>{emptyMessage}</p>
    ) : (
        <Table flush className={styles.table}>
            <Thead>
                <Tr>
                    <Th>App</Th>
                    {showUser && <Th>User</Th>}
                    <Th>Sends sign-in to</Th>
                    <Th>Access</Th>
                    <Th>Connected</Th>
                    <Th>Last used</Th>
                    <Th><span className={styles.visually_hidden}>Actions</span></Th>
                </Tr>
            </Thead>
            <Tbody>
                {apps.map(app => {
                    const key = connectedAppKey(app);
                    return (
                        <Tr key={key}>
                            <Td data-label="App">
                                <div className={styles.app_name}>{app.clientName}</div>
                                <div className={styles.app_meta}>
                                    {app.clientUri ? displayHost(app.clientUri) : displayHost(app.clientId)}
                                </div>
                            </Td>
                            {showUser && (
                                <Td data-label="User" muted>{app.userEmail ?? app.userId}</Td>
                            )}
                            <Td data-label="Sends sign-in to">
                                <div className={styles.badge_row}>
                                    {app.redirectHosts.map(host => (
                                        <Badge key={host} tone="neutral" size="sm">{host}</Badge>
                                    ))}
                                    {app.loopbackOnly && <Badge tone="info" size="sm">This computer only</Badge>}
                                </div>
                            </Td>
                            <Td data-label="Access">
                                <div className={styles.badge_row}>
                                    {app.scopes.map(scope => (
                                        <Badge key={scope} tone="neutral" size="sm">{scope}</Badge>
                                    ))}
                                </div>
                            </Td>
                            <Td data-label="Connected" muted><ClientTime date={app.grantedAt} format="date" /></Td>
                            <Td data-label="Last used" muted><ClientTime date={app.lastUsedAt} format="relative" fallback="Never" /></Td>
                            <Td data-label="Actions">
                                <Button
                                    variant="danger"
                                    size="sm"
                                    icon={<Unplug size={16} aria-hidden />}
                                    loading={revokingKey === key}
                                    onClick={() => onRevoke(app)}
                                    aria-label={`Revoke ${app.clientName}`}
                                >
                                    Revoke
                                </Button>
                            </Td>
                        </Tr>
                    );
                })}
            </Tbody>
        </Table>
    );
}
