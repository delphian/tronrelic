/**
 * @fileoverview Check an unknown value against the shape of a widget embed.
 *
 * An embed starts as JSON an author typed into a ` ```widget ` block and is
 * read back later from stored HTML, so neither source can be trusted to have
 * the right shape. The markdown renderer and `splitWidgetEmbeds` both run the
 * value through this one check, which keeps the two from accepting different
 * things.
 */

import type { IWidgetEmbed } from './IWidgetEmbed.js';

/**
 * Shape a widget type id must have to be looked up. Ids follow the
 * `<owner>:<name>` convention; the pattern stays loose so a plugin's own
 * spelling still matches, and only the length and character set are held.
 */
const WIDGET_TYPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Return the value as an embed, or null when it does not have an embed's
 * shape.
 *
 * Accepts an object with a string `type` that could be a widget type id, an
 * optional plain-object `config`, and an optional `required` flag. A missing
 * `config` becomes `{}`. `required` is kept only when it is exactly `true`,
 * so a quoted `"true"` or any other value leaves the embed optional. Other
 * keys are dropped, so nothing else an author wrote travels into the stored
 * HTML. Whether the type exists, may be embedded, and accepts the settings
 * is decided later, when the embed is resolved.
 *
 * @param value - Parsed JSON from a fenced block or a placeholder attribute.
 * @returns The embed, or null when the value cannot be one.
 */
export function parseWidgetEmbed(value: unknown): IWidgetEmbed | null {
    let result: IWidgetEmbed | null = null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const candidate = value as Record<string, unknown>;
        const type = candidate.type;
        const config = candidate.config ?? {};
        const typeIsValid = typeof type === 'string' && WIDGET_TYPE_ID_PATTERN.test(type);
        const configIsValid = typeof config === 'object' && config !== null && !Array.isArray(config);
        if (typeIsValid && configIsValid) {
            result = { type, config: config as Record<string, unknown> };
            if (candidate.required === true) {
                result.required = true;
            }
        }
    }
    return result;
}
