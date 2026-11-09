/// <reference types="vitest" />

/**
 * @fileoverview UsdtParametersFetcher tests.
 *
 * Why these tests matter:
 * The fetcher's figures feed market pricing and the AI prompt variables. TronGrid
 * answers a reverted simulation with `result.result: true` and a small
 * `energy_used`, so a fetcher that trusts the response shape would silently save
 * a figure about seven times too low. These tests pin down that:
 * - both costs are measured and saved when TronGrid describes two real transfers
 * - the first-time cost is measured against a fresh address on every run
 * - every kind of invalid response is rejected, logged as an error, and not saved
 *
 * The response fixtures are trimmed copies of real mainnet answers captured on
 * 2026-11-09, including the revert TronGrid returns when the sender cannot cover
 * the transfer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import type { IDatabaseService, ISystemLogService } from '@/types';
import { UsdtParametersFetcher } from '../usdt-parameters-fetcher.js';

/** ABI form of the fetcher's sample holder, TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7. */
const SAMPLE_HOLDER_ABI = '74472e7d35395a6b5add427eecb7f4b62ad2b071';

/**
 * Build a successful simulation response, as TronGrid returns one.
 *
 * `constant_result` is all zeros because USDT's `transfer` returns `false` even on
 * success, which the fetcher must not treat as a failure.
 *
 * @param energyUsed - Energy the simulated transfer reports, including the penalty
 * @param energyPenalty - The dynamic energy penalty part of that figure
 * @returns A response body describing a completed transfer
 */
function successResponse(energyUsed: number, energyPenalty: number) {
    return {
        data: {
            constant_result: ['0'.repeat(64)],
            result: { result: true },
            energy_used: energyUsed,
            energy_penalty: energyPenalty,
            logs: [{ topics: ['ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'] }],
            transaction: { ret: [{}] }
        }
    };
}

/**
 * Build the response TronGrid returns when the simulated transfer reverts.
 *
 * @returns A response body that still reports `result.result: true`
 */
function revertResponse() {
    return {
        data: {
            result: { result: true, message: 'REVERT opcode executed' },
            energy_used: 8624,
            energy_penalty: 6640,
            transaction: { ret: [{ ret: 'FAILED' }] }
        }
    };
}

/**
 * Create a database mock whose model records what the fetcher saves.
 *
 * @param create - Spy standing in for the model's `create`
 * @returns A database that hands out a model backed by the spy
 */
function createMockDatabase(create: ReturnType<typeof vi.fn>): IDatabaseService {
    return {
        registerModel: vi.fn(),
        getModel: vi.fn().mockReturnValue({ create })
    } as unknown as IDatabaseService;
}

/**
 * Create a logger mock so tests can assert that a failure is logged as an error.
 *
 * @returns A logger whose methods are spies
 */
function createMockLogger(): ISystemLogService {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn()
    } as unknown as ISystemLogService;
}

/**
 * Read the recipient a simulated transfer was sent to.
 *
 * @param post - The HTTP spy the fetcher called
 * @param callIndex - Which call to inspect: 0 for standard, 1 for first-time
 * @returns The recipient as 20-byte hex, taken from the ABI-encoded parameter
 */
function recipientOf(post: ReturnType<typeof vi.fn>, callIndex: number): string {
    const body = post.mock.calls[callIndex][1] as { parameter: string };
    return body.parameter.slice(24, 64);
}

