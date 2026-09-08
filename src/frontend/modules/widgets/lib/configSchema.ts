/**
 * @fileoverview Turns a widget type's `configSchema` (JSON Schema Draft 7)
 * into the fields the settings form renders, seeds working values from a
 * saved `instanceConfig`, and validates the working values back into the
 * object to persist.
 *
 * The schema is the widget's admin form. Without this translation every
 * widget's settings would be a raw JSON textarea, which is how the form
 * used to work and what operators found hardest to use. The server's AJV
 * check stays authoritative; the subset applied here (required presence,
 * number typing and range, array `minItems`) covers the common mistakes so
 * they surface inline before a request is made.
 *
 * @module modules/widgets/lib/configSchema
 */

import type { JSONSchema7, JSONSchema7Definition } from 'json-schema';
import { enumOptionLabel, humanizeKey } from './layoutPresets';

/**
 * One operator-editable instanceConfig field, derived from one property of
 * a widget type's `configSchema`.
 */
export interface IConfigFieldDescriptor {
    /** Property name in the schema (and key in the emitted config). */
    key: string;
    /** The property's own JSON Schema sub-document. */
    schema: JSONSchema7;
    /** True when the schema lists this key under `required`. */
    required: boolean;
    /** Human label: the schema `title` or a humanised key. */
    label: string;
    /** Optional help text from the schema `description`. */
    description?: string;
}

/** The control a field renders as. */
export type ConfigControlType = 'boolean' | 'enum' | 'number' | 'text' | 'array';

/**
 * Resolve a schema property's primary scalar type, ignoring a nullable
 * `['string', 'null']` union by taking the first non-null member.
 *
 * @param schema - Property schema.
 * @returns The primary type name, or undefined when untyped.
 */
export function primaryType(schema: JSONSchema7): string | undefined {
    const type = schema.type;
    return Array.isArray(type) ? type.find(member => member !== 'null') : type;
}

/**
 * Map a property schema to the control it renders as. Enums take
 * precedence over the raw string type so a constrained string becomes a
 * select rather than free text; arrays render as a repeatable row editor
 * whatever their item shape.
 *
 * @param schema - Property schema.
 * @returns The control kind to render.
 */
export function fieldControlType(schema: JSONSchema7): ConfigControlType {
    const type = primaryType(schema);
    let control: ConfigControlType = 'text';
    if (type === 'boolean') {
        control = 'boolean';
    } else if (type === 'array') {
        control = 'array';
    } else if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        control = 'enum';
    } else if (type === 'integer' || type === 'number') {
        control = 'number';
    }
    return control;
}

/**
 * Whether a string property is edited in a multiline box. A widget's raw
 * HTML block or a paragraph of copy squeezed into a single-line input hides
 * everything past the first eighty characters. The schema says which
 * strings are long-form: a `contentMediaType` or a `maxLength` well beyond
 * a one-line value.
 *
 * @param schema - The string property's schema.
 * @returns True when the field renders as a textarea.
 */
export function isMultilineString(schema: JSONSchema7): boolean {
    const longMaxLength = typeof schema.maxLength === 'number' && schema.maxLength > 200;
    return typeof schema.contentMediaType === 'string' || longMaxLength;
}

/**
 * Whether an enum renders as a segmented control (every choice visible,
 * one tap to pick) instead of a dropdown. Segments suit a small set of
 * short choices; a dropdown still serves a long list or long labels. A
 * segmented control has no unset state, so an optional enum with no schema
 * default keeps the dropdown, whose blank option means "use the widget's
 * default".
 *
 * @param field - The enum field descriptor.
 * @returns True when the field renders as segments.
 */
export function enumUsesSegments(field: IConfigFieldDescriptor): boolean {
    const members = field.schema.enum ?? [];
    const canBeUnset = !field.required && field.schema.default === undefined;
    const fewShortChoices = members.length >= 2 && members.length <= 4
        && members.every(member => enumOptionLabel(member).length <= 14);
    return !canBeUnset && fewShortChoices;
}

/**
 * Resolve an array property's item shape for the row editor: the item
 * sub-schema, whether each item is a scalar or an object, and (for object
 * items) the scalar fields each row exposes. A tuple `items` array or a
 * boolean shorthand yields an empty object schema and scalar kind;
 * {@link isRepresentableArray} rejects those upstream.
 *
 * @param schema - The array property's own schema.
 * @returns The item kind, the item sub-schema, and object-item sub-fields.
 */
export function describeArrayItems(schema: JSONSchema7): {
    kind: 'scalar' | 'object';
    itemSchema: JSONSchema7;
    fields: IConfigFieldDescriptor[];
} {
    const items = schema.items;
    const itemSchema: JSONSchema7 =
        items && typeof items === 'object' && !Array.isArray(items) ? items : {};
    const kind = primaryType(itemSchema) === 'object' ? 'object' : 'scalar';
    const fields = kind === 'object' ? extractConfigFields(itemSchema) : [];
    return { kind, itemSchema, fields };
}

