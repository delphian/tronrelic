/**
 * @fileoverview Report one language switcher click to the backend.
 *
 * The switcher's links start a full page load, so the report has to be handed
 * to the browser before the current page goes away. `sendJsonBeacon` does that,
 * and the click is posted to `POST /api/localization/switches`, where it is
 * counted for the Switches tab of `/system/localization`.
 *
 * @module modules/localization/lib/sendLanguageSwitch
 */

import type { ILanguageSwitch } from '@/types';
import { getRuntimeConfig } from '../../../lib/runtimeConfig';
import { sendJsonBeacon } from '../../../lib/sendJsonBeacon';
import { isAutomatedBrowser } from '../../../lib/isAutomatedBrowser';

/**
 * Send one switcher click. Best-effort: a failure is never surfaced, because
 * the visitor's navigation must go ahead whether or not it was counted.
 *
 * @param click - The unprefixed page path and the two languages. The
 *   automation flag is filled in here, so callers cannot forget it.
 * @returns Nothing; the call is fire-and-forget.
 */
export function sendLanguageSwitch(click: Omit<ILanguageSwitch, 'automated'>): void {
    if (typeof window !== 'undefined') {
        const body: ILanguageSwitch = { ...click, automated: isAutomatedBrowser() };
        sendJsonBeacon(`${getRuntimeConfig().apiUrl}/localization/switches`, body);
    }

    return;
}
