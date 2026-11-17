'use client';

/**
 * @fileoverview Generic configuration card for one external data vendor.
 *
 * Renders a vendor's form from the field descriptors the backend registry
 * publishes, so a vendor declared on the backend gets a card here with no
 * frontend change. Each field kind maps to one control: a switch, a select, a
 * bounded number, a URL or text input, or a secret input. A secret loads
 * masked, the input never pre-fills the masked value (so a save cannot echo
 * `****` back over the real key), and a Clear button sends the backend's clear
 * sentinel. A Test button runs the vendor's live check against the saved
 * config so the operator can confirm connectivity or a pasted key.
 */

import { useEffect, useState, useCallback, type ChangeEvent, type ReactElement } from 'react';
import { Eye, EyeOff, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { Panel } from '../../../../../../../components/ui/Panel';
import { Button } from '../../../../../../../components/ui/Button';
import { Field } from '../../../../../../../components/ui/Field';
import { IconButton } from '../../../../../../../components/ui/IconButton';
import { Input } from '../../../../../../../components/ui/Input';
import { Select } from '../../../../../../../components/ui/Select';
import { Switch } from '../../../../../../../components/ui/Switch';
import { Badge } from '../../../../../../../components/ui/Badge';
import {
    updateProviderConfig,
    testProvider,
    CLEAR_SENTINEL,
    type IProviderView,
    type IProviderFieldView,
    type IProviderTestResult
} from './providers-api';
import styles from './ProviderSection.module.scss';

/** Props for the generic vendor card. */
interface IProviderVendorSectionProps {
    /** The vendor's descriptor and masked config, as the list endpoint returned it. */
    provider: IProviderView;
}

/**
 * Pull the non-secret field values out of a masked config so the form can
 * edit them, leaving secrets to their own typed inputs.
 *
 * @param fields - The vendor's field descriptors.
 * @param config - The masked config.
 * @returns Editable values keyed by field.
 */
function editableValues(fields: IProviderFieldView[], config: Record<string, unknown>): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const field of fields) {
        if (field.kind !== 'secret') {
            values[field.key] = config[field.key];
        }
    }
    return values;
}

/**
 * Render and manage one vendor's config form.
 *
 * @param props - {@link IProviderVendorSectionProps}.
 * @returns The configuration card.
 */
