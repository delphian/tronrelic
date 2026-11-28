/**
 * @fileoverview Builds the fenced ` ```widget ` block a tool page embeds its tool with.
 *
 * Every CMS page the tools module proposes places its tool in the body the
 * same way, so the block is written here once. It is built from the shared
 * markup constants, so a change to the embed syntax cannot leave a proposed
 * page behind.
 */

import { WIDGET_EMBED_MARKUP } from '@/types';

/**
 * Write the markdown block that embeds a tool widget as required.
 *
 * The pages module describes a page with a required embed as a
 * `WebApplication` in its structured data, because the page is that widget's
 * tool page; without the flag the page goes out as an `Article`. The flag
 * also withholds the page while its widget type is unregistered, which never
 * happens for the tools module's own widget types.
 *
 * @param typeId - Widget-type id of the tool the page is built around.
 * @returns The fenced block, with no surrounding blank lines.
 */
export function buildRequiredWidgetEmbed(typeId: string): string {
    const block = [
        '```' + WIDGET_EMBED_MARKUP.fenceLanguage,
        JSON.stringify({ type: typeId, config: {}, required: true }),
        '```'
    ].join('\n');
    return block;
}