/**
 * Whether an array property can be edited through the structured form: its
 * `items` is a single schema whose item is either a scalar or an object
 * with at least one representable scalar field. Arrays of arrays, or object
 * items with nothing the form can render, stay raw-JSON-only.
 *
 * @param schema - The array property's own schema.
 * @returns True when the row editor can round-trip the property.
 */
export function isRepresentableArray(schema: JSONSchema7): boolean {
    const items = schema.items;
    let representable = false;
    if (items && typeof items === 'object' && !Array.isArray(items)) {
        const { kind, fields } = describeArrayItems(schema);
        representable = kind === 'object' ? fields.length > 0 : true;
    }
    return representable;
}

/**
 * Flatten a widget type's `configSchema` into the ordered list of fields
 * the form renders. Top-level scalars (boolean, enum, number, string) are
 * surfaced, plus arrays the row editor can represent. Boolean sub-schemas
 * carry no metadata, plain `object` properties cannot round-trip, and
 * unrepresentable arrays are skipped; all remain editable through the
 * raw-JSON view. Property insertion order is preserved.
 *
 * @param schema - The widget type's instanceConfig schema, if any.
 * @returns Ordered field descriptors (empty when no schema fields apply).
 */
export function extractConfigFields(schema: JSONSchema7 | undefined): IConfigFieldDescriptor[] {
    const fields: IConfigFieldDescriptor[] = [];
    if (schema && primaryType(schema) === 'object' && schema.properties) {
        const required = new Set(Array.isArray(schema.required) ? schema.required : []);
        for (const [key, definition] of Object.entries(schema.properties as Record<string, JSONSchema7Definition>)) {
            if (typeof definition === 'boolean') continue;
            const propertyType = primaryType(definition);
            if (propertyType === 'object') continue;
            if (propertyType === 'array' && !isRepresentableArray(definition)) continue;
            fields.push({
                key,
                schema: definition,
                required: required.has(key),
                label: typeof definition.title === 'string' ? definition.title : humanizeKey(key),
                description: typeof definition.description === 'string' ? definition.description : undefined
            });
        }
    }
    return fields;
}

/**
 * Build the form's working values from a saved instanceConfig, falling
 * back to each field's schema `default`. Numbers with no value become an
 * empty string so the numeric input renders blank rather than `NaN`; an
 * enum keeps its saved member whatever its type so a numeric or boolean
 * member survives a round trip; strings default to empty; booleans to
 * false; arrays to the saved or default array.
 *
 * @param fields - Field descriptors for the active schema.
 * @param existing - Saved instanceConfig, or undefined for a new row.
 * @returns Keyed working values for the controlled form.
 */
export function coerceInitialConfig(
    fields: ReadonlyArray<IConfigFieldDescriptor>,
    existing: Record<string, unknown> | undefined
): Record<string, unknown> {
    const value: Record<string, unknown> = {};
    for (const field of fields) {
        const provided = existing ? existing[field.key] : undefined;
        const fallback = field.schema.default;
        const control = fieldControlType(field.schema);
        if (control === 'array') {
            value[field.key] = Array.isArray(provided) ? provided : Array.isArray(fallback) ? fallback : [];
        } else if (control === 'boolean') {
            value[field.key] = Boolean(provided ?? fallback ?? false);
        } else if (control === 'number') {
            const candidate = provided ?? fallback;
            value[field.key] = typeof candidate === 'number' ? candidate : '';
        } else if (control === 'enum') {
            const candidate = provided ?? fallback;
            const isMember = typeof candidate === 'string'
                || typeof candidate === 'number'
                || typeof candidate === 'boolean';
            value[field.key] = isMember ? candidate : '';
        } else {
            const candidate = provided ?? fallback;
            value[field.key] = typeof candidate === 'string' ? candidate : '';
        }
    }
    return value;
}

/**
 * Validate and coerce one scalar working value against its schema. Shared
 * by the top-level field loop and scalar array items so both report
 * failures identically. Booleans always yield a value; an optional empty
 * yields `{}` (omit); a required empty or a typing or range violation
 * yields `{ error }`.
 *
 * @param schema - The scalar property schema.
 * @param raw - The current working value.
 * @param label - Human label used in error messages.
 * @param required - Whether an empty value is an error rather than an omit.
 * @returns A value to emit, an empty object to omit, or an error to surface.
 */
export function coerceScalarValue(
    schema: JSONSchema7,
    raw: unknown,
    label: string,
    required: boolean
): { value?: unknown; error?: string } {
    const control = fieldControlType(schema);
    let result: { value?: unknown; error?: string };
    const isEmpty = raw === undefined || raw === null || raw === '';
    if (control === 'boolean') {
        result = { value: Boolean(raw) };
    } else if (isEmpty) {
        result = required ? { error: `${label} is required.` } : {};
    } else if (control === 'number') {
        const num = Number(raw);
        if (Number.isNaN(num)) {
            result = { error: `${label} must be a number.` };
        } else if (primaryType(schema) === 'integer' && !Number.isInteger(num)) {
            result = { error: `${label} must be a whole number.` };
        } else if (typeof schema.minimum === 'number' && num < schema.minimum) {
            result = { error: `${label} must be at least ${schema.minimum}.` };
        } else if (typeof schema.maximum === 'number' && num > schema.maximum) {
            result = { error: `${label} must be at most ${schema.maximum}.` };
        } else {
            result = { value: num };
        }
    } else {
        result = { value: raw };
    }
    return result;
}

