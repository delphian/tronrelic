/**
 * @fileoverview /system/system server entry.
 *
 * The consolidated System page carries an in-page tab row (the menu module's
 * Submenu Pattern) so it can host distinct concerns — the block Pipeline, the
 * Server console, Configuration, the pipeline's Schedules and Logs, WebSockets,
 * MongoDB, and ClickHouse — without a hand-rolled control. This server
 * component fetches the `system` namespace tree and the Pipeline payload
 * SSR-first (forwarding the admin's cookie so admin gating resolves) and reads
 * `?tab=` to seed the active panel, mirroring /system/account-history.
 * Admin-gated by the /system layout.
 */

import { cookies } from 'next/headers';
import type { MenuNodeSerialized } from '@/shared';
import type { IPipelineStatus } from '@/types';
import { getServerSideApiUrl } from '../../../../lib/api-url';
import { SystemAdminClient } from './SystemAdminClient';

/** Namespace holding the page's tab nodes; registered in bootstrap. */
const SUBMENU_NAMESPACE = 'system';

/**
 * Build the Cookie header that carries the admin's session to the backend.
 *
 * Both server fetches below go to admin-gated endpoints, and on the server
 * the browser's cookies are not sent automatically.
 *
 * @returns Headers to pass to `fetch`, or undefined when there are no cookies.
 */
async function adminHeaders(): Promise<Record<string, string> | undefined> {
    const cookieHeader = (await cookies()).toString();
    return cookieHeader ? { Cookie: cookieHeader } : undefined;
}

/**
 * Fetch the submenu namespace tree, forwarding cookies so the admin gating
 * resolves. Degrades to an empty tree on any failure — the page still renders,
 * just without the tab row until a live `menu:update` refetch repopulates it.
 *
 * @returns The namespace root nodes and the tree snapshot timestamp.
 */
async function fetchSubmenu(): Promise<{ roots: MenuNodeSerialized[]; generatedAt: string }> {
    const fallback = { roots: [] as MenuNodeSerialized[], generatedAt: new Date().toISOString() };
    try {
        const response = await fetch(`${getServerSideApiUrl()}/api/menu?namespace=${SUBMENU_NAMESPACE}`, {
            cache: 'no-store',
            headers: await adminHeaders()
        });
        if (!response.ok) {
            return fallback;
        }
        const data = await response.json() as { tree?: { roots?: MenuNodeSerialized[]; generatedAt?: string } };
        return {
            roots: data.tree?.roots ?? [],
            generatedAt: data.tree?.generatedAt ?? fallback.generatedAt
        };
    } catch {
        return fallback;
    }
}

/**
 * Fetch the Pipeline tab's payload for the first render.
 *
 * Fetched on every page load rather than only for `?tab=pipeline`, because
 * Pipeline is the default tab and the payload is a cheap read of in-memory
 * state plus one sync state document. A failure degrades to null, which the
 * tab turns into a short notice and fills from its first browser refresh.
 *
 * @returns The payload, or null when the request failed.
 */
async function fetchPipeline(): Promise<IPipelineStatus | null> {
    let pipeline: IPipelineStatus | null = null;

    try {
        const response = await fetch(`${getServerSideApiUrl()}/api/admin/system/blockchain/pipeline`, {
            cache: 'no-store',
            headers: await adminHeaders()
        });
        if (response.ok) {
            const data = await response.json() as { pipeline?: IPipelineStatus };
            pipeline = data.pipeline ?? null;
        }
    } catch {
        pipeline = null;
    }

    return pipeline;
}

/**
 * System admin page (server entry).
 *
 * @param props - Next.js route props.
 * @param props.searchParams - The `?tab=` deep link (a Promise in Next.js 15+),
 *   read SSR-first to seed the initially active panel.
 * @returns The client shell seeded with the SSR-fetched submenu tree and pipeline payload.
 */
export default async function SystemAdminPage({
    searchParams
}: {
    searchParams: Promise<{ tab?: string }>;
}) {
    const [{ roots, generatedAt }, pipeline, { tab }] = await Promise.all([
        fetchSubmenu(),
        fetchPipeline(),
        searchParams
    ]);
    return (
        <SystemAdminClient
            submenuTree={roots}
            submenuGeneratedAt={generatedAt}
            initialTab={tab}
            initialPipeline={pipeline}
        />
    );
}
