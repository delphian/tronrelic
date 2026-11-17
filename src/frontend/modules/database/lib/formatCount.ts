/**
 * @fileoverview Counts written with their noun for the storage browsers'
 * summary lines.
 *
 * The browsers state counts in three places: the panel header, the page bar
 * above a collection's documents or a table's rows, and the heading line of a
 * stacked entry on a phone. Each of those places shows a count of one often
 * enough that a fixed plural would read wrongly.
 */

/**
 * Write a count followed by the noun that agrees with it, such as "1 document"
 * or "1,204 rows".
 *
 * @param count - The quantity to state.
 * @param singular - The noun used for exactly one.
 * @param plural - The noun used for any other number, zero included.
 * @returns The count in the reader's number format, then the noun.
 */
export function formatCount(count: number, singular: string, plural: string): string {
    return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}
