'use client';

/**
 * @fileoverview Connected apps tab of /system/mcp: every user's OAuth grants,
 * each revocable by an admin.
 */

import { useCallback, useState } from 'react';
import type { IConnectedAppAdminRow } from '@/types';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Stack } from '../../../../components/layout';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { useModal } from '../../../../components/ui/ModalProvider';
import { useToast } from '../../../../components/ui/ToastProvider';
import { ConnectedAppsTable, connectedAppKey, type IConnectedAppRow } from '../../../../modules/user';
import { MCP_APPS_PAGE_SIZE, listMcpApps, revokeMcpApp } from '../../../../modules/mcp';
import styles from './page.module.scss';

/**
 * Props for {@link AppsTab}.
 */
interface IAppsTabProps {
    /** SSR-fetched grants. */
    initialApps: IConnectedAppAdminRow[];
    /** Total grants across all users. */
    initialTotal: number;
}

/**
 * Render the connected apps list.
 *
 * @param props - {@link IAppsTabProps}.
 * @returns The apps panel.
 */
export function AppsTab({ initialApps, initialTotal }: IAppsTabProps) {
    const [apps, setApps] = useState<IConnectedAppAdminRow[]>(initialApps);
    const [total, setTotal] = useState(initialTotal);
    const [revokingKey, setRevokingKey] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const { open, close } = useModal();
    const { push } = useToast();

    /**
     * Fetch the next page of grants and append it, so an admin can reach and
     * revoke grants older than the first page the server rendered.
     *
     * The offset is the number of rows already shown. Revoked rows are gone on
     * the server as well, so they do not shift it. A grant created since the
     * page loaded does shift older rows down by one, which would repeat a row
     * at the page boundary, so rows already present are skipped by key.
     */
    const handleShowMore = useCallback(async (): Promise<void> => {
        setLoadingMore(true);
        try {
            const page = await listMcpApps(MCP_APPS_PAGE_SIZE, apps.length);
            setApps(current => {
                const seen = new Set(current.map(connectedAppKey));
                return [...current, ...page.apps.filter(row => !seen.has(connectedAppKey(row)))];
            });
            setTotal(page.total);
        } catch (error) {
            push({ tone: 'danger', title: 'Could not load more apps', description: error instanceof Error ? error.message : String(error) });
        } finally {
            setLoadingMore(false);
        }
    }, [apps.length, push]);

    /**
     * Revoke one grant after confirmation and drop its row.
     *
     * @param app - The row whose revoke button was pressed.
     */
    const handleRevoke = useCallback((app: IConnectedAppRow): void => {
        const userId = app.userId;
        if (userId) {
            const modalId = open({
                title: 'Revoke connected app',
                content: (
                    <ConfirmDialog
                        label={app.clientName}
                        confirmLabel="Revoke"
                        message={<>Revoke <strong>{app.clientName}</strong> for {app.userEmail ?? userId}? Its tokens stop working at once; the user can reconnect it later if they are still in the MCP group.</>}
                        onConfirm={
                            /**
                             * Revoke the grant once the admin confirms, drop its
                             * row and the total on success, and close the dialog
                             * either way so a failure is reported by toast.
                             */
                            async () => {
                            const key = connectedAppKey(app);
                            setRevokingKey(key);
                            try {
                                await revokeMcpApp(userId, app.clientId);
                                setApps(current => current.filter(row => connectedAppKey(row) !== key));
                                setTotal(current => Math.max(0, current - 1));
                                push({ tone: 'success', title: 'App revoked', description: app.clientName });
                            } catch (error) {
                                push({ tone: 'danger', title: 'Could not revoke app', description: error instanceof Error ? error.message : String(error) });
                            } finally {
                                setRevokingKey(null);
                                close(modalId);
                            }
                        }}
                        onCancel={() => close(modalId)}
                    />
                )
            });
        }
    }, [open, close, push]);

    return (
        <Stack gap="md">
            <p className={styles.intro}>
                Apps members have authorized to act as them. {total > apps.length ? `Showing the newest ${apps.length} of ${total}.` : `${total} in total.`}
                {' '}Removing a user from the MCP group also blocks all their apps within about 30 seconds, without revoking them here.
            </p>
            <Card padding="xs">
                <ConnectedAppsTable
                    apps={apps}
                    showUser
                    onRevoke={handleRevoke}
                    revokingKey={revokingKey}
                    emptyMessage="No apps are connected."
                />
            </Card>
            {total > apps.length && (
                <div>
                    <Button variant="secondary" size="sm" loading={loadingMore} onClick={() => { void handleShowMore(); }}>
                        Show more
                    </Button>
                </div>
            )}
        </Stack>
    );
}
