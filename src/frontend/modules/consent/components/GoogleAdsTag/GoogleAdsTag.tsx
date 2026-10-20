'use client';

/**
 * @fileoverview Loads the Google Ads tag and records affiliate-link
 * conversions, once the visitor allows advertising measurement.
 *
 * Renders nothing. It runs only after hydration, so the server HTML never
 * contains the tag, and it does nothing at all until the consent state allows
 * advertising and a Google Ads id is configured on `/system/consent`.
 *
 * A conversion is any click on a link marked `rel="sponsored"`. The
 * resource-markets plugin marks every affiliate and referral link that way
 * for search engines already, so listening for that one attribute covers
 * every placement the plugin has, and any it adds later, without the plugin
 * or the shared types package having to know about Google Ads.
 *
 * @module modules/consent/components/GoogleAdsTag
 */

import { useEffect } from 'react';
import { useConsent } from '../../hooks/useConsent';
import { loadGoogleAdsTag, recordGoogleAdsConversion } from '../../lib/loadGoogleAdsTag';

/**
 * Whether a click landed on a sponsored link.
 *
 * @param target - The element the click started on, which may sit inside the link.
 * @returns True when the click is inside an `<a rel="… sponsored …">`.
 */
function isSponsoredLinkClick(target: EventTarget | null): boolean {
    const link = target instanceof Element ? target.closest('a[rel]') : null;
    return link !== null && (link.getAttribute('rel') ?? '').split(/\s+/).includes('sponsored');
}

/**
 * Side-effect component for the Google Ads tag.
 *
 * @returns Always null.
 */
export function GoogleAdsTag(): null {
    const { config, state } = useConsent();
    const { googleAdsId, conversionLabel } = config;
    const allowed = state.ads && googleAdsId !== null;

    useEffect(() => {
        if (allowed && googleAdsId) {
            loadGoogleAdsTag(googleAdsId);
        }
    }, [allowed, googleAdsId]);

    useEffect(() => {
        /**
         * Record a conversion when a sponsored link is followed. Listens in
         * the capture phase so the conversion is queued before the link's own
         * handlers run or the browser starts leaving the page.
         *
         * @param event - The click anywhere in the document.
         */
        const handleClick = (event: MouseEvent): void => {
            if (googleAdsId && conversionLabel && isSponsoredLinkClick(event.target)) {
                recordGoogleAdsConversion(googleAdsId, conversionLabel);
            }
        };
        if (allowed && conversionLabel) {
            document.addEventListener('click', handleClick, true);
        }
        return () => document.removeEventListener('click', handleClick, true);
    }, [allowed, googleAdsId, conversionLabel]);

    return null;
}
