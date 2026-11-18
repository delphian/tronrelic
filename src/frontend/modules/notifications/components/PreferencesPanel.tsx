'use client';

/**
 * @fileoverview Per-user notification preferences, drawn as one matrix.
 *
 * Categories run down the side and channels across the top, with one switch
 * per (category, channel) pair, because that pair is the unit the dispatch
 * pipeline opts a user out of. A new channel therefore arrives as a new column
 * rather than a new block of controls. A "Mute all" switch silences everything
 * without discarding the per-pair choices.
 *
 * The matrix renders on two hosts. The admin "My Preferences" tab asks it to
 * draw its own titled panel, with "Mute all" in the panel header. `/profile`
 * already wraps it in a panel of its own, so there it draws no second panel
 * and puts "Mute all" on a line above the matrix. Either way the table runs
 * to the edges of the panel holding it.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { INotificationCategory, INotificationChannelInfo, INotificationPreferences } from '@/types';
import { Panel } from '../../../components/ui/Panel';
import { Switch } from '../../../components/ui/Switch';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../components/ui/Table';
import { getMyPreferences, updateMyPreferences } from '../api/notifications.api';
import { RowLabel } from './RowLabel';
import styles from './PreferencesPanel.module.scss';

/** What "Mute all" does, on the line beside the switch where a host draws the panel. */
const MUTE_HELP = 'Silences every channel. Your choices below are kept.';

/**
 * The same explanation as the titled panel's context line. It names the switch
 * because the line comes before the switch, and on a phone sits above it.
 */
const PANEL_META = 'Mute all silences every channel and keeps your choices below.';

/** Props for {@link PreferencesPanel}. */
interface IPreferencesPanelProps {
    /**
     * Title of the panel the matrix draws itself in, with "Mute all" in that
     * panel's header. Leave it out where the host already wraps the matrix in
     * a titled panel, as `/profile` does, so the page does not show a panel
     * inside a panel; "Mute all" then takes a line above the matrix.
     */
    title?: string;
}

/**
 * Per-user notification opt-out matrix.
 *
 * Lets any signed-in user mute everything, or silence specific (category,
 * channel) pairings. Enforcement is server-side — this panel only records the
 * user's choices, which the dispatch pipeline reads before delivering. It owns
 * its data loading rather than taking props, because both hosts render it the
 * same way.
 *
 * @param props - The optional panel title; see {@link IPreferencesPanelProps}.
 * @returns The preferences matrix, or a status line while loading or empty.
 */
export function PreferencesPanel({ title }: IPreferencesPanelProps = {}): React.ReactElement {
    const [preferences, setPreferences] = useState<INotificationPreferences | null>(null);
    const [categories, setCategories] = useState<INotificationCategory[]>([]);
    const [channels, setChannels] = useState<INotificationChannelInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    /**
     * Load the caller's preferences and the catalog the matrix renders from
     * once the panel mounts.
     *
     * @returns Cleanup that ignores an answer arriving after the panel unmounted.
     */
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const bundle = await getMyPreferences();
                if (!cancelled) {
                    setPreferences(bundle.preferences);
                    setCategories(bundle.categories);
                    setChannels(bundle.channels);
                }
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
            return override ?? category.channelDefaults[channelId] ?? false;
        },
        [preferences]
    );

    /**
     * Persist the global-mute toggle and show the stored result.
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
     * Persist a single (category, channel) override and show the stored result.
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

    const muted = preferences?.mutedAll ?? false;
    const showMatrix = !loading && preferences !== null && categories.length > 0;

    const muteSwitch = (
        <Switch
            size="sm"
            label="Mute all"
            on={muted}
            disabled={saving}
            onChange={(next) => void onToggleMute(next)}
            aria-label="Mute all notifications"
        />
    );

    let body: ReactNode;
    if (loading) {
        body = <p className={styles.placeholder}>Loading preferences…</p>;
    } else if (preferences === null) {
        body = <p className={styles.placeholder}>{error ?? 'Failed to load preferences'}</p>;
    } else if (categories.length === 0) {
        body = <p className={styles.placeholder}>No configurable notifications yet.</p>;
    } else {
        body = (
            <>
                {error && <p className={styles.error} role="alert">{error}</p>}
                <Table variant="compact" flush className={muted ? `${styles.matrix} ${styles.matrix_muted}` : styles.matrix}>
                    <Thead>
                        <Tr>
                            <Th>Category</Th>
                            {channels.map((ch) => (
                                <Th key={ch.id} width="shrink" className={styles.cell_switch}>{ch.label}</Th>
                            ))}
                        </Tr>
                    </Thead>
                    <Tbody>
                        {categories.map((category) => (
                            <Tr key={category.id}>
                                <Td>
                                    <RowLabel name={category.label} description={category.description} />
                                </Td>
                                {channels.map((ch) => (
                                    <Td key={ch.id} className={styles.cell_switch}>
                                        <Switch
                                            size="sm"
                                            on={isEnabled(category, ch.id)}
                                            disabled={saving || muted}
                                            onChange={(next) => void onTogglePairing(category.id, ch.id, next)}
                                            aria-label={`${category.label} by ${ch.label}`}
                                        />
                                    </Td>
                                ))}
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            </>
        );
    }

    let panel: React.ReactElement;
    if (title !== undefined) {
        panel = (
            <Panel title={title} meta={showMatrix ? PANEL_META : undefined} actions={showMatrix ? muteSwitch : undefined}>
                {body}
            </Panel>
        );
    } else {
        panel = (
            <div className={styles.panel}>
                {showMatrix && (
                    <div className={styles.mute_row}>
                        {muteSwitch}
                        <span className={styles.help}>{MUTE_HELP}</span>
                    </div>
                )}
                {body}
            </div>
        );
    }

    return panel;
}
