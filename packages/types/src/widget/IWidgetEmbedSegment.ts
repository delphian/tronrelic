/**
 * @fileoverview One piece of a rendered body split at its embedded widgets.
 *
 * `splitWidgetEmbeds` cuts rendered HTML into runs of plain HTML and the
 * placeholders between them, in document order. The frontend renders the HTML
 * runs as markup and each placeholder as a widget; the backend reads only the
 * placeholders to fetch their data.
 */

import type { IWidgetEmbed } from './IWidgetEmbed.js';

/**
 * A run of rendered HTML containing no placeholder.
 */
export interface IWidgetEmbedHtmlSegment {
    kind: 'html';

    /** Sanitized HTML, balanced because placeholders only sit at the top level. */
    html: string;
}

/**
 * A placeholder for one embedded widget.
 */
export interface IWidgetEmbedWidgetSegment {
    kind: 'embed';

    /**
     * Position of this placeholder among the body's placeholders, counting
     * from zero. `resolveEmbeds` returns its results in the same order, so
     * this index pairs a placeholder with its resolved data.
     */
    index: number;

    /** The decoded embed, or null when the placeholder's value is malformed. */
    embed: IWidgetEmbed | null;
}

/**
 * Either kind of segment.
 */
export type IWidgetEmbedSegment = IWidgetEmbedHtmlSegment | IWidgetEmbedWidgetSegment;
