'use client';

/**
 * Admin tab for the Phase 5 traffic-events dashboard
 * (PLAN-traffic-events.md).
 *
 * Reads aggregates from `/api/admin/users/traffic/*` (ClickHouse) and
 * surfaces:
 *
 * - **Bot class breakdown** — headline view; NULL bucket is a deliberate
 *   distinct value that decays as pre-classifier rows roll off the
 *   24h window.
 * - **bot_other UA samples** — operator's only feedback loop on
 *   classifier coverage. UAs that recur here are candidates for explicit
 *   rules in `bot-classifier.ts`. The 2026-04-30 prod sample that
 *   surfaced Amazonbot, DotBot, and FlipboardProxy in `bot_other` is
 *   exactly the signal this panel exists to expose.
 * - **Top paths** — landing-path frequency.
 * - **Top countries** — geo distribution.
 *
 * Mirrors the established admin-tab pattern (UsersMonitor, GroupsManager):
 * client-only, session-cookie auth, fetch-on-mount, local state per
 * panel. SSR + Live Updates does NOT apply because the route is
 * admin-gated; the `/system/users` page hosting this tab is already a
 * client component for the same reason.
 *
 * Each panel owns its loading/error state independently so a slow or
 * failing query for one dimension does not block the rest of the dashboard.
 */

import { useEffect, useMemo, useState } from 'react';
import { Bot, Globe, MapPin, RefreshCw } from 'lucide-react';
import { getRuntimeConfig } from '../../../../../lib/runtimeConfig';
import { Button } from '../../../../../components/ui/Button';
import { Card } from '../../../../../components/ui/Card';
import styles from './TrafficDashboard.module.scss';

interface AggregateBucket {
    key: string | null;
    count: number;
}

interface SummaryResponse {
    sinceHours: number;
    total: number;
    buckets: AggregateBucket[];
    clickhouseEnabled: boolean;
}

interface AggregateResponse {
    sinceHours: number;
    limit: number;
    buckets: AggregateBucket[];
}

/** Lookback windows the dashboard offers. Wider windows hit the 30-day cap. */
const SINCE_OPTIONS: Array<{ label: string; hours: number }> = [
    { label: '1h', hours: 1 },
    { label: '24h', hours: 24 },
    { label: '7d', hours: 168 },
    { label: '30d', hours: 720 }
];

/**
 * Render `null` bucket keys as a literal "(null)" so operators see the
 * distinction from `human` / `bot_other` — the NULL bucket is meaningful
 * (pre-classifier rows), not a missing-data placeholder.
 */
function renderKey(key: string | null): string {
    return key === null ? '(null)' : key;
}

/**
 * Format an integer with thousands separators using the user's locale.
 * Wrapped in useMemo by callers so re-renders don't reconstruct the
 * formatter on every row.
 */
function useNumberFormatter(): (n: number) => string {
    return useMemo(() => {
        const fmt = new Intl.NumberFormat();
        return (n: number) => fmt.format(n);
    }, []);
}

