import type { Request, Response } from 'express';
import { z } from 'zod';
import { EnergyService } from './energy.service.js';

const delegationSchema = z.object({
  address: z.string().min(34)
});

export class EnergyController {
  private readonly service: EnergyService;

  constructor(service = new EnergyService()) {
    this.service = service;
  }

  accountEnergyDelegation = async (req: Request, res: Response) => {
    const payload = delegationSchema.parse(req.body);
    const delegations = await this.service.getAccountDelegations(payload.address);
    res.json({ success: true, delegations });
  };
}
