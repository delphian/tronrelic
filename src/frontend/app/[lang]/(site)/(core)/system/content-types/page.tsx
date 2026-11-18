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
 * Each row names the type by its label with the id beneath it. The provider is
 * shown only when it differs from the id's prefix, because for almost every
 * type the prefix already names it. The Bindings column shows the one
 * statically-resolvable binding — whether a curation type backs the id.
 * Notification usage is dynamic (a content type is chosen per dispatch), so it
 * is intentionally not attributed here.
 *
 * @module app/[lang]/(site)/(core)/system/content-types/page
 */

import { useEffect, useState } from 'react';
import { AdminPage } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import { Panel } from '../../../../../../components/ui/Panel';
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
 * What the Bindings column means, shown when an operator hovers its header.
 * The page keeps its intro to one subtitle line, so the detail lives here.
 */
const BINDINGS_HELP = 'Whether a curation type backs this content type, so changes to it can be held for review. '
    + 'Notifications choose a content type each time they send, so that use is not shown here. '
    + 'A type with no binding is registered but unused by curation.';

/**
 * Decide whether a row needs to name its provider. A type id is written
 * `<prefix>:<name>`, and the prefix is nearly always the provider's own id,
 * so the provider is shown only where the two differ, such as `core:page`
 * registered by the pages module.
 *
 * @param type - The registry row.
 * @returns The provider id to show beside the type id, or null when the id already names it.
 */
function providerNote(type: IContentTypeRecord): string | null {
    const separator = type.typeId.indexOf(':');
    const prefix = separator === -1 ? type.typeId : type.typeId.slice(0, separator);
    return prefix === type.providerId ? null : type.providerId;
}

/**
 * Admin page rendering the centralized content-type registry table.
 *
 * @returns The page: the header, then one panel holding the registry table.
 */
export default function ContentTypesAdminPage() {
    const [types, setTypes] = useState<ReadonlyArray<IContentTypeRecord>>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    /**
     * Load the registry once after mount, and abandon the request if the page
     * unmounts first so a late answer cannot set state on a dead page.
     */
    useEffect(() => {
        let aborted = false;
        const ctrl = new AbortController();

        /**
         * Fetch the snapshot and store either its types or the reason it failed.
         */
        async function load(): Promise<void> {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch('/api/admin/system/content-types', { signal: ctrl.signal });
                if (!res.ok) {
                    throw new Error(`Snapshot request failed with status ${res.status}`);
                }
                const data = await res.json() as { types: ReadonlyArray<IContentTypeRecord> };
                if (!aborted) {
                    setTypes(data.types);
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
            title="Content Types"
            subtitle="Every content type registered by a module or plugin; Bindings shows whether curation backs it."
        >
            {error && <div className="alert" role="alert">{error}</div>}
            {loading && types.length === 0 && (
                <p className="text-muted">Loading content types&hellip;</p>
            )}
            {!loading && types.length === 0 && !error && (
                <p className="text-muted">No content types registered.</p>
            )}

            {types.length > 0 && (
                <Panel
                    title="Registered types"
                    meta={`${types.length} ${types.length === 1 ? 'type' : 'types'}`}
                >
                    {/* Two columns fit every width down to a phone, so the
                        table never stacks: the type's label over its id, and
                        a shrink column for the one binding badge. */}
                    <Table variant="compact" flush>
                        <Thead>
                            <Tr>
                                <Th>Type</Th>
                                <Th width="shrink" title={BINDINGS_HELP}>Bindings</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {types.map((t) => {
                                const provider = providerNote(t);
                                return (
                                    <Tr key={t.typeId}>
                                        <Td>
                                            <span className={styles.type_label}>{t.label}</span>
                                            <span className={styles.type_meta}>
                                                <code className={styles.type_id}>{t.typeId}</code>
                                                {provider && <> &middot; registered by {provider}</>}
                                            </span>
                                        </Td>
                                        <Td>
                                            {t.curatable
                                                ? <Badge tone="success" size="sm">curation</Badge>
                                                : <span className="text-muted">&mdash;</span>}
                                        </Td>
                                    </Tr>
                                );
                            })}
                        </Tbody>
                    </Table>
                </Panel>
            )}
        </AdminPage>
    );
}
