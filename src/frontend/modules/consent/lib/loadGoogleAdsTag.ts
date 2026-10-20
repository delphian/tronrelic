/**
 * @fileoverview Load the Google Ads tag after the visitor allowed advertising.
 *
 * This is Google Consent Mode's "basic" setup: the tag is not on the page at
 * all until consent is given, so nothing is sent to Google before then. That
 * is the cautious choice, because whether the cookieless pings of "advanced"
 * mode also need consent is disputed.
 *
 * @module modules/consent/lib/loadGoogleAdsTag
 */

/** Global the Google tag reads its queued commands from. */
interface IGoogleTagWindow extends Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
}

/**
 * Add the Google tag to the page for one Google Ads account.
 *
 * Calling it again does nothing, so a re-render cannot load the tag twice.
 *
 * The consent defaults state what the visitor allowed: advertising storage
 * and the sending of conversion data are granted, while ad personalization
 * stays denied because the site measures conversions only and runs no
 * remarketing. Analytics storage is denied because this tag is not used for
 * Google Analytics.
 *
 * The script element is added by this bundle's code, which the page's
 * Content-Security-Policy already trusts through its nonce, so
 * `'strict-dynamic'` lets it load without a nonce of its own.
 *
 * @param googleAdsId - The tag id, such as `AW-123456789`, already validated by the backend.
 */
export function loadGoogleAdsTag(googleAdsId: string): void {
    const tagWindow = window as IGoogleTagWindow;
    if (!tagWindow.gtag) {
        tagWindow.dataLayer = tagWindow.dataLayer ?? [];
        // gtag.js expects the `arguments` object itself on the data layer, not
        // an array copy, which is why this is a function expression.
        tagWindow.gtag = function gtag() {
            // eslint-disable-next-line prefer-rest-params
            tagWindow.dataLayer?.push(arguments);
        };
        tagWindow.gtag('consent', 'default', {
            ad_storage: 'granted',
            ad_user_data: 'granted',
            ad_personalization: 'denied',
            analytics_storage: 'denied'
        });
        tagWindow.gtag('js', new Date());
        tagWindow.gtag('config', googleAdsId, { allow_ad_personalization_signals: false });

        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(googleAdsId)}`;
        document.head.appendChild(script);
    }
}

/**
 * Record one conversion for the configured conversion action.
 *
 * `transport_type: 'beacon'` lets the browser finish sending it after the
 * page unloads, since the click that triggers it usually opens the
 * provider's site.
 *
 * @param googleAdsId - The tag id the conversion belongs to.
 * @param conversionLabel - The label of the conversion action.
 */
export function recordGoogleAdsConversion(googleAdsId: string, conversionLabel: string): void {
    (window as IGoogleTagWindow).gtag?.('event', 'conversion', {
        send_to: `${googleAdsId}/${conversionLabel}`,
        transport_type: 'beacon'
    });
}
