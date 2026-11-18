'use client';

/**
 * @fileoverview Centralized admin view of the content router's sink registry.
 *
 * Lists every capability-registered sink — the one place an operator sees which
 * destinations the platform can route content to, with each sink's structural
 * `accepts` (its routing predicate) and its `reach` (the exposure it causes, the
 * gate's input), shown as separate Egress and Audience columns so an operator
 * can scan for every external or public sink at once. Loads the snapshot from
 * the admin-gated `/api/admin/system/content-router` endpoint and renders a
 * read-only table, following the same client-fetch convention as the sibling
 * `/system/*` surfaces (`/system/content-types`, `/system/hooks`) rather than SSR.
 *
 * The endpoint also computes the gate's admitted set and the structural
 * candidates for an operator-supplied classification (`?egress=&audience=&features=`);
 * this view renders the registry itself, the stable surface an operator scans.
 *
 * @module app/[lang]/(site)/(core)/system/content-router/page
 */

import { useEffect, useState } from 'react';
import { AdminPage } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import { Panel } from '../../../../../../components/ui/Panel';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
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
 * Explanations shown when an operator hovers a column header. The page keeps
 * its intro to one subtitle line, so what each column means and how the router
 * uses it lives here instead of in a paragraph above the table.
 */
const COLUMN_HELP = {
    accepts: 'The content features the sink can render. Among the sinks the gate admits, the router offers content '
        + 'to a sink only when the content carries every feature listed here. A sink that lists none matches all content.',
    egress: 'How far the sink exposes content: internal, then user, then external. The gate admits the sink only when '
        + 'this stays within the egress ceiling of the content’s classification. The sink itself never reads it.',
    audience: 'How broadly the sink exposes content: admin, then user, then public. The gate admits the sink only when '
        + 'this stays within the audience ceiling of the content’s classification. The sink itself never reads it.'
};

/**
 * Map an egress level to a Badge tone so more-exposed reach reads as more
 * cautionary at a glance: `external` (leaves the platform) warns, `user` informs,
 * `internal` is neutral.
 */
function egressTone(egress: string): 'neutral' | 'info' | 'warning' {
    let tone: 'neutral' | 'info' | 'warning' = 'neutral';
    if (egress === 'external') {
        tone = 'warning';
    } else if (egress === 'user') {
        tone = 'info';
    }
    return tone;
}

/**
 * Map an audience level to a Badge tone on the same more-exposed-reads-cautionary
 * scale: `public` warns, `user` informs, `admin` is neutral.
 */
function audienceTone(audience: string): 'neutral' | 'info' | 'warning' {
    let tone: 'neutral' | 'info' | 'warning' = 'neutral';
    if (audience === 'public') {
        tone = 'warning';
    } else if (audience === 'user') {
        tone = 'info';
    }
    return tone;
}

/**
 * Admin page rendering the content router's sink registry table.
 *
 * @returns The page: the header, then one panel holding the sink table.
 */
export default function ContentRouterAdminPage() {
    const [sinks, setSinks] = useState<ReadonlyArray<IContentSinkRecord>>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    /**
     * Load the sink registry once after mount, and abandon the request if the
     * page unmounts first so a late answer cannot set state on a dead page.
     */
    useEffect(() => {
        let aborted = false;
        const ctrl = new AbortController();

        /**
         * Fetch the snapshot and store either its sinks or the reason it failed.
         */
        async function load(): Promise<void> {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch('/api/admin/system/content-router', { signal: ctrl.signal });
                if (!res.ok) {
                    throw new Error(`Snapshot request failed with status ${res.status}`);
                }
                const data = await res.json() as { sinks: ReadonlyArray<IContentSinkRecord> };
                if (!aborted) {
                    setSinks(data.sinks);
                }
            } catch (err) {
                if (!aborted) {
                    setError(err instanceof Error ? err.message : String(err));
                }
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
        <AdminPage
            title="Content Router"
            subtitle="Every sink the platform can route content to, the features it accepts, and how far it exposes them."
        >
            {error && <div className="alert" role="alert">{error}</div>}
            {loading && sinks.length === 0 && (
                <p className="text-muted">Loading sinks&hellip;</p>
            )}
            {!loading && sinks.length === 0 && !error && (
                <p className="text-muted">No sinks registered.</p>
            )}

            {sinks.length > 0 && (
                <Panel
                    title="Registered sinks"
                    meta={`${sinks.length} ${sinks.length === 1 ? 'sink' : 'sinks'}`}
                >
                    {/* The three badge columns shrink to their badges, so the id
                        column takes the rest of the width and only a very long
                        id wraps. The table fits a tablet; on a phone each sink
                        stacks into an entry headed by its id. */}
                    <Table variant="compact" flush stackAt="mobile">
                        <Thead>
                            <Tr>
                                <Th>Sink ID</Th>
                                <Th width="shrink" title={COLUMN_HELP.accepts}>Accepts</Th>
                                <Th width="shrink" title={COLUMN_HELP.egress}>Egress</Th>
                                <Th width="shrink" title={COLUMN_HELP.audience}>Audience</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {sinks.map((s) => (
                                <Tr key={s.id}>
                                    <Td><code className={styles.sink_id}>{s.id}</code></Td>
                                    <Td label="Accepts">
                                        <span className={styles.badge_row}>
                                            {s.accepts.length > 0
                                                ? s.accepts.map((f) => <Badge key={f} tone="info" size="sm">{f}</Badge>)
                                                : <span className="text-muted" title="Matches all content">any</span>}
                                        </span>
                                    </Td>
                                    <Td label="Egress">
                                        <Badge tone={egressTone(s.reach.egress)} size="sm">{s.reach.egress}</Badge>
                                    </Td>
                                    <Td label="Audience">
                                        <Badge tone={audienceTone(s.reach.audience)} size="sm">{s.reach.audience}</Badge>
                                    </Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                </Panel>
            )}
        </AdminPage>
    );
}
