import type { Request, Response } from 'express';
import { z } from 'zod';
import { FlowAnalyticsService, type FlowDirection } from './flow-analytics.service.js';

const totalsSchema = z.object({
  address: z.string().min(34),
  startDate: z.coerce.number(),
  endDate: z.coerce.number(),
  ignore: z.coerce.number().min(0).default(0)
});

const seriesSchema = totalsSchema.extend({
  targetAddress: z.string().min(34)
});

export class FlowController {
  constructor(private readonly service: FlowAnalyticsService, private readonly direction: FlowDirection) {}

  totals = async (req: Request, res: Response) => {
    const payload = totalsSchema.parse(req.body);
    const result = await this.service.getTotals(
      this.direction,
      payload.address,
      payload.startDate,
      payload.endDate,
      payload.ignore
    );
    res.json(result);
  };

  series = async (req: Request, res: Response) => {
    const payload = seriesSchema.parse(req.body);
    const result = await this.service.getSeries(
      this.direction,
      payload.address,
      payload.targetAddress,
      payload.startDate,
      payload.endDate,
      payload.ignore
    );
    res.json(result);
  };
}
