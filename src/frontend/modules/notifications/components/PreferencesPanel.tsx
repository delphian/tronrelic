'use client';

import { useCallback, useEffect, useState } from 'react';
import type { INotificationCategory, INotificationChannelInfo, INotificationPreferences } from '@/types';
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
            <label className={styles.mute_row}>
                <input
                    type="checkbox"
                    checked={muted}
                    disabled={saving}
                    onChange={(e) => void onToggleMute(e.target.checked)}
                />
                <span>
                    <span className={styles.mute_title}>Mute all notifications</span>
                    <span className={styles.help}>Temporarily silence every notification across all channels.</span>
                </span>
            </label>

            {error && <p className={styles.error} role="alert">{error}</p>}

            {categories.map((category) => (
                <fieldset key={category.id} className={styles.category} disabled={muted}>
                    <legend className={styles.category_legend}>{category.label}</legend>
                    <p className={styles.help}>{category.description}</p>
                    <div className={styles.channels}>
                        {channels
                            .map((ch) => (
                                <label key={ch.id} className={styles.channel_row}>
                                    <input
                                        type="checkbox"
                                        checked={isEnabled(category, ch.id)}
                                        disabled={saving || muted}
                                        onChange={(e) => void onTogglePairing(category.id, ch.id, e.target.checked)}
                                    />
                                    <span>{ch.label}</span>
                                </label>
                            ))}
                    </div>
                </fieldset>
            ))}
        </div>
    );
}
