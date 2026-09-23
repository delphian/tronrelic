/**
 * @fileoverview Browser-side calls behind the Pipeline tab.
 *
 * The tab's initial payload is fetched on the server by `page.tsx`; these
 * functions cover the live refresh and the one action the tab takes against
 * the pipeline. Requests go to the relative `/api/admin/...` path so the admin
 * session cookie travels with them.
 */
import type { IPipelineStatus } from '@/types';

/** Endpoint returning the whole pipeline payload. */
export const PIPELINE_STATUS_PATH = '/api/admin/system/blockchain/pipeline';

/** Endpoint that runs one `blockchain:sync` tick immediately. */
const TRIGGER_SYNC_PATH = '/api/admin/system/blockchain/sync';

/**
 * Fetch the current pipeline payload.
 *
 * @returns The payload the tab renders.
 * @throws Error naming the HTTP status when the request fails, so the tab can
 *         say the data has stopped refreshing instead of blanking it.
 */
export async function fetchPipelineStatus(): Promise<IPipelineStatus> {
    const response = await fetch(PIPELINE_STATUS_PATH, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Pipeline status request failed (HTTP ${response.status})`);
    }
    const data = await response.json() as { pipeline?: IPipelineStatus };
    if (!data.pipeline) {
        throw new Error('Pipeline status response carried no payload');
    }

    return data.pipeline;
}

/**
 * Ask the backend to run one sync tick now.
 *
 * The tick takes the same distributed lock as a scheduled one, so running it
 * while a scheduled tick is in flight is harmless: the second one skips.
 *
 * @throws Error carrying the server's reason when the request is refused.
 */
export async function triggerSyncTick(): Promise<void> {
    const response = await fetch(TRIGGER_SYNC_PATH, { method: 'POST' });
    if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string; message?: string } | null;
        throw new Error(data?.error ?? data?.message ?? `Sync trigger failed (HTTP ${response.status})`);
    }
}
