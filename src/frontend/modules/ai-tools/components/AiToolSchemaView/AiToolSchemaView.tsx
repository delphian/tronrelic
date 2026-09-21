'use client';

/**
 * @fileoverview Read-only view of an AI tool's input parameter schema.
 *
 * An admin auditing a tool needs to see exactly what the model is allowed to
 * pass — each parameter's name, type, whether it's required, the values it is
 * restricted to, and its description — without reading source. The
 * `/system/ai-tools` detail panel renders it, and plugins receive the same
 * component as `context.system.AiToolSchemaView` so a plugin admin page listing
 * its own tools shows parameters identically.
 *
 * The parameters render as a two-column definition list rather than one boxed
 * card each: the name and type sit in a narrow left column and the description
 * fills the rest of the row, so a tool with nine parameters takes nine short
 * rows instead of nine stacked cards. JSON Schema property values can be
 * booleans, so each is read defensively. Tools that take no parameters get a
 * plain note rather than an empty list.
 */

import type { IAiToolSchemaViewProps } from '@/types';
import styles from './AiToolSchemaView.module.scss';

/** The fields surfaced for one parameter, read defensively from the schema. */
interface IParamView {
    name: string;
    type: string;
    description?: string;
    required: boolean;
    /** The `enum` values, formatted for display. Empty when the schema lists none. */
    allowedValues: string[];
    /** The declared `default`, formatted for display. */
    defaultValue?: string;
    /** The `minimum`/`maximum` bounds as a short phrase, such as "1 to 168". */
    range?: string;
}

/**
 * Turn a JSON Schema literal into the text shown inside a value chip.
 *
 * Enum and default values can be any JSON type. A string is shown bare
 * because the chip's monospace styling already marks it as a literal, and
 * quoting it would only add noise; every other type is shown as JSON so
 * `null`, `true`, and `0` stay distinguishable from the words.
 *
 * @param value - A literal taken from the schema's `enum` or `default`.
 * @returns The display text for that literal.
 */
function formatLiteral(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Describe a numeric parameter's bounds in words.
 *
 * An operator deciding whether a tool is safe to enable wants to know how
 * large a request the model can make, and the schema's `minimum`/`maximum`
 * are the machine-enforced answer. Only numbers are read, so a malformed
 * schema simply shows no range.
 *
 * @param fragment - The parameter's JSON Schema object.
 * @returns A phrase such as "1 to 168", or undefined when no bound is declared.
 */
function describeRange(fragment: Record<string, unknown>): string | undefined {
    const min = typeof fragment.minimum === 'number' ? fragment.minimum : undefined;
    const max = typeof fragment.maximum === 'number' ? fragment.maximum : undefined;
    let range: string | undefined;

    if (min !== undefined && max !== undefined) {
        range = `${min} to ${max}`;
    } else if (min !== undefined) {
        range = `at least ${min}`;
    } else if (max !== undefined) {
        range = `at most ${max}`;
    }

    return range;
}

/**
 * Read a parameter's type as a short label.
 *
 * A union type is joined with `|`, and an array names its item type (`string[]`)
 * because "array" alone does not tell an operator what the model may put in
 * it. Anything absent or unexpected falls back to `any`.
 *
 * @param fragment - The parameter's JSON Schema object.
 * @returns The type label shown under the parameter name.
 */
function describeType(fragment: Record<string, unknown>): string {
    const rawType = fragment.type;
    const items = fragment.items;
    let type = 'any';

    if (Array.isArray(rawType)) {
        type = rawType.join(' | ');
    } else if (rawType === 'array' && items && typeof items === 'object' && !Array.isArray(items)) {
        const itemType = (items as Record<string, unknown>).type;
        type = typeof itemType === 'string' ? `${itemType}[]` : 'array';
    } else if (typeof rawType === 'string') {
        type = rawType;
    }

    return type;
}

/**
 * Read one JSON Schema property fragment into the small shape the view renders.
 * A fragment may legally be a boolean (`true`/`false`) per JSON Schema, so guard
 * before reading fields.
 *
 * @param name - The parameter name (the property key).
 * @param definition - The raw JSON Schema property value (object or boolean).
 * @param required - Whether the schema lists this parameter as required.
 * @returns The flattened parameter view.
 */
function toParamView(name: string, definition: unknown, required: boolean): IParamView {
    const fragment = (definition && typeof definition === 'object') ? definition as Record<string, unknown> : {};
    const description = typeof fragment.description === 'string' ? fragment.description : undefined;
    const allowedValues = Array.isArray(fragment.enum) ? fragment.enum.map(formatLiteral) : [];
    const defaultValue = 'default' in fragment ? formatLiteral(fragment.default) : undefined;

    return {
        name,
        type: describeType(fragment),
        description,
        required,
        allowedValues,
        defaultValue,
        range: describeRange(fragment)
    };
}

/**
 * Render a tool's input parameters as a definition list.
 *
 * Required parameters are listed first, because they are the ones a model call
 * fails without; the schema's own order is kept within each group.
 *
 * @param props.schema - The tool's input schema (top-level object with properties).
 * @returns A parameter list, or a no-parameters note.
 */
export function AiToolSchemaView({ schema }: IAiToolSchemaViewProps) {
    const properties = schema?.properties ?? {};
    const requiredSet = new Set(schema?.required ?? []);
    const params = Object.entries(properties)
        .map(([name, def]) => toParamView(name, def, requiredSet.has(name)))
        .sort((a, b) => Number(b.required) - Number(a.required));

    return params.length === 0
        ? <p className="text-muted">This tool takes no parameters.</p>
        : (
            <div className={styles.container}>
                <dl className={styles.params}>
                    {params.map(param => (
                        <div key={param.name} className={styles.param}>
                            <dt className={styles.param_term}>
                                <code className={styles.param_name}>{param.name}</code>
                                <span className={styles.param_type}>
                                    {param.type}
                                    {param.required && <span className={styles.param_required}> required</span>}
                                </span>
                            </dt>
                            <dd className={styles.param_detail}>
                                {param.description && <p className={styles.param_desc}>{param.description}</p>}
                                {param.allowedValues.length > 0 && (
                                    <p className={styles.param_facts}>
                                        <span className={styles.param_fact_label}>One of</span>
                                        {param.allowedValues.map(value => (
                                            <code key={value} className={styles.value_chip}>{value}</code>
                                        ))}
                                    </p>
                                )}
                                {(param.defaultValue !== undefined || param.range) && (
                                    <p className={styles.param_facts}>
                                        {param.range && (
                                            <span className={styles.param_fact_label}>Range {param.range}</span>
                                        )}
                                        {param.defaultValue !== undefined && (
                                            <>
                                                <span className={styles.param_fact_label}>Default</span>
                                                <code className={styles.value_chip}>{param.defaultValue}</code>
                                            </>
                                        )}
                                    </p>
                                )}
                            </dd>
                        </div>
                    ))}
                </dl>
            </div>
        );
}
