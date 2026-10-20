'use client';

/**
 * @fileoverview React context carrying the visitor's consent state.
 *
 * The root layout resolves the consent settings and this visitor's state on
 * the server and passes them here once. The banner, the "Privacy choices"
 * button, the page-view tracker, and the Google Ads tag all read them through
 * `useConsent`, so every part of the page agrees, and a saved choice updates
 * all of them at once without a reload.
 *
 * @module modules/consent/components/ConsentProvider
 */

import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import type { IConsentContextValue, IConsentSeed } from '../../types';
import { writeConsentCookie } from '../../lib/writeConsentCookie';
import { clearGoogleAdsCookies } from '../../lib/clearGoogleAdsCookies';

/**
 * The seed used when no provider is mounted, such as in an isolated test or
 * the global error page. It is the main switch turned off, which is exactly
 * how the site behaved before consent handling existed.
 */
export const DISABLED_CONSENT_SEED: IConsentSeed = {
    config: { enabled: false, policyVersion: 1, googleAdsId: null, conversionLabel: null },
    state: { enabled: false, required: false, decided: false, analytics: true, ads: false }
};

/**
 * Do nothing. Stands in for the actions when no provider is mounted.
 */
function noop(): void {
    /* no provider mounted */
}

/** Context holding the consent state and the actions that change it. */
export const ConsentContext = createContext<IConsentContextValue>({
    ...DISABLED_CONSENT_SEED,
    settingsOpen: false,
    openSettings: noop,
    closeSettings: noop,
    save: noop
});

/** Props for {@link ConsentProvider}. */
interface IConsentProviderProps {
    /** Settings and state the root layout resolved for this request. */
    seed: IConsentSeed;
    /** The page subtree. */
    children: ReactNode;
}

/**
 * Make the consent state and its actions available to every component below.
 *
 * State starts from the server-resolved seed, so the first browser render
 * matches the server render.
 *
 * @param props - The seed and the subtree.
 * @returns The subtree inside the context provider.
 */
export function ConsentProvider({ seed, children }: IConsentProviderProps) {
    const [state, setState] = useState(seed.state);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const { policyVersion } = seed.config;

    /**
     * Store a choice and apply it.
     *
     * Granting something applies at once: the tracker switches to the traffic
     * beacon and the Google Ads tag loads. Withdrawing something reloads the
     * page instead, because cookies already set have to go: the middleware
     * removes the analytics cookies on the next request, and the Google Ads
     * cookies, which the tag set in the browser, are removed here first. A
     * reload is also the only way to stop a Google tag that is already running.
     *
     * @param choice - Whether the visitor allows analytics and advertising.
     */
    const save = useCallback((choice: { analytics: boolean; ads: boolean }) => {
        writeConsentCookie({
            version: policyVersion,
            analytics: choice.analytics,
            ads: choice.ads,
            decidedAt: Math.floor(Date.now() / 1000)
        });
        const withdrawsAds = state.ads && !choice.ads;
        const withdrawsAnalytics = state.analytics && !choice.analytics;
        if (withdrawsAds) {
            clearGoogleAdsCookies();
        }
        if (withdrawsAds || withdrawsAnalytics) {
            window.location.reload();
        } else {
            setState(previous => ({ ...previous, decided: true, analytics: choice.analytics, ads: choice.ads }));
            setSettingsOpen(false);
        }
    }, [policyVersion, state.ads, state.analytics]);

    /** Open the detailed choices from "Privacy choices". */
    const openSettings = useCallback(() => setSettingsOpen(true), []);

    /** Close the detailed choices without saving. */
    const closeSettings = useCallback(() => setSettingsOpen(false), []);

    const value = useMemo<IConsentContextValue>(
        () => ({ config: seed.config, state, settingsOpen, openSettings, closeSettings, save }),
        [seed.config, state, settingsOpen, openSettings, closeSettings, save]
    );

    return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}
