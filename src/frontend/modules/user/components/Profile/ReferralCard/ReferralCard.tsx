/**
 * ReferralCard Component
 *
 * Displays the user's referral link with copy-to-clipboard, share buttons
 * for Twitter and Telegram, and referral statistics (visitors referred,
 * wallets converted). Only shown to users in the *verified* identity state
 * on their own profile page — referral codes are issued at the moment of
 * verification.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Copy, Check, Share2, ExternalLink, Users, UserCheck } from 'lucide-react';
import { Stack } from '../../../../../components/layout';
import { fetchReferralStats } from '../../../api';
import type { IReferralStats } from '../../../api';
import styles from './ReferralCard.module.scss';

/**
 * Props for ReferralCard.
 */
interface ReferralCardProps {
    /** User UUID for fetching referral data */
    userId: string;
    /** Public site URL for building referral links */
    siteUrl: string;
}

/**
 * Build the full referral URL from a code and site URL.
 *
 * @param siteUrl - Public site URL (e.g., "https://tronrelic.com")
 * @param code - Referral code
 * @returns Full referral URL with UTM params
 */
function buildReferralUrl(siteUrl: string, code: string): string {
    const base = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;
    return `${base}/?utm_source=referral&utm_medium=link&utm_content=${code}`;
}

/**
 * ReferralCard displays referral link, share options, and stats.
 *
 * Fetches referral data from the backend on mount. Shows an empty state
 * if the user has no referral code (i.e. the user is still *anonymous* or
 * *registered* — codes are issued only on transition into the *verified*
 * state). Once loaded, displays the referral URL, copy button,
 * Twitter/Telegram share buttons, and counts of referred visitors and
 * wallet conversions.
 *
 * @param props - Component props
 * @param props.userId - User UUID for API calls
 * @param props.siteUrl - Site URL for building referral links
 */
export function ReferralCard({ userId, siteUrl }: ReferralCardProps) {
    const [stats, setStats] = useState<IReferralStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [copied, setCopied] = useState(false);
    const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    /**
     * Fetch referral stats from the backend.
     */
    const loadStats = useCallback(async () => {
        try {
            const result = await fetchReferralStats(userId);
            setStats(result);
            setError(false);
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        loadStats();
        return () => {
            if (copyTimeoutRef.current) {
                clearTimeout(copyTimeoutRef.current);
            }
        };
    }, [loadStats]);

    /**
     * Copy referral link to clipboard with visual feedback.
     */
    const handleCopy = useCallback(async () => {
        if (!stats) return;
        const url = buildReferralUrl(siteUrl, stats.code);

        // Clear any existing timeout before setting a new one
        if (copyTimeoutRef.current) {
            clearTimeout(copyTimeoutRef.current);
        }

        try {
            await navigator.clipboard.writeText(url);
        } catch {
            // Fallback for older browsers — position off-screen to avoid layout shift
            const input = document.createElement('input');
            input.style.position = 'fixed';
            input.style.top = '-9999px';
            input.style.left = '-9999px';
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
        }

        setCopied(true);
        copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    }, [stats, siteUrl]);

    /**
     * Open Twitter share intent with pre-filled text.
     */
    const handleShareTwitter = useCallback(() => {
        if (!stats) return;
        const url = buildReferralUrl(siteUrl, stats.code);
        const text = 'Check out TronRelic — compare TRON energy rental prices and save on transaction fees!';
        window.open(
            `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
            '_blank',
            'noopener,noreferrer'
        );
    }, [stats, siteUrl]);

    /**
     * Open Telegram share intent with pre-filled text.
     */
    const handleShareTelegram = useCallback(() => {
        if (!stats) return;
        const url = buildReferralUrl(siteUrl, stats.code);
        const text = 'Check out TronRelic — compare TRON energy rental prices and save on transaction fees!';
        window.open(
            `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
            '_blank',
            'noopener,noreferrer'
        );
    }, [stats, siteUrl]);

    if (loading) {
        return (
            <div className={`surface surface--padding-md ${styles.card}`}>
                <div className={styles.empty_state}>Loading referral data...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className={`surface surface--padding-md ${styles.card}`}>
                <div className={styles.empty_state}>
                    Unable to load referral data. Please try refreshing the page.
                </div>
            </div>
        );
    }

    if (!stats) {
        return (
            <div className={`surface surface--padding-md ${styles.card}`}>
                <div className={styles.empty_state}>
                    Verify a wallet to get your personal referral link.
                </div>
            </div>
        );
    }

    const referralUrl = buildReferralUrl(siteUrl, stats.code);

    return (
        <div className={`surface surface--padding-md ${styles.card}`}>
            <Stack gap="md">
                <h3 className={styles.card_title}>
                    <Share2 size={16} className={styles.title_icon} />
                    Referral Program
                </h3>

                {/* Stats */}
                <div className={styles.stats_row}>
                    <div className={styles.stat}>
                        <div className={styles.stat__value}>{stats.referredCount}</div>
                        <div className={styles.stat__label}>
                            <Users size={12} className={styles.stat_icon} />
                            Visitors Referred
                        </div>
                    </div>
                    <div className={styles.stat}>
                        <div className={styles.stat__value}>{stats.convertedCount}</div>
                        <div className={styles.stat__label}>
                            <UserCheck size={12} className={styles.stat_icon} />
                            Wallets Verified
                        </div>
                    </div>
                    <div className={styles.stat}>
                        <div className={styles.stat__value}>
                            {stats.referredCount > 0
                                ? `${Math.round((stats.convertedCount / stats.referredCount) * 100)}%`
                                : '—'}
                        </div>
                        <div className={styles.stat__label}>Conversion Rate</div>
                    </div>
                </div>

                {/* Referral Link */}
                <div className={styles.link_row}>
                    <input
                        type="text"
                        className={styles.link_input}
                        value={referralUrl}
                        readOnly
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                        aria-label="Referral link"
                    />
                    <button
                        className={`btn btn--primary btn--sm ${styles.copy_btn}`}
                        onClick={handleCopy}
                        aria-label={copied ? 'Copied!' : 'Copy referral link'}
                    >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                </div>

                {/* Share Buttons */}
                <div className={styles.share_row}>
                    <button
                        className={`btn btn--secondary btn--sm ${styles.share_btn}`}
                        onClick={handleShareTwitter}
                        aria-label="Share on Twitter"
                    >
                        <ExternalLink size={14} />
                        Share on Twitter
                    </button>
                    <button
                        className={`btn btn--secondary btn--sm ${styles.share_btn}`}
                        onClick={handleShareTelegram}
                        aria-label="Share on Telegram"
                    >
                        <ExternalLink size={14} />
                        Share on Telegram
                    </button>
                </div>
            </Stack>
        </div>
    );
}
