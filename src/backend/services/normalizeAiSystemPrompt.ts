/**
 * @fileoverview Validate a system prompt an administrator saved for an AI
 * feature, such as the localization or page translation Suggest buttons.
 *
 * @module backend/services/normalizeAiSystemPrompt
 */

/**
 * Trim a system prompt and check it is neither empty nor longer than the
 * feature allows. An empty prompt would send the model no instructions at all,
 * and the limit keeps a pasted document from inflating the cost of every run.
 *
 * @param value - Candidate prompt from the request.
 * @param maxLength - Longest prompt the feature accepts.
 * @param invalid - Builds the caller's own validation error, so its HTTP layer
 *   answers with the status it already uses for bad input.
 * @returns The trimmed prompt.
 * @throws The error `invalid` builds.
 */
export function normalizeAiSystemPrompt(
    value: unknown,
    maxLength: number,
    invalid: (message: string) => Error
): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed === '' || trimmed.length > maxLength) {
        throw invalid(`Invalid system prompt: must be 1–${maxLength} characters`);
    }

    return trimmed;
}
