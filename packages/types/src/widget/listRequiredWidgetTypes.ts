/**
 * @fileoverview List the widget types a rendered body marks as required.
 *
 * An author marks an embed `required` when the page makes no sense without
 * it, such as a page built around one plugin's dashboard. Whoever serves the
 * body asks which types it requires and withholds the body while one of
 * them is unregistered. Reading them from the rendered HTML, through the
 * same `splitWidgetEmbeds` the embed resolver uses, keeps the two from
 * disagreeing about which placeholders a body holds.
 */

import { splitWidgetEmbeds } from './splitWidgetEmbeds.js';

/**
 * Collect the type ids of every required embed in a rendered body.
 *
 * Each type appears once, in the order of its first required embed. A
 * placeholder whose embed could not be decoded is skipped, since it names no
 * type to check.
 *
 * @param html - Sanitized HTML from the shared markdown renderer.
 * @returns The required widget type ids; empty when the body requires none.
 */
export function listRequiredWidgetTypes(html: string): string[] {
    const types: string[] = [];
    for (const segment of splitWidgetEmbeds(html)) {
        if (segment.kind === 'embed' && segment.embed?.required === true && !types.includes(segment.embed.type)) {
            types.push(segment.embed.type);
        }
    }

    return types;
}
