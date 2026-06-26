'use client';

/**
 * @fileoverview Read-only view of a tool's input parameter schema for the
 * registry slide-over. An admin auditing a tool needs to see exactly what the
 * model is allowed to pass — each parameter's name, type, whether it's required,
 * and its description — without reading source. JSON Schema property values can
 * be booleans, so each is read defensively. Tools that take no parameters get a
 * plain note rather than an empty list.
 */

import type { IAiToolInputSchema } from '@/types';
import { cn } from '../../../../../lib/cn';
import { Badge } from '../../../../../components/ui/Badge';
import styles from '../page.module.scss';

/** The fields surfaced for one parameter, read defensively from the schema. */
interface IParamView {
    name: string;
    type: string;
    description?: string;
    required: boolean;
}

/**
 * Read one JSON Schema property fragment into the small shape the view renders.
 * A fragment may legally be a boolean (`true`/`false`) per JSON Schema, so guard
 * before reading fields and fall back to `any` for an absent/odd type.
 *
 * @param name - The parameter name (the property key).
 * @param definition - The raw JSON Schema property value (object or boolean).
 * @param required - Whether the schema lists this parameter as required.
 * @returns The flattened parameter view.
 */
function toParamView(name: string, definition: unknown, required: boolean): IParamView {
    const fragment = (definition && typeof definition === 'object') ? definition as Record<string, unknown> : {};
    const rawType = fragment.type;
    const type = Array.isArray(rawType)
        ? rawType.join(' | ')
        : typeof rawType === 'string' ? rawType : 'any';
    const description = typeof fragment.description === 'string' ? fragment.description : undefined;
    return { name, type, description, required };
}

/**
 * The Schema tab body for one tool.
 *
 * @param props.schema - The tool's input schema (top-level object with properties).
 * @returns A parameter list, or a no-parameters note.
 */
export function ToolSchemaView({ schema }: { schema: IAiToolInputSchema }) {
    const properties = schema?.properties ?? {};
    const requiredSet = new Set(schema?.required ?? []);
    const params = Object.entries(properties).map(([name, def]) => toParamView(name, def, requiredSet.has(name)));

    return params.length === 0
        ? <p className="text-muted">This tool takes no parameters.</p>
        : (
            <ul className={cn('list--plain', styles.schema_list)}>
                {params.map(param => (
                    <li key={param.name} className={styles.schema_param}>
                        <div className={styles.schema_param_head}>
                            <span className={styles.schema_param_name}>{param.name}</span>
                            <span className={styles.mono}>{param.type}</span>
                            {param.required && <Badge tone="info">required</Badge>}
                        </div>
                        {param.description && <p className={styles.schema_param_desc}>{param.description}</p>}
                    </li>
                ))}
            </ul>
        );
}
