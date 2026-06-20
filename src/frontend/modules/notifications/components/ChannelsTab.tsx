'use client';

import { useCallback, useEffect, useState } from 'react';
import { getAdminChannels, setAdminChannel, type IAdminChannel } from '../api/notifications.api';
import styles from './admin.module.scss';

/**
 * Admin Channels tab — the global channel kill switches.
 *
 * Lists every registered delivery transport (toast today; email/push later)
 * with a toggle that enables or disables it platform-wide. Disabling a channel
 * suppresses it for every category and every user. Client component behind the
 * admin-gated `/system/notifications` page.
 *
 * @returns The channels admin list.
 */
export function ChannelsTab(): React.ReactElement {
    const [channels, setChannels] = useState<IAdminChannel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(async (): Promise<void> => {
        try {
            setChannels(await getAdminChannels());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load channels');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Toggle a channel's global enable state, updating local rows optimistically.
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

    if (loading) {
        return <p className={styles.placeholder}>Loading channels…</p>;
    }
    if (channels.length === 0) {
        return <p className={styles.placeholder}>No channels registered.</p>;
    }

    return (
        <div className={styles.list}>
            {error && <p className={styles.error} role="alert">{error}</p>}
            {channels.map((channel) => (
                <div key={channel.id} className={styles.row}>
                    <div className={styles.row_main}>
                        <div className={styles.row_title}>{channel.label}</div>
                        <div className={styles.row_desc}>{channel.id}</div>
                    </div>
                    <label className={styles.toggle}>
                        <input
                            type="checkbox"
                            checked={channel.enabled}
                            disabled={busyId === channel.id}
                            onChange={(e) => void onToggle(channel.id, e.target.checked)}
                        />
                        <span>{channel.enabled ? 'Enabled' : 'Disabled'}</span>
                    </label>
                </div>
            ))}
        </div>
    );
}
