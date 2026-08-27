'use client';

/**
 * @fileoverview Settings panel for /system/address-tags: per-source enable
 * switches and the write-only Chainalysis API key.
 *
 * The key field is deliberately not a masked input that can be revealed. The
 * settings endpoint reports only whether a key is configured and its last four
 * characters — the value never travels back over HTTP — so the form shows
 * recognition state and accepts a replacement. Storing the key here (module
 * key-value config, not `.env`) is what lets an operator paste a key and have
 * the next screen use it without a redeploy.
 *
 * Like the other /system managers this panel fetches on mount over the
 * cookie-authenticated admin API rather than SSR-seeding: admin surfaces are
 * exempt from the SSR + Live Updates mandate by the /system dashboard
 * convention.
 */

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Field } from '../../../../components/ui/Field';
import { Switch } from '../../../../components/ui/Switch';
import { useToast } from '../../../../components/ui/ToastProvider';
import {
    getAddressTagsSettings,
    updateAddressTagsSettings,
    type IAddressTagsSettingsView,
    type IAddressTagsSettingsUpdateView
} from '../../../../modules/address-tags';
import styles from './page.module.scss';

/** Human labels for the scheduled sources' switches. */
const SOURCE_LABELS: Record<string, string> = {
    'ofac-sdn': 'OFAC SDN list (daily snapshot)',
    'usdt-blacklist': 'Tether USDT blacklist (event poll + weekly verify)'
};

/**
 * The Settings panel: source switches and the Chainalysis key form.
 */
export function SettingsTab() {
    const [settings, setSettings] = useState<IAddressTagsSettingsView | null>(null);
    const [loading, setLoading] = useState(true);
    const [keyDraft, setKeyDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const { push } = useToast();

    /**
     * Toast helper mapping a thrown error (or success text) onto the toast
     * provider's `{ tone, title, description }` shape.
     */
    const notify = useCallback((tone: 'success' | 'danger', title: string, error?: unknown) => {
        push({
            tone,
            title,
            description: error ? (error instanceof Error ? error.message : String(error)) : undefined
        });
    }, [push]);

    useEffect(() => {
        void (async () => {
            try {
                setSettings(await getAddressTagsSettings());
            } catch (error) {
                notify('danger', 'Failed to load settings', error);
            } finally {
                setLoading(false);
            }
        })();
    }, [notify]);

    /**
     * Apply one partial update and swap in the settings the server returns, so
     * the panel always reflects committed state rather than an optimistic guess
     * that could drift from a rejected write. A failure is reported as a toast
     * instead of being thrown, so the switch handlers can call this without
     * error handling of their own.
     *
     * @param update - The partial update to send.
     * @param successTitle - Toast title on success.
     * @returns Whether the server accepted the write. A caller holding text the
     *          operator typed, such as the write-only API key field, must check
     *          this before discarding that input.
     */
    const apply = useCallback(async (update: IAddressTagsSettingsUpdateView, successTitle: string): Promise<boolean> => {
        setSaving(true);
        let succeeded = false;
        try {
            setSettings(await updateAddressTagsSettings(update));
            notify('success', successTitle);
            succeeded = true;
        } catch (error) {
            notify('danger', 'Failed to update settings', error);
        } finally {
            setSaving(false);
        }

        return succeeded;
    }, [notify]);

    /**
     * Store the drafted key, clearing the field only once the server confirms
     * the write. The value is write-only, so clearing it after a failed save
     * would make the operator go and find the credential again; keeping the
     * draft lets them retry after a transient backend or auth failure. On
     * success the field is cleared, because it is the one place the key would
     * otherwise still be visible.
     */
    const handleSaveKey = useCallback(async () => {
        const draft = keyDraft.trim();
        if (!draft) {
            notify('danger', 'Enter an API key to save');
            return;
        }
        if (await apply({ chainalysis: { apiKey: draft } }, 'Chainalysis API key saved')) {
            setKeyDraft('');
        }
    }, [apply, keyDraft, notify]);

    if (!settings) {
        return (
            <Card>
                <div className={styles.placeholder}>
                    {loading ? 'Loading settings…' : 'Settings unavailable.'}
                </div>
            </Card>
        );
    }

    return (
        <Stack gap="lg">
            <Card>
                <Stack gap="md">
                    <p className={styles.intro}>
                        Each switch gates that source&apos;s <em>scheduled</em> runs; &ldquo;Run now&rdquo; on the Sources tab works
                        either way. All scheduled ingestion additionally requires the platform scheduler to be on
                        (<code>ENABLE_SCHEDULER</code>).
                    </p>
                    {Object.entries(settings.sources).map(([id, source]) => (
                        <div key={id} className={styles.switch_row}>
                            <Switch
                                on={source.enabled}
                                onChange={(next) => void apply(
                                    { sources: { [id]: { enabled: next } } },
                                    `${SOURCE_LABELS[id] ?? id} ${next ? 'enabled' : 'disabled'}`
                                )}
                                disabled={saving}
                                aria-label={`Toggle scheduled runs for ${SOURCE_LABELS[id] ?? id}`}
                            />
                            <span>{SOURCE_LABELS[id] ?? id}</span>
                        </div>
                    ))}
                </Stack>
            </Card>

            <Card>
                <Stack gap="md">
                    <div className={styles.switch_row}>
                        <Switch
                            on={settings.chainalysis.enabled}
                            onChange={(next) => void apply(
                                { chainalysis: { enabled: next } },
                                `Chainalysis screening ${next ? 'enabled' : 'disabled'}`
                            )}
                            disabled={saving}
                            aria-label="Toggle Chainalysis screening"
                        />
                        <span>Chainalysis screening</span>
                        {settings.chainalysis.configured
                            ? <Badge tone="success">key configured (…{settings.chainalysis.keySuffix})</Badge>
                            : <Badge tone="warning">no key configured</Badge>}
                    </div>

                    <Field
                        label="Chainalysis API key"
                        hint="Write-only: the stored key is never shown again, only whether one is configured and its last four characters. Saving replaces any existing key."
                        htmlFor="chainalysis-api-key"
                    >
                        <div className={styles.key_form}>
                            <Input
                                id="chainalysis-api-key"
                                value={keyDraft}
                                onChange={(event) => setKeyDraft(event.target.value)}
                                placeholder={settings.chainalysis.configured ? 'Enter a replacement key' : 'Enter an API key'}
                                autoComplete="off"
                                className={styles.key_input}
                            />
                            <Button variant="primary" onClick={() => void handleSaveKey()} disabled={saving}>
                                <KeyRound size={16} /> Save key
                            </Button>
                            {settings.chainalysis.configured && (
                                <Button
                                    variant="danger"
                                    onClick={() => void apply({ chainalysis: { apiKey: null } }, 'Chainalysis API key cleared')}
                                    disabled={saving}
                                >
                                    <Trash2 size={16} /> Clear key
                                </Button>
                            )}
                        </div>
                    </Field>
                </Stack>
            </Card>
        </Stack>
    );
}
