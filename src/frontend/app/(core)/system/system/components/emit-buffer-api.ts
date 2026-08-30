/**
 * @fileoverview Reading and saving the block feed's emit-buffer settings.
 *
 * The five values here shape how the backend paces `block:new` broadcasts. They
 * share the system config document with the site URL, so both this module and
 * `SystemConfigSection` talk to the same endpoint — each sending only its own
 * fields, so one card's save can never overwrite the other's.
 *
 * @module app/(core)/system/system/components/emit-buffer-api
 */

import type { IFieldBounds } from './field-integer';

/** Where the system configuration document is read and written. */
const SYSTEM_CONFIG_ENDPOINT = '/api/admin/system/config/system';

/**
 * The range each field accepts, mirroring `EMIT_BUFFER_LIMITS` on the backend.
 *
 * The backend remains the authority and re-checks every value; this copy exists
 * so an out-of-range entry is named at the field the operator is looking at,
 * rather than coming back as a save failure after a round trip. Keep the two in
 * step — the backend file is `src/backend/config/emit-buffer.ts`.
 */
export const EMIT_BUFFER_FIELD_LIMITS: Record<keyof IEmitBufferConfigView, IFieldBounds> = {
    emitBufferTargetDepth: { min: 0, max: 120 },
    emitBufferCatchupDepth: { min: 1, max: 240 },
    emitBufferMaxDepth: { min: 2, max: 480 },
    emitBufferRefillIntervalMs: { min: 100, max: 30_000 },
    emitBufferCatchupIntervalMs: { min: 100, max: 30_000 }
};

/** The emit-buffer slice of the system configuration document. */
export interface IEmitBufferConfigView {
    /** Blocks of lead the feed holds. Zero switches buffering off. */
    emitBufferTargetDepth: number;
    /** Depth at which draining speeds up to clear a burst. */
    emitBufferCatchupDepth: number;
    /** Depth beyond which blocks go out with no wait. */
    emitBufferMaxDepth: number;
    /** Spacing used below target, which is what rebuilds a spent lead. */
    emitBufferRefillIntervalMs: number;
    /** Spacing used above the catch-up depth. */
    emitBufferCatchupIntervalMs: number;
}

/**
 * Pull the emit-buffer settings out of a system config response.
 *
 * The endpoint answers with the whole configuration document. Narrowing it here
 * keeps the component's state to the five fields it owns, so a later addition
 * elsewhere on the document cannot end up in this form's save payload.
 *
 * @param config - The `config` object from the endpoint, of unknown shape.
 * @returns Just the five emit-buffer values.
 */
function toConfigView(config: Record<string, number>): IEmitBufferConfigView {
    const view: IEmitBufferConfigView = {
        emitBufferTargetDepth: config.emitBufferTargetDepth,
        emitBufferCatchupDepth: config.emitBufferCatchupDepth,
        emitBufferMaxDepth: config.emitBufferMaxDepth,
        emitBufferRefillIntervalMs: config.emitBufferRefillIntervalMs,
        emitBufferCatchupIntervalMs: config.emitBufferCatchupIntervalMs
    };

    return view;
}

/**
 * Fetch the stored emit-buffer settings.
 *
 * The admin session cookie authorizes the request, and the gate around the
 * System page has already established that the visitor is an administrator.
 *
 * @returns The five stored values.
 * @throws When the request fails, so the caller can show the reason rather than
 *         rendering a form full of zeros that would overwrite real settings.
 */
export async function getEmitBufferConfig(): Promise<IEmitBufferConfigView> {
    const response = await fetch(SYSTEM_CONFIG_ENDPOINT);

    if (!response.ok) {
        throw new Error(`Request failed: ${response.statusText}`);
    }

    const data = await response.json();

    return toConfigView(data.config ?? {});
}

/**
 * Save the emit-buffer settings and apply them to the running feed.
 *
 * All five are sent together even when only one changed, because the backend
 * checks the rules that span fields — the depths increasing, the refill
 * interval clearing one block time — against the values that will be stored.
 * Sending the complete set means that check sees exactly what the operator sees.
 *
 * @param values - The five values as the form currently holds them.
 * @returns The saved values as the backend echoed them back.
 * @throws With the backend's own message when a value is rejected, so the form
 *         can explain which rule was broken instead of reporting a generic
 *         failure.
 */
export async function updateEmitBufferConfig(
    values: IEmitBufferConfigView
): Promise<IEmitBufferConfigView> {
    const response = await fetch(SYSTEM_CONFIG_ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data?.error || `Request failed: ${response.statusText}`);
    }

    return toConfigView(data.config ?? {});
}
