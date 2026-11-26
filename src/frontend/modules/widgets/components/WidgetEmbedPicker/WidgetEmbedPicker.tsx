'use client';

/**
 * @fileoverview The Insert widget dialog used by the page and post editors.
 *
 * An author picks an embeddable widget type and fills in its settings, and
 * the dialog hands back the ` ```widget ` block for the editor to insert. The
 * settings form is the one the placement editor builds from the type's
 * schema, so a setting offered as a picker or dropdown there is offered the
 * same way here, and the result passes the same schema check when the embed
 * is resolved.
 *
 * The Required switch marks the embed `required`, for a page built around
 * the widget: while the widget's type is unregistered, usually because its
 * plugin is disabled, the page is treated as missing instead of showing an
 * empty space where the widget belongs.
 *
 * The type list loads when the dialog opens, which is a user action, so a
 * loading line is shown until it arrives.
 */

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import type { IWidgetTypeSnapshot } from '@/types';
import { Button } from '../../../../components/ui/Button';
import { Field } from '../../../../components/ui/Field';
import { Select } from '../../../../components/ui/Select';
import { Switch } from '../../../../components/ui/Switch';
import { fetchWidgetTypes } from '../../api/client';
import { buildStructuredConfig, coerceInitialConfig, extractConfigFields, fieldSpansRow } from '../../lib/configSchema';
import { formatWidgetEmbedBlock } from '../../lib/formatWidgetEmbedBlock';
import { findWidgetType, providerLabel } from '../../lib/placementLookup';
import { InstanceConfigField } from '../InstanceConfigField';
import styles from './WidgetEmbedPicker.module.scss';

/**
 * Props for the Insert widget dialog body.
 */
export interface IWidgetEmbedPickerProps {
    /** Receives the markdown block to insert; the caller closes the dialog. */
    onInsert: (block: string) => void;
    /** Called when the author cancels; the caller closes the dialog. */
    onCancel: () => void;
}

/**
 * Keep only the types that may be embedded, dropping owners left with none,
 * so the dropdown never offers a widget the resolver would refuse.
 *
 * @param snapshot - Every registered type, grouped by owner.
 * @returns The embeddable subset in the same shape.
 */
function embeddableOnly(snapshot: IWidgetTypeSnapshot): IWidgetTypeSnapshot {
    return {
        groups: snapshot.groups
            .map(group => ({ ...group, types: group.types.filter(type => type.embeddable) }))
            .filter(group => group.types.length > 0)
    };
}

/**
 * The dialog body: a type dropdown, the type's settings, and Insert.
 *
 * @param props - See {@link IWidgetEmbedPickerProps}.
 * @returns The form.
 */
export function WidgetEmbedPicker({ onInsert, onCancel }: IWidgetEmbedPickerProps) {
    const formId = useId();
    const [types, setTypes] = useState<IWidgetTypeSnapshot | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [typeId, setTypeId] = useState('');
    const [configValue, setConfigValue] = useState<Record<string, unknown>>({});
    const [configError, setConfigError] = useState<string | null>(null);
    const [required, setRequired] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetchWidgetTypes()
            .then(snapshot => { if (!cancelled) setTypes(embeddableOnly(snapshot)); })
            .catch((error: unknown) => {
                if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load widget types');
            });
        return () => { cancelled = true; };
    }, []);

    const selectedType = useMemo(() => findWidgetType(types, typeId), [types, typeId]);
    const configFields = useMemo(() => extractConfigFields(selectedType?.configSchema), [selectedType]);

    // A new type brings a new schema, so start its settings from the schema defaults.
    useEffect(() => {
        setConfigValue(coerceInitialConfig(configFields, undefined));
        setConfigError(null);
    }, [configFields]);

    /** Build the block from the chosen type and settings, or show why the settings are invalid. */
    const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const built = buildStructuredConfig(configFields, configValue);
        if (built.error) {
            setConfigError(built.error);
        } else if (typeId) {
            onInsert(formatWidgetEmbedBlock({ type: typeId, config: built.value ?? {}, ...(required ? { required: true as const } : {}) }));
        }
    }, [configFields, configValue, typeId, required, onInsert]);

    let body: JSX.Element;
    if (loadError) {
        body = <p className={styles.notice} role="alert">{loadError}</p>;
    } else if (!types) {
        body = <p className={styles.notice}>Loading widgets…</p>;
    } else if (types.groups.length === 0) {
        body = <p className={styles.notice}>No widget can be embedded right now.</p>;
    } else {
        body = (
            <>
                <Field label="Widget" required hint={selectedType?.description}>
                    <Select id={`${formId}-type`} size="sm" value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
                        <option value="">Choose a widget</option>
                        {types.groups.map(group => (
                            <optgroup key={group.pluginId} label={providerLabel(group.pluginId)}>
                                {group.types.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
                            </optgroup>
                        ))}
                    </Select>
                </Field>
                {configFields.length > 0 && (
                    <div className={styles.grid}>
                        {configFields.map(field => (
                            <InstanceConfigField
                                key={field.key}
                                field={field}
                                value={configValue[field.key]}
                                idPrefix={`${formId}-config`}
                                disabled={false}
                                className={fieldSpansRow(field) ? styles.span : undefined}
                                onChange={(next) => { setConfigValue(prev => ({ ...prev, [field.key]: next })); setConfigError(null); }}
                            />
                        ))}
                    </div>
                )}
                {configError && <p className={styles.error} role="alert">{configError}</p>}
                <Field
                    inline
                    label="Required"
                    htmlFor={`${formId}-required`}
                    hint="Hide the whole page while this widget is unavailable, such as when its plugin is disabled. Leave off for a widget the page can do without."
                >
                    <Switch id={`${formId}-required`} size="sm" on={required} onChange={setRequired} aria-label="Required" />
                </Field>
            </>
        );
    }

    return (
        <form className={styles.form} onSubmit={handleSubmit}>
            {body}
            <div className={styles.actions}>
                <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={!typeId}>Insert</Button>
            </div>
        </form>
    );
}
