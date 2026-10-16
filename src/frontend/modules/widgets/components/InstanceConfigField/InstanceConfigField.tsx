'use client';

/**
 * @fileoverview Renders one schema-derived widget setting.
 *
 * A widget type declares its settings as JSON Schema, and this component
 * turns one property into the control its type implies: a toggle row for
 * booleans, segments or a dropdown for enums, a numeric input for numbers
 * with min, max, and step, a textarea for long-form strings, the icon
 * picker for a string declaring the shared icon-name format, the file
 * picker with a preview for a string declaring the shared image-URL format,
 * a dropdown of existing menus for a string declaring the shared
 * menu-namespace format, a text input otherwise, and a repeatable row
 * editor for arrays. The label carries the
 * schema title and a required marker; the description becomes help text,
 * or a tooltip and placeholder inside a list row where repeated paragraphs
 * would bury the controls.
 *
 * @module modules/widgets/components/InstanceConfigField
 */

import { useEffect, useState, type ReactElement } from 'react';
import { ImageIcon, Plus, Shapes, Trash2 } from 'lucide-react';
import { MenuNodeIcon } from '../../../../components/layout/MenuNav/MenuNodeIcon';
import { Button } from '../../../../components/ui/Button';
import { Field } from '../../../../components/ui/Field';
import { IconButton } from '../../../../components/ui/IconButton';
import { LazyIconPickerModal } from '../../../../components/ui/IconPickerModal';
import { Input } from '../../../../components/ui/Input';
import { useModal } from '../../../../components/ui/ModalProvider';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { Select } from '../../../../components/ui/Select';
import { Switch } from '../../../../components/ui/Switch';
import { Textarea } from '../../../../components/ui/Textarea';
import { useToast } from '../../../../components/ui/ToastProvider/ToastProvider';
import { cn } from '../../../../lib/cn';
import { useFilePicker } from '../../../../lib/filePickerRegistry';
import { fetchMenuNamespaces } from '../../api/client';
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
 * Renders an icon-name setting as a button that shows the chosen icon and
 * opens the searchable icon picker, so an operator picks from what exists
 * instead of typing a lucide export name and hoping it resolves. The glyph
 * comes from `MenuNodeIcon`, which loads the icon library in its own chunk;
 * this control only ever renders in the admin editor, after hydration.
 *
 * @param props - See {@link IInstanceConfigFieldProps}.
 * @returns The labelled picker button.
 */
function InstanceConfigIconField({ field, value, idPrefix, disabled, compact = false, className, onChange }: IInstanceConfigFieldProps) {
    const { open, close } = useModal();
    const fieldId = `${idPrefix}-${field.key}`;
    const current = typeof value === 'string' ? value : '';
    const hint = compact ? undefined : field.description;

    /**
     * Open the icon picker in the shared modal, seeded with the current
     * choice, and write the picked name back to the form.
     */
    const openPicker = () => {
        const id = open({
            title: `Choose ${field.label.toLowerCase()}`,
            size: 'lg',
            content: (
                <LazyIconPickerModal
                    selectedIcon={current || undefined}
                    onSelect={(name) => onChange(name)}
                    onClose={() => close(id)}
                />
            )
        });
    };

    return (
        <Field label={field.label} required={field.required} hint={hint} className={className}>
            <Button
                id={fieldId}
                type="button"
                variant="secondary"
                size="sm"
                onClick={openPicker}
                disabled={disabled}
                title={compact ? field.description : undefined}
                aria-label={current ? `${field.label}: ${current}. Choose another` : `Choose ${field.label.toLowerCase()}`}
                className={styles.icon_choice}
            >
                {current
                    ? <MenuNodeIcon name={current} size={16} />
                    : <Shapes size={16} aria-hidden />}
                <span className={styles.icon_choice_name}>{current || 'Choose'}</span>
            </Button>
        </Field>
    );
}

/**
 * Renders an image-URL setting as a preview with Choose and Remove buttons,
 * so an operator uploads or picks an image through the platform file picker
 * instead of copying an upload URL by hand. The picker belongs to whichever
 * files-provider plugin is enabled. When none is, the control says so and
 * falls back to a text input, so the setting can still be filled in by
 * pasting a URL. The placements API checks the value against the image-URL
 * format either way.
 *
 * @param props - See {@link IInstanceConfigFieldProps}.
 * @returns The labelled image control.
 */
