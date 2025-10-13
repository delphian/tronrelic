import type { Request, Response } from 'express';
import { BlockchainService } from './blockchain.service.js';

export class BlockchainController {
  private readonly service: BlockchainService;

  constructor() {
    this.service = BlockchainService.getInstance();
  }

  latestTransactions = async (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 50);
    const transactions = await this.service.getLatestTransactions(Math.min(limit, 200));
    res.json({ success: true, transactions });
  };

  triggerSync = async (_req: Request, res: Response) => {
    await this.service.syncLatestBlocks();
    res.json({ success: true });
  };
}
