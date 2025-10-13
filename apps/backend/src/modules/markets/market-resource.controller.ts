import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import { z } from 'zod';
import { MarketBillingService } from './market-billing.service.js';

const billingRecentSchema = z.object({
  addresses: z.array(z.string()).min(1),
  limit: z.coerce.number().min(1).max(200).default(10),
  minimum: z.coerce.number().min(0).default(0)
});

const billingTotalsSchema = z.object({
  addresses: z.array(z.string()).default([]),
  hours: z.coerce.number().min(1).max(24 * 30).default(24),
  minimum: z.coerce.number().min(0).default(0)
});

export class MarketResourceController {
  private readonly billing: MarketBillingService;

  constructor(redis: RedisClient) {
    this.billing = new MarketBillingService(redis);
  }

  billingRecent = async (req: Request, res: Response) => {
    const payload = billingRecentSchema.parse(req.body);
    const result = await this.billing.getRecentBilling(payload.addresses, payload.limit, payload.minimum);
    res.json({ success: true, cache: result.cache, transfers: result.transfers });
  };

  billingTotals = async (req: Request, res: Response) => {
    const payload = billingTotalsSchema.parse(req.body);
    const result = await this.billing.getBillingTotals(payload.addresses, payload.hours, payload.minimum);
    res.json({ success: true, cache: result.cache, totals: result.totals });
  };
}
