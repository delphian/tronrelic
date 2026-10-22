/**
 * @fileoverview Validate an optional AI provider or model id an administrator
 * chose for an AI feature.
 *
 * @module backend/services/normalizeAiId
 */

/** Longest provider or model id accepted. */
const MAX_AI_ID_LENGTH = 200;

/**
 * Trim an optional provider or model id. An empty string means the same as
 * null, which is what the "automatic" choice in a model select sends: the
 * active provider, or the provider's default model.
 *
 * @param value - Candidate id from the request.
 * @param label - Field name used in the error message, such as `provider` or `model`.
 * @param invalid - Builds the caller's own validation error, so its HTTP layer
 *   answers with the status it already uses for bad input.
 * @returns The trimmed id, or null for the automatic choice.
 * @throws The error `invalid` builds when the value is not a string or is too long.
 */
export function normalizeAiId(value: unknown, label: string, invalid: (message: string) => Error): string | null {
    let result: string | null = null;
    if (value !== null) {
        if (typeof value !== 'string' || value.trim().length > MAX_AI_ID_LENGTH) {
            throw invalid(`Invalid ${label}: expected an id of at most ${MAX_AI_ID_LENGTH} characters`);
        }
        result = value.trim() === '' ? null : value.trim();
    }

    return result;
}
