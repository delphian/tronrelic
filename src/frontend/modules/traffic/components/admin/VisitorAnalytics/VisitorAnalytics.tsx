/**
 * VisitorAnalytics Component
 *
 * Admin table of new visitors (anonymous first touches): the earliest
 * cookieless `bootstrap` row for each visitor whose first-ever contact falls
 * in the window, newest first. Recorded server-side by the Next.js
 * middleware, so it captures bots, crawlers, and unfurlers alongside humans;
 * the page-level bot filter (humans-only by default) governs which appear.
 *
 * The daily-visitors chart that previously lived here was superseded by the
 * unified OverviewTrend headline on the Analytics tab — platforms show one
 * chart, not two competing ones. The lookback window, custom range, and bot
 * filter arrive as props from the page-level global controls.
 *
 * Per-page clickstream for cookied (tid) and registered (user_id) visitors
 * lives in the sibling PageActivity sections.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Button } from '../../../../../components/ui/Button';
import { adminGetAnonymousFirstTouches, adminGetFlaggedSubnets } from '../../../api';
import type { AnalyticsPeriod, ICustomDateRange, IVisitorOrigin, VisitorPeriod } from '../../../api';
import { getDeviceIcon } from '../../../lib/deviceIcon';
import styles from './VisitorAnalytics.module.scss';

/** Rows per table page. */
const PAGE_LIMIT = 25;

/**
 * Format UTM parameters into a readable summary string.
 *
 * @param utm - UTM parameters object or null
 * @returns Formatted string like "google / cpc / spring_sale" or null
 */
function formatUtm(utm: IVisitorOrigin['utm']): string | null {
    if (!utm) {
        return null;
    }

    const parts = [utm.source, utm.medium, utm.campaign].filter(Boolean);

    return parts.length > 0 ? parts.join(' / ') : null;
}

interface IVisitorAnalyticsProps {
    /** Selected lookback period from the page-level controls. */
    period: AnalyticsPeriod;
    /** Custom date range when `period === 'custom'`. */
    customRange?: ICustomDateRange;
    /** Whether classified bot rows are included. */
    includeBots: boolean;
}

/**
 * New-visitor first-touch table for the admin dashboard, showing
 * first-touch acquisition data (original referrer, landing page, country,
 * device, UTM) for SEO and marketing analysis.
 *
 * @param props - Global period, custom range, and bot-filter selection.
 */
