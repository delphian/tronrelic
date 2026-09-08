'use client';

/**
 * @fileoverview Renders one schema-derived widget setting.
 *
 * A widget type declares its settings as JSON Schema, and this component
 * turns one property into the control its type implies: a toggle row for
 * booleans, segments or a dropdown for enums, a numeric input for numbers
 * with min, max, and step, a textarea for long-form strings, a text input
 * otherwise, and a repeatable row editor for arrays. The label carries the
 * schema title and a required marker; the description becomes help text,
 * or a tooltip and placeholder inside a list row where repeated paragraphs
 * would bury the controls.
 *
 * @module modules/widgets/components/InstanceConfigField
 */

import type { ReactElement } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { Field } from '../../../../components/ui/Field';
import { IconButton } from '../../../../components/ui/IconButton';
import { Input } from '../../../../components/ui/Input';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { Select } from '../../../../components/ui/Select';
import { Switch } from '../../../../components/ui/Switch';
import { Textarea } from '../../../../components/ui/Textarea';
import { cn } from '../../../../lib/cn';
import {
    coerceInitialConfig,
    describeArrayItems,
    enumUsesSegments,
    fieldControlType,
    isMultilineString,
    primaryType,
    singularizeLabel,
    type IConfigFieldDescriptor
} from '../../lib/configSchema';
import { enumOptionLabel } from '../../lib/layoutPresets';
import styles from './InstanceConfigField.module.scss';

/**
 * Props shared by the scalar and array field renderers.
 */
export interface IInstanceConfigFieldProps {
    /** The field descriptor. */
    field: IConfigFieldDescriptor;
    /** The current working value. */
    value: unknown;
    /** Prefix keeping this field's element id unique across list rows. */
    idPrefix: string;
    /** Whether the control is inert because a save is in flight. */
    disabled: boolean;
    /** True inside a list row: help moves into a tooltip and placeholder. */
    compact?: boolean;
    /** Grid placement class supplied by the parent. */
    className?: string;
    /** Receives the new working value. */
    onChange: (next: unknown) => void;
}

/**
 * Work out the `step` a numeric input should carry. A schema with no
 * granularity allows every value in range, so the input must too; leaving
 * `step` off makes the browser default to 1 counted from `min`, which
 * turns a continuous range into a ladder. `multipleOf` states a real
 * granularity, but the browser counts steps from `min` while JSON Schema
 * counts from zero, so a `min` that is not itself a multiple would make
 * the browser refuse schema-valid values; and a fractional multiple on an
 * integer schema would step to non-integers the form then rejects. Both
 * cases drop the multiple and let validation enforce it.
 *
 * @param field - The number field.
 * @returns The step value for the input.
 */
function numericStep(field: IConfigFieldDescriptor): number | 'any' {
    const integer = primaryType(field.schema) === 'integer';
    const min = typeof field.schema.minimum === 'number' ? field.schema.minimum : undefined;
    const multiple = typeof field.schema.multipleOf === 'number' && field.schema.multipleOf > 0
        && (!integer || Number.isInteger(field.schema.multipleOf))
        ? field.schema.multipleOf
        : undefined;
    let step: number | 'any' = integer ? 1 : 'any';
    if (multiple !== undefined) {
        step = min === undefined || min % multiple === 0 ? multiple : 'any';
    }
    return step;
}

/**
 * Renders an array setting as an editable list of rows, so a widget whose
 * schema requires an array (for example the world clocks' time zones) is
 * configurable through the form rather than only through raw JSON. Each
 * row is either a group of scalar sub-fields (object items) or one scalar
 * control; both reuse {@link InstanceConfigField}.
 *
 * @param props - See {@link IInstanceConfigFieldProps}.
 * @returns The list editor.
 */
