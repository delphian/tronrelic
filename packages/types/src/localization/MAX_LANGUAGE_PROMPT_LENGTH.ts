/**
 * @fileoverview Longest per-language translation prompt the backend accepts.
 */

/**
 * Upper bound on `ILanguage.translationPrompt`, in characters.
 *
 * The prompt is sent with every Suggest request into its language, on top of
 * the shared system prompt, so the limit keeps a pasted document from raising
 * the cost of every run. It is shared so the Languages tab editor can show the
 * same limit the backend enforces.
 */
export const MAX_LANGUAGE_PROMPT_LENGTH = 4000;
