/**
 * @fileoverview Tests for the valuation admin controller.
 *
 * Covers the ownership gate specifically: a mistyped `userId` or an address the
 * account doesn't own must 404 rather than silently reading/writing an override
 * nobody's portfolio computation will ever resolve.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import { ValuationAdminController } from '../api/valuation-admin.controller.js';

const USER_ID = 'user-1';
const WALLET_A = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const WALLET_B = 'TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax';

/** No-op logger. */
function silentLogger(): ISystemLogService {
    const logger = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return logger; } };
    return logger as unknown as ISystemLogService;
}

/**
 * Mock Express request carrying only the params/body this controller reads.
 *
 * @param params - Route params (`userId`, `address`).
 * @param body - Request body.
 * @returns A partial Request sufficient for the handlers under test.
 */
function mockRequest(params: Record<string, string>, body: Record<string, unknown> = {}): Request {
    return { params, body } as unknown as Request;
}

/**
 * Mock Express response capturing the status/json calls for assertion.
 *
 * @returns A partial Response with `json`/`status` spies.
 */
function mockResponse(): Response {
    const res: any = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res as Response;
}

/**
 * Build the controller against a registry seeded with `'accounts'`/`'wallets'`/
 * `'user-settings'` fakes.
 *
 * @param owned - Addresses the user owns; `null` means the account itself doesn't exist.
 * @param userSettings - Optional user-settings fake; defaults to an always-empty store.
 * @returns The wired controller.
 */
function buildController(owned: string[] | null, userSettings: unknown = { getNamespace: vi.fn(async () => ({})), get: vi.fn(async () => null), set: vi.fn(async () => {}), delete: vi.fn(async () => {}) }): ValuationAdminController {
    const registry = createMockServiceRegistry({
        accounts: { getAccount: vi.fn(async () => (owned === null ? null : { id: USER_ID })) },
        wallets: { listWallets: vi.fn(async () => (owned ?? []).map((address) => ({ address }))) },
        'user-settings': userSettings
    });
    return new ValuationAdminController(registry, silentLogger());
}

describe('ValuationAdminController', () => {
    it('404s when userId has no account', async () => {
        const controller = buildController(null);
        const res = mockResponse();

        await controller.getBalanceRange(mockRequest({ userId: USER_ID, address: WALLET_A }), res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    it("404s when the account doesn't own the requested address", async () => {
        const controller = buildController([WALLET_B]); // owns B, not A
        const res = mockResponse();

        await controller.getBalanceRange(mockRequest({ userId: USER_ID, address: WALLET_A }), res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('reads the default range for an owned wallet with no stored override', async () => {
        const controller = buildController([WALLET_A]);
        const res = mockResponse();

        await controller.getBalanceRange(mockRequest({ userId: USER_ID, address: WALLET_A }), res);

        expect(res.json).toHaveBeenCalledWith({ range: '1y' });
    });

    it("404s a PATCH for an address the account doesn't own, before writing anything", async () => {
        const userSettings = { getNamespace: vi.fn(async () => ({})), get: vi.fn(async () => null), set: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
        const controller = buildController([WALLET_B], userSettings);
        const res = mockResponse();

        await controller.setBalanceRange(mockRequest({ userId: USER_ID, address: WALLET_A }, { range: 'all' }), res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(userSettings.set).not.toHaveBeenCalled();
    });

    it('writes the override for an owned wallet', async () => {
        const userSettings = { getNamespace: vi.fn(async () => ({})), get: vi.fn(async () => null), set: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
        const controller = buildController([WALLET_A], userSettings);
        const res = mockResponse();

        await controller.setBalanceRange(mockRequest({ userId: USER_ID, address: WALLET_A }, { range: 'all' }), res);

        expect(userSettings.set).toHaveBeenCalledWith(USER_ID, 'valuation', WALLET_A, 'all');
        expect(res.json).toHaveBeenCalledWith({ range: 'all' });
    });
});
