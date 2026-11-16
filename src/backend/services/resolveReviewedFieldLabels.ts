/**
 * @fileoverview Works out the label a curator reads for each reviewed field of
 * a managed content type, for the change set shown in the curation queue.
 *
 * A type may set `reviewedFieldLabels`, but most of what it needs is often
 * already declared: a translatable type labels its fields for the translation
 * editor. Falling back through those sources means a type gets readable labels
 * without repeating them, and a type with neither still shows something a
 * person can read instead of a raw property name.
 *
 * @module backend/services/resolveReviewedFieldLabels
 */

import type { IContent, IManagedContentType } from '@/types';
import type { IChangeSetField } from './buildContentChangeSet.js';

/**
 * Pair each reviewed field with its label, in the order the type lists them.
 * The label comes from the type's `reviewedFieldLabels`, then from the
 * translatable field of the same name, then from the field name split into
 * words.
 *
 * @param type - The managed content type whose reviewed fields are compared.
 * @returns The fields to compare, each with the label a reviewer reads.
 */
export function resolveReviewedFieldLabels(type: IManagedContentType<IContent, unknown, unknown>): IChangeSetField[] {
    const explicit = (type.reviewedFieldLabels ?? {}) as Readonly<Record<string, string | undefined>>;
    const translatable = new Map(
        (type.translation?.translatableFields ?? []).map((field) => [field.name, field.label])
    );

    return type.reviewedFields.map((name) => ({
        name,
        label: explicit[name] ?? translatable.get(name) ?? humanizeFieldName(name)
    }));
}

/**
 * Turn a property name into a sentence-case label, splitting camelCase,
 * snake_case, and kebab-case, so `metaTitle` reads as "Meta title".
 */
function humanizeFieldName(name: string): string {
    const words = name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .toLowerCase();

    return words.length > 0 ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : name;
}
