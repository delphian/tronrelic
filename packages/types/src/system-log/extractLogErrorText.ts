/**
 * @fileoverview Reads the error text out of a log entry's context.
 *
 * The log viewer shows this text under each row, and the log query AI tool
 * returns it in place of the full context. Both read it through this one
 * function so they agree on what counts as an entry's error.
 */

/**
 * Pull the error text out of a log entry's context, when it carries one, so a
 * list of entries can say why something failed without the full context.
 *
 * Log calls pass the failure as `{ error }`, either as a string or as a
 * serialized error object with a `message`. Anything else yields nothing.
 *
 * @param context - The entry's stored `context` value, of any shape, since
 *                  log calls attach arbitrary metadata.
 * @returns The error text, or null when the context has none.
 */
export function extractLogErrorText(context: unknown): string | null {
    const error: unknown = context && typeof context === 'object'
        ? (context as { error?: unknown }).error
        : undefined;
    let text: string | null = null;
    if (typeof error === 'string' && error.trim().length > 0) {
        text = error;
    } else if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
        text = (error as { message: string }).message;
    }
    return text;
}