function InstanceConfigImageField({ field, value, idPrefix, disabled, compact = false, className, onChange }: IInstanceConfigFieldProps) {
    const { pick, isAvailable: pickerAvailable } = useFilePicker();
    const { push: pushToast } = useToast();
    const fieldId = `${idPrefix}-${field.key}`;
    const current = typeof value === 'string' ? value : '';
    const hint = compact ? undefined : field.description;

    /**
     * Open the file picker and write the chosen image's URL to the form.
     *
     * The picker's `accept` list is only a hint to the provider, so the
     * returned MIME type is checked here as well, and a file that is not an
     * image is refused with a message rather than written to the setting.
     */
    const choose = async () => {
        const selection = await pick({ accept: ['image/*'], title: `Choose ${field.label.toLowerCase()}` });

        if (selection && selection.mimeType.startsWith('image/')) {
            onChange(selection.url);
        } else if (selection) {
            pushToast({
                tone: 'danger',
                title: 'That file is not an image',
                description: `${selection.name} is ${selection.mimeType}. Choose a PNG, JPEG, WebP, or SVG file.`
            });
        }
    };

    // Field has no single element to decorate here, because its children are
    // the row wrapper plus the fallback note. It therefore clones nothing and
    // injects neither `aria-describedby` nor `aria-required`, and its contract
    // for that shape is to wire both onto the focusable control by hand. The
    // hint element Field renders takes its id from the `htmlFor` value passed
    // below, and the no-provider note is referenced alongside the hint so a
    // screen-reader user also hears why the control is a plain URL box.
    const noticeId = `${fieldId}-notice`;
    const describedIds = [
        hint ? `${fieldId}-hint` : undefined,
        pickerAvailable ? undefined : noticeId
    ].filter((id): id is string => id !== undefined);
    const describedBy = describedIds.length > 0 ? describedIds.join(' ') : undefined;

    // `htmlFor` points the label at the Choose button or URL input inside the
    // row, rather than at the row wrapper Field would otherwise label.
    return (
        <Field label={field.label} required={field.required} hint={hint} className={className} htmlFor={fieldId}>
            <div className={styles.image_choice}>
                <div className={styles.image_preview}>
                    {current
                        ? (
                            // Plain <img> is the project's convention for uploaded images.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={current} alt={`Preview of the ${field.label.toLowerCase()}`} className={styles.image_preview_img} />
                        )
                        : <ImageIcon size={18} aria-hidden />}
                </div>
                {pickerAvailable
                    ? (
                        <Button
                            id={fieldId}
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => void choose()}
                            disabled={disabled}
                            icon={<ImageIcon size={18} />}
                            aria-describedby={describedBy}
                            aria-required={field.required || undefined}
                        >
                            {current ? 'Choose another' : 'Choose image'}
                        </Button>
                    )
                    : (
                        <Input
                            id={fieldId}
                            size="sm"
                            className={styles.image_url_input}
                            value={current}
                            onChange={(e) => onChange(e.target.value)}
                            disabled={disabled}
                            placeholder="/uploads/... or https://..."
                            aria-describedby={describedBy}
                            aria-required={field.required || undefined}
                        />
                    )}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange('')}
                    disabled={disabled || !current}
                    icon={<Trash2 size={18} />}
                >
                    Remove
                </Button>
            </div>
            {!pickerAvailable && (
                <span id={noticeId} className={styles.hint}>
                    No files provider is enabled, so paste the image URL instead. Enable the Files plugin under
                    System, then Plugins, to upload or choose an image.
                </span>
            )}
        </Field>
    );
}

/**
 * Renders a menu-namespace setting as a dropdown of the namespaces the menu
 * service holds, so an operator picks an existing menu rather than typing
 * its name and getting an empty menu from a typo. The list is fetched when
 * the control mounts, which only happens after an operator opens the
 * placement editor. Until it arrives, and if it fails, the saved value stays
 * selectable so the control never shows a blank choice for a placement that
 * has one. If the list cannot be loaded, the control falls back to a text
 * input and says why; the placements API checks the value's shape either way.
 *
 * @param props - See {@link IInstanceConfigFieldProps}.
 * @returns The labelled namespace control.
 */
function InstanceConfigMenuNamespaceField({ field, value, idPrefix, disabled, compact = false, className, onChange }: IInstanceConfigFieldProps) {
    const [namespaces, setNamespaces] = useState<string[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const fieldId = `${idPrefix}-${field.key}`;
    const current = typeof value === 'string' ? value : '';
    const hint = compact ? undefined : field.description;
    const tooltip = compact ? field.description : undefined;

    /**
     * Load the namespace list once per mount. The `cancelled` flag stops a
     * response that arrives after the editor closed from setting state on an
     * unmounted control.
     */
    useEffect(() => {
        let cancelled = false;
        fetchMenuNamespaces()
            .then((names) => {
                if (!cancelled) setNamespaces(names);
            })
            .catch((error: unknown) => {
                if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // The saved value joins the list so a namespace that has since lost all
    // its nodes, or one the list has not loaded yet, still shows as chosen.
    const options = Array.from(new Set([...(namespaces ?? []), ...(current ? [current] : [])])).sort();
    let rendered: ReactElement;

    if (loadError) {
        const noticeId = `${fieldId}-notice`;
        rendered = (
            <Field label={field.label} required={field.required} hint={hint} className={className} htmlFor={fieldId}>
                <Input
                    id={fieldId}
                    size="sm"
                    value={current}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    placeholder="main"
                    title={tooltip}
                    aria-describedby={hint ? `${fieldId}-hint ${noticeId}` : noticeId}
                />
                <span id={noticeId} className={styles.hint}>
                    The list of menus could not be loaded ({loadError}), so type the namespace name instead.
                </span>
            </Field>
        );
    } else {
        rendered = (
            <Field label={field.label} required={field.required} hint={hint} className={className}>
                <Select
                    id={fieldId}
                    size="sm"
                    value={current}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    title={tooltip}
                >
                    {!field.required && <option value="">Default</option>}
                    {options.map(name => <option key={name} value={name}>{name}</option>)}
                </Select>
            </Field>
        );
    }

    return rendered;
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
    } else if (control === 'icon') {
        rendered = <InstanceConfigIconField {...props} />;
    } else if (control === 'image') {
        rendered = <InstanceConfigImageField {...props} />;
    } else if (control === 'menuNamespace') {
        rendered = <InstanceConfigMenuNamespaceField {...props} />;
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
