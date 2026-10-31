'use client';

/**
 * BotRuleForm — create or edit one bot rule, with a preview against recent
 * traffic before saving.
 *
 * Why it exists: an operator who has spotted a disguised crawler needs to turn
 * what they found — its network, country, browser build, the pages it reads —
 * into a rule without a code change, and to see what the rule would catch
 * before trusting it. The form keeps every field as text, converts through
 * `botRuleFormState.ts`, and leaves validation to the server so the form and
 * the AI tool cannot disagree about what a valid rule is.
 */

import { useCallback, useId, useState, type FormEvent } from 'react';
import { isAxiosError } from 'axios';
import { Eye, Save, X } from 'lucide-react';
import { BOT_RULE_LABELS, type IBotRule, type IBotRulePreview } from '@/types';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Select } from '../../../../../components/ui/Select';
import { Textarea } from '../../../../../components/ui/Textarea';
import { Field } from '../../../../../components/ui/Field';
import { Switch } from '../../../../../components/ui/Switch';
import { adminCreateBotRule, adminPreviewBotRule, adminUpdateBotRule } from '../../../api/client';
import { BotRulePreview } from './BotRulePreview';
import { botRuleConditionsFromForm, botRuleInputFromForm, type IBotRuleFormState } from './botRuleFormState';
import styles from './BotRules.module.scss';

/** Preview windows the server accepts, in days. */
const PREVIEW_DAYS = [1, 7, 30] as const;

/** Props for {@link BotRuleForm}. */
interface IBotRuleFormProps {
    /** The rule being edited, or null for a new rule. */
    rule: IBotRule | null;
    /** The form's starting values. */
    initial: IBotRuleFormState;
    /** Called with the stored rule after a successful save. */
    onSaved: (rule: IBotRule) => void;
    /** Called when the operator closes the form without saving. */
    onCancel: () => void;
}

/**
 * Pull a readable message out of a failed request, preferring the server's own
 * validation text so the operator sees exactly which field to fix.
 *
 * @param err - The thrown value.
 * @param fallback - Message when nothing more specific is available.
 * @returns The message to show.
 */
export function botRuleErrorMessage(err: unknown, fallback: string): string {
    let message = fallback;
    if (isAxiosError<{ message?: string; error?: string }>(err)) {
        message = err.response?.data?.message || err.response?.data?.error || fallback;
    } else if (err instanceof Error) {
        message = err.message;
    }
    return message;
}

/**
 * Render the rule editor.
 *
 * @param props - The rule being edited, starting values, and save and cancel callbacks.
 * @returns The form, with its preview once one has been run.
 */
