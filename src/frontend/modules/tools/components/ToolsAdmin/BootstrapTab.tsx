/**
 * @fileoverview The Bootstrap tab of `/system/tools`.
 *
 * Lists the CMS pages the tools module ships, such as the stake calculator's,
 * with the state of the address each would take. An admin creates a page with
 * its Create button; the backend proposes it into the curation queue, so
 * nothing changes for visitors until a curator approves it. The button is
 * offered only while no page holds the address, because the pages module
 * refuses a second page there, including a deleted or rejected one.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { IToolsBootstrapPage, ToolsBootstrapPageState } from '@/types';
import { Stack } from '../../../../components/layout';
import { Badge, type BadgeTone } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Panel } from '../../../../components/ui/Panel';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../../../components/ui/Table';
import { useToast } from '../../../../components/ui/ToastProvider';
import { bootstrapErrorMessage, createBootstrapPage } from '../../api/bootstrap';

/**
 * How each address state reads on the tab: the badge text and tone.
 */
const STATE_DISPLAY: Record<ToolsBootstrapPageState, { label: string; tone: BadgeTone }> = {
    absent: { label: 'Not created', tone: 'neutral' },
    pending: { label: 'Awaiting review', tone: 'warning' },
    approved: { label: 'Approved', tone: 'success' },
    draft: { label: 'Draft', tone: 'neutral' },
    rejected: { label: 'Rejected', tone: 'danger' },
    deleted: { label: 'Deleted', tone: 'danger' },
    redirect: { label: 'Redirects elsewhere', tone: 'info' }
};

/**
 * Props for {@link BootstrapTab}.
 */
interface IBootstrapTabProps {
    /**
     * The rows the server read when it rendered the page, so the tab opens
     * with data; null when that read failed, which the tab says rather than
     * showing an empty list an admin could mistake for "nothing to create".
     */
    initialPages: IToolsBootstrapPage[] | null;
}

/**
 * Explain where to go about a page that already holds an address, so the
 * admin knows why Create is not offered and where to act instead.
 *
 * @param row - A row whose address is held.
 * @returns A short note naming the holding page and the admin page to visit.
 */
function HeldNote({ row }: { row: IToolsBootstrapPage }) {
    const target = row.state === 'pending' ? '/system/curation' : '/system/pages';
    const place = row.state === 'pending' ? 'the curation queue' : 'Pages';

    return (
        <span className="text-muted">
            Held by &ldquo;{row.holder?.title}&rdquo; — see <Link href={target}>{place}</Link>
        </span>
    );
}

/**
 * Bootstrap tab: one row per page the tools module can create, with a Create
 * button while the page's address is free.
 *
 * @param props - The server-read rows.
 * @returns The tab panel.
 */
export function BootstrapTab({ initialPages }: IBootstrapTabProps) {
    const [pages, setPages] = useState<IToolsBootstrapPage[]>(initialPages ?? []);
    const [creatingId, setCreatingId] = useState<string | null>(null);
    const { push } = useToast();

    /**
     * Create one page, replace its row with the state the backend returns,
     * and tell the admin where the page is waiting.
     *
     * @param row - The row whose Create button was clicked.
     */
    const handleCreate = async (row: IToolsBootstrapPage) => {
        setCreatingId(row.id);
        try {
            const { page } = await createBootstrapPage(row.id);
            setPages(current => current.map(item => (item.id === page.id ? page : item)));
            push({
                tone: 'success',
                title: `${row.label} created`,
                titleHref: '/system/curation',
                description: 'It is waiting in the curation queue. Visitors see no change until a curator approves it.'
            });
        } catch (error) {
            push({ tone: 'danger', title: `Could not create the ${row.label}`, description: bootstrapErrorMessage(error, 'The request failed.') });
        } finally {
            setCreatingId(null);
        }
    };

    return (
        <Panel
            title="Bootstrap"
            meta="Pages this module can create. Each goes to the curation queue and is created only while no page holds its address."
        >
            {initialPages === null && (
                <p className="text-muted">The page list could not be loaded. Reload the page to try again.</p>
            )}
            {/* Stacks into labelled entries on a narrow panel, where four
              * columns and a sentence-long description would not fit. */}
            {initialPages !== null && <Table flush stackAt="tablet">
                <Thead>
                    <Tr>
                        <Th>Page</Th>
                        <Th width="shrink">Address</Th>
                        <Th width="shrink">Status</Th>
                        <Th width="shrink">Action</Th>
                    </Tr>
                </Thead>
                <Tbody>
                    {pages.map(row => (
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
