'use client';

/**
 * @fileoverview Settings tab of `/system/consent`.
 *
 * Three things live here. The main switch turns the cookie banner, the
 * analytics gate, and the Google Ads tag on or off together; while it is off
 * the site behaves exactly as it did before consent handling existed. The
 * Google Ads id and conversion label decide whether the tag loads and what
 * counts as a conversion. "Ask everyone again" raises the policy version, so
 * every visitor in a consent region sees the banner on their next page view,
 * which is what to do after the Privacy Policy changes.
 *
 * Below them, the page views from visitors without analytics consent show how
 * much traffic the `/system/traffic` dashboard cannot see. Fetches its own data
 * on mount, as every `/system` manager does.
 *
 * @module modules/consent/components/admin/SettingsTab
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, Save } from 'lucide-react';
import type { IConsentPageviewStats, IConsentSettings } from '@/types';
import { GOOGLE_ADS_CONVERSION_LABEL_PATTERN, GOOGLE_ADS_ID_PATTERN } from '@/types';
import { Stack } from '../../../../components/layout';
import { Panel } from '../../../../components/ui/Panel';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Switch } from '../../../../components/ui/Switch';
import { Field } from '../../../../components/ui/Field';
import { FigureList } from '../../../../components/ui/FigureList';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { useModal } from '../../../../components/ui/ModalProvider';
import { useToast } from '../../../../components/ui/ToastProvider';
import { getConsentPageviewStats, getConsentSettings, renewConsent, updateConsentSettings } from '../../api/client';

/** Days of anonymous page views the tab shows. */
const PAGEVIEW_WINDOW_DAYS = 30;

/**
 * Describe what is wrong with an optional field, or nothing when it is fine.
 *
 * @param value - What the administrator typed.
 * @param pattern - The form the value must take.
 * @param expected - Plain description of that form.
 * @returns The error message, or undefined for an empty or valid value.
 */
function fieldError(value: string, pattern: RegExp, expected: string): string | undefined {
    const trimmed = value.trim();
    return trimmed === '' || pattern.test(trimmed) ? undefined : `Expected ${expected}.`;
}

/**
 * The Settings tab.
 *
 * @returns The tab content.
 */