export function TrafficDashboard() {
    const [sinceHours, setSinceHours] = useState<number>(24);
    // Bumped by the Refresh button to re-trigger the fetch effect under
    // the same cleanup-flag guard used for window changes. Avoids a
    // separate manual fetch path that would race with the in-flight one.
    const [refreshNonce, setRefreshNonce] = useState(0);
    const formatNumber = useNumberFormatter();

    // Each panel manages its own state; a failing query for one
    // dimension shouldn't black out the rest of the dashboard.
    const [summary, setSummary] = useState<SummaryResponse | null>(null);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [summaryLoading, setSummaryLoading] = useState(true);

    const [botOther, setBotOther] = useState<AggregateResponse | null>(null);
    const [botOtherError, setBotOtherError] = useState<string | null>(null);
    const [botOtherLoading, setBotOtherLoading] = useState(true);

    const [topPaths, setTopPaths] = useState<AggregateResponse | null>(null);
    const [topPathsError, setTopPathsError] = useState<string | null>(null);
    const [topPathsLoading, setTopPathsLoading] = useState(true);

    const [topCountries, setTopCountries] = useState<AggregateResponse | null>(null);
    const [topCountriesError, setTopCountriesError] = useState<string | null>(null);
    const [topCountriesLoading, setTopCountriesLoading] = useState(true);

    // Read from window.__RUNTIME_CONFIG__ so the same Docker image works
    // on any domain. Calling once per mount is enough — the runtime
    // config is set during SSR injection and never changes client-side.
    const baseUrl = useMemo(
        () => `${getRuntimeConfig().apiUrl}/admin/users/traffic`,
        []
    );

    useEffect(() => {
        // Cleanup-flag guard against stale fetch results: clicking the
        // window picker rapidly (e.g. 24h -> 7d -> 1h) starts overlapping
        // requests, and a slower earlier response can land after a
        // faster later one. Without this guard, the dashboard would
        // briefly display data for a window the user has already left.
        // The flag also covers the Refresh-while-fetching case via
        // refreshNonce because the effect re-runs through the same
        // cleanup path.
        let active = true;
        const params = `?sinceHours=${sinceHours}`;

        // Reset loading and error state up-front so a previously-failed
        // panel renders the loading state during refresh rather than
        // continuing to display the stale error (PanelBody renders error
        // before loading).
        setSummaryLoading(true);
        setBotOtherLoading(true);
        setTopPathsLoading(true);
        setTopCountriesLoading(true);
        setSummaryError(null);
        setBotOtherError(null);
        setTopPathsError(null);
        setTopCountriesError(null);

        // Fire all four reads in parallel — they're independent endpoints
        // and the loading-per-panel UX hides any tail latency.
        const summaryPromise = fetch(`${baseUrl}/summary${params}`)
            .then(async r => {
                if (!r.ok) throw new Error(`Failed to load summary (${r.status})`);
                return r.json() as Promise<SummaryResponse>;
            })
            .then(data => { if (active) { setSummary(data); setSummaryError(null); } })
            .catch(err => { if (active) setSummaryError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setSummaryLoading(false); });

        const botOtherPromise = fetch(`${baseUrl}/bot-other-samples${params}&limit=15`)
            .then(async r => {
                if (!r.ok) throw new Error(`Failed to load bot_other (${r.status})`);
                return r.json() as Promise<AggregateResponse>;
            })
            .then(data => { if (active) { setBotOther(data); setBotOtherError(null); } })
            .catch(err => { if (active) setBotOtherError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setBotOtherLoading(false); });

        const topPathsPromise = fetch(`${baseUrl}/top-paths${params}&limit=15`)
            .then(async r => {
                if (!r.ok) throw new Error(`Failed to load paths (${r.status})`);
                return r.json() as Promise<AggregateResponse>;
            })
            .then(data => { if (active) { setTopPaths(data); setTopPathsError(null); } })
            .catch(err => { if (active) setTopPathsError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setTopPathsLoading(false); });

        const topCountriesPromise = fetch(`${baseUrl}/top-countries${params}&limit=15`)
            .then(async r => {
                if (!r.ok) throw new Error(`Failed to load countries (${r.status})`);
                return r.json() as Promise<AggregateResponse>;
            })
            .then(data => { if (active) { setTopCountries(data); setTopCountriesError(null); } })
            .catch(err => { if (active) setTopCountriesError(err instanceof Error ? err.message : 'Failed to load'); })
            .finally(() => { if (active) setTopCountriesLoading(false); });

        // The await-all isn't required for cleanup correctness — each
        // chain self-guards via `active`. It's kept off the effect
        // signature deliberately: useEffect can't return a Promise.
        void Promise.all([summaryPromise, botOtherPromise, topPathsPromise, topCountriesPromise]);

        return () => { active = false; };
    }, [baseUrl, sinceHours, refreshNonce]);

    const clickhouseDisabledNotice = summary && !summary.clickhouseEnabled;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1 className={styles.title}>Traffic</h1>
                    <p className={styles.subtitle}>
                        ClickHouse <code>traffic_events</code> — every cookieless
                        and pre-session HTTP request we see, classified at write
                        time. Use this to investigate bot pressure, classifier
                        coverage, and geographic / landing distribution.
                    </p>
                </div>
                <div className={styles.controls}>
                    <div className={styles.window_picker} role="group" aria-label="Lookback window">
                        {SINCE_OPTIONS.map(opt => (
                            <button
                                key={opt.hours}
                                type="button"
                                onClick={() => setSinceHours(opt.hours)}
                                className={opt.hours === sinceHours ? styles.window_active : styles.window_button}
                                aria-pressed={opt.hours === sinceHours}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setRefreshNonce(n => n + 1)}
                        aria-label="Refresh dashboard"
                    >
                        <RefreshCw size={16} aria-hidden="true" /> Refresh
                    </Button>
                </div>
            </header>

            {clickhouseDisabledNotice && (
                <Card padding="md" className={styles.notice_card}>
                    <p>
                        ClickHouse is not configured on this deployment.
                        Traffic events are not being recorded; all panels will
                        report zero rows.
                    </p>
                </Card>
            )}

            <Card padding="md" className={styles.panel}>
                <div className={styles.panel_header}>
                    <Bot size={18} aria-hidden="true" />
                    <h2 className={styles.panel_title}>Bot class breakdown</h2>
                    {summary && (
                        <span className={styles.panel_meta}>
                            {formatNumber(summary.total)} events
                        </span>
                    )}
                </div>
                <PanelBody loading={summaryLoading} error={summaryError} empty={summary?.buckets.length === 0}>
                    {summary && (
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th scope="col">bot_class</th>
                                    <th scope="col" className={styles.numeric_col}>events</th>
                                    <th scope="col" className={styles.numeric_col}>share</th>
                                </tr>
                            </thead>
                            <tbody>
                                {summary.buckets.map(b => {
                                    const share = summary.total > 0
                                        ? ((b.count / summary.total) * 100).toFixed(1)
                                        : '0.0';
                                    return (
                                        <tr key={b.key ?? '__null__'}>
                                            <td><code className={styles.code}>{renderKey(b.key)}</code></td>
                                            <td className={styles.numeric}>{formatNumber(b.count)}</td>
                                            <td className={styles.numeric}>{share}%</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </PanelBody>
            </Card>

            <Card padding="md" className={styles.panel}>
                <div className={styles.panel_header}>
                    <Bot size={18} aria-hidden="true" />
                    <h2 className={styles.panel_title}>bot_other — classifier gaps</h2>
                </div>
                <p className={styles.panel_help}>
                    UAs that <code>isbot()</code> flagged but no explicit
                    fragment rule matched. Recurring entries are candidates for
                    explicit rules in <code>bot-classifier.ts</code>.
                </p>
                <PanelBody loading={botOtherLoading} error={botOtherError} empty={botOther?.buckets.length === 0}>
                    {botOther && (
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th scope="col">user_agent</th>
                                    <th scope="col" className={styles.numeric_col}>events</th>
                                </tr>
                            </thead>
                            <tbody>
                                {botOther.buckets.map((b, i) => (
                                    <tr key={`${b.key ?? 'null'}_${i}`}>
                                        <td className={styles.ua_cell}>
                                            <code className={styles.code}>{renderKey(b.key)}</code>
                                        </td>
                                        <td className={styles.numeric}>{formatNumber(b.count)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </PanelBody>
            </Card>

            <div className={styles.grid_two}>
                <Card padding="md" className={styles.panel}>
                    <div className={styles.panel_header}>
                        <MapPin size={18} aria-hidden="true" />
                        <h2 className={styles.panel_title}>Top landing paths</h2>
                    </div>
                    <PanelBody loading={topPathsLoading} error={topPathsError} empty={topPaths?.buckets.length === 0}>
                        {topPaths && (
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th scope="col">path</th>
                                        <th scope="col" className={styles.numeric_col}>events</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {topPaths.buckets.map((b, i) => (
                                        <tr key={`${b.key ?? 'null'}_${i}`}>
                                            <td><code className={styles.code}>{renderKey(b.key)}</code></td>
                                            <td className={styles.numeric}>{formatNumber(b.count)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </PanelBody>
                </Card>

                <Card padding="md" className={styles.panel}>
                    <div className={styles.panel_header}>
                        <Globe size={18} aria-hidden="true" />
                        <h2 className={styles.panel_title}>Top countries</h2>
                    </div>
                    <PanelBody loading={topCountriesLoading} error={topCountriesError} empty={topCountries?.buckets.length === 0}>
                        {topCountries && (
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th scope="col">country</th>
                                        <th scope="col" className={styles.numeric_col}>events</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {topCountries.buckets.map((b, i) => (
                                        <tr key={`${b.key ?? 'null'}_${i}`}>
                                            <td><code className={styles.code}>{renderKey(b.key)}</code></td>
                                            <td className={styles.numeric}>{formatNumber(b.count)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </PanelBody>
                </Card>
            </div>
        </div>
    );
}

interface PanelBodyProps {
    loading: boolean;
    error: string | null;
    empty: boolean | undefined;
    children: React.ReactNode;
}

/**
 * Shared loading / error / empty rendering for every panel. Keeps the
 * three states centrally typed so a missed empty-check in one panel
 * doesn't render a phantom table.
 */
function PanelBody({ loading, error, empty, children }: PanelBodyProps) {
    if (error) {
        return <p className={styles.panel_error}>{error}</p>;
    }
    if (loading) {
        return <p className={styles.panel_loading}>Loading…</p>;
    }
    if (empty) {
        return <p className={styles.panel_empty}>No events in this window.</p>;
    }
    return <>{children}</>;
}
