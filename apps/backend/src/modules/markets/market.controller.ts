import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import { MarketService } from './market.service.js';
import { z } from 'zod';

const refreshSchema = z.object({
  force: z.coerce.boolean().optional()
});

const comparisonQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional()
});

const historyParamsSchema = z.object({
  guid: z.string().min(1)
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(5000).optional(),
  bucket_hours: z.coerce.number().min(1).max(24).optional()
});

const affiliateBodySchema = z.object({
  trackingCode: z.string().min(4)
});

export class MarketController {
  private readonly service: MarketService;

  constructor(redis: RedisClient) {
    this.service = new MarketService(redis);
  }

  list = async (_req: Request, res: Response) => {
    const markets = await this.service.listActiveMarkets();
    res.json({ success: true, markets, timestamp: Date.now() });
  };

  refresh = async (req: Request, res: Response) => {
    const params = refreshSchema.parse(req.body);
    await this.service.refreshMarkets(params.force);
    res.json({ success: true });
  };

  compare = async (req: Request, res: Response) => {
    const query = comparisonQuerySchema.parse(req.query);
    const result = await this.service.getComparison(query.limit ?? 25);
    res.json({ success: true, generatedAt: Date.now(), ...result });
  };

  history = async (req: Request, res: Response) => {
    const params = historyParamsSchema.parse(req.params);
    const query = historyQuerySchema.parse(req.query);
    const history = await this.service.getPriceHistory(params.guid, query.limit ?? 4320, query.bucket_hours);
    res.json({ success: true, guid: params.guid, history });
  };

  affiliateImpression = async (req: Request, res: Response) => {
    const params = historyParamsSchema.parse(req.params);
    const body = affiliateBodySchema.parse(req.body);
    const tracking = await this.service.recordAffiliateImpression(params.guid, body.trackingCode);
    if (!tracking) {
      res.status(404).json({ success: false, error: 'Invalid tracking code' });
      return;
    }
    res.json({ success: true, tracking });
  };

  affiliateClick = async (req: Request, res: Response) => {
    const params = historyParamsSchema.parse(req.params);
    const body = affiliateBodySchema.parse(req.body);
    const tracking = await this.service.recordAffiliateClick(params.guid, body.trackingCode);
    if (!tracking) {
      res.status(404).json({ success: false, error: 'Invalid tracking code' });
      return;
    }
    res.json({ success: true, tracking });
  };
}
