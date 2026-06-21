'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { getAdminCategories, setAdminCategory, type IAdminCategory } from '../api/notifications.api';
import styles from './admin.module.scss';

/**
 * Admin Categories tab — the global category kill switches.
 *
 * Lists every registered notification category with its source, supported
 * channels, and a toggle that enables or disables it for everyone. Disabling a
 * category here suppresses it before per-user preferences are consulted. Client
 * component behind the admin-gated `/system/notifications` page.
 *
 * @returns The categories admin list.
 */
export function CategoriesTab(): React.ReactElement {
    const [categories, setCategories] = useState<IAdminCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(async (): Promise<void> => {
        try {
            setCategories(await getAdminCategories());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load categories');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Toggle a category's global enable state, updating local rows optimistically.
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

    if (loading) {
        return <p className={styles.placeholder}>Loading categories…</p>;
    }
    if (categories.length === 0) {
        return <p className={styles.placeholder}>No categories registered.</p>;
    }

    return (
        <div className={styles.list}>
            {error && <p className={styles.error} role="alert">{error}</p>}
            {categories.map((category) => (
                <div key={category.id} className={styles.row}>
                    <div className={styles.row_main}>
                        <div className={styles.row_title}>{category.label}</div>
                        <div className={styles.row_desc}>{category.description}</div>
                        <div className={styles.badges}>
                            <Badge tone="neutral">{category.source}</Badge>
                            {Object.keys(category.channelDefaults).map((ch) => (
                                <Badge key={ch} tone="info">{ch}</Badge>
                            ))}
                        </div>
                    </div>
                    <label className={styles.toggle}>
                        <input
                            type="checkbox"
                            checked={category.enabled}
                            disabled={busyId === category.id}
                            onChange={(e) => void onToggle(category.id, e.target.checked)}
                        />
                        <span>{category.enabled ? 'Enabled' : 'Disabled'}</span>
                    </label>
                </div>
            ))}
        </div>
    );
}
