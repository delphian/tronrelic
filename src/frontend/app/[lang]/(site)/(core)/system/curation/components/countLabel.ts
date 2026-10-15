/**
 * @fileoverview Count-plus-noun phrasing for the curation page's messages —
 * "1 destination", "3 destinations" — so the decision hint, the confirmation
 * button, and the toasts all pluralise the same way.
 */

/**
 * Join a count to a noun, choosing the singular or plural form by the count.
 *
 * @param count - How many there are.
 * @param singular - The noun for exactly one, e.g. `destination`.
 * @param pluralForm - The noun for any other count; defaults to the singular plus `s`.
 * @returns The phrase, e.g. `2 destinations`.
 */
export function countLabel(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}
