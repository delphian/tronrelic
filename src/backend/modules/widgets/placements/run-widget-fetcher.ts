/**
 * @fileoverview Runs one widget data fetcher with the guards SSR needs.
 *
 * A placed widget and a widget embedded in a page body both run their type's
 * data fetcher while a page is being rendered. One slow or broken fetcher
 * must not hold up or break the page, and its result is embedded in the
 * response as JSON. Both callers use this one function so the guards cannot
 * drift apart.
 *
 * - Each fetch is limited to `WIDGET_FETCH_TIMEOUT_MS`.
 * - The result must survive a JSON round trip (no BigInt, cycles, or functions).
 * - A bare `null` result means "nothing to render" and skips the widget, so a
 *   fetcher that must still mount its component wraps an empty value, as the
 *   block ticker's `{ block: null }` does.
 * - Any failure is logged and skips the widget; nothing is thrown.
 */

import type { ISystemLogService, IWidgetPlacementContext, IWidgetType } from '@/types';

/** Per-fetch time limit, in milliseconds. */
export const WIDGET_FETCH_TIMEOUT_MS = 5000;

/**
 * Run a widget type's data fetcher under the time limit and check that its
 * result can be sent as JSON.
 *
 * @param type - The registered widget type whose fetcher runs.
 * @param route - The page path, passed to the fetcher.
 * @param params - The page's route params, passed to the fetcher.
 * @param placement - Settings, id, and language, passed to the fetcher.
 * @param logger - Records a failed, timed-out, or non-serializable fetch.
 * @param logContext - Fields that identify the widget in the log entry.
 * @returns The JSON-safe data, or null when the widget should not render.
 */
export async function runWidgetFetcher(
    type: IWidgetType,
    route: string,
    params: Record<string, string>,
    placement: IWidgetPlacementContext,
    logger: ISystemLogService,
    logContext: Record<string, unknown>
): Promise<unknown> {
    let timerId: NodeJS.Timeout | undefined;
    let result: unknown = null;
    try {
        const timeoutPromise = new Promise<never>((_, reject) => {
            timerId = setTimeout(() => reject(new Error('Widget fetch timeout')), WIDGET_FETCH_TIMEOUT_MS);
        });
        const raw = await Promise.race([type.defaultDataFetcher(route, params, placement), timeoutPromise]);
        try {
            result = JSON.parse(JSON.stringify(raw));
        } catch (error) {
            logger.error(
                { ...logContext, typeId: type.id, error: error instanceof Error ? error.message : String(error) },
                'Widget returned non-serializable data'
            );
        }
    } catch (error) {
        logger.error(
            { ...logContext, typeId: type.id, error: error instanceof Error ? error.message : String(error) },
            'Widget data fetch failed'
        );
    } finally {
        clearTimeout(timerId);
    }
    return result;
}
