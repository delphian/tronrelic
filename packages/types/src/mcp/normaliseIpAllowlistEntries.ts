/**
 * @file normaliseIpAllowlistEntries.ts
 *
 * The cleaning applied to a group's MCP IP allowlist, shared by the backend
 * (which stores the cleaned list) and the admin page (which compares its
 * textarea to the stored list), so the Save button's dirty check always agrees
 * with what the server stores.
 */

/**
 * Trim allowlist entries and drop blank lines and duplicates, so a pasted list
 * with stray whitespace or a repeated line is stored the way the admin meant it.
 *
 * @param entries - The entries as submitted, such as the lines of a textarea.
 * @returns The cleaned entries, in their original order.
 */
export function normaliseIpAllowlistEntries(entries: readonly string[]): string[] {
    return [...new Set(entries.map(entry => String(entry).trim()).filter(entry => entry.length > 0))];
}
