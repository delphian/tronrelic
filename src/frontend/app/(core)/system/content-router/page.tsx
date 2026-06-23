'use client';

/**
 * @fileoverview Centralized admin view of the content router's sink registry.
 *
 * Lists every capability-registered sink — the one place an operator sees which
 * destinations the platform can route content to, with each sink's structural
 * `accepts` (its routing predicate) and its `reach` (the exposure it causes, the
 * gate's input). Loads the snapshot from the admin-gated
 * `/api/admin/system/content-router` endpoint and renders a read-only table,
 * following the same client-fetch convention as the sibling `/system/*` surfaces
 * (`/system/content-types`, `/system/hooks`) rather than SSR.
 *
 * The endpoint also computes the gate's admitted set and the structural
 * candidates for an operator-supplied classification (`?egress=&audience=&features=`);
 * this view renders the registry itself, the stable surface an operator scans.
 *
 * @module app/(core)/system/content-router/page
 */

import { useEffect, useState } from 'react';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import styles from './page.module.scss';

/**
 * Shape of one sink row returned by the snapshot endpoint. Redeclared locally —
 * matching the hooks and content-types page convention — so the page does not
 * depend on a backend response type.
 */
interface IContentSinkRecord {
    id: string;
    accepts: string[];
    reach: { egress: string; audience: string };
    providerId: string;
}

/**
 * Map an egress level to a Badge tone so more-exposed reach reads as more
 * cautionary at a glance: `external` (leaves the platform) warns, `user` informs,
 * `internal` is neutral.
 *
 * @param egress - The sink's egress level.
 * @returns The Badge tone for that level.
 */
function egressTone(egress: string): 'neutral' | 'info' | 'warning' {
    if (egress === 'external') return 'warning';
    if (egress === 'user') return 'info';
    return 'neutral';
}

/**
 * Map an audience level to a Badge tone on the same more-exposed-reads-cautionary
 * scale: `public` warns, `user` informs, `admin` is neutral.
 *
 * @param audience - The sink's audience level.
 * @returns The Badge tone for that level.
 */
function audienceTone(audience: string): 'neutral' | 'info' | 'warning' {
    if (audience === 'public') return 'warning';
    if (audience === 'user') return 'info';
    return 'neutral';
}

/**
 * Admin page rendering the content router's sink registry table.
 */
export default function ContentRouterAdminPage() {
    const [sinks, setSinks] = useState<ReadonlyArray<IContentSinkRecord>>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        let aborted = false;
        const ctrl = new AbortController();

        async function load(): Promise<void> {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch('/api/admin/system/content-router', { signal: ctrl.signal });
                if (!res.ok) {
                    throw new Error(`Snapshot request failed with status ${res.status}`);
                }
                const data = await res.json() as { sinks: ReadonlyArray<IContentSinkRecord> };
                if (aborted) return;
                setSinks(data.sinks);
            } catch (err) {
                if (aborted) return;
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                if (!aborted) {
                    setLoading(false);
                }
            }
        }
        void load();

        return () => {
            aborted = true;
            ctrl.abort();
        };
    }, []);

    return (
        <Page>
            <div className={styles.container}>
                <PageHeader
                    title="Content Router"
                    subtitle="Every capability-registered sink the platform can route content to."
                />
                <Stack gap="lg">
                    <p className={styles.intro}>
                        A sink is a registered consumer of content. The router admits a sink for a
                        content type only when the sink&rsquo;s <code>reach</code> stays within the
                        content&rsquo;s classification ceiling (the gate), then matches the sink&rsquo;s
                        <code> accepts</code> against the features the content carries (structural
                        routing). <code>accepts</code> is the only routing predicate; <code>reach</code>
                        is read by the gate, never branched on by the sink.
                    </p>

                    {error && <div className="alert" role="alert">{error}</div>}
                    {loading && sinks.length === 0 && (
                        <p className="text-muted">Loading sinks&hellip;</p>
                    )}
                    {!loading && sinks.length === 0 && !error && (
                        <p className="text-muted">No sinks registered.</p>
                    )}

                    {sinks.length > 0 && (
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Sink ID</th>
                                    <th>Provider</th>
                                    <th>Accepts</th>
                                    <th>Reach</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sinks.map((s) => (
                                    <tr key={s.id}>
                                        <td><code className={styles.sink_id}>{s.id}</code></td>
                                        <td><Badge tone="neutral">{s.providerId}</Badge></td>
                                        <td>
                                            <span className={styles.badge_row}>
                                                {s.accepts.length > 0
                                                    ? s.accepts.map((f) => <Badge key={f} tone="info">{f}</Badge>)
                                                    : <span className="text-muted">—</span>}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={styles.badge_row}>
                                                <Badge tone={egressTone(s.reach.egress)}>{s.reach.egress}</Badge>
                                                <Badge tone={audienceTone(s.reach.audience)}>{s.reach.audience}</Badge>
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </Stack>
            </div>
        </Page>
    );
}
