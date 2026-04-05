/**
 * @fileoverview Controller for all user-facing tool endpoints.
 *
 * Handles HTTP request/response for address conversion, energy estimation,
 * bidirectional stake calculation, and signature verification. Each method
 * validates input with Zod schemas and delegates to the appropriate service.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AddressService } from '../services/address.service.js';
import type { CalculatorService } from '../services/calculator.service.js';
import type { SignatureService } from '../../auth/signature.service.js';

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
     */
    constructor(
        private readonly addressService: AddressService,
        private readonly calculatorService: CalculatorService,
        private readonly signatureService: SignatureService
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
}
