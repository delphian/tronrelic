/**
 * @file curation.controller.test.ts
 *
 * Covers the curation history endpoint's query handling. The history keeps
 * every decision forever, so the route must refuse a page size or filter it
 * cannot honour rather than guess at it, and must pass a valid request through
 * to the service unchanged. The service's own paging is covered in
 * `curation-module.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { ICurationHistoryPage } from '@/types';
import { CurationController } from '../api/curation.controller.js';
import type { CurationService } from '../services/curation-service.js';

/**
 * Build a request carrying only a query string, the one part this route reads.
 *
 * @param query - The parsed query string, as Express would give it.
 * @returns The request.
 */
function requestWith(query: Record<string, unknown>): Request {
    return { params: {}, body: {}, query } as unknown as Request;
}

/**
 * Build a response whose `status` and `json` are spies that chain, as Express's do.
 *
 * @returns The response.
 */
function createMockResponse(): Response {
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
    };
    return res as unknown as Response;
}

/** One page the mock service answers with: a single approved tweet and the type filter's options. */
const PAGE: ICurationHistoryPage = {
    items: [{
        id: 'item-1',
        typeId: 'x-poster:tweet',
        providerId: 'x-poster',
        ref: { postId: 'p1' },
        preview: { title: 'Tweet draft', body: 'hello' },
        status: 'approved',
        createdAt: new Date('2026-11-16T10:00:00.000Z'),
        decidedAt: new Date('2026-11-16T11:00:00.000Z'),
        decidedBy: 'admin-1'
    }],
    total: 31,
    types: [{ typeId: 'x-poster:tweet', label: 'Tweet' }]
};

describe('CurationController history', () => {
    let listHistory: ReturnType<typeof vi.fn>;
    let controller: CurationController;

    beforeEach(() => {
        listHistory = vi.fn(async () => PAGE);
        controller = new CurationController({ listHistory } as unknown as CurationService);
    });

    it('asks for the first page of 25 when the request names no paging or filters', async () => {
        const res = createMockResponse();

        await controller.listCurationHistory(requestWith({}), res);

        expect(listHistory).toHaveBeenCalledWith({ limit: 25, skip: 0 });
    });

    it('passes valid paging and both filters through to the service', async () => {
        const res = createMockResponse();

        await controller.listCurationHistory(
            requestWith({ limit: '50', skip: '75', decision: 'rejected', typeId: 'x-poster:tweet' }),
            res
        );

        expect(listHistory).toHaveBeenCalledWith({ limit: 50, skip: 75, decision: 'rejected', typeId: 'x-poster:tweet' });
    });

    it('treats a blank decision or type as no filter, which is what an "All" option sends', async () => {
        const res = createMockResponse();

        await controller.listCurationHistory(requestWith({ decision: '', typeId: '' }), res);

        expect(listHistory).toHaveBeenCalledWith({ limit: 25, skip: 0 });
    });

    it('answers with the serialized page, its total, and the type options', async () => {
        const res = createMockResponse();

        await controller.listCurationHistory(requestWith({}), res);

        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({
            curations: [expect.objectContaining({
                id: 'item-1',
                status: 'approved',
                createdAt: '2026-11-16T10:00:00.000Z',
                decidedAt: '2026-11-16T11:00:00.000Z'
            })],
            total: 31,
            types: [{ typeId: 'x-poster:tweet', label: 'Tweet' }]
        });
    });

    it.each([
        ['a limit of zero', { limit: '0' }],
        ['a limit over 100', { limit: '101' }],
        ['a fractional limit', { limit: '2.5' }],
        ['a limit that is not a number', { limit: 'all' }],
        ['a negative skip', { skip: '-25' }],
        ['a skip that is not a number', { skip: 'next' }],
        ['a pending decision, which is not a decision', { decision: 'pending' }],
        ['an unknown decision', { decision: 'deleted' }],
        ['a repeated decision', { decision: ['approved', 'rejected'] }],
        ['a repeated type', { typeId: ['x-poster:tweet', 'core:page'] }],
        ['an over-long type', { typeId: `x:${'a'.repeat(200)}` }]
    ])('refuses %s with a 400 and never reads the history', async (_case, query) => {
        const res = createMockResponse();

        await controller.listCurationHistory(requestWith(query), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) });
        expect(listHistory).not.toHaveBeenCalled();
    });
});
