/**
 * @fileoverview HTTP interface for per-wallet notification preferences.
 *
 * Preferences are keyed by TRON wallet address. Because a wallet address is
 * public on-chain data, the caller-supplied `wallet` cannot be trusted as
 * proof of ownership — every request is authenticated against the Better Auth
 * session (`req.authSession`, populated by the global `attachAuthSession`
 * middleware) and the requested wallet must be one the signed-in account has
 * linked and proven via signature. Without this gate any visitor could read or
 * overwrite another wallet's notification routing (an IDOR), e.g. redirecting
 * alerts to an attacker-controlled email.
 *
 * Wallet ownership is resolved through the `'wallets'` service on the registry
 * (the identity module's signature-proven store) rather than by touching the
 * `module_user_wallets` collection directly, keeping account data behind its
 * service abstraction.
 */

import type { Request, Response } from 'express';
import type { IDatabaseService, IServiceRegistry, IWalletService } from '@/types';
import { z, ZodError } from 'zod';
import { NotificationService } from '../../services/notification.service.js';
import { logger } from '../../lib/logger.js';

const channelEnum = z.enum(['websocket', 'email']);

const preferencesSchema = z.object({
  wallet: z.string().min(34),
  channels: z.array(channelEnum).optional(),
  thresholds: z.record(z.string(), z.number()).default({}),
  preferences: z.record(z.string(), z.unknown()).default({}),
  throttleOverrides: z
    .object({
      websocket: z.number().nonnegative().optional(),
      telegram: z.number().nonnegative().optional(),
      email: z.number().nonnegative().optional()
    })
    .partial()
    .optional()
});

const walletQuerySchema = z.string().min(34);

/**
 * Controller for `/api/notifications/preferences`.
 *
 * Constructed by the notifications router factory with the shared database
 * service and the service registry used to resolve wallet ownership at
 * request time.
 */
export class NotificationController {
  private readonly service: NotificationService;
  private readonly serviceRegistry: IServiceRegistry;

  /**
   * @param database - Shared database service backing the notification store.
   * @param serviceRegistry - Registry used to resolve the `'wallets'` service
   *   at request time for ownership verification.
   */
  constructor(database: IDatabaseService, serviceRegistry: IServiceRegistry) {
    this.service = new NotificationService(database);
    this.serviceRegistry = serviceRegistry;
  }

  /**
   * POST /preferences — update the signed-in account's preferences for one of
   * its own linked wallets. Rejects unauthenticated callers (401), wallets the
   * account does not own (403), and malformed bodies (400).
   */
  updatePreferences = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = preferencesSchema.parse(req.body);
      const ownedWallet = await this.requireOwnedWallet(req, res, body.wallet);
      if (!ownedWallet) {
        return;
      }
      await this.service.updatePreferences(ownedWallet, body);
      res.json({ success: true });
    } catch (error) {
      this.handleError(res, error, 'update notification preferences');
    }
  };

  /**
   * GET /preferences?wallet=... — read the signed-in account's preferences for
   * one of its own linked wallets. Same authorization gate as the update path.
   */
  getPreferences = async (req: Request, res: Response): Promise<void> => {
    try {
      const wallet = walletQuerySchema.parse(req.query.wallet);
      const ownedWallet = await this.requireOwnedWallet(req, res, wallet);
      if (!ownedWallet) {
        return;
      }
      const preferences = await this.service.getPreferences(ownedWallet);
      res.json({ success: true, preferences });
    } catch (error) {
      this.handleError(res, error, 'read notification preferences');
    }
  };

  /**
   * Authenticate the caller and confirm the requested wallet belongs to them.
   *
   * Sends the appropriate response and returns `null` on any failure so each
   * handler can guard with `if (!ownedWallet) return;`:
   *   - 401 when the request carries no Better Auth session.
   *   - 503 when the wallet store is unavailable (registry not yet wired).
   *   - 403 when the wallet is not linked to the signed-in account.
   *
   * @param req - Express request carrying the resolved `authSession`.
   * @param res - Express response used to send the failure status.
   * @param wallet - Caller-supplied wallet address to authorize.
   * @returns The trimmed wallet address when owned, otherwise `null`.
   */
  private async requireOwnedWallet(
    req: Request,
    res: Response,
    wallet: string
  ): Promise<string | null> {
    const userId = req.authSession?.user?.id ?? null;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Sign in required' });
      return null;
    }

    const wallets = this.serviceRegistry.get<IWalletService>('wallets');
    if (!wallets) {
      logger.error('Wallet service unavailable; cannot verify notification wallet ownership');
      res.status(503).json({ success: false, error: 'Wallet service unavailable' });
      return null;
    }

    const normalizedWallet = wallet.trim();
    const linked = await wallets.listWallets(userId);
    const owned = linked.some(w => w.address === normalizedWallet);
    if (!owned) {
      res.status(403).json({ success: false, error: 'Wallet not linked to this account' });
      return null;
    }

    return normalizedWallet;
  }

  /**
   * Map a thrown error to a response without letting the rejection escape the
   * handler — an unhandled async rejection would crash the process under
   * Express 4 (which does not forward async rejections to error middleware),
   * turning a malformed body into a remote denial of service.
   *
   * @param res - Express response.
   * @param error - The caught error.
   * @param action - Human-readable action for the log line.
   */
  private handleError(res: Response, error: unknown, action: string): void {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: 'Invalid request', details: error.issues });
      return;
    }
    logger.error({ error }, `Failed to ${action}`);
    res.status(500).json({ success: false, error: `Failed to ${action}` });
  }
}
