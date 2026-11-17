'use client';

/**
 * @fileoverview Ingestion-settings tab for /system/account-history.
 *
 * The pacing dials: a master ingestion switch plus pages-per-tick and
 * accounts-per-tick. All three govern BOTH passes — the backward backfill and
 * the forward sync that keeps completed accounts current — since both share one
 * settings document. These throttle ingestion *down* only: they cannot exceed
 * the shared TronGrid rate limiter that protects live block sync, so turning
 * them up never pulls faster than the global budget allows. The three cron
 * cadences live on the Schedules tab (owned by the scheduler), not here.
 */

import { useEffect, useState, useCallback } from 'react';
import { Save } from 'lucide-react';
import { Button } from '../../../../../../components/ui/Button';
import { Field } from '../../../../../../components/ui/Field';
import { Input } from '../../../../../../components/ui/Input';
import { Panel } from '../../../../../../components/ui/Panel';
import { Switch } from '../../../../../../components/ui/Switch';
import { useToast } from '../../../../../../components/ui/ToastProvider';
import { getSettings, updateSettings, type IAccountHistorySettings } from '../../../../../../modules/account-history';
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

    /**
     * Merge one changed dial into the draft. Nothing is sent until Save, so
     * an operator can adjust all three before the next tick reads them.
     *
     * @param change - The fields the operator just edited.
     */
    const patch = useCallback((change: Partial<IAccountHistorySettings>) => {
        setSettings((prev) => (prev ? { ...prev, ...change } : prev));
    }, []);

    /**
     * Send the draft and replace it with what the server stored, so the form
     * shows committed values rather than an optimistic copy that a rejected
     * write could leave behind.
     */
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

    return (
        <Panel
            className={styles.settings_panel}
            title="Ingestion pacing"
            meta="Shared by both passes; never faster than the TronGrid rate limit"
            actions={settings && (
                <Button variant="primary" icon={<Save size={16} />} loading={saving} onClick={() => { void save(); }}>
                    Save settings
                </Button>
            )}
        >
            {!settings
                ? <p className="text-muted">Loading settings…</p>
                : (
                    <div className={styles.settings_form}>
                        <Field
                            inline
                            label="Ingestion enabled"
                            htmlFor="account-history-ingestion-enabled"
                            hint="Master switch for both passes. When off, every tick is a no-op and no account advances or refreshes."
                        >
                            <Switch
                                id="account-history-ingestion-enabled"
                                on={settings.ingestionEnabled}
                                onChange={(next) => patch({ ingestionEnabled: next })}
                                aria-label="Ingestion enabled"
                            />
                        </Field>
                        <div className={styles.settings_grid}>
                            <Field
                                label="Pages per tick"
                                htmlFor="account-history-pages-per-tick"
                                hint="TronGrid pages of 200 transactions pulled per account each tick. The main speed dial; raising it also drains a forward-sync backlog faster."
                            >
                                <Input
                                    id="account-history-pages-per-tick"
                                    type="number"
                                    min={1}
                                    value={settings.pagesPerTick}
                                    onChange={(event) => patch({ pagesPerTick: Number(event.target.value) })}
                                    className={styles.number_input}
                                />
                            </Field>
                            <Field
                                label="Accounts per tick"
                                htmlFor="account-history-accounts-per-tick"
                                hint="Accounts each tick advances, least recently run first. Backfill rotates unfinished accounts and forward sync rotates complete ones."
                            >
                                <Input
                                    id="account-history-accounts-per-tick"
                                    type="number"
                                    min={1}
                                    value={settings.accountsPerTick}
                                    onChange={(event) => patch({ accountsPerTick: Number(event.target.value) })}
                                    className={styles.number_input}
                                />
                            </Field>
                        </div>
                    </div>
                )}
        </Panel>
    );
}
