'use client';

/**
 * @fileoverview The profile's Connected apps tab: the AI clients and other
 * apps the user has let act on their behalf, each revocable.
 *
 * Renders from the SSR-fetched list, so the tab paints immediately, and
 * removes a row locally once its revocation succeeds.
 */

import { useCallback, useState } from 'react';
import type { IConnectedApp } from '@/types';
import { Card } from '../../../../components/ui/Card';
import { Stack } from '../../../../components/layout';
import { useModal } from '../../../../components/ui/ModalProvider';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { useToast } from '../../../../components/ui/ToastProvider';
import { revokeConnectedApp } from '../../api/connected-apps.api';
import { ConnectedAppsTable, connectedAppKey, type IConnectedAppRow } from '../ConnectedAppsTable';

/**
 * Props for {@link ConnectedAppsPanel}.
 */
export interface IConnectedAppsPanelProps {
    /** The user's connected apps, fetched during server rendering. */
    initialApps: IConnectedApp[];
}

/**
 * Connected apps tab body.
 *
 * @param props - {@link IConnectedAppsPanelProps}.
 * @returns The explanation and the table of apps.
 */
export function ConnectedAppsPanel({ initialApps }: IConnectedAppsPanelProps) {
    const [apps, setApps] = useState<IConnectedApp[]>(initialApps);
    const [revokingKey, setRevokingKey] = useState<string | null>(null);
    const { open, close } = useModal();
    const { push } = useToast();

    /**
     * Revoke one app after the user confirms, then drop its row.
     *
     * Confirmation matters because revocation is immediate: the app loses
     * access on its next request and the user has to sign in from it again to
     * reconnect.
     *
     * @param app - The row whose revoke button was pressed.
     */
    const handleRevoke = useCallback((app: IConnectedAppRow): void => {
        const modalId = open({
            title: 'Revoke connected app',
            content: (
                <ConfirmDialog
                    label={app.clientName}
                    confirmLabel="Revoke"
                    message={<><strong>{app.clientName}</strong> will lose access to TronRelic on its next request. To use it again you will need to reconnect it.</>}
                    onConfirm={
                        /**
                         * Revoke the app once the user confirms, drop its row on
                         * success, and close the dialog either way so a failure
                         * is reported by toast rather than a stuck dialog.
                         */
                        async () => {
                        const key = connectedAppKey(app);
                        setRevokingKey(key);
                        try {
                            await revokeConnectedApp(app.clientId);
                            setApps(current => current.filter(item => item.clientId !== app.clientId));
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
    }, [open, close, push]);

    return (
        <Stack gap="sm">
            <h2>Connected apps</h2>
            <p className="text-muted">
                Apps you have allowed to use TronRelic as you, such as an AI assistant connected over MCP.
                Revoke any you no longer use or do not recognise.
            </p>
            <Card padding="xs">
                <ConnectedAppsTable
                    apps={apps}
                    onRevoke={handleRevoke}
                    revokingKey={revokingKey}
                    emptyMessage="You have not connected any apps."
                />
            </Card>
        </Stack>
    );
}
