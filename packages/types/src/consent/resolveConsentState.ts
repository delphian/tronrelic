/**
 * @fileoverview The one rule deciding what a request may do about cookies and
 * advertising.
 *
 * The Next.js middleware, the root layout, and the backend's page-view
 * endpoint each have to answer the same question for the same visitor. They
 * all call this function, so the banner, the analytics cookie, and the Google
 * Ads tag cannot disagree about one request.
 */

import type { IConsentPublicConfig } from './IConsentPublicConfig.js';
import type { IConsentState } from './IConsentState.js';
import { CONSENT_COOKIE_MAX_AGE_SECONDS } from './CONSENT_COOKIE_MAX_AGE_SECONDS.js';
import { isConsentRequiredCountry } from './isConsentRequiredCountry.js';
import { parseConsentCookie } from './parseConsentCookie.js';

/**
 * How far in the future a saved choice's timestamp may be before it is
 * treated as forged. A day absorbs any reasonable difference between the
 * visitor's clock, which wrote the timestamp, and the server's.
 */
const FUTURE_TOLERANCE_SECONDS = 24 * 60 * 60;

/**
 * Work out what one request is allowed to do.
 *
 * With the main switch off, the site behaves as it did before consent
 * handling existed: analytics on, advertising off, no banner. With it on, a
 * visitor inside a consent region gets only what their saved choice allows. A
 * visitor outside one gets both without being asked, unless they opened
 * "Privacy choices" and saved a choice of their own, which is then honoured
 * the same way. A choice counts only when it was made under the current
 * `policyVersion` and within the last twelve months.
 *
 * When a choice stops counting, a refusal in it is not simply dropped.
 * Outside a consent region nothing would ever ask the visitor again, so
 * raising the policy version or passing twelve months would silently turn
 * their refusal back into permission. A stale refusal therefore sets
 * `required`, which allows nothing and shows the banner until the visitor
 * answers again. Declining advertising counts as a refusal only while an Ads
 * id is configured, because without one the banner never offers it and
 * stores `ads: false` for every visitor.
 *
 * @param config - The consent settings currently in force.
 * @param country - The request's `cf-ipcountry` value, or nothing when absent.
 * @param cookieValue - The raw `tronrelic_consent` cookie, or nothing when absent.
 * @param nowMs - The current time in milliseconds, injectable so tests can pin it.
 * @returns The resolved state every consumer acts on.
 */
export function resolveConsentState(
    config: IConsentPublicConfig,
    country: string | null | undefined,
    cookieValue: string | null | undefined,
    nowMs: number = Date.now()
): IConsentState {
    let state: IConsentState;
    if (!config.enabled) {
        state = { enabled: false, required: false, decided: false, analytics: true, ads: false };
    } else {
        const required = isConsentRequiredCountry(country);
        const choice = parseConsentCookie(cookieValue);
        const nowSeconds = Math.floor(nowMs / 1000);
        const current = choice !== null
            && choice.version === config.policyVersion
            && choice.decidedAt <= nowSeconds + FUTURE_TOLERANCE_SECONDS
            && nowSeconds - choice.decidedAt < CONSENT_COOKIE_MAX_AGE_SECONDS
            ? choice
            : null;
        // A stale choice that withheld something still has to be asked about
        // again. Outside a consent region no banner would appear, so falling
        // back to the permissive default would undo the refusal.
        const staleRefusal = current === null
            && choice !== null
            && (!choice.analytics || (config.googleAdsId !== null && !choice.ads));
        const mustAsk = required || staleRefusal;
        // Without a current choice, a visitor who must be asked allows
        // nothing and anyone else allows everything.
        state = {
            enabled: true,
            required: mustAsk,
            decided: current !== null,
            analytics: current ? current.analytics : !mustAsk,
            ads: current ? current.ads : !mustAsk
        };
    }
    return state;
}
