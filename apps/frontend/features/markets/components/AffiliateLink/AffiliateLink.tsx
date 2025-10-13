'use client';

import { useEffect } from 'react';
import type { AnchorHTMLAttributes, MouseEvent, PropsWithChildren } from 'react';
import type { MarketDocument, MarketSiteLink } from '@tronrelic/shared';
import { recordAffiliateClick, recordAffiliateImpression } from '../../../../lib/affiliate';
import { cn } from '../../../../lib/cn';

/**
 * Properties for the AffiliateLink component.
 */
interface AffiliateLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
    /** Market document containing affiliate tracking configuration */
    market: MarketDocument;
    /** Specific site link with optional conversion tracking code */
    link: MarketSiteLink;
}

/**
 * AffiliateLink - Tracked external link component for affiliate revenue attribution
 *
 * Wraps standard anchor tags with automatic affiliate tracking for:
 * - **Impressions** - Recorded when the link component mounts (page view)
 * - **Clicks** - Recorded when the user clicks the link
 *
 * The component supports both link-specific and market-wide tracking codes,
 * preferring the conversion-specific code from the link if available.
 *
 * Tracking is entirely client-side and non-blocking. Failed tracking events
 * do not prevent navigation. All tracking data is sent to the backend API
 * which aggregates metrics per market and tracking code.
 *
 * Security features:
 * - Automatic `target="_blank"` for external navigation
 * - Automatic `rel="noreferrer"` to prevent referrer leakage
 * - Tracking code exposed via data attribute for debugging
 *
 * @param props - Standard anchor attributes plus market and link configuration
 * @returns An anchor element with affiliate tracking hooks
 *
 * @example
 * ```tsx
 * <AffiliateLink market={marketDoc} link={primaryLink}>
 *   Visit Energy Marketplace
 * </AffiliateLink>
 * ```
 */
export function AffiliateLink({
    market,
    link,
    className,
    children,
    onClick,
    href,
    target = '_blank',
    rel = 'noreferrer',
    ...rest
}: PropsWithChildren<AffiliateLinkProps>) {
    /**
     * Determines the tracking code to use for this link.
     * Prefers link-specific conversion code over market-wide tracking code.
     */
    const trackingCode = link.conversion ?? market.affiliateTracking?.trackingCode ?? null;

    /**
     * Records an affiliate impression when the component mounts.
     * Only fires if a tracking code is available.
     */
    useEffect(() => {
        if (!trackingCode) {
            return;
        }
        recordAffiliateImpression(market.guid, trackingCode);
    }, [market.guid, trackingCode]);

    /**
     * Handles click events with affiliate tracking.
     *
     * Records the click event before allowing the link to navigate.
     * Tracking is fire-and-forget; navigation proceeds regardless of success.
     *
     * @param event - React mouse event from the anchor click
     */
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (trackingCode) {
            recordAffiliateClick(market.guid, trackingCode);
        }
        onClick?.(event);
    };

    return (
        <a
            {...rest}
            href={href ?? link.link}
            target={target}
            rel={rel}
            className={cn(className)}
            onClick={handleClick}
            data-tracking-code={trackingCode ?? undefined}
        >
            {children ?? link.text ?? 'Visit site'}
        </a>
    );
}
