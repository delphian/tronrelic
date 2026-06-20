/**
 * @fileoverview Client-side API helpers for the notifications surfaces.
 *
 * Every call is a same-origin fetch, so the browser attaches the Better Auth
 * session cookie automatically — the backend gates admin routes via
 * `requireAdmin` and user routes via the login check. The base contract types
 * come from `@/types`; only the audit view (with a string `createdAt` over the
 * wire) and the admin-augmented category/channel rows are declared locally.
 */

import type {
    INotificationCategory,
    INotificationChannelInfo,
    INotificationPreferences,
    INotificationPreferenceUpdate,
    NotificationSeverity
} from '@/types';

/** Admin category row — a category plus its current global enable state. */
export interface IAdminCategory extends INotificationCategory {
    enabled: boolean;
}

/** Admin channel row — a channel plus its current global enable state. */
export interface IAdminChannel extends INotificationChannelInfo {
    enabled: boolean;
}

/** Audit history row as it arrives over the wire (dates serialized to strings). */
export interface IAuditRecordView {
    id: string;
    categoryId: string;
    categoryLabel: string;
    source: string;
    severity: NotificationSeverity;
    title: string;
    body?: string;
    recipientCount: number;
    suppressedCount: number;
    channels: Array<{ channelId: string; delivered: number; suppressed: number }>;
    firedBy?: string;
    createdAt: string;
}

/** The user-preferences bundle backing the opt-out matrix. */
export interface IPreferencesBundle {
    preferences: INotificationPreferences;
    categories: INotificationCategory[];
    channels: INotificationChannelInfo[];
}

/**
 * Parse a JSON response, throwing on a non-2xx status or a `success: false`
 * envelope so callers can rely on a resolved promise meaning success.
 *
 * @param res - The fetch response.
 * @returns The parsed body.
 */
async function unwrap<T>(res: Response): Promise<T> {
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success === false) {
        throw new Error(body?.error ?? `Request failed (${res.status})`);
    }
    return body as T;
}

/**
 * Load the current user's preferences plus the catalog the opt-out matrix
 * renders from (user-configurable categories and the channel list).
 *
 * @returns The preferences bundle.
 */
export async function getMyPreferences(): Promise<IPreferencesBundle> {
    const body = await unwrap<{ preferences: INotificationPreferences; categories: INotificationCategory[]; channels: INotificationChannelInfo[] }>(
        await fetch('/api/notifications/preferences')
    );
    return { preferences: body.preferences, categories: body.categories, channels: body.channels };
}

/**
 * Merge a preference patch for the current user.
 *
 * @param patch - `mutedAll` and/or per-pairing `overrides` to change.
 * @returns The updated preferences.
 */
export async function updateMyPreferences(patch: INotificationPreferenceUpdate): Promise<INotificationPreferences> {
    const body = await unwrap<{ preferences: INotificationPreferences }>(
        await fetch('/api/notifications/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch)
        })
    );
    return body.preferences;
}

/**
 * Load every registered category with its admin enable state.
 *
 * @returns Admin category rows.
 */
export async function getAdminCategories(): Promise<IAdminCategory[]> {
    const body = await unwrap<{ categories: IAdminCategory[] }>(
        await fetch('/api/admin/system/notifications/categories')
    );
    return body.categories;
}

/**
 * Globally enable or disable a category.
 *
 * @param id - Category id.
 * @param enabled - New enable state.
 */
export async function setAdminCategory(id: string, enabled: boolean): Promise<void> {
    await unwrap(
        await fetch(`/api/admin/system/notifications/categories/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        })
    );
}

/**
 * Load every registered channel with its admin enable state.
 *
 * @returns Admin channel rows.
 */
export async function getAdminChannels(): Promise<IAdminChannel[]> {
    const body = await unwrap<{ channels: IAdminChannel[] }>(
        await fetch('/api/admin/system/notifications/channels')
    );
    return body.channels;
}

/**
 * Globally enable or disable a channel transport.
 *
 * @param id - Channel id.
 * @param enabled - New enable state.
 */
export async function setAdminChannel(id: string, enabled: boolean): Promise<void> {
    await unwrap(
        await fetch(`/api/admin/system/notifications/channels/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        })
    );
}

/**
 * Load a page of audit history, newest first.
 *
 * @param params - Optional category/source filter and pagination.
 * @returns The records and the unpaginated total for the filter.
 */
export async function getHistory(params: { categoryId?: string; source?: string; limit?: number; skip?: number } = {}): Promise<{ records: IAuditRecordView[]; total: number }> {
    const qs = new URLSearchParams();
    if (params.categoryId) qs.set('categoryId', params.categoryId);
    if (params.source) qs.set('source', params.source);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.skip !== undefined) qs.set('skip', String(params.skip));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return unwrap<{ records: IAuditRecordView[]; total: number }>(
        await fetch(`/api/admin/system/notifications/history${suffix}`)
    );
}
