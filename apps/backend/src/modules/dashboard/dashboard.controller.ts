import type { Request, Response } from 'express';
import type { IDatabaseService } from '@tronrelic/types';
import { z } from 'zod';
import { DashboardService } from './dashboard.service.js';

const daysSchema = z.coerce.number().min(1).max(90).default(14);
const limitSchema = z.coerce.number().min(1).max(5000).default(50);

export class DashboardController {
  private readonly service: DashboardService;

  constructor(database: IDatabaseService) {
    this.service = new DashboardService(database);
  }



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

  memoFeed = async (req: Request, res: Response) => {
    const limit = limitSchema.parse(req.query.limit);
    const memos = await this.service.getMemoFeed(limit);
    res.json({ success: true, memos });
  };
}
