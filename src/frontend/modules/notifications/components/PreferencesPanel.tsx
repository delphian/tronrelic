'use client';

/**
 * @fileoverview Per-user notification preferences, drawn as one matrix.
 *
 * Categories run down the side and channels across the top, with one checkbox
 * per (category, channel) pair, because that pair is the unit the dispatch
 * pipeline opts a user out of. A new channel therefore arrives as a new column
 * rather than a new block of controls. A single switch above the matrix mutes
 * everything without discarding the per-pair choices.
 */

import { useCallback, useEffect, useState } from 'react';
import type { INotificationCategory, INotificationChannelInfo, INotificationPreferences } from '@/types';
import { Switch } from '../../../components/ui/Switch';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../components/ui/Table';
import { getMyPreferences, updateMyPreferences } from '../api/notifications.api';
import styles from './PreferencesPanel.module.scss';

/**
 * Per-user notification opt-out matrix.
 *
 * Lets any signed-in user mute everything, or silence specific (category,
 * channel) pairings. Enforcement is server-side — this panel only records the
 * user's choices, which the dispatch pipeline reads before delivering. Used both
 * as the admin "My Preferences" tab and the standalone `/account/notifications`
 * page, so it owns its own data loading rather than taking props.
 *
 * @returns The preferences matrix, or a status placeholder while loading/empty.
 */
export function PreferencesPanel(): React.ReactElement {
    const [preferences, setPreferences] = useState<INotificationPreferences | null>(null);
    const [categories, setCategories] = useState<INotificationCategory[]>([]);
    const [channels, setChannels] = useState<INotificationChannelInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const bundle = await getMyPreferences();
                if (cancelled) {
                    return;
                }
                setPreferences(bundle.preferences);
                setCategories(bundle.categories);
                setChannels(bundle.channels);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Failed to load preferences');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * Effective opt-in state for a (category, channel) pair: the user's override
     * when set, otherwise the category's channel default.
     *
     * @param category - The category.
     * @param channelId - The channel id.
     * @returns Whether this pairing currently delivers to the user.
     */
    const isEnabled = useCallback(
        (category: INotificationCategory, channelId: string): boolean => {
            const override = preferences?.overrides?.[category.id]?.[channelId];
            if (override !== undefined) {
                return override;
            }
            return category.channelDefaults[channelId] ?? false;
        },
        [preferences]
    );

    /**
     * Persist the global-mute toggle, updating local state optimistically.
     *
     * @param mutedAll - The new mute state.
     */
    const onToggleMute = useCallback(async (mutedAll: boolean): Promise<void> => {
        setSaving(true);
        setError(null);
        try {
            const updated = await updateMyPreferences({ mutedAll });
            setPreferences(updated);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    }, []);

    /**
     * Persist a single (category, channel) override.
     *
     * @param categoryId - The category id.
     * @param channelId - The channel id.
     * @param enabled - The new pairing state.
     */
    const onTogglePairing = useCallback(async (categoryId: string, channelId: string, enabled: boolean): Promise<void> => {
        setSaving(true);
        setError(null);
        try {
            const updated = await updateMyPreferences({ overrides: { [categoryId]: { [channelId]: enabled } } });
            setPreferences(updated);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    }, []);

    if (loading) {
        return <p className={styles.placeholder}>Loading preferences…</p>;
    }
    if (error && !preferences) {
        return <p className={styles.placeholder}>{error}</p>;
    }
    if (categories.length === 0) {
        return <p className={styles.placeholder}>No configurable notifications yet.</p>;
    }

    const muted = preferences?.mutedAll ?? false;

    return (
        <div className={styles.panel}>
            <div className={styles.mute_row}>
                <Switch
                    size="sm"
                    on={muted}
                    disabled={saving}
                    onChange={(next) => void onToggleMute(next)}
                    aria-label="Mute all notifications"
                />
                <span className={styles.mute_title}>Mute all</span>
                <span className={styles.help}>Silences every channel. Your choices below are kept.</span>
            </div>

            {error && <p className={styles.error} role="alert">{error}</p>}

            <Table variant="compact" className={muted ? `${styles.matrix} ${styles.matrix_muted}` : styles.matrix}>
                <Thead>
                    <Tr>
                        <Th width="expand">Category</Th>
                        {channels.map((ch) => (
                            <Th key={ch.id} className={styles.cell_check}>{ch.label}</Th>
                        ))}
                    </Tr>
                </Thead>
                <Tbody>
                    {categories.map((category) => (
                        <Tr key={category.id}>
                            <Td>
                                <div className={styles.category_label}>{category.label}</div>
                                {category.description && (
                                    <div className={styles.category_desc}>{category.description}</div>
                                )}
                            </Td>
                            {channels.map((ch) => (
                                <Td key={ch.id} className={styles.cell_check}>
                                    <input
                                        type="checkbox"
                                        checked={isEnabled(category, ch.id)}
                                        disabled={saving || muted}
                                        onChange={(e) => void onTogglePairing(category.id, ch.id, e.target.checked)}
                                        aria-label={`${category.label} by ${ch.label}`}
                                    />
                                </Td>
                            ))}
                        </Tr>
                    ))}
                </Tbody>
            </Table>
        </div>
    );
}
