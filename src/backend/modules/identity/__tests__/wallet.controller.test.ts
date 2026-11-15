/**
 * Tests for what the wallet controller tells a caller when an operation fails.
 *
 * The controller used to copy every error's message into the response, so an
 * internal failure's text reached the browser, and so did the exact cause of a
 * cross-account link conflict. These tests pin the rule that replaced it: only
 * errors marked safe are shown, everything else gets a generic message, and
 * the full error is always logged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import { WalletController } from '../api/wallet.controller.js';
import { WalletUserError } from '../services/WalletUserError.js';
import { ValidationError } from '../../../lib/errors.js';
import type { WalletService } from '../services/wallet.service.js';

/** A complete link request body. */
const LINK_BODY = { address: 'TWallet', message: 'TronRelic link wallet TWallet (nonce n)', signature: '0xsig', nonce: 'n' };

/**
 * Build a logger whose methods are spies; `child` returns the same logger so
 * the controller's scoped logger is observable.
 *
 * @returns The logger.
 */
function buildLogger(): ISystemLogService {
    const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: () => logger
    } as unknown as ISystemLogService;
    return logger;
}

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
 * Build a signed-in link request.
 *
 * @returns The request.
 */
function linkRequest(): Request {
    return { authSession: { user: { id: 'user-1' } }, body: LINK_BODY, params: {} } as unknown as Request;
}

describe('WalletController failure responses', () => {
    let logger: ISystemLogService;
    let linkWallet: ReturnType<typeof vi.fn>;
    let controller: WalletController;

    beforeEach(() => {
        logger = buildLogger();
        linkWallet = vi.fn();
        controller = new WalletController({ linkWallet } as unknown as WalletService, logger);
    });

    it('shows the soft wording for a wallet owned by another account and logs the exact cause', async () => {
        linkWallet.mockRejectedValue(new WalletUserError(
            'This wallet is already linked to another account.',
            "This wallet can't be added to this account. If you linked it before, sign in with that account."
        ));
        const { res, sent } = buildResponse();

        await controller.link(linkRequest(), res);

        expect(sent.status).toBe(400);
        expect(sent.body).toEqual({
            error: 'Failed to link wallet',
            message: "This wallet can't be added to this account. If you linked it before, sign in with that account."
        });
        expect(JSON.stringify(sent.body)).not.toMatch(/another account/i);
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.objectContaining({ message: 'This wallet is already linked to another account.' }) }),
            'Failed to link wallet'
        );
    });

    it('shows the text of an input validation error', async () => {
        linkWallet.mockRejectedValue(new ValidationError('Invalid signature provided'));
        const { res, sent } = buildResponse();

        await controller.link(linkRequest(), res);

        expect(sent.status).toBe(400);
        expect(sent.body).toMatchObject({ message: 'Invalid signature provided' });
    });

    it('answers an unexpected error with a generic message and a 500, never its text', async () => {
        linkWallet.mockRejectedValue(new Error('MongoServerError: connection pool closed at 10.0.0.5:27017'));
        const { res, sent } = buildResponse();

        await controller.link(linkRequest(), res);

        expect(sent.status).toBe(500);
        expect(sent.body).toEqual({ error: 'Failed to link wallet', message: 'Could not link this wallet. Please try again.' });
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('connection pool closed') }) }),
            'Failed to link wallet'
        );
    });
});
