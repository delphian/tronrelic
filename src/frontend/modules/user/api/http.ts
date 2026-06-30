/**
 * @fileoverview Shared response parser for the user module's same-origin API
 * helpers.
 *
 * The user-facing endpoints all answer with a JSON envelope that, on failure,
 * carries a `message`/`error` string the UI should surface verbatim. Centralising
 * the parse-and-throw here gives every client helper one consistent way to turn a
 * non-OK response into a meaningful Error (so callers can toast the real reason)
 * and to reject a malformed 200 body, instead of each helper re-deriving that
 * boilerplate.
 */

/**
 * Parse a same-origin API response, surfacing the backend's `message`/`error`
 * field as a thrown Error on failure so callers can toast a meaningful reason
 * rather than a generic failure.
 *
 * A non-JSON error body (e.g. an HTML 502 page from a proxy) falls through to the
 * HTTP status for the message; a non-JSON 200 body is treated as a real fault
 * because a successful endpoint must return parseable JSON.
 *
 * @param response - The raw fetch response from a user-facing endpoint.
 * @returns The parsed JSON body typed as `T`.
 * @throws When the response is not ok, or a 200 carries an unparseable body.
 */
export async function parseJsonResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    let body: any = {};
    try {
        body = text ? JSON.parse(text) : {};
    } catch {
        if (response.ok) {
            throw new Error(`Malformed response body (${response.status})`);
        }
    }
    if (!response.ok) {
        const reason = body?.message || body?.error || `Request failed (${response.status})`;
        throw new Error(reason);
    }
    return body as T;
}
