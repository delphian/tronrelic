'use client';

/**
 * @fileoverview The site-wide sign-up cap on the Sign-ups tab of
 * `/system/users`: where new accounts stand against it now, and the form that
 * sets its mode and hourly maximum.
 *
 * The reading sits above the form because the right maximum depends on what
 * a normal hour looks like, and the 24-hour count is what shows that. The
 * mode is not repeated as a figure, because the Mode field already shows it.
 * The two fields and the save button share one row, with the description of
 * the chosen mode under it.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
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

/** What each mode does, shown under the form as the mode field's description. */
const MODE_HINTS: Record<SignupCapMode, string> = {
    off: 'Off: new accounts are not counted against the cap and no alert is sent.',
    alert: 'Alert only: admins are notified once an hour while the cap is reached, and nobody is refused.',
    enforce: 'Enforce: admins are notified, and new accounts are refused until the count for the last hour falls below the cap. Existing accounts can always sign in.'
};

/** Id of the mode description, which the mode field points at with `aria-describedby`. */
const MODE_HELP_ID = 'signup-cap-mode-help';

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

    const error = maxPerHourError(maxPerHour);
    const dirty = mode !== savedCap.mode || maxPerHour.trim() !== String(savedCap.maxPerHour);
    const canSave = dirty && error === undefined;

    /**
     * Save the mode and the maximum together, since the form edits both. A
     * submission while nothing changed or the maximum is invalid sends nothing.
     *
     * @param event - The form submission, whose default page reload is stopped.
     */
    const handleSave = useCallback(async (event: FormEvent) => {
        event.preventDefault();
        if (canSave) {
            setSaving(true);
            try {
                onReport(await saveSignupCap({ mode, maxPerHour: Number(maxPerHour) }));
                push({ tone: 'success', title: 'Sign-up cap saved' });
            } catch (caught) {
                push({ tone: 'danger', title: 'Could not save the sign-up cap', description: caught instanceof Error ? caught.message : String(caught) });
            } finally {
                setSaving(false);
            }
        }
    }, [canSave, maxPerHour, mode, onReport, push]);

    const { cap } = report;
    const reachedTone = savedCap.mode === 'enforce' ? 'danger' : 'warning';

    return (
        <Panel
            title="Sign-up cap"
            meta="New accounts in any 60 minutes, by every sign-in method"
            actions={
                <Button variant="ghost" loading={refreshing} onClick={onRefresh} icon={<RefreshCcw size={16} />}>
                    Refresh
                </Button>
            }
        >
            <Stack gap="md">
                <StatGrid size="sm">
                    <StatTile
                        size="sm"
                        surface={false}
                        label="Last 60 minutes"
                        value={cap.createdLastHour.toLocaleString('en-US')}
                        note={savedCap.mode === 'off' ? 'Cap is off' : `Cap ${savedCap.maxPerHour.toLocaleString('en-US')}${cap.reached ? ', reached' : ''}`}
                        tone={cap.reached ? reachedTone : 'neutral'}
                    />
                    <StatTile size="sm" surface={false} label="Last 24 hours" value={cap.createdLast24Hours.toLocaleString('en-US')} note="New accounts" />
                    <StatTile
                        size="sm"
                        surface={false}
                        label="Last alert"
                        value={cap.lastAlertAt ? <ClientTime date={cap.lastAlertAt} format="relative" /> : 'None'}
                        note="Within the last hour"
                    />
                </StatGrid>

                <div className={styles.form_container}>
                    <form className={`${styles.form_row} ${styles.form_row__cap}`} aria-label="Sign-up cap settings" onSubmit={event => void handleSave(event)}>
                        <Field label="Mode" className={styles.form_field}>
                            <Select
                                id="signup-cap-mode"
                                value={mode}
                                aria-describedby={MODE_HELP_ID}
                                onChange={event => setMode(event.target.value as SignupCapMode)}
                            >
                                <option value="off">Off</option>
                                <option value="alert">Alert only</option>
                                <option value="enforce">Enforce</option>
                            </Select>
                        </Field>
                        <Field label="New accounts per hour" error={error} className={styles.form_field}>
                            <Input
                                id="signup-cap-max"
                                inputMode="numeric"
                                value={maxPerHour}
                                invalid={error !== undefined}
                                onChange={event => setMaxPerHour(event.target.value)}
                            />
                        </Field>
                        <p id={MODE_HELP_ID} className={styles.form_help}>{MODE_HINTS[mode]}</p>
                        <Button
                            type="submit"
                            variant="primary"
                            loading={saving}
                            disabled={!canSave}
                            icon={<Save size={16} />}
                            className={styles.form_submit}
                        >
                            Save cap
                        </Button>
                    </form>
                </div>
            </Stack>
        </Panel>
    );
}
