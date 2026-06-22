/**
 * @fileoverview Admin API client for the central curation queue.
 *
 * Thin fetch wrappers over `/api/admin/system/curation/*`. Same-origin calls
 * carry the Better Auth session cookie automatically, which the backend's
 * `requireAdmin` middleware consults — no token plumbing here. Every function
 * throws on a non-2xx response so callers surface the failure in the UI.
 */

import type { ICurationPreview } from '@/types';

/** Base path for every curation admin endpoint. */
const BASE = '/api/admin/system/curation';

/**
 * Parse a fetch response, throwing a descriptive error on a non-2xx status so
 * the caller can surface it. Mirrors the shared admin-client pattern.
 *
 * @param response - The fetch response.
 * @param what - A short verb phrase naming the action, for the error message.
 * @returns The parsed JSON body.
 */
async function parse<T>(response: Response, what: string): Promise<T> {
    if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error || `Failed to ${what} (HTTP ${response.status})`);
    }
    return response.json() as Promise<T>;
}

/**
 * One held item in the central curation queue, as returned by `GET /curations`.
 * Mirrors the backend's serialized envelope (dates as ISO strings); `preview` is
 * the content-agnostic descriptor the queue renders, and `ref` is the owning
 * type's opaque pointer (used by an inline editor to address its own record).
 */
export interface ICurationItemView {
    id: string;
    typeId: string;
    providerId: string;
    ref: Record<string, unknown>;
    preview: ICurationPreview;
    status: string;
    source?: string;
    createdAt: string;
    decidedAt?: string;
    decidedBy?: string;
}

/**
 * List pending items in the central curation queue, newest first.
 *
 * @returns The pending curation envelopes.
 */
export async function listCurations(): Promise<ICurationItemView[]> {
    const data = await parse<{ curations: ICurationItemView[] }>(await fetch(`${BASE}/curations`), 'load curation queue');
    return data.curations;
}

/**
 * List decided curation items (approved/rejected), most-recently-decided first.
 * The pending queue answers "what needs me now?"; this answers "what was decided,
 * when, and by whom?" — the records persist after a decision, this surfaces them.
 *
 * @returns The decided curation envelopes, newest decision first.
 */
export async function listCurationHistory(): Promise<ICurationItemView[]> {
    const data = await parse<{ curations: ICurationItemView[] }>(await fetch(`${BASE}/curations/history`), 'load curation history');
    return data.curations;
}

/**
 * Fetch the count of pending curation items, for the header badge.
 *
 * @returns The pending count.
 */
export async function getCurationsCount(): Promise<number> {
    const data = await parse<{ count: number }>(await fetch(`${BASE}/curations/count`), 'load curation count');
    return data.count;
}

/**
 * Apply an inline edit to a held curation item before deciding it. The patch is
 * generic (today just `body`); the owning type maps it onto its record and
 * validates it, so a rejected edit surfaces as a thrown error here.
 *
 * @param id - The curation envelope id.
 * @param patch - The generic edit (e.g. replacement body text).
 * @returns Resolves when the edit is applied.
 */
export async function editCuration(id: string, patch: { body: string }): Promise<void> {
    await parse(await fetch(`${BASE}/curations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    }), 'edit curation item');
}

/**
 * Approve a held curation item, committing it through its owning type.
 *
 * @param id - The curation envelope id.
 * @returns Resolves when the item resolves.
 */
export async function approveCuration(id: string): Promise<void> {
    await parse(await fetch(`${BASE}/curations/${encodeURIComponent(id)}/approve`, { method: 'POST' }), 'approve curation item');
}

/**
 * Reject a held curation item, discarding it through its owning type.
 *
 * @param id - The curation envelope id.
 * @returns Resolves when the item resolves.
 */
export async function rejectCuration(id: string): Promise<void> {
    await parse(await fetch(`${BASE}/curations/${encodeURIComponent(id)}/reject`, { method: 'POST' }), 'reject curation item');
}
