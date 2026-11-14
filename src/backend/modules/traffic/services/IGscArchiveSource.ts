/**
 * @fileoverview What the archive backfill needs from the Search Console fetcher.
 *
 * `GscArchiveBackfill` depends on this narrow contract instead of the whole
 * `GscService`, so it can be tested with a double and cannot reach the daily
 * fetch, which saves fetch markers an old window must not overwrite.
 */

/**
 * Fetches Search Console windows into the permanent archive.
 */
export interface IGscArchiveSource {
    /**
     * Whether Search Console credentials are stored. A backfill without them
     * would fail on its first window, so it is refused up front instead.
     *
     * @returns True when credentials and a site URL are configured.
     */
    isConfigured(): Promise<boolean>;

    /**
     * Fetch one window from Search Console and write it to the archive only.
     *
     * @param start - First day of the window (YYYY-MM-DD), inclusive.
     * @param end - Last day of the window (YYYY-MM-DD), inclusive.
     * @returns Rows Google returned across the window's requests.
     */
    archiveWindow(start: string, end: string): Promise<{ rowsFetched: number }>;
}
