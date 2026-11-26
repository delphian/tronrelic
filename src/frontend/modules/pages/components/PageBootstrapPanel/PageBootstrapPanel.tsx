/**
 * @fileoverview The Bootstrap panel a module or plugin admin page shows.
 *
 * Lists the default CMS pages a component ships, such as a tool's page, with
 * the state of the address each would take. An admin creates a page with its
 * Create button; the owner's backend proposes it into the curation queue, so
 * nothing changes for visitors until a curator approves it. The button is
 * offered only while no page holds the address, because the pages module
 * refuses a second page there, including a deleted or rejected one.
 *
 * Shared by the tools module's Bootstrap tab and, through
 * `context.system.PageBootstrapPanel`, by plugins, so every Bootstrap tab
 * reads and behaves the same. The owner supplies the rows and the create
 * call, because a module and a plugin reach their admin routes differently.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { IPageBootstrapPanelProps, IPageBootstrapRow, PageBootstrapState } from '@/types';
import { Stack } from '../../../../components/layout';
import { Badge, type BadgeTone } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Panel } from '../../../../components/ui/Panel';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../../../components/ui/Table';
import { useToast } from '../../../../components/ui/ToastProvider';

/**
 * How each address state reads on the panel: the badge text and tone.
 */
const STATE_DISPLAY: Record<PageBootstrapState, { label: string; tone: BadgeTone }> = {
    absent: { label: 'Not created', tone: 'neutral' },
    pending: { label: 'Awaiting review', tone: 'warning' },
    approved: { label: 'Approved', tone: 'success' },
    draft: { label: 'Draft', tone: 'neutral' },
    rejected: { label: 'Rejected', tone: 'danger' },
    deleted: { label: 'Deleted', tone: 'danger' },
    redirect: { label: 'Redirects elsewhere', tone: 'info' }
};

/** The line under the title when the owner gives none. */
const DEFAULT_META = 'Pages this component can create. Each goes to the curation queue and is created only while no page holds its address.';

/**
 * Explain where to go about a page that already holds an address, so the
 * admin knows why Create is not offered and where to act instead.
 *
 * @param props - The row whose address is held.
 * @returns A short note naming the holding page and the admin page to visit.
 */
function HeldNote({ row }: { row: IPageBootstrapRow }) {
    const target = row.state === 'pending' ? '/system/curation' : '/system/pages';
    const place = row.state === 'pending' ? 'the curation queue' : 'Pages';

    return (
        <span className="text-muted">
            Held by &ldquo;{row.holder?.title}&rdquo; — see <Link href={target}>{place}</Link>
        </span>
    );
}

/**
 * Bootstrap panel: one row per page the owner can create, with a Create
 * button while the page's address is free.
 *
 * @param props - The rows, the callback that records an updated row, the
 *   create call, and an optional line under the title.
 * @returns The panel.
 */
export function PageBootstrapPanel({ rows, onRowUpdated, onCreate, meta }: IPageBootstrapPanelProps) {
    const [creatingId, setCreatingId] = useState<string | null>(null);
    const { push } = useToast();

    /**
     * Create one page, replace its row with the state the backend returns,
     * and tell the admin where the page is waiting.
     *
     * @param row - The row whose Create button was clicked.
     */
    const handleCreate = async (row: IPageBootstrapRow) => {
        setCreatingId(row.id);
        try {
            onRowUpdated(await onCreate(row.id));
            push({
                tone: 'success',
                title: `${row.label} created`,
                titleHref: '/system/curation',
                description: 'It is waiting in the curation queue. Visitors see no change until a curator approves it.'
            });
        } catch (error) {
            push({
                tone: 'danger',
                title: `Could not create the ${row.label}`,
                description: error instanceof Error && error.message ? error.message : 'The request failed.'
            });
        } finally {
            setCreatingId(null);
        }
    };

    return (
        <Panel title="Bootstrap" meta={meta ?? DEFAULT_META}>
            {rows === null && (
                <p className="text-muted">The page list could not be loaded. Reload the page to try again.</p>
            )}
            {/* Stacks into labelled entries on a narrow panel, where four
              * columns and a sentence-long description would not fit. */}
            {rows !== null && <Table flush stackAt="tablet">
                <Thead>
                    <Tr>
                        <Th>Page</Th>
                        <Th width="shrink">Address</Th>
                        <Th width="shrink">Status</Th>
                        <Th width="shrink">Action</Th>
                    </Tr>
                </Thead>
                <Tbody>
                    {rows.map(row => (
                        <Tr key={row.id}>
                            <Td label="Page">
                                <Stack gap="sm">
                                    <strong>{row.label}</strong>
                                    <span className="text-muted">{row.description}</span>
                                </Stack>
                            </Td>
                            <Td label="Address"><code>{row.slug}</code></Td>
                            <Td label="Status">
                                <Badge tone={STATE_DISPLAY[row.state].tone}>{STATE_DISPLAY[row.state].label}</Badge>
                            </Td>
                            <Td label="Action">
                                {row.state === 'absent' ? (
                                    <Button
                                        variant="primary"
                                        icon={<Plus size={18} />}
                                        loading={creatingId === row.id}
                                        disabled={creatingId !== null}
                                        onClick={() => handleCreate(row)}
                                    >
                                        Create
                                    </Button>
                                ) : (
                                    <HeldNote row={row} />
                                )}
                            </Td>
                        </Tr>
                    ))}
                </Tbody>
            </Table>}
        </Panel>
    );
}