/**
 * Build and validate one array field's items. Object items recurse through
 * {@link buildStructuredConfig}; scalar items coerce individually and drop
 * blank optional rows. Enforces the array's own `minItems` (defaulting to 1
 * for a required array) so an empty required array fails inline.
 *
 * @param field - The array field descriptor.
 * @param raw - The current working value (expected to be an array).
 * @returns The built item array, or an error message to display.
 */
export function buildArrayConfig(
    field: IConfigFieldDescriptor,
    raw: unknown
): { value?: unknown[]; error?: string } {
    const items = Array.isArray(raw) ? raw : [];
    const { kind, itemSchema, fields: itemFields } = describeArrayItems(field.schema);
    const built: unknown[] = [];
    let error: string | undefined;
    for (let index = 0; index < items.length && !error; index++) {
        if (kind === 'object') {
            const source = items[index] && typeof items[index] === 'object'
                ? (items[index] as Record<string, unknown>)
                : {};
            const res = buildStructuredConfig(itemFields, source);
            if (res.error) {
                error = `${field.label} #${index + 1}: ${res.error}`;
            } else {
                built.push(res.value ?? {});
            }
        } else {
            const res = coerceScalarValue(itemSchema, items[index], `${field.label} #${index + 1}`, false);
            if (res.error) {
                error = res.error;
            } else if ('value' in res) {
                built.push(res.value);
            }
        }
    }
    const minItems = typeof field.schema.minItems === 'number'
        ? field.schema.minItems
        : field.required ? 1 : 0;
    if (!error && built.length < minItems) {
        error = `${field.label} needs at least ${minItems} ${minItems === 1 ? 'entry' : 'entries'}.`;
    }
    return error ? { error } : { value: built };
}

/**
 * Serialise the form's working values into the instanceConfig object to
 * persist. Booleans are always emitted; optional empty scalars and empty
 * optional arrays are omitted so they fall through to the widget's own
 * defaults; required empties, typing or range violations, and short
 * required arrays produce an error.
 *
 * @param fields - Field descriptors for the active schema.
 * @param value - Current working values.
 * @returns The config object, or an error message to display.
 */
export function buildStructuredConfig(
    fields: ReadonlyArray<IConfigFieldDescriptor>,
    value: Record<string, unknown>
): { value?: Record<string, unknown>; error?: string } {
    const result: Record<string, unknown> = {};
    let error: string | undefined;
    for (const field of fields) {
        if (error) break;
        const control = fieldControlType(field.schema);
        const raw = value[field.key];
        if (control === 'array') {
            const built = buildArrayConfig(field, raw);
            if (built.error) {
                error = built.error;
            } else {
                const arr = built.value ?? [];
                if (field.required || arr.length > 0) {
                    result[field.key] = arr;
                }
            }
        } else {
            const res = coerceScalarValue(field.schema, raw, field.label, field.required);
            if (res.error) {
                error = res.error;
            } else if ('value' in res) {
                result[field.key] = res.value;
            }
        }
    }
    return error ? { error } : { value: result };
}

/**
 * Whether a field takes the full width of the settings grid. Short
 * controls (a dropdown, segments, a number) sit two to a row; free text, a
 * switch with a sentence of help, or a list of rows needs the whole width.
 *
 * @param field - The field descriptor.
 * @returns True when the field spans both grid columns.
 */
export function fieldSpansRow(field: IConfigFieldDescriptor): boolean {
    const control = fieldControlType(field.schema);
    return control === 'text' || control === 'array' || control === 'boolean';
}

/**
 * Derive a singular noun from a plural field label for per-row labels and
 * the add-row button ("Zones" becomes "Zone"). A trailing-`s` strip is
 * enough for the labels widget schemas use.
 *
 * @param label - The array field's plural label.
 * @returns A best-effort singular form.
 */
export function singularizeLabel(label: string): string {
    return label.length > 1 && label.endsWith('s') ? label.slice(0, -1) : label;
}

/**
 * Serialise working values to JSON for the raw editor without validating,
 * so a half-filled or out-of-range form survives the switch and the
 * operator can hand-fix it rather than losing it to `{}`.
 *
 * @param fields - Field descriptors for the active schema.
 * @param value - Current working values.
 * @returns Pretty-printed JSON of the non-empty values.
 */
export function draftConfigJson(
    fields: ReadonlyArray<IConfigFieldDescriptor>,
    value: Record<string, unknown>
): string {
    const draft: Record<string, unknown> = {};
    for (const field of fields) {
        const raw = value[field.key];
        if (fieldControlType(field.schema) === 'boolean') {
            draft[field.key] = Boolean(raw);
        } else if (raw !== undefined && raw !== null && raw !== '') {
            draft[field.key] = raw;
        }
    }
    return JSON.stringify(draft, null, 2);
}