export function BotRuleForm({ rule, initial, onSaved, onCancel }: IBotRuleFormProps) {
    const [form, setForm] = useState<IBotRuleFormState>(initial);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [previewDays, setPreviewDays] = useState<number>(7);
    const [preview, setPreview] = useState<IBotRulePreview | null>(null);
    const id = useId();

    /**
     * Update one field. A changed condition makes the shown preview stale, so
     * it is cleared rather than left describing different conditions.
     *
     * @param key - The field to change.
     * @param value - Its new value.
     */
    const set = useCallback(<K extends keyof IBotRuleFormState>(key: K, value: IBotRuleFormState[K]): void => {
        setForm(current => ({ ...current, [key]: value }));
        if (key !== 'name' && key !== 'note' && key !== 'label' && key !== 'mode' && key !== 'enabled' && key !== 'expiresAt') {
            setPreview(null);
        }
    }, []);

    /**
     * Run the conditions against recent traffic without saving.
     */
    const handlePreview = useCallback(async (): Promise<void> => {
        const { conditions, problem } = botRuleConditionsFromForm(form);
        setError(problem);
        if (!problem) {
            setPreviewing(true);
            try {
                setPreview(await adminPreviewBotRule(conditions, previewDays));
            } catch (err) {
                setError(botRuleErrorMessage(err, 'Failed to preview the rule'));
            } finally {
                setPreviewing(false);
            }
        }
    }, [form, previewDays]);

    /**
     * Save the rule, creating it or replacing the edited one's fields.
     *
     * @param event - The submit event, cancelled so the page does not reload.
     */
    const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        const { input, problem } = botRuleInputFromForm(form);
        setError(problem);
        if (!problem) {
            setSaving(true);
            try {
                onSaved(rule ? await adminUpdateBotRule(rule.id, input) : await adminCreateBotRule(input));
            } catch (err) {
                setError(botRuleErrorMessage(err, 'Failed to save the rule'));
            } finally {
                setSaving(false);
            }
        }
    }, [form, rule, onSaved]);

    return (
        <form className={styles.form} onSubmit={handleSubmit} aria-label={rule ? `Edit rule ${rule.name}` : 'New bot rule'}>
            {error && <div className={styles.error} role="alert">{error}</div>}

            <div className={styles.form_row}>
                <Field label="Name" htmlFor={`${id}-name`} className={styles.field_wide}>
                    <Input id={`${id}-name`} size="sm" value={form.name} maxLength={80} onChange={e => set('name', e.target.value)} placeholder="Alibaba Cloud SG crawler" />
                </Field>
                <Field label="Label" htmlFor={`${id}-label`}>
                    <Select id={`${id}-label`} size="sm" value={form.label} onChange={e => set('label', e.target.value as IBotRuleFormState['label'])}>
                        {BOT_RULE_LABELS.map(label => <option key={label} value={label}>{label}</option>)}
                    </Select>
                </Field>
                <Field label="Mode" htmlFor={`${id}-mode`} hint={form.mode === 'monitor' ? 'Counts matches only' : 'Changes labels'}>
                    <Select id={`${id}-mode`} size="sm" value={form.mode} onChange={e => set('mode', e.target.value as IBotRuleFormState['mode'])}>
                        <option value="monitor">Monitor</option>
                        <option value="label">Label</option>
                    </Select>
                </Field>
            </div>

            <Field label="Why this is automated" htmlFor={`${id}-note`}>
                <Input id={`${id}-note`} size="sm" value={form.note} maxLength={500} onChange={e => set('note', e.target.value)} placeholder="Who runs the network, and what the traffic looks like" />
            </Field>

            <fieldset className={styles.conditions}>
                <legend className={styles.legend}>Conditions — all set conditions must match</legend>
                <div className={styles.form_row}>
                    <Field label="Networks (ASN)" htmlFor={`${id}-asns`} hint="Any one matches" className={styles.field_wide}>
                        <Input id={`${id}-asns`} size="sm" value={form.asns} onChange={e => set('asns', e.target.value)} placeholder="45102, AS132203" />
                    </Field>
                    <Field label="Countries" htmlFor={`${id}-countries`} hint="Any one matches" className={styles.field_wide}>
                        <Input id={`${id}-countries`} size="sm" value={form.countries} onChange={e => set('countries', e.target.value)} placeholder="SG" />
                    </Field>
                </div>
                <div className={styles.form_row}>
                    <Field label="Browser identifier contains" htmlFor={`${id}-ua`} hint="One per line; every line must appear" className={styles.field_wide}>
                        <Textarea id={`${id}-ua`} size="sm" rows={2} value={form.userAgentContains} onChange={e => set('userAgentContains', e.target.value)} placeholder={'chrome/145.0.0.0\nmacintosh'} />
                    </Field>
                    <Field label="Path starts with" htmlFor={`${id}-paths`} hint="Any one matches" className={styles.field_wide}>
                        <Input id={`${id}-paths`} size="sm" value={form.pathPrefixes} onChange={e => set('pathPrefixes', e.target.value)} placeholder="/vi/, /zh/" />
                    </Field>
                </div>
                <div className={styles.form_row}>
                    <Field label="Event type" htmlFor={`${id}-event`}>
                        <Select id={`${id}-event`} size="sm" value={form.eventType} onChange={e => set('eventType', e.target.value as IBotRuleFormState['eventType'])}>
                            <option value="">Either</option>
                            <option value="bootstrap">Page loads</option>
                            <option value="page">JavaScript reports</option>
                        </Select>
                    </Field>
                    <Field label="Referrer" htmlFor={`${id}-referrer`}>
                        <Select id={`${id}-referrer`} size="sm" value={form.referrer} onChange={e => set('referrer', e.target.value as IBotRuleFormState['referrer'])}>
                            <option value="">Either</option>
                            <option value="absent">None</option>
                            <option value="present">Has one</option>
                        </Select>
                    </Field>
                    <Field label="Report differs from page load" htmlFor={`${id}-mismatch`} hint="Catches residential-proxy fleets">
                        <Select id={`${id}-mismatch`} size="sm" value={form.mismatchCompare} onChange={e => set('mismatchCompare', e.target.value as IBotRuleFormState['mismatchCompare'])}>
                            <option value="">Off</option>
                            <option value="asn">By network</option>
                            <option value="country">By country</option>
                        </Select>
                    </Field>
                    {form.mismatchCompare && (
                        <Field label="Within seconds" htmlFor={`${id}-seconds`}>
                            <Input id={`${id}-seconds`} size="sm" inputMode="numeric" value={form.mismatchSeconds} onChange={e => set('mismatchSeconds', e.target.value)} />
                        </Field>
                    )}
                </div>
            </fieldset>

            <div className={styles.form_row}>
                <Field label="Expires" htmlFor={`${id}-expires`} hint="Optional; networks change hands">
                    <Input id={`${id}-expires`} size="sm" type="date" value={form.expiresAt} onChange={e => set('expiresAt', e.target.value)} />
                </Field>
                <div className={styles.switch_field}>
                    <Switch size="sm" on={form.enabled} onChange={next => set('enabled', next)} aria-label="Rule enabled" />
                    <span>{form.enabled ? 'Enabled' : 'Paused'}</span>
                </div>
            </div>

            <div className={styles.form_actions}>
                <Field label="Preview window" htmlFor={`${id}-days`}>
                    <Select id={`${id}-days`} size="sm" value={String(previewDays)} onChange={e => setPreviewDays(Number(e.target.value))}>
                        {PREVIEW_DAYS.map(days => <option key={days} value={days}>{days === 1 ? 'Last day' : `Last ${days} days`}</option>)}
                    </Select>
                </Field>
                <Button type="button" size="sm" variant="secondary" loading={previewing} onClick={handlePreview}>
                    <Eye size={16} aria-hidden="true" /> Preview
                </Button>
                <span className={styles.spacer} />
                <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                    <X size={16} aria-hidden="true" /> Cancel
                </Button>
                <Button type="submit" size="sm" variant="primary" loading={saving}>
                    <Save size={16} aria-hidden="true" /> {rule ? 'Save changes' : 'Create rule'}
                </Button>
            </div>

            {preview && <BotRulePreview preview={preview} />}
        </form>
    );
}
