import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import { z } from 'zod';
import { MarketAdminService } from './market-admin.service.js';

const prioritySchema = z.object({
  priority: z.coerce.number().int().min(0).max(9999)
});

const statusSchema = z.object({
  isActive: z.coerce.boolean()
});

const affiliateSchema = z.object({
  link: z.string().trim().min(1).optional().nullable(),
  commission: z.union([z.coerce.number().min(0).max(100), z.null()]).optional(),
  cookieDuration: z.union([z.coerce.number().int().positive(), z.null()]).optional()
});

const refreshSchema = z.object({
  force: z.coerce.boolean().optional()
});

export class MarketAdminController {
  private readonly service: MarketAdminService;

  constructor(redis: RedisClient) {
    this.service = new MarketAdminService(redis);
  }

  list = async (_req: Request, res: Response) => {
    const markets = await this.service.listAll();
    res.json({ success: true, markets, timestamp: Date.now() });
  };

  updatePriority = async (req: Request, res: Response) => {
    const params = prioritySchema.parse(req.body);
    const market = await this.service.setPriority(req.params.guid, params.priority);
    res.json({ success: true, market });
  };

  updateStatus = async (req: Request, res: Response) => {
    const params = statusSchema.parse(req.body);
    const market = await this.service.setActive(req.params.guid, params.isActive);
    res.json({ success: true, market });
  };

  updateAffiliate = async (req: Request, res: Response) => {
    const params = affiliateSchema.parse(req.body);
    const market = await this.service.updateAffiliate(req.params.guid, params);
    res.json({ success: true, market });
  };

  refresh = async (req: Request, res: Response) => {
    const params = refreshSchema.parse(req.body ?? {});
    const markets = await this.service.refresh(req.params.guid, Boolean(params.force));
    res.json({ success: true, markets });
  };
}
