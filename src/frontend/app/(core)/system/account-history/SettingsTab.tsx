'use client';

/**
 * @fileoverview Ingestion-settings tab for /system/account-history.
 *
 * The pacing dials: a master ingestion switch plus pages-per-tick and
 * accounts-per-tick. All three govern BOTH passes — the backward backfill and
 * the forward sync that keeps completed accounts current — since both share one
 * settings document. These throttle ingestion *down* only: they cannot exceed
 * the shared TronGrid rate limiter that protects live block sync, so turning
 * them up never pulls faster than the global budget allows. The two cron
 * cadences live on the Schedules tab (owned by the scheduler), not here.
 */

import { useEffect, useState, useCallback } from 'react';
import { Save } from 'lucide-react';
import { Stack } from '../../../../components/layout';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Switch } from '../../../../components/ui/Switch';
import { useToast } from '../../../../components/ui/ToastProvider';
import { getSettings, updateSettings, type IAccountHistorySettings } from '../../../../modules/account-history';
import styles from './page.module.scss';

/**
 * Ingestion-settings tab content.
 *
 * @returns The tab.
 */
export function SettingsTab() {
    const [settings, setSettings] = useState<IAccountHistorySettings | null>(null);
    const [saving, setSaving] = useState(false);
    const { push } = useToast();

    useEffect(() => {
        let cancelled = false;
        getSettings()
            .then((next) => { if (!cancelled) setSettings(next); })
            .catch((err) => {
                if (!cancelled) push({ tone: 'danger', title: 'Failed to load settings', description: err instanceof Error ? err.message : String(err) });
            });
        return () => { cancelled = true; };
    }, [push]);

    const patch = useCallback((change: Partial<IAccountHistorySettings>) => {
        setSettings((prev) => (prev ? { ...prev, ...change } : prev));
    }, []);

    const save = useCallback(async () => {
        if (!settings) {
            return;
        }
        setSaving(true);
        try {
            const next = await updateSettings(settings);
            setSettings(next);
            push({ tone: 'success', title: 'Settings saved' });
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to save settings', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setSaving(false);
        }
    }, [settings, push]);

    if (!settings) {
        return <div className="text-muted">Loading settings…</div>;
    }

    return (
        <Stack gap="lg">
            <div className={styles.setting_row}>
                <div>
                    <div className={styles.setting_label}>Ingestion enabled</div>
                    <div className="text-muted">Master switch for both passes. When off, the backfill and forward-sync ticks are no-ops and no account advances or refreshes.</div>
                </div>
                <Switch on={settings.ingestionEnabled} onChange={(next) => patch({ ingestionEnabled: next })} aria-label="Toggle ingestion" />
            </div>

            <div className={styles.setting_row}>
                <div>
                    <div className={styles.setting_label}>Pages per tick</div>
                    <div className="text-muted">TronGrid pages (200 tx each) pulled per account each tick, for both backfill and forward sync — the primary speed/load dial. Raising it also lets forward sync drain a backlog faster.</div>
                </div>
                <Input
                    type="number"
                    min={1}
                    value={settings.pagesPerTick}
                    onChange={(event) => patch({ pagesPerTick: Number(event.target.value) })}
                    aria-label="Pages per tick"
                    className={styles.number_input}
                />
            </div>

            <div className={styles.setting_row}>
                <div>
                    <div className={styles.setting_label}>Accounts per tick</div>
                    <div className="text-muted">How many accounts each tick advances (round-robin, least-recent first) — backfill rotates not-yet-complete accounts, forward sync rotates completed ones.</div>
                </div>
                <Input
                    type="number"
                    min={1}
                    value={settings.accountsPerTick}
                    onChange={(event) => patch({ accountsPerTick: Number(event.target.value) })}
                    aria-label="Accounts per tick"
                    className={styles.number_input}
                />
            </div>

            <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-body-sm)' }}>
                These dials throttle ingestion down only. They cannot exceed the shared TronGrid rate limiter that protects live block
                sync — past that ceiling, higher values just mean the tick waits in the throttle queue rather than pulling faster.
            </p>

            <div>
                <Button variant="primary" size="sm" loading={saving} onClick={() => { void save(); }}>
                    <Save size={16} /> Save settings
                </Button>
            </div>
        </Stack>
    );
}
