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
 * @module app/[lang]/(site)/(core)/system/content-types/page
 */

import { useEffect, useState } from 'react';
import { Page, PageHeader, Stack } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
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
                        /* Four columns fit a tablet; on a phone each type
                           stacks into an entry headed by its id. */
                        <Table stackAt="mobile">
                            <Thead>
                                <Tr>
                                    <Th>Type ID</Th>
                                    <Th>Label</Th>
                                    <Th>Provider</Th>
                                    <Th>Bindings</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {types.map((t) => (
                                    <Tr key={t.typeId}>
                                        <Td><code className={styles.type_id}>{t.typeId}</code></Td>
                                        <Td label="Label">{t.label}</Td>
                                        <Td label="Provider"><Badge tone="neutral">{t.providerId}</Badge></Td>
                                        <Td label="Bindings">
                                            {t.curatable
                                                ? <Badge tone="success">curation</Badge>
                                                : <span className="text-muted">—</span>}
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    )}
                </Stack>
            </div>
        </Page>
    );
}