function InstanceConfigArrayField({ field, value, idPrefix, disabled, className, onChange }: IInstanceConfigFieldProps) {
    const items = Array.isArray(value) ? value : [];
    const { kind, itemSchema, fields: itemFields } = describeArrayItems(field.schema);
    const singular = singularizeLabel(field.label);

    /**
     * Replace one row and lift the new array to the parent.
     *
     * @param index - Row position to replace.
     * @param nextItem - The row's new value.
     */
    const updateItem = (index: number, nextItem: unknown) => {
        const next = items.slice();
        next[index] = nextItem;
        onChange(next);
    };

    /**
     * Append a blank row seeded from the item shape so it renders editable
     * controls rather than nothing.
     */
    const addItem = () => {
        const blank = kind === 'object' ? coerceInitialConfig(itemFields, undefined) : itemSchema.default ?? '';
        onChange([...items, blank]);
    };

    return (
        <div className={cn(styles.group, className)}>
            <div className={styles.group_header}>
                <span className={styles.label}>
                    {field.label}
                    {field.required && <span className={styles.required} aria-hidden> *</span>}
                </span>
                <Button type="button" variant="ghost" size="xs" onClick={addItem} disabled={disabled}>
                    <Plus size={14} aria-hidden /> Add {singular.toLowerCase()}
                </Button>
            </div>
            {field.description && <span className={styles.hint}>{field.description}</span>}
            <div className={styles.array}>
                {items.length === 0 && (
                    <span className={styles.array_empty}>No {field.label.toLowerCase()} yet.</span>
                )}
                {items.map((item, index) => (
                    <div key={index} className={styles.array_item}>
                        <span className={styles.array_index} aria-hidden>{index + 1}</span>
                        <div className={styles.array_fields}>
                            {kind === 'object'
                                ? itemFields.map(sub => (
                                    <InstanceConfigField
                                        key={sub.key}
                                        field={sub}
                                        value={item && typeof item === 'object' ? (item as Record<string, unknown>)[sub.key] : undefined}
                                        idPrefix={`${idPrefix}-${field.key}-${index}`}
                                        disabled={disabled}
                                        compact
                                        onChange={(next) => updateItem(index, {
                                            ...(item && typeof item === 'object' ? item as Record<string, unknown> : {}),
                                            [sub.key]: next
                                        })}
                                    />
                                ))
                                : (
                                    <InstanceConfigField
                                        field={{ key: 'item', schema: itemSchema, required: false, label: `${singular} ${index + 1}` }}
                                        value={item}
                                        idPrefix={`${idPrefix}-${field.key}-${index}`}
                                        disabled={disabled}
                                        compact
                                        onChange={(next) => updateItem(index, next)}
                                    />
                                )}
                        </div>
                        <IconButton
                            size="sm"
                            variant="danger"
                            aria-label={`Remove ${singular} ${index + 1}`}
                            onClick={() => onChange(items.filter((_, i) => i !== index))}
                            disabled={disabled}
                        >
                            <Trash2 size={14} />
                        </IconButton>
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * One setting, rendered with the control its schema implies.
 *
 * @param props - See {@link IInstanceConfigFieldProps}.
 * @returns The control with its label and help.
 */
export function InstanceConfigField(props: IInstanceConfigFieldProps) {
    const { field, value, idPrefix, disabled, compact = false, className, onChange } = props;
    const control = fieldControlType(field.schema);
    const fieldId = `${idPrefix}-${field.key}`;
    const hint = compact ? undefined : field.description;
    const tooltip = compact ? field.description : undefined;
    const marker = field.required ? <span className={styles.required} aria-hidden> *</span> : null;
    let rendered: ReactElement;

    if (control === 'array') {
        rendered = <InstanceConfigArrayField {...props} />;
    } else if (control === 'boolean') {
        rendered = (
            <div className={cn(styles.toggle_row, className)}>
                <Switch
                    id={fieldId}
                    size="sm"
                    on={Boolean(value)}
                    onChange={onChange}
                    disabled={disabled}
                    aria-label={field.label}
                    title={tooltip}
                />
                <label htmlFor={fieldId} className={styles.toggle_text}>
                    <span className={styles.label}>{field.label}</span>
                    {hint && <span className={styles.hint}>{hint}</span>}
                </label>
            </div>
        );
    } else if (control === 'enum') {
        const members = field.schema.enum ?? [];
        const current = value !== undefined && value !== null ? String(value) : '';

        /**
         * Map the chosen option's string form back to the typed member so a
         * numeric or boolean enum keeps the type the server expects.
         *
         * @param selected - The option or segment value.
         */
        const selectMember = (selected: string) => {
            const match = members.find(member => String(member) === selected);
            onChange(match !== undefined ? match : selected);
        };

        rendered = enumUsesSegments(field) ? (
            <div className={cn(styles.group, className)}>
                <span className={styles.label}>{field.label}{marker}</span>
                <SegmentedControl
                    label={field.label}
                    value={current}
                    disabled={disabled}
                    onChange={selectMember}
                    options={members.map(member => {
                        const raw = String(member);
                        const text = enumOptionLabel(member);
                        return { id: raw, label: text, title: text === raw ? undefined : raw };
                    })}
                />
                {hint && <span className={styles.hint}>{hint}</span>}
            </div>
        ) : (
            <Field label={field.label} required={field.required} hint={hint} className={className}>
                <Select
                    id={fieldId}
                    size="sm"
                    value={current}
                    onChange={(e) => selectMember(e.target.value)}
                    disabled={disabled}
                    title={tooltip}
                >
                    {!field.required && <option value="">Default</option>}
                    {members.map(member => {
                        const raw = String(member);
                        return <option key={raw} value={raw}>{enumOptionLabel(member)}</option>;
                    })}
                </Select>
            </Field>
        );
    } else if (control === 'number') {
        const integer = primaryType(field.schema) === 'integer';
        rendered = (
            <Field label={field.label} required={field.required} hint={hint} className={className}>
                <Input
                    id={fieldId}
                    size="sm"
                    type="number"
                    inputMode={integer ? 'numeric' : 'decimal'}
                    min={typeof field.schema.minimum === 'number' ? field.schema.minimum : undefined}
                    max={typeof field.schema.maximum === 'number' ? field.schema.maximum : undefined}
                    step={numericStep(field)}
                    value={value === undefined || value === null || value === '' ? '' : String(value)}
                    onChange={(e) => {
                        // Hold transient unparseable input (`-`, `1e`) as text
                        // rather than NaN, which would render as "NaN" and trap
                        // the field; a clean parse is stored as a number.
                        const text = e.target.value;
                        if (text === '') {
                            onChange('');
                        } else {
                            const num = Number(text);
                            onChange(Number.isNaN(num) ? text : num);
                        }
                    }}
                    disabled={disabled}
                    title={tooltip}
                />
            </Field>
        );
    } else {
        const text = typeof value === 'string' ? value : '';
        rendered = (
            <Field label={field.label} required={field.required} hint={hint} className={className}>
                {isMultilineString(field.schema) ? (
                    <Textarea
                        id={fieldId}
                        size="sm"
                        className={styles.textarea_content}
                        rows={6}
                        value={text}
                        onChange={(e) => onChange(e.target.value)}
                        disabled={disabled}
                        spellCheck={false}
                        placeholder={tooltip}
                        title={tooltip}
                    />
                ) : (
                    <Input
                        id={fieldId}
                        size="sm"
                        value={text}
                        onChange={(e) => onChange(e.target.value)}
                        disabled={disabled}
                        placeholder={tooltip}
                        title={tooltip}
                    />
                )}
            </Field>
        );
    }

    return rendered;
}
