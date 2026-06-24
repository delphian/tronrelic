/**
 * @file curation-gate-sink.test.ts
 *
 * Covers the curation gate sink: its capability declaration (accepts everything,
 * narrowest reach so the classification gate always admits it) and that
 * deliver() holds by reference through the curation service — reading
 * typeId/ref/source from the destination config, ignoring the pre-rendered
 * descriptor, and rejecting malformed destination config at the boundary.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ICurationService } from '@/types';
import { createCurationGateSink, CURATION_GATE_SINK_ID } from '../services/curation-gate-sink.js';

/** A curation service whose `hold` is a spy; the gate sink touches nothing else. */
function mockCuration(): ICurationService {
    return { hold: vi.fn(async () => ({})) } as unknown as ICurationService;
}

describe('curation gate sink', () => {
    it('declares the gate capability: accepts everything, narrowest reach', () => {
        const sink = createCurationGateSink(mockCuration());

        expect(sink.id).toBe(CURATION_GATE_SINK_ID);
        // Empty accepts matches any descriptor under the router's accepts ⊆ present rule.
        expect(sink.accepts).toEqual([]);
        // Narrowest reach so reach ≤ ceiling holds for every content classification.
        expect(sink.reach).toEqual({ egress: 'internal', audience: 'admin' });
    });

    it('holds by reference: deliver reads typeId/ref/source from dest and ignores the descriptor', async () => {
        const curation = mockCuration();
        const sink = createCurationGateSink(curation);

        await sink.deliver(
            { title: 'rendered title — intentionally ignored' },
            { typeId: 'x-poster:tweet', ref: { postId: 'p1' }, source: 'ai-tool:x-post' }
        );

        expect(curation.hold).toHaveBeenCalledWith({
            typeId: 'x-poster:tweet',
            ref: { postId: 'p1' },
            source: 'ai-tool:x-post'
        });
    });

    it('rejects destination config missing a string typeId', async () => {
        const sink = createCurationGateSink(mockCuration());

        await expect(sink.deliver({}, { ref: {} })).rejects.toThrow(/typeId/);
    });

    it('rejects destination config missing an object ref', async () => {
        const sink = createCurationGateSink(mockCuration());

        await expect(sink.deliver({}, { typeId: 'x:y' })).rejects.toThrow(/ref/);
    });

    it('does not hold when the destination config is malformed', async () => {
        const curation = mockCuration();
        const sink = createCurationGateSink(curation);

        await expect(sink.deliver({}, { typeId: 'x:y', ref: 'not-an-object' })).rejects.toThrow();
        expect(curation.hold).not.toHaveBeenCalled();
    });
});
