/**
 * @fileoverview A piece of interface text that can be translated.
 */

/**
 * One translatable string and its English source.
 *
 * Code supplies the English text at the call site, as in
 * `t('markets.title', 'Energy Markets')`. The first time the frontend server
 * renders that call, it reports the key and its English text here, which is
 * how a translator finds out what exists to translate without reading source
 * code. An administrator can also add a key by hand.
 *
 * `sourceChangedAt` moves forward whenever the English text changes. A
 * translation saved before that moment is shown as stale in the admin page,
 * because it may no longer say the same thing as the English.
 */
export interface ITranslationKey {
    /** Owner of the key: `core`, or the id of the plugin that renders it. */
    namespace: string;

    /** Key within the namespace, e.g. `markets.title`. */
    key: string;

    /** The English text the code renders when no translation exists. */
    source: string;

    /**
     * Unprefixed paths the key was rendered on, newest first and capped, so an
     * administrator can see which keys a page needs before publishing it.
     */
    routes: string[];

    /** `observed` when the frontend reported the key, `manual` when an administrator added it. */
    origin: 'observed' | 'manual';

    /** ISO timestamp of the first report or manual creation. */
    firstSeenAt: string;

    /** ISO timestamp of the most recent report. */
    lastSeenAt: string;

    /** ISO timestamp of the last change to `source`. */
    sourceChangedAt: string;
}
