/**
 * @fileoverview Encode a widget embed for the placeholder's attribute.
 *
 * The embed travels inside stored HTML as an attribute value. URI encoding
 * leaves no quote, ampersand, or angle bracket in the value, so the HTML
 * serializer writes it unchanged and `splitWidgetEmbeds` can read it back
 * without an HTML entity decoder.
 */

import type { IWidgetEmbed } from './IWidgetEmbed.js';

/**
 * Encode an embed as the value of `WIDGET_EMBED_MARKUP.embedAttribute`.
 *
 * @param embed - The checked embed to store.
 * @returns URI-encoded JSON, safe to write into a double-quoted attribute.
 */
export function encodeWidgetEmbed(embed: IWidgetEmbed): string {
    return encodeURIComponent(JSON.stringify({ type: embed.type, config: embed.config }));
}
