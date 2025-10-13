import type { Request, Response } from 'express';
import { z } from 'zod';
import { DashboardService } from './dashboard.service.js';

const daysSchema = z.coerce.number().min(1).max(90).default(14);
const limitSchema = z.coerce.number().min(1).max(200).default(50);

export class DashboardController {
  private readonly service = new DashboardService();



  delegationTimeseries = async (req: Request, res: Response) => {
    const days = daysSchema.parse(req.query.days);
    const series = await this.service.getDelegationTimeseries(days);
    res.json({ success: true, series });
  };

  stakingTimeseries = async (req: Request, res: Response) => {
    const days = daysSchema.parse(req.query.days);
    const series = await this.service.getStakingTimeseries(days);
    res.json({ success: true, series });
  };

  marketHistory = async (req: Request, res: Response) => {
    const guid = z.string().min(1).parse(req.query.guid);
    const limit = limitSchema.parse(req.query.limit);
    const history = await this.service.getMarketHistory(guid, limit);
    res.json({ success: true, history });
  };

  memoFeed = async (req: Request, res: Response) => {
    const limit = limitSchema.parse(req.query.limit);
    const memos = await this.service.getMemoFeed(limit);
    res.json({ success: true, memos });
  };
}
