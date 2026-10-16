/**
 * @fileoverview Largest batch of keys one suggestion request may carry.
 */

/**
 * The most keys sent to the AI model in one translation request. It matches
 * the Translations tab's page size, so filling a page is always one request.
 * The backend enforces it because a larger batch risks the model's reply being
 * cut off by its output limit, which would waste the whole request.
 */
export const MAX_TRANSLATION_SUGGESTION_KEYS = 50;