export function SettingsTab() {
    const [settings, setSettings] = useState<IConsentSettings | null>(null);
    const [stats, setStats] = useState<IConsentPageviewStats | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [googleAdsId, setGoogleAdsId] = useState('');
    const [conversionLabel, setConversionLabel] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [renewing, setRenewing] = useState(false);
    const { open, close } = useModal();
    const { push } = useToast();

    /**
     * Put saved settings into the form, so the fields show what is stored.
     *
     * @param next - Settings returned by the backend.
     */
    const apply = useCallback((next: IConsentSettings) => {
        setSettings(next);
        setEnabled(next.enabled);
        setGoogleAdsId(next.googleAdsId ?? '');
        setConversionLabel(next.conversionLabel ?? '');
    }, []);

    /**
     * Load the settings and the page view counts. The counts failing must
     * not hide the settings, so they degrade to nothing on their own.
     */
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [nextSettings, nextStats] = await Promise.all([
                getConsentSettings(),
                getConsentPageviewStats(PAGEVIEW_WINDOW_DAYS).catch(() => null)
            ]);
            apply(nextSettings);
            setStats(nextStats);
        } catch (error) {
            push({ tone: 'danger', title: 'Could not load consent settings', description: error instanceof Error ? error.message : String(error) });
        } finally {
            setLoading(false);
        }
    }, [apply, push]);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Save the switch and both Google Ads fields together, since the form
     * edits all three.
     */
    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            const next = await updateConsentSettings({ enabled, googleAdsId, conversionLabel });
            apply(next);
            push({ tone: 'success', title: 'Consent settings saved', description: 'Visitors see the change within about a minute.' });
        } catch (error) {
            push({ tone: 'danger', title: 'Could not save consent settings', description: error instanceof Error ? error.message : String(error) });
        } finally {
            setSaving(false);
        }
    }, [apply, conversionLabel, enabled, googleAdsId, push]);

    /**
     * Ask for confirmation, then raise the policy version.
     */
    const handleRenew = useCallback(() => {
        const modalId = open({
            title: 'Ask every visitor again',
            content: (
                <ConfirmDialog
                    label="Consent policy version"
                    confirmLabel="Ask again"
                    message="Every visitor in the EEA, the UK, and Switzerland will see the banner again on their next page view, and their analytics and advertising cookies stop until they answer. Do this after the Privacy Policy changes. Continue?"
                    onConfirm={
                        /**
                         * Raise the version once the admin confirms, then close
                         * the dialog and report the outcome.
                         */
                        async () => {
                            setRenewing(true);
                            try {
                                apply(await renewConsent());
                                push({ tone: 'success', title: 'Visitors will be asked again' });
                            } catch (error) {
                                push({ tone: 'danger', title: 'Could not ask visitors again', description: error instanceof Error ? error.message : String(error) });
                            } finally {
                                setRenewing(false);
                                close(modalId);
                            }
                        }
                    }
                    onCancel={() => close(modalId)}
                />
            )
        });
    }, [apply, close, open, push]);

    const idError = fieldError(googleAdsId, GOOGLE_ADS_ID_PATTERN, 'AW- followed by digits, such as AW-123456789');
    const labelError = fieldError(conversionLabel, GOOGLE_ADS_CONVERSION_LABEL_PATTERN, 'letters, digits, hyphens, and underscores');
    const dirty = settings !== null && (
        enabled !== settings.enabled
        || googleAdsId.trim() !== (settings.googleAdsId ?? '')
        || conversionLabel.trim() !== (settings.conversionLabel ?? '')
    );
    const today = stats?.byDay[stats.byDay.length - 1]?.count ?? 0;

    return (
        <Stack gap="md">
            <Panel
                title="Consent and Google Ads"
                meta={settings?.updatedAt ? <>Saved <ClientTime date={settings.updatedAt} format="relative" /></> : 'Never saved'}
                actions={settings && (
                    <Button
                        size="sm"
                        variant="primary"
                        loading={saving}
                        disabled={!dirty || idError !== undefined || labelError !== undefined}
                        onClick={() => void handleSave()}
                        icon={<Save size={16} />}
                    >
                        Save settings
                    </Button>
                )}
            >
                {loading || !settings ? (
                    <p className="text-muted">Loading settings…</p>
                ) : (
                    <Stack gap="md">
                        <Field
                            label="Consent handling"
                            htmlFor="consent-enabled"
                            hint={enabled
                                ? 'On. Visitors in the EEA, the UK, and Switzerland see the banner and get no analytics or advertising cookies until they agree. Everyone sees "Privacy choices" in the footer.'
                                : 'Off. No banner, the analytics cookie is set for every visitor, and the Google Ads tag never loads.'}
                        >
                            <Switch id="consent-enabled" on={enabled} onChange={setEnabled} aria-label="Consent handling" />
                        </Field>
                        <Field
                            label="Google Ads tag id"
                            htmlFor="consent-google-ads-id"
                            hint="From Google Ads → Tools → Google tag. Leave empty to keep the tag off the site."
                            error={idError}
                        >
                            <Input
                                id="consent-google-ads-id"
                                size="sm"
                                value={googleAdsId}
                                placeholder="AW-123456789"
                                invalid={idError !== undefined}
                                onChange={event => setGoogleAdsId(event.target.value)}
                            />
                        </Field>
                        <Field
                            label="Conversion label"
                            htmlFor="consent-conversion-label"
                            hint="The label of the conversion action counted when a visitor follows an affiliate link. Leave empty to load the tag without recording conversions."
                            error={labelError}
                        >
                            <Input
                                id="consent-conversion-label"
                                size="sm"
                                value={conversionLabel}
                                invalid={labelError !== undefined}
                                onChange={event => setConversionLabel(event.target.value)}
                            />
                        </Field>
                    </Stack>
                )}
            </Panel>

            <Panel
                title="Ask everyone again"
                meta={settings ? `Policy version ${settings.policyVersion}` : undefined}
                actions={settings && (
                    <Button size="sm" variant="secondary" loading={renewing} onClick={handleRenew} icon={<RefreshCcw size={16} />}>
                        Ask again
                    </Button>
                )}
            >
                <p className="text-muted">
                    A visitor&apos;s answer counts only for the policy version they answered. Raise it after the Privacy
                    Policy changes in a way visitors should agree to afresh. Answers also expire after twelve months.
                </p>
            </Panel>

            <Panel title="Page views without analytics consent" meta={`Last ${PAGEVIEW_WINDOW_DAYS} days`}>
                <Stack gap="sm">
                    <p className="text-muted">
                        Counted with no visitor identifier, so they are missing from the traffic dashboard. This is how much
                        traffic the dashboard cannot see.
                    </p>
                    <FigureList
                        label="Page views without analytics consent"
                        rows={stats ? [
                            { key: 'total', label: `Last ${stats.days} days`, value: stats.total.toLocaleString('en-US') },
                            { key: 'today', label: 'Today (UTC)', value: today.toLocaleString('en-US') }
                        ] : []}
                    />
                    {!stats && !loading && <p className="text-muted">Page view counts could not be loaded.</p>}
                </Stack>
            </Panel>
        </Stack>
    );
}
