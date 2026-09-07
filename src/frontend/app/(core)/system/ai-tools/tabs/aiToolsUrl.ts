/**
 * @file aiToolsUrl.ts
 *
 * The one place the /system/ai-tools page rewrites its own address. The page
 * keeps two things in the query string — the active tab and the open
 * conversation — and two components write them: the shell writes `tab`, the
 * Query tab writes `conversation`. Each used to rebuild the whole query string
 * from what it knew, so switching tabs dropped the conversation and vice
 * versa. Routing both through here means a write touches only its own key and
 * every other key survives, which is what makes the address a real deep link.
 */

/**
 * Set or remove one query-string parameter on the current address without a
 * navigation, leaving every other parameter as it is. Uses `replaceState`
 * rather than `pushState` because these values describe the current view, not
 * a step in a history the Back button should retrace.
 *
 * Browser-only: it reads `window.location`, so call it from an event handler
 * or an effect, never during render.
 *
 * @param name - The parameter to write.
 * @param value - The new value, or null to remove the parameter.
 */
export function writeAiToolsSearchParam(name: string, value: string | null): void {
    const params = new URLSearchParams(window.location.search);
    if (value === null || value === '') {
        params.delete(name);
    } else {
        params.set(name, value);
    }
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}
