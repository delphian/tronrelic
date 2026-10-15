/**
 * @fileoverview Report translation lookups from the frontend server to the backend.
 *
 * Translators need a list of the text the site renders, and the frontend
 * server is the only place that sees every `t(key, englishText)` call. This
 * reporter collects those calls while pages render on the server and sends
 * them to the backend in small batches, where they appear on
 * `/system/localization` and where a lookup that fell back to English on a
 * translated page is logged as a missing translation.
 *
 * It is careful about volume. Each key is reported with at most a few
 * distinct paths per server process, so a key that appears on every address
 * page does not produce one request per address. Nothing is sent from the
 * browser: every page is rendered on the server first, which already covers
 * the text a visitor sees on arrival.
 *
 * @module modules/localization/lib/observationReporter
 */

import type { ITranslationObservation } from '@/types';
import { getServerSideApiUrl } from '../../../lib/api-url';

/** Wait after the first new observation before sending, so one render's keys travel together. */
const FLUSH_DELAY_MS = 2000;

/** Most observations sent in one request; matches the backend's per-batch cap. */
const BATCH_SIZE = 200;

/** Distinct paths reported per key per process; enough to show where a key is used. */
const MAX_PATHS_PER_KEY = 5;

/** Distinct keys tracked per process, so a flood of generated keys cannot grow memory without bound. */
const MAX_TRACKED_KEYS = 20000;

/** Pause after a failed send before trying again. */
const FAILURE_BACKOFF_MS = 60_000;

/** Request timeout for one batch. */
const SEND_TIMEOUT_MS = 5000;

/** Paths already reported, per key identity. */
const reportedPaths = new Map<string, Set<string>>();

/** Observations waiting for the next send. */
const pending: ITranslationObservation[] = [];

/** The scheduled send, if one is waiting. */
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** No send is attempted before this time, after a failure. */
let backoffUntil = 0;

/**
 * Identify a key report independently of the path it was seen on. The English
 * source is part of the identity so a changed wording is reported again, which
 * is how the backend learns that existing translations went stale.
 *
 * @param observation - A lookup to identify.
 * @returns A string unique to the namespace, key, source, and missing language.
 */
function identify(observation: ITranslationObservation): string {
    return [observation.missingIn ?? '', observation.namespace, observation.key, observation.source].join('\u0000');
}

/**
 * Forget that a batch was reported, so a later render reports it again after
 * a failed send.
 *
 * @param batch - Observations whose send failed.
 */
function forget(batch: ITranslationObservation[]): void {
    for (const observation of batch) {
        reportedPaths.get(identify(observation))?.delete(observation.path);
    }
}

/**
 * Send one batch and schedule the next if more are waiting.
 */
async function flush(): Promise<void> {
    flushTimer = null;
    const batch = pending.splice(0, BATCH_SIZE);
    if (batch.length > 0) {
        if (Date.now() < backoffUntil) {
            forget(batch);
        } else {
            try {
                const response = await fetch(`${getServerSideApiUrl()}/api/localization/observations`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ observations: batch }),
                    cache: 'no-store',
                    signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
            } catch (error) {
                // Reporting is best effort: a failure must never affect a
                // render. The batch is forgotten so it is reported again once
                // the backend recovers.
                backoffUntil = Date.now() + FAILURE_BACKOFF_MS;
                forget(batch);
                console.warn('Failed to report translation keys; retrying after a pause:', error);
            }
        }
    }
    if (pending.length > 0 && !flushTimer) {
        flushTimer = setTimeout(() => { void flush(); }, FLUSH_DELAY_MS);
    }
}

/**
 * Record one translation lookup for reporting.
 *
 * Does nothing in the browser, and nothing for a key and path already
 * reported by this process.
 *
 * @param observation - The key, its English source, the page path, and the
 *   language it was missing in, if any.
 */
export function reportTranslationObservation(observation: ITranslationObservation): void {
    if (typeof window === 'undefined') {
        const id = identify(observation);
        const paths = reportedPaths.get(id);
        const isNewKey = paths === undefined;
        const accept = isNewKey
            ? reportedPaths.size < MAX_TRACKED_KEYS
            : !paths.has(observation.path) && paths.size < MAX_PATHS_PER_KEY;
        if (accept) {
            const updated = paths ?? new Set<string>();
            updated.add(observation.path);
            reportedPaths.set(id, updated);
            pending.push(observation);
            if (!flushTimer) {
                flushTimer = setTimeout(() => { void flush(); }, FLUSH_DELAY_MS);
            }
        }
    }
}
