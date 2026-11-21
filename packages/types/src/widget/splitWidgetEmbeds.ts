/**
 * @fileoverview Split rendered HTML at its embedded-widget placeholders.
 *
 * The markdown renderer stores a page or post body as sanitized HTML with one
 * empty placeholder element per embedded widget. The backend needs the list
 * of embeds to fetch their data, and the frontend needs the HTML between them
 * to render the body around each widget. Both use this one function, so the
 * index the backend gives a result always names the placeholder the frontend
 * renders it into.
 *
 * - The renderer writes placeholders only as direct children of the body, so
 *   every HTML run between two placeholders is balanced markup.
 * - The scan matches the exact element name; the sanitizer removes that
 *   element from anything an author wrote, so every match came from the
 *   renderer.
 */

import type { IWidgetEmbedSegment } from './IWidgetEmbedSegment.js';
import type { IWidgetEmbed } from './IWidgetEmbed.js';
import { WIDGET_EMBED_MARKUP } from './WIDGET_EMBED_MARKUP.js';
import { parseWidgetEmbed } from './parseWidgetEmbed.js';

/** Matches one placeholder element and captures its attribute text. */
const PLACEHOLDER_PATTERN = new RegExp(
    `<${WIDGET_EMBED_MARKUP.tagName}\\b([^>]*)>\\s*</${WIDGET_EMBED_MARKUP.tagName}>`,
    'g'
);

/** Captures the encoded embed from a placeholder's attribute text. */
const EMBED_ATTRIBUTE_PATTERN = new RegExp(`\\b${WIDGET_EMBED_MARKUP.embedAttribute}="([^"]*)"`);

/**
 * Decode a placeholder's attribute text into an embed, or null when the
 * value is missing or malformed.
 *
 * @param attributes - Everything between the element name and `>`.
 */
function decodeEmbed(attributes: string): IWidgetEmbed | null {
    let result: IWidgetEmbed | null = null;
    const match = EMBED_ATTRIBUTE_PATTERN.exec(attributes);
    if (match) {
        try {
            result = parseWidgetEmbed(JSON.parse(decodeURIComponent(match[1])));
        } catch {
            result = null;
        }
    }
    return result;
}

/**
 * Split rendered HTML into HTML runs and widget placeholders, in document
 * order.
 *
 * Empty HTML runs between adjacent placeholders are left out. HTML with no
 * placeholder returns a single HTML segment, or none when it is empty, so a
 * caller can always render the result without checking for embeds first.
 *
 * @param html - Sanitized HTML from the shared markdown renderer.
 * @returns The segments, with each placeholder numbered from zero.
 */
export function splitWidgetEmbeds(html: string): IWidgetEmbedSegment[] {
    const segments: IWidgetEmbedSegment[] = [];
    let cursor = 0;
    let index = 0;
    for (const match of html.matchAll(PLACEHOLDER_PATTERN)) {
        const start = match.index ?? 0;
        if (start > cursor) {
            segments.push({ kind: 'html', html: html.slice(cursor, start) });
        }
        segments.push({ kind: 'embed', index, embed: decodeEmbed(match[1]) });
        index += 1;
        cursor = start + match[0].length;
    }
    if (cursor < html.length) {
        segments.push({ kind: 'html', html: html.slice(cursor) });
    }
    return segments;
}
