import type { Request, Response } from 'express';
import type { IDatabaseService } from '@tronrelic/types';
import { z } from 'zod';
import { NotificationService } from '../../services/notification.service.js';

const channelEnum = z.enum(['websocket', 'email']);

const preferencesSchema = z.object({
  wallet: z.string().min(34),
  channels: z.array(channelEnum).optional(),
  thresholds: z.record(z.number()).default({}),
  preferences: z.record(z.unknown()).default({}),
  throttleOverrides: z
    .object({
      websocket: z.number().nonnegative().optional(),
      telegram: z.number().nonnegative().optional(),
      email: z.number().nonnegative().optional()
    })
    .partial()
    .optional()
});

export class NotificationController {
  private readonly service: NotificationService;

  constructor(database: IDatabaseService) {
    this.service = new NotificationService(database);
  }

  updatePreferences = async (req: Request, res: Response) => {
    const body = preferencesSchema.parse(req.body);
    await this.service.updatePreferences(body.wallet, body);
    res.json({ success: true });
  };

  getPreferences = async (req: Request, res: Response) => {
    const wallet = z.string().min(34).parse(req.query.wallet);
    const preferences = await this.service.getPreferences(wallet);
    res.json({ success: true, preferences });
  };
}