describe('UsdtParametersFetcher', () => {
    let post: ReturnType<typeof vi.fn>;
    let create: ReturnType<typeof vi.fn>;
    let logger: ISystemLogService;
    let fetcher: UsdtParametersFetcher;

    beforeEach(() => {
        post = vi.fn();
        create = vi.fn().mockResolvedValue(undefined);
        logger = createMockLogger();
        fetcher = new UsdtParametersFetcher(
            { post } as unknown as AxiosInstance,
            logger,
            createMockDatabase(create)
        );
    });

    describe('successful measurement', () => {
        it('saves the standard and first-time figures exactly as measured', async () => {
            post.mockResolvedValueOnce(successResponse(64285, 49635))
                .mockResolvedValueOnce(successResponse(130285, 100635));

            const result = await fetcher.fetch();

            expect(result.parameters).toEqual({
                standardTransferEnergy: 64285,
                firstTimeTransferEnergy: 130285
            });
            expect(create).toHaveBeenCalledTimes(1);
            expect(create.mock.calls[0][0].parameters).toEqual(result.parameters);
            expect(logger.error).not.toHaveBeenCalled();
        });

        it('sends the standard simulation to the sample holder itself', async () => {
            post.mockResolvedValueOnce(successResponse(64285, 49635))
                .mockResolvedValueOnce(successResponse(130285, 100635));

            await fetcher.fetch();

            expect(recipientOf(post, 0)).toBe(SAMPLE_HOLDER_ABI);
        });

        it('sends the first-time simulation to a fresh address on every run', async () => {
            post.mockResolvedValueOnce(successResponse(64285, 49635))
                .mockResolvedValueOnce(successResponse(130285, 100635))
                .mockResolvedValueOnce(successResponse(64285, 49635))
                .mockResolvedValueOnce(successResponse(130285, 100635));

            await fetcher.fetch();
            await fetcher.fetch();

            const firstRun = recipientOf(post, 1);
            const secondRun = recipientOf(post, 3);
            expect(firstRun).toMatch(/^[0-9a-f]{40}$/);
            expect(firstRun).not.toBe(SAMPLE_HOLDER_ABI);
            expect(secondRun).not.toBe(firstRun);
        });
    });

    describe('invalid responses are logged as errors and not saved', () => {
        /**
         * Assert the fetch failed loudly: it rejected, logged one error naming the
         * reason, and saved nothing.
         *
         * @param reasonPattern - Text the logged reason must contain
         */
        async function expectRejectedAndLogged(reasonPattern: RegExp): Promise<void> {
            await expect(fetcher.fetch()).rejects.toThrow(reasonPattern);
            expect(logger.error).toHaveBeenCalledTimes(1);
            const [logged] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(logged.reason).toMatch(reasonPattern);
            expect(create).not.toHaveBeenCalled();
        }

        it('rejects a reverted standard simulation even though TronGrid reports success', async () => {
            post.mockResolvedValueOnce(revertResponse());

            await expectRejectedAndLogged(/standard transfer simulation reverted/);
            const [logged] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(logged).toMatchObject({
                simulation: 'standard',
                tronGridMessage: 'REVERT opcode executed',
                transactionResult: 'FAILED',
                energyUsed: 8624
            });
        });

        it('rejects a reverted first-time simulation', async () => {
            post.mockResolvedValueOnce(successResponse(64285, 49635))
                .mockResolvedValueOnce(revertResponse());

            await expectRejectedAndLogged(/first-time transfer simulation reverted/);
        });

        it('rejects a FAILED transaction result that carries no message', async () => {
            const response = revertResponse();
            delete (response.data.result as { message?: string }).message;
            post.mockResolvedValueOnce(response);

            await expectRejectedAndLogged(/FAILED transaction result/);
        });

        it('rejects a response that emitted no Transfer event', async () => {
            const response = successResponse(64285, 49635);
            response.data.logs = [];
            post.mockResolvedValueOnce(response);

            await expectRejectedAndLogged(/emitted no Transfer event/);
        });

        it('rejects a call TronGrid refused', async () => {
            post.mockResolvedValueOnce({ data: { result: { result: false, message: 'CONTRACT_VALIDATE_ERROR' } } });

            await expectRejectedAndLogged(/TronGrid rejected the standard transfer simulation/);
        });

        it('rejects a missing or non-positive energy figure', async () => {
            const response = successResponse(0, 0);
            post.mockResolvedValueOnce(response);

            await expectRejectedAndLogged(/invalid energy_used value/);
        });

        it('rejects a first-time figure that is not higher than the standard one', async () => {
            post.mockResolvedValueOnce(successResponse(64285, 49635))
                .mockResolvedValueOnce(successResponse(64285, 49635));

            await expectRejectedAndLogged(/not higher than standard transfer energy/);
        });

        it('logs and rethrows a network failure', async () => {
            post.mockRejectedValueOnce(new Error('timeout of 10000ms exceeded'));

            await expectRejectedAndLogged(/timeout of 10000ms exceeded/);
        });
    });
});
