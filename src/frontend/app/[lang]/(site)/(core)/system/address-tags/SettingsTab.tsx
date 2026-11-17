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
import { ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import { Badge } from '../../../../../../components/ui/Badge';
import { Button } from '../../../../../../components/ui/Button';
import { Field } from '../../../../../../components/ui/Field';
import { Input } from '../../../../../../components/ui/Input';
import { Panel } from '../../../../../../components/ui/Panel';
import { Switch } from '../../../../../../components/ui/Switch';
import { useToast } from '../../../../../../components/ui/ToastProvider';
import {
    getAddressTagsSettings,
    updateAddressTagsSettings,
    type IAddressTagsSettingsView,
    type IAddressTagsSettingsUpdateView
} from '../../../../../../modules/address-tags';
import styles from './page.module.scss';

/**
 * Where an operator can ask Chainalysis about access to the screening API.
 *
 * The backend calls `https://public.chainalysis.com/api/v1/address/`, which
 * only works with a key Chainalysis issues. This URL is the one Chainalysis
 * still publishes for that request, in their own announcement of the sanctions
 * screening API, and there is no self-service signup anywhere else. It no
 * longer reaches a key-request form: it redirects to the commercial Address
 * Screening product page, whose only form is a sales enquiry. Do not describe
 * it to operators as a way to obtain a free key, because the destination page
 * offers no such thing, and re-check where it lands before changing the copy
 * below.
 */
const CHAINALYSIS_KEY_URL = 'https://go.chainalysis.com/crypto-sanctions-screening.html';

/**
 * The label and hint for each scheduled source's switch. The hint says what
 * the switch starts, so an operator does not have to open the Sources tab to
 * learn how often a feed runs.
 */
const SOURCE_FIELDS: Record<string, { label: string; hint: string }> = {
    'ofac-sdn': {
        label: 'OFAC SDN list',
        hint: 'Takes a daily snapshot of the sanctions list.'
    },
    'usdt-blacklist': {
        label: 'Tether USDT blacklist',
        hint: 'Polls freeze events every five minutes and re-checks every held freeze weekly.'
    }
};

/**
 * The Settings panel: source switches and the Chainalysis key form.
 *
 * @returns The tab.
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

    return (
        <Panel
            className={styles.settings_panel}
            title="Sources"
            meta="Switches gate scheduled runs only; Run now on Sources works either way"
        >
            {!settings ? (
                <p className="text-muted">{loading ? 'Loading settings…' : 'Settings unavailable.'}</p>
            ) : (
                <div className={styles.settings_form}>
                    {Object.entries(settings.sources).map(([id, source]) => {
                        const field = SOURCE_FIELDS[id] ?? { label: id, hint: '' };
                        return (
                            <Field key={id} inline label={field.label} hint={field.hint} htmlFor={`address-tags-source-${id}`}>
                                <Switch
                                    id={`address-tags-source-${id}`}
                                    on={source.enabled}
                                    onChange={(next) => void apply(
                                        { sources: { [id]: { enabled: next } } },
                                        `${field.label} ${next ? 'enabled' : 'disabled'}`
                                    )}
                                    disabled={saving}
                                    aria-label={`Scheduled runs for ${field.label}`}
                                />
                            </Field>
                        );
                    })}

                    <Field
                        inline
                        label="Chainalysis screening"
                        hint="Lets an admin screen one address on the Sources tab. Needs the API key below."
                        htmlFor="address-tags-chainalysis-enabled"
                    >
                        <Switch
                            id="address-tags-chainalysis-enabled"
                            on={settings.chainalysis.enabled}
                            onChange={(next) => void apply(
                                { chainalysis: { enabled: next } },
                                `Chainalysis screening ${next ? 'enabled' : 'disabled'}`
                            )}
                            disabled={saving}
                            aria-label="Chainalysis screening"
                        />
                    </Field>

                    <Field
                        label={(
                            <>
                                Chainalysis API key
                                {settings.chainalysis.configured
                                    ? <Badge tone="success">set, ends …{settings.chainalysis.keySuffix}</Badge>
                                    : <Badge tone="warning">not set</Badge>}
                            </>
                        )}
                        htmlFor="chainalysis-api-key"
                        hint={(
                            <>
                                Write-only: after saving, only its last four characters are shown, and saving again
                                replaces it. Chainalysis has no self-service signup for this API, and its only
                                documented route is a sales enquiry.{' '}
                                <a className={styles.docs_link} href={CHAINALYSIS_KEY_URL} target="_blank" rel="noopener noreferrer">
                                    Contact Chainalysis about API access <ExternalLink size={14} aria-hidden />
                                </a>
                            </>
                        )}
                    >
                        <div className={styles.key_form}>
                            <Input
                                id="chainalysis-api-key"
                                value={keyDraft}
                                onChange={(event) => setKeyDraft(event.target.value)}
                                placeholder={settings.chainalysis.configured ? 'Enter a replacement key' : 'Enter an API key'}
                                autoComplete="off"
                                aria-describedby="chainalysis-api-key-hint"
                                className={styles.key_input}
                            />
                            <Button variant="primary" icon={<KeyRound size={16} />} onClick={() => void handleSaveKey()} disabled={saving}>
                                Save key
                            </Button>
                            {settings.chainalysis.configured && (
                                <Button
                                    variant="danger"
                                    icon={<Trash2 size={16} />}
                                    onClick={() => void apply({ chainalysis: { apiKey: null } }, 'Chainalysis API key cleared')}
                                    disabled={saving}
                                >
                                    Clear key
                                </Button>
                            )}
                        </div>
                    </Field>
                </div>
            )}
        </Panel>
    );
}