export function ProviderVendorSection({ provider }: IProviderVendorSectionProps) {
    const [config, setConfig] = useState<Record<string, unknown>>(provider.config);
    const [values, setValues] = useState<Record<string, unknown>>(() => editableValues(provider.fields, provider.config));
    const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
    const [revealed, setRevealed] = useState<Record<string, boolean>>({});
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<IProviderTestResult | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    /** Seed local form state from a freshly-saved masked config. */
    const applyConfig = useCallback((next: Record<string, unknown>) => {
        setConfig(next);
        setValues(editableValues(provider.fields, next));
    }, [provider.fields]);

    /**
     * Auto-dismiss a success message after a short delay. Driving this from an
     * effect rather than a per-handler timer guarantees the timeout is cleared
     * on unmount and whenever newer feedback replaces it.
     */
    useEffect(() => {
        const timer = feedback?.type === 'success'
            ? setTimeout(() => setFeedback(null), 4000)
            : undefined;
        return () => clearTimeout(timer);
    }, [feedback]);

    /**
     * Persist the form. Every non-secret field is sent; a secret is sent only
     * when the operator typed a new one, so an untouched field leaves the
     * stored key intact.
     */
    const handleSave = useCallback(async () => {
        setSaving(true);
        setFeedback(null);
        setTestResult(null);
        try {
            const updates: Record<string, unknown> = { ...values };
            for (const field of provider.fields) {
                if (field.kind === 'secret') {
                    const typed = (secretInputs[field.key] ?? '').trim();
                    if (typed) {
                        updates[field.key] = typed;
                    }
                }
            }
            const next = await updateProviderConfig(provider.id, updates);
            applyConfig(next);
            setSecretInputs({});
            setRevealed({});
            setFeedback({ type: 'success', message: `${provider.label} configuration saved.` });
        } catch (err) {
            setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save.' });
        } finally {
            setSaving(false);
        }
    }, [values, secretInputs, provider, applyConfig]);

    /**
     * Clear one stored secret via the backend sentinel.
     *
     * @param key - The secret field to clear.
     */
    const handleClearSecret = useCallback(async (key: string) => {
        setSaving(true);
        setFeedback(null);
        try {
            const next = await updateProviderConfig(provider.id, { [key]: CLEAR_SENTINEL });
            applyConfig(next);
            setSecretInputs((current) => ({ ...current, [key]: '' }));
            setFeedback({ type: 'success', message: 'Key cleared.' });
        } catch (err) {
            setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to clear key.' });
        } finally {
            setSaving(false);
        }
    }, [provider.id, applyConfig]);

    /**
     * Run the vendor's live connectivity/credential test against the *saved* config.
     */
    const handleTest = useCallback(async () => {
        setTesting(true);
        setTestResult(null);
        try {
            setTestResult(await testProvider(provider.id));
        } catch (err) {
            setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Test failed.' });
        } finally {
            setTesting(false);
        }
    }, [provider.id]);

    /** Update one editable value. */
    const setValue = useCallback((key: string, value: unknown) => {
        setValues((current) => ({ ...current, [key]: value }));
    }, []);

    const secretFields = provider.fields.filter((field) => field.kind === 'secret');
    const anySecretConfigured = secretFields.some((field) => config[`${field.key}Configured`] === true);
    const enabled = config.enabled;

    /**
     * Render the control for one field by its kind, wrapped in a `Field` that
     * owns its label and hint.
     *
     * A boolean is an inline field, so the switch sits beside its label at its
     * own width instead of stretching across the card with its icon in the
     * middle. A secret, with its reveal and clear buttons, and a URL each take
     * a wide cell; every other field takes one column of the grid.
     *
     * @param field - The field descriptor.
     * @returns The labelled control.
     */
    const renderField = (field: IProviderFieldView): ReactElement => {
        const id = `${provider.id}-${field.key}`;
        const wide = field.kind === 'secret' || field.kind === 'url';
        let control: ReactElement;
        switch (field.kind) {
            case 'boolean':
                control = (
                    <Switch
                        id={id}
                        on={values[field.key] === true}
                        onChange={(on: boolean) => setValue(field.key, on)}
                        disabled={saving}
                        aria-label={field.label}
                    />
                );
                break;
            case 'select':
                control = (
                    <Select
                        id={id}
                        value={String(values[field.key] ?? '')}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => setValue(field.key, e.target.value)}
                        disabled={saving}
                    >
                        {(field.options ?? []).map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </Select>
                );
                break;
            case 'integer':
                control = (
                    <Input
                        id={id}
                        type="number"
                        min={field.min}
                        max={field.max}
                        step={1}
                        value={values[field.key] === undefined || values[field.key] === null ? '' : String(values[field.key])}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(field.key, e.target.value === '' ? undefined : Number(e.target.value))}
                        disabled={saving}
                    />
                );
                break;
            case 'secret': {
                const configured = config[`${field.key}Configured`] === true;
                const masked = String(config[field.key] ?? '');
                // The field wraps this row rather than the input, so it cannot
                // attach its hint to the input; the input names the hint itself.
                control = (
                    <div className={styles.input_row}>
                        <Input
                            id={id}
                            aria-describedby={field.hint ? `${id}-hint` : undefined}
                            type={revealed[field.key] ? 'text' : 'password'}
                            value={secretInputs[field.key] ?? ''}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setSecretInputs((current) => ({ ...current, [field.key]: e.target.value }))}
                            placeholder={configured ? `Configured (${masked}) — type to replace` : field.placeholder}
                            className={styles.mono}
                            disabled={saving}
                        />
                        <IconButton
                            onClick={() => setRevealed((current) => ({ ...current, [field.key]: !current[field.key] }))}
                            disabled={saving}
                            aria-label={revealed[field.key] ? 'Hide key' : 'Show key'}
                        >
                            {revealed[field.key] ? <EyeOff size={18} /> : <Eye size={18} />}
                        </IconButton>
                        {configured && (
                            <Button variant="ghost" onClick={() => handleClearSecret(field.key)} disabled={saving}>Clear</Button>
                        )}
                    </div>
                );
                break;
            }
            case 'url':
            case 'text':
            default:
                control = (
                    <Input
                        id={id}
                        type="text"
                        value={String(values[field.key] ?? '')}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className={field.kind === 'url' ? styles.mono : undefined}
                        disabled={saving}
                    />
                );
                break;
        }
        return (
            <Field
                key={field.key}
                label={field.label}
                htmlFor={id}
                hint={field.hint}
                inline={field.kind === 'boolean'}
                className={wide ? styles.field_wide : undefined}
            >
                {control}
            </Field>
        );
    };

    return (
        <Panel
            title={provider.label}
            meta={(
                <span className={styles.badges}>
                    {secretFields.length > 0 && (
                        anySecretConfigured ? <Badge tone="success">Key configured</Badge> : <Badge tone="neutral">Keyless</Badge>
                    )}
                    {enabled === false && <Badge tone="warning">Disabled</Badge>}
                    {provider.capabilities.map((capability) => (
                        <Badge key={capability} tone="info">{capability}</Badge>
                    ))}
                </span>
            )}
            actions={(
                <>
                    <Button
                        variant="secondary"
                        onClick={handleTest}
                        loading={testing}
                        disabled={saving || testing}
                        title="Tests the saved config, so save a new key before testing it"
                    >
                        Test connection
                    </Button>
                    <Button variant="primary" onClick={handleSave} loading={saving} disabled={saving}>
                        Save
                    </Button>
                </>
            )}
        >
            <p className={styles.description}>
                {provider.description}
                {provider.docsUrl && (
                    <>
                        {' '}
                        <a className={styles.docs_link} href={provider.docsUrl} target="_blank" rel="noopener noreferrer">
                            Vendor docs <ExternalLink size={14} aria-hidden />
                        </a>
                    </>
                )}
            </p>

            <div className={styles.field_grid}>
                {provider.fields.map(renderField)}
            </div>

            {secretFields.length > 0 && (
                <p className={styles.hint}>Test connection uses the saved config, so save a new key before testing it.</p>
            )}

            {testResult && (
                <div className={testResult.ok ? styles.feedback_success : styles.feedback_error} role="status">
                    {testResult.ok ? <CheckCircle size={16} aria-hidden /> : <AlertCircle size={16} aria-hidden />}
                    <span>
                        {testResult.message}
                        {typeof testResult.latencyMs === 'number' && ` (${testResult.latencyMs} ms${testResult.usingKey ? ', with key' : ', keyless'})`}
                    </span>
                </div>
            )}

            {feedback && (
                <div className={feedback.type === 'success' ? styles.feedback_success : styles.feedback_error} role="status">
                    {feedback.type === 'success' ? <CheckCircle size={16} aria-hidden /> : <AlertCircle size={16} aria-hidden />}
                    <span>{feedback.message}</span>
                </div>
            )}
        </Panel>
    );
}
