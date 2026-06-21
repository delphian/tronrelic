'use client';

/**
 * @fileoverview Centralized admin view of the content-type registry.
 *
 * Lists every provider-owned content type registered on the central registry —
 * the one place an operator sees the aggregate across pipelines (curation,
 * notifications). Loads the snapshot from the admin-gated
 * `/api/admin/system/content-types` endpoint and renders a read-only table,
 * following the same client-fetch convention as the other `/system/*` surfaces
 * (e.g. `/system/hooks`) rather than SSR.
 *
 * The Bindings column shows the one statically-resolvable binding — whether a
 * curation type backs the id. Notification usage is dynamic (a content type is
 * chosen per dispatch), so it is intentionally not attributed here.
 *
 * @module app/(core)/system/content-types/page
 */

import { useEffect, useState } from 'react';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import styles from './page.module.scss';

/**
 * Shape of one content-type row returned by the snapshot endpoint. Redeclared
 * locally — matching the hooks page convention — so the page does not depend on
 * a backend response type.
 */
interface IContentTypeRecord {
    typeId: string;
    label: string;
    providerId: string;
    curatable: boolean;
}

/**
 * Admin page rendering the centralized content-type registry table.
 */
export default function ContentTypesAdminPage() {
    const [types, setTypes] = useState<ReadonlyArray<IContentTypeRecord>>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        let aborted = false;
        const ctrl = new AbortController();

        async function load(): Promise<void> {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch('/api/admin/system/content-types', { signal: ctrl.signal });
                if (!res.ok) {
                    throw new Error(`Snapshot request failed with status ${res.status}`);
                }
                const data = await res.json() as { types: ReadonlyArray<IContentTypeRecord> };
                if (aborted) return;
                setTypes(data.types);
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
                    title="Content Types"
                    subtitle="Every provider-owned content type registered on the central registry."
                />
                <Stack gap="lg">
                    <p className={styles.intro}>
                        A content type is a provider-owned effect the platform can render, hold, decide,
                        or deliver without understanding its payload. Pipelines bind to these by id. The
                        Bindings column shows whether a curation type backs the id; notification usage is
                        chosen per dispatch and is not statically attributed here.
                    </p>

                    {error && <div className="alert" role="alert">{error}</div>}
                    {loading && types.length === 0 && (
                        <p className="text-muted">Loading content types&hellip;</p>
                    )}
                    {!loading && types.length === 0 && !error && (
                        <p className="text-muted">No content types registered.</p>
                    )}

                    {types.length > 0 && (
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Type ID</th>
                                    <th>Label</th>
                                    <th>Provider</th>
                                    <th>Bindings</th>
                                </tr>
                            </thead>
                            <tbody>
                                {types.map((t) => (
                                    <tr key={t.typeId}>
                                        <td><code className={styles.type_id}>{t.typeId}</code></td>
                                        <td>{t.label}</td>
                                        <td><Badge tone="neutral">{t.providerId}</Badge></td>
                                        <td>
                                            {t.curatable
                                                ? <Badge tone="success">curation</Badge>
                                                : <span className="text-muted">—</span>}
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
