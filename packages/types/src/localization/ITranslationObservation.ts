/**
 * @fileoverview One translation lookup the frontend server reports.
 */

/**
 * A key the frontend server rendered, sent so the backend can list it for
 * translators and log a warning when a translation was missing.
 *
 * The frontend reports each distinct key once per server process rather than
 * once per render, so the volume stays at roughly one batch per new key.
 */
export interface ITranslationObservation {
    /** Owner of the key: `core`, or a plugin id. */
    namespace: string;

    /** Key within the namespace. */
    key: string;

    /** English text the code supplied for the key. */
    source: string;

    /** Unprefixed path being rendered when the key was looked up. */
    path: string;

    /**
     * Language the page was rendered in when no translation existed, so the
     * backend can log that English text was served on a translated page.
     * Absent when the lookup succeeded or the page was English.
     */
    missingIn?: string;
}
