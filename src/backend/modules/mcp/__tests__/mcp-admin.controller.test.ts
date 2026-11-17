/**
 * Tests for how the MCP admin controller reads the connected-apps list
 * request: the page bounds, the search text, and the refusal of a search too
 * long to be an email address.
 *
 * The list is paged on the server and searched by the user's email, so these
 * pin what reaches the identity module's `listAll` for each query shape.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { IConnectedAppsService, ISystemLogService } from '@/types';
import { McpAdminController } from '../api/mcp-admin.controller.js';

/**
 * Build a response double that records the status and body.
 *
 * @returns The response and what it recorded.
 */
function buildResponse(): { res: Response; sent: { status: number; body: unknown } } {
    const sent = { status: 200, body: undefined as unknown };
    const res = {
        status(code: number) {
            sent.status = code;
            return this;
        },
        json(body: unknown) {
            sent.body = body;
            return this;
        }
    } as unknown as Response;
    return { res, sent };
}

/**
 * Build a request carrying only a query string, which is all `listApps` reads.
 *
 * @param query - The parsed query parameters.
 * @returns The request.
 */
function appsRequest(query: Record<string, unknown>): Request {
    return { query } as unknown as Request;
}

describe('McpAdminController.listApps', () => {
    let listAll: ReturnType<typeof vi.fn>;
    let controller: McpAdminController;

    beforeEach(() => {
        listAll = vi.fn(async () => ({ apps: [], total: 0, searchTruncated: false }));
        const connectedApps = { listAll } as unknown as IConnectedAppsService;
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ISystemLogService;
        // Only the connected-apps store is used by this handler.
        controller = new McpAdminController(
            {} as never,
            {} as never,
            {} as never,
            connectedApps,
            {} as never,
            {} as never,
            { resourceUrl: 'https://example.com/mcp', publicUrl: 'https://example.com/mcp/public', issuer: 'https://example.com' },
            { identity: { description: 'd', version: '1' }, describedAnonymousTools: [] },
            logger
        );
    });

    it('passes the page and the trimmed search through', async () => {
        const { res, sent } = buildResponse();
        await controller.listApps(appsRequest({ limit: '25', offset: '50', search: '  alice@example.com ' }), res);

        expect(listAll).toHaveBeenCalledWith({ limit: 25, offset: 50, search: 'alice@example.com' });
        expect(sent.body).toEqual({ apps: [], total: 0, searchTruncated: false });
    });

    it('lists every grant when the search is blank or repeated', async () => {
        await controller.listApps(appsRequest({ search: '   ' }), buildResponse().res);
        await controller.listApps(appsRequest({ search: ['a', 'b'] }), buildResponse().res);

        expect(listAll).toHaveBeenNthCalledWith(1, { limit: 50, offset: 0 });
        expect(listAll).toHaveBeenNthCalledWith(2, { limit: 50, offset: 0 });
    });

    it('holds the page size to its bounds', async () => {
        await controller.listApps(appsRequest({ limit: '5000', offset: '-3' }), buildResponse().res);

        expect(listAll).toHaveBeenCalledWith({ limit: 200, offset: 0 });
    });

    it('refuses a search longer than an email address can be', async () => {
        const { res, sent } = buildResponse();
        await controller.listApps(appsRequest({ search: 'a'.repeat(255) }), res);

        expect(sent.status).toBe(400);
        expect(listAll).not.toHaveBeenCalled();
    });
});
