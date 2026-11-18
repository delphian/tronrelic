'use client';

/**
 * @fileoverview Channels tab of /system/notifications: the global switch for
 * every registered delivery transport (toast today; email and push later).
 *
 * Drawn as the same compact table in a panel as the Categories tab, with the
 * switch beside each channel's name. The channel id is an internal key, so it
 * appears only as the name's hover text. Switching a channel off suppresses it
 * for every category and every user. Client component behind the admin-gated
 * page.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Panel } from '../../../components/ui/Panel';
import { Switch } from '../../../components/ui/Switch';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../components/ui/Table';
import { getAdminChannels, setAdminChannel, type IAdminChannel } from '../api/notifications.api';
import { RowLabel } from './RowLabel';
import styles from './admin.module.scss';

/** What the switches do, stated once beside the panel title. */
const PANEL_META = 'Switching a channel off stops it for every category and every user.';

/**
 * Admin Channels tab — the global channel kill switches.
 *
 * @returns The channels panel.
 */
export function ChannelsTab(): React.ReactElement {
    const [channels, setChannels] = useState<IAdminChannel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    /** Read every registered channel with its current enable state. */
    const load = useCallback(async (): Promise<void> => {
        try {
            setChannels(await getAdminChannels());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load channels');
        } finally {
            setLoading(false);
        }
    }, []);

    /** Load the channels once the tab opens. */
    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Toggle a channel's global enable state, updating the row once the
     * server accepts the change.
     *
     * @param id - Channel id.
     * @param enabled - New enable state.
     */
    const onToggle = useCallback(async (id: string, enabled: boolean): Promise<void> => {
        setBusyId(id);
        setError(null);
        try {
            await setAdminChannel(id, enabled);
            setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, enabled } : c)));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update channel');
        } finally {
            setBusyId(null);
        }
    }, []);

    let content: ReactNode;
    if (loading) {
        content = <p className={styles.placeholder}>Loading channels…</p>;
    } else if (channels.length === 0) {
        content = <p className={styles.placeholder}>No channels registered.</p>;
    } else {
        content = (
            <Table variant="compact" flush>
                <Thead>
                    <Tr>
                        <Th>Channel</Th>
                    </Tr>
                </Thead>
                <Tbody>
                    {channels.map((channel) => (
                        <Tr key={channel.id}>
                            <Td>
                                <div className={`${styles.toggle_label} ${styles.toggle_label_single}`}>
                                    <Switch
                                        size="sm"
                                        on={channel.enabled}
                                        disabled={busyId === channel.id}
                                        onChange={(next) => void onToggle(channel.id, next)}
                                        aria-label={`${channel.label} for everyone`}
                                    />
                                    <RowLabel name={channel.label} nameTitle={`Channel id: ${channel.id}`} />
                                </div>
                            </Td>
                        </Tr>
                    ))}
                </Tbody>
            </Table>
        );
    }

    return (
        <Panel title="Channels" meta={PANEL_META}>
            {error && <p className={styles.error} role="alert">{error}</p>}
            {content}
        </Panel>
    );
}
