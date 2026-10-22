/**
 * @fileoverview Errors the page translation Suggest request raises, so the
 * controller can answer each failure with the status it deserves.
 *
 * Validation failures use plain errors (400), and a missing page or language
 * uses the content service's `not-found` code (404). These two cover the AI
 * side, which neither of those describes.
 */

/**
 * No AI provider can run the request: none installed, none active, or the one
 * chosen on the Pages Settings tab is gone. Answered with 503, because the
 * request may succeed once a provider is enabled.
 */
export class PageTranslationUnavailableError extends Error {
    /**
     * @param message - Explanation shown to the administrator as-is.
     */
    constructor(message: string) {
        super(message);
        this.name = 'PageTranslationUnavailableError';
    }
}

/**
 * The provider ran but its answer cannot be used: the request failed, the
 * model refused or stopped early, or the reply could not be read. Answered
 * with 502, because the fault lies with the upstream model.
 */
export class PageTranslationProviderError extends Error {
    /**
     * @param message - Explanation shown to the administrator as-is.
     */
    constructor(message: string) {
        super(message);
        this.name = 'PageTranslationProviderError';
    }
}
