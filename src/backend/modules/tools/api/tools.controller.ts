/**
 * @fileoverview Controller for all user-facing tool endpoints.
 *
 * Handles HTTP request/response for address conversion, energy estimation,
 * bidirectional stake calculation, signature verification, token approval
 * checking, and timestamp/block conversion. Each method validates input
 * with Zod schemas and delegates to the appropriate service.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import type { IActivatingTransaction } from '@/types';
import type { AddressService } from '../services/address.service.js';
import type { CalculatorService } from '../services/calculator.service.js';
import type { SignatureService } from '../../auth/signature.service.js';
import type { ApprovalService } from '../services/approval.service.js';
import type { TimestampService } from '../services/timestamp.service.js';
import type { AddressOriginsService } from '../services/address-origins.service.js';

const addressSchema = z
    .object({
        hex: z.string().trim().optional(),
        base58Check: z.string().trim().optional()
    })
    .refine(data => data.hex || data.base58Check, {
        message: 'Provide hex or base58Check'
    });

const energySchema = z.object({
    contractType: z.string().min(1).max(100),
    averageMethodCalls: z.coerce.number().int().min(1).max(10_000),
    expectedTransactionsPerDay: z.coerce.number().int().min(1).max(1_000_000)
});

const stakeFromTrxSchema = z.object({
    trx: z.coerce.number().min(1).max(100_000_000_000)
});

const stakeFromEnergySchema = z.object({
    energy: z.coerce.number().min(1).max(100_000_000_000)
});

const signatureSchema = z.object({
    wallet: z.string().min(34),
    message: z.string().min(1),
    signature: z.string().min(1)
});

const approvalCheckSchema = z.object({
    address: z.string().trim().min(34).max(44)
});

const addressOriginsQuerySchema = z.object({
    // Comma-separated base58 addresses; individual validation and per-tier capping
    // happen in AddressOriginsService.resolvePlan. Bounded length guards the parse.
    addresses: z.string().trim().min(1).max(1000)
});

const timestampConvertSchema = z.object({
    timestamp: z.coerce.number().int().min(0).max(32503680000).optional(),
    blockNumber: z.coerce.number().int().min(1).max(999_999_999_999).optional(),
    dateString: z.string().trim().max(100).optional()
}).refine(
    data => [data.timestamp, data.blockNumber, data.dateString].filter(v => v !== undefined).length === 1,
    { message: 'Provide exactly one of: timestamp, blockNumber, or dateString' }
);

/**
 * Tools controller exposing all tool endpoints.
 *
 * Receives all services via constructor injection so the module
 * controls instantiation timing.
 */
export class ToolsController {
    /**
     * @param addressService - TRON address format converter
     * @param calculatorService - Energy and stake calculator
     * @param signatureService - TRON signature verifier
     * @param approvalService - TRC20 token approval scanner
     * @param timestampService - Timestamp/block/date converter
     */
    constructor(
        private readonly addressService: AddressService,
        private readonly calculatorService: CalculatorService,
        private readonly signatureService: SignatureService,
        private readonly approvalService: ApprovalService,
        private readonly timestampService: TimestampService,
        private readonly addressOriginsService: AddressOriginsService
    ) {}

    /**
     * Convert between TRON hex and base58check address formats.
     *
     * Accepts either format in the request body and returns both.
     */
    convertAddress = async (req: Request, res: Response): Promise<void> => {
        const payload = addressSchema.parse(req.body);
        const result = this.addressService.convertAddress(payload);
        res.json({ success: true, transform: result });
    };

    /**
     * Estimate daily energy requirements for a contract type.
     *
     * Uses historical transaction data to project energy needs and
     * returns staking vs rental cost comparison.
     */
    estimateEnergy = async (req: Request, res: Response): Promise<void> => {
        const body = energySchema.parse(req.body);
        const estimate = await this.calculatorService.estimateEnergy(body);
        res.json({ success: true, estimate });
    };

    /**
     * Calculate energy and bandwidth from a TRX stake amount.
     *
     * Forward direction: TRX -> energy + bandwidth.
     */
    estimateStakeFromTrx = async (req: Request, res: Response): Promise<void> => {
        const body = stakeFromTrxSchema.parse(req.body);
        const estimate = await this.calculatorService.estimateStakeFromTrx(body.trx);
        res.json({ success: true, estimate });
    };

    /**
     * Calculate TRX required to produce a target energy amount.
     *
     * Reverse direction: energy -> TRX + bandwidth.
     */
    estimateStakeFromEnergy = async (req: Request, res: Response): Promise<void> => {
        const body = stakeFromEnergySchema.parse(req.body);
        const estimate = await this.calculatorService.estimateStakeFromEnergy(body.energy);
        res.json({ success: true, estimate });
    };

