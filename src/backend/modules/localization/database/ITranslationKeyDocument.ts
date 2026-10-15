/**
 * @fileoverview Stored shape of a translatable key.
 */

/**
 * One document in `module_localization_keys`, unique on `(namespace, key)`.
 * The wire form is `ITranslationKey`, which carries the same fields with ISO
 * date strings.
 */
export interface ITranslationKeyDocument {
    /** `core` or a plugin id. */
    namespace: string;
    /** Key within the namespace. */
    key: string;
    /** English text the code renders when no translation exists. */
    source: string;
    /** Unprefixed paths the key was rendered on, newest first and capped. */
    routes: string[];
    /** How the key became known. */
    origin: 'observed' | 'manual';
    /** First report or manual creation. */
    firstSeenAt: Date;
    /** Most recent report. */
    lastSeenAt: Date;
    /** Last change to `source`; a translation older than this is stale. */
    sourceChangedAt: Date;
}
