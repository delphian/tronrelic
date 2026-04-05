import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import type { IDatabaseService, ISignatureService } from '@/types';
import { z } from 'zod';
import { CalculatorService } from './calculator.service.js';

const energySchema = z.object({
  contractType: z.string().min(1),
  averageMethodCalls: z.coerce.number().min(1),
  expectedTransactionsPerDay: z.coerce.number().min(1)
});

const signatureSchema = z.object({
  wallet: z.string().min(34),
  message: z.string().min(1),
  signature: z.string().min(1)
});

const stakeSchema = z.object({
  trx: z.coerce.number().min(1)
});

export class CalculatorController {
  private readonly calculator: CalculatorService;

  /**
   * @param redis - Redis client for caching
   * @param database - Database service for transaction lookups
   * @param signatureService - Signature verification service
   */
  constructor(redis: RedisClient, database: IDatabaseService, private readonly signatureService: ISignatureService) {
    this.calculator = new CalculatorService(redis, database);
  }

  estimateEnergy = async (req: Request, res: Response) => {
    const body = energySchema.parse(req.body);
    const estimate = await this.calculator.estimateEnergy(body);
    res.json({ success: true, estimate });
  };

  estimateStake = async (req: Request, res: Response) => {
    const body = stakeSchema.parse(req.body);
    const estimate = await this.calculator.estimateStake(body.trx);
    res.json({ success: true, estimate });
  };

  verifySignature = async (req: Request, res: Response) => {
    const body = signatureSchema.parse(req.body);
    const normalized = await this.signatureService.verifyMessage(body.wallet, body.message, body.signature);
    res.json({ success: true, wallet: normalized });
  };
}
