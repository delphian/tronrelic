/**
 * @fileoverview Writes the markdown block that embeds a widget in a body.
 *
 * The Insert widget picker in the page and post editors produces this text
 * and inserts it at the cursor. The fence language comes from
 * `WIDGET_EMBED_MARKUP` so the editor writes exactly what the markdown
 * renderer looks for.
 */

import { WIDGET_EMBED_MARKUP, type IWidgetEmbed } from '@/types';

/**
 * Format an embed as a fenced ` ```widget ` block, surrounded by blank lines
 * so it stays a top-level block wherever the cursor was. The renderer only
 * converts top-level blocks, and a block typed directly under a list item
 * would otherwise be read as part of it.
 *
 * `required` is written only when the author set it, so an optional embed
 * produces the same block it always has.
 *
 * @param embed - The widget type, the settings, and whether the page needs it.
 * @returns The markdown to insert.
 */
export function formatWidgetEmbedBlock(embed: IWidgetEmbed): string {
    const written = embed.required === true
        ? { type: embed.type, config: embed.config, required: true }
        : { type: embed.type, config: embed.config };
    const json = JSON.stringify(written, null, 2);
    return `\n\n\`\`\`${WIDGET_EMBED_MARKUP.fenceLanguage}\n${json}\n\`\`\`\n\n`;
}
