'use client';

/**
 * @fileoverview The site-wide sign-up cap on the Sign-ups tab of
 * `/system/users`: where new accounts stand against it now, and the form that
 * sets its mode and hourly maximum.
 *
 * The reading sits beside the form because the right maximum depends on what
 * a normal hour looks like, and the 24-hour count is what shows that.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, Save } from 'lucide-react';
import type { ISignupProtectionReport, SignupCapMode } from '@/types';
import { SIGNUP_PROTECTION_LIMITS } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Panel } from '../../../../../components/ui/Panel';
import { Button } from '../../../../../components/ui/Button';
import { Field } from '../../../../../components/ui/Field';
import { Input } from '../../../../../components/ui/Input';
import { Select } from '../../../../../components/ui/Select';
import { StatGrid, StatTile } from '../../../../../components/ui/StatTile';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { saveSignupCap } from '../../../api/sign-up-protection.api';
import styles from './SignupProtectionTab.module.scss';

/** What each mode does, shown as the mode field's hint. */
const MODE_HINTS: Record<SignupCapMode, string> = {
    off: 'Off. New accounts are not counted against the cap and no alert is sent.',
    alert: 'Alert only. Admins are notified once an hour while the cap is reached, and nobody is refused.',
    enforce: 'Enforce. Admins are notified, and new accounts are refused until the count for the last hour falls below the cap. Existing accounts can always sign in.'
};

/** Short label for each mode, for the reading above the form. */
const MODE_LABELS: Record<SignupCapMode, string> = {
    off: 'Off',
    alert: 'Alert only',
    enforce: 'Enforce'
};

/**
 * Check the hourly maximum the admin typed.
 *
 * @param value - The field's text.
 * @returns A message saying what is wrong, or undefined when it is valid.
 */
function maxPerHourError(value: string): string | undefined {
    const parsed = Number(value);
    const valid = /^\d+$/.test(value.trim()) && parsed >= SIGNUP_PROTECTION_LIMITS.minPerHour && parsed <= SIGNUP_PROTECTION_LIMITS.maxPerHour;
    return valid ? undefined : `Enter a whole number from ${SIGNUP_PROTECTION_LIMITS.minPerHour} to ${SIGNUP_PROTECTION_LIMITS.maxPerHour.toLocaleString('en-US')}.`;
}

/** Props for the cap panel. */
interface ISignupCapPanelProps {
    /** The latest report; the form starts from its saved cap. */
    report: ISignupProtectionReport;

    /** Receives the report the backend answers a change with. */
    onReport: (next: ISignupProtectionReport) => void;

    /** Reloads the report. */
    onRefresh: () => void;

    /** True while a reload is in flight. */
    refreshing: boolean;
}

/**
 * The sign-up cap reading and settings form.
 *
 * @param props - The report, its update callback, and the reload control.
 * @returns The panel.
 */
export function SignupCapPanel({ report, onReport, onRefresh, refreshing }: ISignupCapPanelProps) {
    const savedCap = report.config.signupCap;
    const [mode, setMode] = useState<SignupCapMode>(savedCap.mode);
    const [maxPerHour, setMaxPerHour] = useState(String(savedCap.maxPerHour));
    const [saving, setSaving] = useState(false);
    const { push } = useToast();

    /**
     * Show the saved values again whenever a report brings new ones, such as
     * after a save or a reload.
     */
    useEffect(() => {
        setMode(savedCap.mode);
        setMaxPerHour(String(savedCap.maxPerHour));
    }, [savedCap.mode, savedCap.maxPerHour]);

    /** Save the mode and the maximum together, since the form edits both. */
    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            onReport(await saveSignupCap({ mode, maxPerHour: Number(maxPerHour) }));
            push({ tone: 'success', title: 'Sign-up cap saved' });
        } catch (error) {
            push({ tone: 'danger', title: 'Could not save the sign-up cap', description: error instanceof Error ? error.message : String(error) });
        } finally {
            setSaving(false);
        }
    }, [maxPerHour, mode, onReport, push]);

    const error = maxPerHourError(maxPerHour);
    const dirty = mode !== savedCap.mode || maxPerHour.trim() !== String(savedCap.maxPerHour);
    const { cap } = report;
    const reachedTone = savedCap.mode === 'enforce' ? 'danger' : 'warning';

    return (
        <Panel
            title="Sign-up cap"
            meta="New accounts in any 60 minutes, by every sign-in method"
            actions={
                <Button size="sm" variant="ghost" loading={refreshing} onClick={onRefresh} icon={<RefreshCcw size={16} />}>
                    Refresh
                </Button>
            }
        >
            <Stack gap="md">
                <StatGrid size="sm">
                    <StatTile
                        size="sm"
                        label="Last 60 minutes"
                        value={cap.createdLastHour.toLocaleString('en-US')}
                        note={savedCap.mode === 'off' ? 'Cap is off' : `Cap ${savedCap.maxPerHour.toLocaleString('en-US')}${cap.reached ? ', reached' : ''}`}
                        tone={cap.reached ? reachedTone : 'neutral'}
                    />
                    <StatTile size="sm" label="Last 24 hours" value={cap.createdLast24Hours.toLocaleString('en-US')} note="New accounts" />
                    <StatTile
                        size="sm"
                        label="Last alert"
                        value={cap.lastAlertAt ? <ClientTime date={cap.lastAlertAt} format="relative" /> : 'None'}
                        note="Within the last hour"
                    />
                    <StatTile size="sm" label="Mode" value={MODE_LABELS[savedCap.mode]} />
                </StatGrid>

                <div className={styles.form_container}>
                    <div className={`${styles.form_grid} ${styles.form_grid__cap}`}>
                        <Field label="Mode" htmlFor="signup-cap-mode" hint={MODE_HINTS[mode]}>
                            <Select id="signup-cap-mode" size="sm" value={mode} onChange={event => setMode(event.target.value as SignupCapMode)}>
                                <option value="off">Off</option>
                                <option value="alert">Alert only</option>
                                <option value="enforce">Enforce</option>
                            </Select>
                        </Field>
                        <Field
                            label="New accounts per hour"
                            htmlFor="signup-cap-max"
                            error={error}
                            hint="The cap is reached when this many accounts were created in the last 60 minutes."
                        >
                            <Input
                                id="signup-cap-max"
                                size="sm"
                                inputMode="numeric"
                                value={maxPerHour}
                                invalid={error !== undefined}
                                onChange={event => setMaxPerHour(event.target.value)}
                            />
                        </Field>
                    </div>
                </div>
                <div className={styles.form_actions}>
                    <Button
                        size="sm"
                        variant="primary"
                        loading={saving}
                        disabled={!dirty || error !== undefined}
                        onClick={() => void handleSave()}
                        icon={<Save size={16} />}
                    >
                        Save cap
                    </Button>
                </div>
            </Stack>
        </Panel>
    );
}
