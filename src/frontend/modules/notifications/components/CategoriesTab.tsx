'use client';

/**
 * @fileoverview Categories tab of /system/notifications: the global switch for
 * every registered notification category.
 *
 * Each category is one row of a compact table inside a panel: the switch
 * beside the category's name and description, then the source that fires it
 * and the channels it reaches by default. Switching a category off suppresses
 * it for every user before personal preferences are read. Client component
 * behind the admin-gated page.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Panel } from '../../../components/ui/Panel';
import { Switch } from '../../../components/ui/Switch';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../components/ui/Table';
import { getAdminCategories, setAdminCategory, type IAdminCategory } from '../api/notifications.api';
import { RowLabel } from './RowLabel';
import styles from './admin.module.scss';

/** What the switches do, stated once beside the panel title. */
const PANEL_META = 'Switching a category off stops it for every user, whatever their own preferences say.';

/**
 * List the channels a category reaches by default, marking the ones it leaves
 * off so an admin can tell a channel the category never uses from one a user
 * has to opt into.
 *
 * @param defaults - The category's per-channel defaults, keyed by channel id.
 * @returns The channel ids as comma-separated text.
 */
function renderChannels(defaults: Record<string, boolean>): ReactNode {
    return Object.entries(defaults).map(([channelId, on], index) => (
        <span key={channelId} className={on ? undefined : styles.channel_off} title={on ? undefined : 'Off unless a user turns it on'}>
            {index > 0 && ', '}
            {on ? channelId : `${channelId} (off)`}
        </span>
    ));
}

/**
 * Admin Categories tab — the global category kill switches.
 *
 * @returns The categories panel.
 */
export function CategoriesTab(): React.ReactElement {
    const [categories, setCategories] = useState<IAdminCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    /** Read every registered category with its current enable state. */
    const load = useCallback(async (): Promise<void> => {
        try {
            setCategories(await getAdminCategories());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load categories');
        } finally {
            setLoading(false);
        }
    }, []);

    /** Load the categories once the tab opens. */
    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Toggle a category's global enable state, updating the row once the
     * server accepts the change.
     *
     * @param id - Category id.
     * @param enabled - New enable state.
     */
    const onToggle = useCallback(async (id: string, enabled: boolean): Promise<void> => {
        setBusyId(id);
        setError(null);
        try {
            await setAdminCategory(id, enabled);
            setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, enabled } : c)));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update category');
        } finally {
            setBusyId(null);
        }
    }, []);

    let content: ReactNode;
    if (loading) {
        content = <p className={styles.placeholder}>Loading categories…</p>;
    } else if (categories.length === 0) {
        content = <p className={styles.placeholder}>No categories registered.</p>;
    } else {
        content = (
            <Table variant="compact" flush stackAt="mobile">
                <Thead>
                    <Tr>
                        <Th>Category</Th>
                        <Th width="shrink">Source</Th>
                        <Th width="shrink">Channels</Th>
                    </Tr>
                </Thead>
                <Tbody>
                    {categories.map((category) => (
                        <Tr key={category.id}>
                            <Td>
                                <div className={styles.toggle_label}>
                                    <Switch
                                        size="sm"
                                        on={category.enabled}
                                        disabled={busyId === category.id}
                                        onChange={(next) => void onToggle(category.id, next)}
                                        aria-label={`${category.label} for everyone`}
                                    />
                                    <RowLabel name={category.label} description={category.description} />
                                </div>
                            </Td>
                            <Td label="Source">{category.source}</Td>
                            <Td label="Channels">{renderChannels(category.channelDefaults)}</Td>
                        </Tr>
                    ))}
                </Tbody>
            </Table>
        );
    }

    return (
        <Panel title="Categories" meta={PANEL_META}>
            {error && <p className={styles.error} role="alert">{error}</p>}
            {content}
        </Panel>
    );
}
