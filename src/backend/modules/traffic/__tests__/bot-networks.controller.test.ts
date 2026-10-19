/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the automated-network list admin controller.
 *
 * Checks that each handler returns the updated list, that a rejected ASN
 * becomes a 400 carrying the reason, and that an unexpected failure becomes a
 * 500 without leaking its details.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import { BotNetworksController } from '../api/bot-networks.controller.js';
import { BotNetworkValidationError, type BotNetworksService } from '../services/bot-networks.service.js';

/**
 * Build a response stub whose `status` chains into `json`, as Express's does.
 *
 * @returns The stub plus the `status` and `json` spies to assert on.
 */
function buildRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
    const json = vi.fn();
    const status = vi.fn();
    const res = { status, json } as unknown as Response;
    status.mockReturnValue(res);
    return { res, status, json };
}

describe('BotNetworksController', () => {
    const LISTED = [{ asn: 139341, note: 'Tencent pool', addedAt: new Date('2026-10-19T00:00:00Z') }];
    let service: { list: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
    let controller: BotNetworksController;

    beforeEach(() => {
        service = {
            list: vi.fn().mockResolvedValue(LISTED),
            add: vi.fn().mockResolvedValue(139341),
            remove: vi.fn().mockResolvedValue(undefined)
        };
        const logger = { error: vi.fn() } as unknown as ISystemLogService;
        controller = new BotNetworksController(service as unknown as BotNetworksService, logger);
    });

    it('lists the networks', async () => {
        const { res, json } = buildRes();

        await controller.list({} as Request, res);

        expect(json).toHaveBeenCalledWith({ networks: LISTED });
    });

    it('adds a network and returns the updated list', async () => {
        const { res, json } = buildRes();

        await controller.add({ body: { asn: '139341', note: 'Tencent pool' } } as Request, res);

        expect(service.add).toHaveBeenCalledWith({ asn: '139341', note: 'Tencent pool' });
        expect(json).toHaveBeenCalledWith({ networks: LISTED });
    });

    it('reports a rejected ASN as 400 with the reason', async () => {
        service.add.mockRejectedValue(new BotNetworkValidationError('asn must be a whole number'));
        const { res, status, json } = buildRes();

        await controller.add({ body: { asn: 'nope' } } as Request, res);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({ error: 'ValidationError', message: 'asn must be a whole number' });
    });

    it('reports an unexpected add failure as 500', async () => {
        service.add.mockRejectedValue(new Error('connection lost'));
        const { res, status, json } = buildRes();

        await controller.add({ body: { asn: '139341' } } as Request, res);

        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({ error: 'InternalError', message: 'Failed to add automated network' });
    });

    it('removes a network named in the path and returns the updated list', async () => {
        const { res, json } = buildRes();

        await controller.remove({ params: { asn: '139341' } } as unknown as Request, res);

        expect(service.remove).toHaveBeenCalledWith(139341);
        expect(json).toHaveBeenCalledWith({ networks: LISTED });
    });

    it('rejects a malformed ASN in the path without calling the service', async () => {
        const { res, status } = buildRes();

        await controller.remove({ params: { asn: 'abc' } } as unknown as Request, res);

        expect(status).toHaveBeenCalledWith(400);
        expect(service.remove).not.toHaveBeenCalled();
    });
});