export function VisitorAnalytics({ period, customRange, includeBots }: IVisitorAnalyticsProps) {
    const [firstTouches, setFirstTouches] = useState<IVisitorOrigin[]>([]);
    const [firstTouchesTotal, setFirstTouchesTotal] = useState(0);
    const [firstTouchesLoading, setFirstTouchesLoading] = useState(true);
    const [firstTouchesPage, setFirstTouchesPage] = useState(1);
    // Salted subnet hashes flagged as high-volume for the window — an
    // annotation the Source column badges. Window-scoped, not page-scoped, and
    // independent of the bot filter (the flag is about raw source volume, not a
    // bot_class guess), so it refetches only when the window changes.
    const [flaggedSubnets, setFlaggedSubnets] = useState<Set<string>>(new Set());

    // Window or filter changes invalidate the page cursor.
    useEffect(() => {
        setFirstTouchesPage(1);
    }, [period, customRange, includeBots]);

    useEffect(() => {
        let active = true;
        /**
         * Fetch the first-touches page, dropping the result if a newer
         * window/page selection (or unmount) superseded it before resolving.
         */
        const fetchFirstTouches = async (): Promise<void> => {
            setFirstTouchesLoading(true);
            try {
                const result = await adminGetAnonymousFirstTouches({
                    ...(period === 'custom'
                        ? { customRange }
                        : { period: period as VisitorPeriod }),
                    limit: PAGE_LIMIT,
                    skip: (firstTouchesPage - 1) * PAGE_LIMIT,
                    excludeBots: !includeBots
                });
                if (active) {
                    setFirstTouches(result.visitors ?? []);
                    setFirstTouchesTotal(result.total ?? 0);
                }
            } catch (error) {
                console.error('Failed to fetch anonymous first touches:', error);
                if (active) {
                    setFirstTouches([]);
                    setFirstTouchesTotal(0);
                }
            } finally {
                if (active) {
                    setFirstTouchesLoading(false);
                }
            }
        };
        fetchFirstTouches();
        return () => { active = false; };
    }, [period, customRange, includeBots, firstTouchesPage]);

    useEffect(() => {
        let active = true;
        /**
         * Load the window's flagged source networks so the Source column can
         * badge rows from a high-volume network. Failures degrade to no
         * badges — this is a hint, never load-bearing.
         */
        const fetchFlagged = async (): Promise<void> => {
            try {
                const rows = await adminGetFlaggedSubnets(
                    period === 'custom' ? { customRange } : { period }
                );
                if (active) setFlaggedSubnets(new Set(rows.map(r => r.subnetHash)));
            } catch {
                if (active) setFlaggedSubnets(new Set());
            }
        };
        fetchFlagged();
        return () => { active = false; };
    }, [period, customRange]);

    const totalFirstTouchesPages = firstTouchesTotal > 0 ? Math.ceil(firstTouchesTotal / PAGE_LIMIT) : 1;

    return (
        <div className={styles.container}>
            <div className={styles.section}>
                <div className={styles.section_header}>
                    <h2 className={styles.section_title}>New Visitors</h2>
                </div>
                <p className="text-muted">
                    New visitors first seen in this window. A visitor is a tid that loaded a page
                    (ran JavaScript), so cookieless bots that never run JS are excluded here and from
                    every visitor count; attribution (referrer, landing page) is read from the visitor's
                    first server-recorded hit.{' '}
                    {includeBots
                        ? 'JavaScript-running bots the classifier caught are included; referrers are client-supplied and often spoofed.'
                        : 'Showing human-classified visitors only — switch the page filter to "Include bots" to also see JavaScript-running crawlers.'}
                    {' '}Switch to the Anonymous or Registered view for per-page activity by cookied and signed-in visitors.
                </p>

                {flaggedSubnets.size > 0 && (
                    <p className={styles.flagged_note}>
                        <AlertTriangle size={14} aria-hidden="true" />
                        {flaggedSubnets.size.toLocaleString()} high-volume source{' '}
                        {flaggedSubnets.size === 1 ? 'network' : 'networks'} flagged as possible
                        automated traffic — rows from a flagged network are marked in the Source
                        column. These are not excluded from any count: a busy office, VPN, or mobile
                        carrier can also concentrate many real visitors behind one network.
                    </p>
                )}

                {firstTouchesLoading ? (
                    <div className={styles.loading}>Loading first touches...</div>
                ) : firstTouches.length === 0 ? (
                    <div className={styles.empty}>No new visitors found in this period.</div>
                ) : (
                    <>
                        <div className={styles.table_wrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>First Seen</th>
                                        <th>Country</th>
                                        <th>Original Referrer</th>
                                        <th>Landing Page</th>
                                        <th>Source</th>
                                        <th>UTM</th>
                                        <th>Device</th>
                                        <th title="Client-side page views (page events only — server-recorded first touches are not views)">Total Views</th>
                                        <th title="Derived sessions within the selected window (30-minute inactivity rule over page events)">Sessions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {firstTouches.map(touch => {
                                        const utmDisplay = formatUtm(touch.utm);

                                        return (
                                            <tr key={touch.userId}>
                                                <td>
                                                    <ClientTime date={touch.firstSeen} format="relative" />
                                                </td>
                                                <td className={styles.country_cell}>
                                                    {touch.country || <span className={styles.muted}>—</span>}
                                                </td>
                                                <td className={styles.referrer_cell} title={touch.referrerDomain ?? undefined}>
                                                    {touch.referrerDomain || <span className={styles.muted}>direct</span>}
                                                </td>
                                                <td className={styles.landing_cell} title={touch.landingPage ?? undefined}>
                                                    {touch.landingPage || <span className={styles.muted}>—</span>}
                                                </td>
                                                <td
                                                    className={styles.source_cell}
                                                    title={touch.subnetHash
                                                        ? `${touch.subnetHash && flaggedSubnets.has(touch.subnetHash) ? 'High-volume network (possible automated traffic) — ' : ''}Salted subnet hash ${touch.subnetHash} — rows sharing this value came from the same /24 (IPv4) or /48 (IPv6) network`
                                                        : undefined}
                                                >
                                                    {touch.subnetHash
                                                        ? (
                                                            <span className={styles.source_hash}>
                                                                {flaggedSubnets.has(touch.subnetHash) && (
                                                                    <AlertTriangle
                                                                        size={12}
                                                                        className={styles.flag_icon}
                                                                        aria-label="High-volume network"
                                                                    />
                                                                )}
                                                                {touch.subnetHash.slice(0, 6)}
                                                            </span>
                                                        )
                                                        : <span className={styles.muted}>—</span>}
                                                </td>
                                                <td className={styles.utm_cell} title={utmDisplay ?? undefined}>
                                                    {utmDisplay || <span className={styles.muted}>—</span>}
                                                </td>
                                                <td className={styles.device_cell}>
                                                    {getDeviceIcon(touch.device)}
                                                </td>
                                                <td>{touch.pageViews.toLocaleString()}</td>
                                                <td>{touch.sessionsCount.toLocaleString()}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className={styles.pagination}>
                            <Button
                                onClick={() => setFirstTouchesPage(firstTouchesPage - 1)}
                                disabled={firstTouchesPage <= 1}
                                size="sm"
                                variant="ghost"
                            >
                                Previous
                            </Button>
                            <span className={styles.page_info}>
                                Page {firstTouchesPage} of {totalFirstTouchesPages} ({firstTouchesTotal.toLocaleString()} new visitors)
                            </span>
                            <Button
                                onClick={() => setFirstTouchesPage(firstTouchesPage + 1)}
                                disabled={firstTouchesPage >= totalFirstTouchesPages}
                                size="sm"
                                variant="ghost"
                            >
                                Next
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
