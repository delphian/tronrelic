/**
 * @fileoverview Errors the content translation service raises, so each caller
 * can answer a failure with the response it deserves.
 *
 * A missing item uses the content service's `not-found` code (404). Values the
 * caller can fix raise `ContentTranslationInputError`, which admin routes
 * answer with 400 like any plain error, and which the AI tools return to the
 * model to correct from without also returning database or other internal
 * failures. The last two cover the AI Suggest side.
 *
 * @module backend/services/content-translation-errors
 */

/**
 * The caller's values or language cannot be used: a required field is empty,
 * a value has the wrong shape, the content type refuses it, the language is
 * not enabled, or a proposal changes a link, address, or number. The message
 * says what to fix.
 */
export class ContentTranslationInputError extends Error {
    /**
     * @param message - What is wrong, written for the caller to correct from.
     */
    constructor(message: string) {
        super(message);
        this.name = 'ContentTranslationInputError';
    }
}

/**
 * No AI provider can run the request: none installed, none active, or the one
 * chosen in the content translation settings is gone. Answered with 503,
 * because the request may succeed once a provider is enabled.
 */
export class ContentTranslationUnavailableError extends Error {
    /**
     * @param message - Explanation shown to the administrator as-is.
     */
    constructor(message: string) {
        super(message);
        this.name = 'ContentTranslationUnavailableError';
    }
}

/**
 * The provider ran but its answer cannot be used: the request failed, the
 * model refused or stopped early, or the reply could not be read. Answered
 * with 502, because the fault lies with the upstream model.
 */
export class ContentTranslationProviderError extends Error {
    /**
     * @param message - Explanation shown to the administrator as-is.
     */
    constructor(message: string) {
        super(message);
        this.name = 'ContentTranslationProviderError';
    }
}