    /**
     * Verify a TRON wallet signature against a message.
     *
     * Returns the normalized wallet address on success, throws on failure.
     */
    verifySignature = async (req: Request, res: Response): Promise<void> => {
        const body = signatureSchema.parse(req.body);
        const normalized = await this.signatureService.verifyMessage(body.wallet, body.message, body.signature);
        res.json({ success: true, verified: true, wallet: normalized });
    };

    /**
     * Scan a TRON wallet for active TRC20 token approvals.
     *
     * Queries TronGrid for approval history and checks live allowances.
     * May take several seconds due to fan-out to multiple contract queries.
     */
    checkApprovals = async (req: Request, res: Response): Promise<void> => {
        const { address } = approvalCheckSchema.parse(req.body);
        const result = await this.approvalService.checkApprovals(address);
        res.json({ success: true, result });
    };

    /**
     * Convert between Unix timestamps, ISO dates, and TRON block numbers.
     *
     * Accepts exactly one input type and returns all three representations
     * plus a relative time string and the reference block used.
     */
    convertTimestamp = async (req: Request, res: Response): Promise<void> => {
        const body = timestampConvertSchema.parse(req.body);
        const result = await this.timestampService.convert(body);
        res.json({ success: true, result });
    };

    /**
     * Stream the activation ancestry of one or more addresses as Server-Sent
     * Events, emitting each parent the moment it resolves rather than making the
     * user wait for the whole climb.
     *
     * Why SSE: a climb is a bounded, sequential, seconds-long walk of throttled
     * TronGrid calls; a one-shot stream that pushes each hop and then closes fits
     * that shape better than either a slow single response or WebSocket room
     * plumbing. The `no-transform` header is essential — it opts the response out
     * of the global `compression()` middleware that would otherwise buffer events
     * instead of flushing them live; `X-Accel-Buffering: no` does the same for any
     * upstream nginx.
     *
     * Access tiers are enforced server-side (never trusting the client): anonymous
     * callers get one address climbed one hop (the immediate parent); a valid
     * session unlocks the multi-wallet, full-ladder climb. A shared edge cache
     * across the batch fetches tails common to several wallets once, which is also
     * what lets the client highlight shared ancestors as they surface.
     *
     * The handler owns its own error and lifecycle handling because once the SSE
     * headers flush, delegating to the global error middleware would try to rewrite
     * a committed response. A provider failure mid-climb is caught inside the climb
     * and returned as a partial (an `address-done` with neither terminal flag set,
     * which the client renders as an interruption); an `address-error` event fires
     * only when the climb call itself throws (e.g. the blockchain service is
     * unavailable), and a client disconnect aborts the remaining work.
     */
    streamAddressOrigins = async (req: Request, res: Response): Promise<void> => {
        const parsed = addressOriginsQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ success: false, error: 'Provide an "addresses" query parameter.' });
            return;
        }

        // `attachAuthSession` runs globally before this router, so authSession is
        // null for anonymous callers and an object for authenticated ones.
        const loggedIn = req.authSession != null;
        const plan = this.addressOriginsService.resolvePlan(parsed.data.addresses.split(','), loggedIn);
        if (plan.addresses.length === 0) {
            res.status(400).json({ success: false, error: 'No valid TRON addresses provided.' });
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.flushHeaders();

        const send = (event: string, data: unknown): void => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        let clientGone = false;
        req.on('close', () => {
            clientGone = true;
        });

        send('start', {
            addresses: plan.addresses,
            loggedIn,
            maxDepth: plan.maxDepth ?? null,
            limited: plan.limited
        });

        // One edge cache shared across every address: a tail common to several
        // wallets is fetched once, and the client uses the repeated activator to
        // highlight a shared ancestor.
        const edgeCache = new Map<string, IActivatingTransaction | null>();

        try {
            for (let sourceIndex = 0; sourceIndex < plan.addresses.length; sourceIndex += 1) {
                if (clientGone) {
                    break;
                }
                const address = plan.addresses[sourceIndex];
                try {
                    const result = await this.addressOriginsService.climb(address, {
                        maxDepth: plan.maxDepth,
                        edgeCache,
                        onHop: (hop, depth) => {
                            // Throwing here aborts the climb promptly when the
                            // browser has hung up mid-walk.
                            if (clientGone) {
                                throw new Error('client disconnected');
                            }
                            send('hop', {
                                sourceIndex,
                                address,
                                depth,
                                activatorAddress: hop.activatorAddress,
                                txId: hop.txId,
                                blockTimestamp: hop.blockTimestamp,
                                contractType: hop.contractType
                            });
                        }
                    });
                    if (!clientGone) {
                        send('address-done', {
                            sourceIndex,
                            address,
                            originReached: result.originReached,
                            truncated: result.truncated,
                            hops: result.chain.length
                        });
                    }
                } catch {
                    if (clientGone) {
                        break;
                    }
                    send('address-error', { sourceIndex, address, message: 'Lookup interrupted — please retry.' });
                }
            }
            if (!clientGone) {
                send('complete', {});
            }
        } finally {
            if (!res.writableEnded) {
                res.end();
            }
        }
    };
}
