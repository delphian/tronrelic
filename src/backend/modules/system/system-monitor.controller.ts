import type { Request, Response } from 'express';
import type { Redis as RedisClient } from 'ioredis';
import type { IDatabaseService, ISystemConfig } from '@/types';
import { LOG_LEVELS, type LogLevelName } from '@/types';
import { SystemMonitorService } from './system-monitor.service.js';
import { BlockchainService } from '../blockchain/blockchain.service.js';
import { BlockEmitter, type IEmitBufferSettings } from '../blockchain/block-emitter.js';
import { BlockchainObserverService } from '../../services/blockchain-observer/index.js';
import { SystemConfigService } from '../../services/system-config/index.js';
import { blockchainConfig } from '../../config/blockchain.js';
import { EMIT_BUFFER_LIMITS } from '../../config/emit-buffer.js';

/** The emit-buffer settings this endpoint accepts, in the order the form shows them. */
const EMIT_BUFFER_FIELDS = [
  'emitBufferTargetDepth',
  'emitBufferCatchupDepth',
  'emitBufferMaxDepth',
  'emitBufferRefillIntervalMs',
  'emitBufferCatchupIntervalMs'
] as const;

/** What emit-buffer validation produced: values to save, or the reason it refused. */
interface IEmitBufferValidation {
  /** Fields to write, empty when the request carried none of them. */
  updates: Partial<IEmitBufferSettings>;
  /** A message to return as a 400, or null when the request is acceptable. */
  error: string | null;
}

/**
 * Check the emit-buffer fields on an update request before anything is stored.
 *
 * These five values shape the block feed's playout buffer, and the ways to get
 * them wrong are all invisible once saved. Depths that do not increase leave the
 * buffer draining fast before it ever reaches its target, so it settles
 * permanently short of the lead it was asked to hold. A refill interval at or
 * below one block time lets the buffer cover exactly one gap for the life of the
 * process and then run flat forever. A catch-up interval at or above one block
 * time drains a burst no faster than the chain produces, so the backlog it
 * exists to clear simply stays. None of the three throws, and none shows up
 * anywhere except a slowly climbing underrun count or a feed that is quietly
 * further behind than it should be, so all three are rejected here rather than
 * left for an operator to discover weeks later.
 *
 * Validation runs against the merged result rather than the request alone,
 * because the endpoint accepts a partial update. Sending only a new target
 * depth still has to be checked against the catch-up depth already stored, or
 * a one-field save could break an ordering the request never mentioned.
 *
 * @param body - The parsed request body, of unknown shape until checked here.
 * @param current - The configuration as stored, supplying the values the
 *                  request did not include so the cross-field rules can be
 *                  applied to what the save would actually produce.
 * @returns The fields to persist, plus the first problem found, so the caller
 *          can answer with one specific message instead of a generic refusal.
 */
function validateEmitBufferUpdates(
  body: Record<string, unknown>,
  current: ISystemConfig
): IEmitBufferValidation {
  const updates: Partial<IEmitBufferSettings> = {};
  let error: string | null = null;

  for (const field of EMIT_BUFFER_FIELDS) {
    const raw = body[field];

    if (raw === undefined) {
      continue;
    }

    const value = Number(raw);
    const limits = EMIT_BUFFER_LIMITS[field];

    if (!Number.isInteger(value)) {
      error = error ?? `${field} must be a whole number`;
      continue;
    }

    if (value < limits.min || value > limits.max) {
      error = error ?? `${field} must be between ${limits.min} and ${limits.max}`;
      continue;
    }

    updates[field] = value;
  }

  const merged = { ...current, ...updates };
  const blockIntervalMs = blockchainConfig.network.blockIntervalSeconds * 1000;

  if (!error && Object.keys(updates).length > 0) {
    if (merged.emitBufferCatchupDepth <= merged.emitBufferTargetDepth) {
      error = 'emitBufferCatchupDepth must be greater than emitBufferTargetDepth, '
        + 'or the buffer drains fast before it reaches its target and never holds the lead';
    } else if (merged.emitBufferMaxDepth <= merged.emitBufferCatchupDepth) {
      error = 'emitBufferMaxDepth must be greater than emitBufferCatchupDepth';
    } else if (merged.emitBufferRefillIntervalMs <= blockIntervalMs) {
      error = `emitBufferRefillIntervalMs must be greater than one block time (${blockIntervalMs}ms), `
        + 'or a lead spent covering a gap can never grow back';
    } else if (merged.emitBufferCatchupIntervalMs >= blockIntervalMs) {
      error = `emitBufferCatchupIntervalMs must be less than one block time (${blockIntervalMs}ms), `
        + 'or draining a burst releases no faster than the chain produces and the backlog stays';
    }
  }

  const result: IEmitBufferValidation = { updates, error };

  return result;
}

export class SystemMonitorController {
  private readonly service: SystemMonitorService;

  constructor(redis: RedisClient, database: IDatabaseService) {
    this.service = new SystemMonitorService(redis, database);
  }

  getBlockchainStatus = async (_req: Request, res: Response) => {
    const status = await this.service.getBlockchainSyncStatus();
    res.json({ success: true, status });
  };

  getTransactionStats = async (_req: Request, res: Response) => {
    const stats = await this.service.getTransactionStats();
    res.json({ success: true, stats });
  };

  getBlockProcessingMetrics = async (_req: Request, res: Response) => {
    const metrics = await this.service.getBlockProcessingMetrics();
    res.json({ success: true, metrics });
  };

  triggerBlockchainSync = async (_req: Request, res: Response) => {
    const service = BlockchainService.getInstance();
    // Trigger sync asynchronously
    service.syncLatestBlocks().catch(err => {
      console.error('Manual blockchain sync failed:', err);
    });
    res.json({ success: true, message: 'Blockchain sync triggered' });
  };

  getDatabaseStatus = async (_req: Request, res: Response) => {
    const status = await this.service.getDatabaseStatus();
    res.json({ success: true, status });
  };

  getRedisStatus = async (_req: Request, res: Response) => {
    const status = await this.service.getRedisStatus();
    res.json({ success: true, status });
  };

  getClickHouseStatus = async (_req: Request, res: Response) => {
    const status = await this.service.getClickHouseStatus();
    res.json({ success: true, status });
  };

  getServerMetrics = async (_req: Request, res: Response) => {
    const metrics = await this.service.getServerMetrics();
    res.json({ success: true, metrics });
  };

  /**
   * Serve droplet-level metrics alongside per-container runtime state.
   *
   * Always 200 when the probe itself ran: an unreachable Docker API is carried
   * in `infrastructure.docker.error` rather than surfaced as a request failure,
   * because the host readings in the same payload remain valid and the console
   * would otherwise blank an entire section over one degraded dependency.
   */
  getInfrastructureStatus = async (_req: Request, res: Response) => {
    const infrastructure = await this.service.getInfrastructureStatus();
    res.json({ success: true, infrastructure });
  };

  getConfiguration = async (_req: Request, res: Response) => {
    const config = await this.service.getConfiguration();
    res.json({ success: true, config });
  };

  getSystemConfig = async (_req: Request, res: Response) => {
    const configService = SystemConfigService.getInstance();
    const config = await configService.getConfig();
    res.json({ success: true, config });
  };

  updateSystemConfig = async (req: Request, res: Response) => {
    const configService = SystemConfigService.getInstance();
    const { siteUrl, logLevel, systemLogsMaxCount, systemLogsRetentionDays } = req.body;

    // Build updates object with only provided fields
    const updates: any = {};

    if (siteUrl !== undefined) {
      // Validate URL format
      try {
        new URL(siteUrl);
        updates.siteUrl = siteUrl;
      } catch (err) {
        return res.status(400).json({
          success: false,
          error: 'Invalid URL format. Must include protocol (http:// or https://)'
        });
      }
    }

    if (logLevel !== undefined) {
      const validLevels = Object.keys(LOG_LEVELS) as LogLevelName[];
      if (!validLevels.includes(logLevel as LogLevelName)) {
        return res.status(400).json({
          success: false,
          error: `Invalid log level. Must be one of: ${validLevels.join(', ')}`
        });
      }
      updates.logLevel = logLevel as LogLevelName;
    }

    if (systemLogsMaxCount !== undefined) {
      const count = Number(systemLogsMaxCount);
      if (isNaN(count) || count < 0) {
        return res.status(400).json({
          success: false,
          error: 'systemLogsMaxCount must be a non-negative number'
        });
      }
      updates.systemLogsMaxCount = count;
    }

    if (systemLogsRetentionDays !== undefined) {
      const days = Number(systemLogsRetentionDays);
      if (isNaN(days) || days < 0) {
        return res.status(400).json({
          success: false,
          error: 'systemLogsRetentionDays must be a non-negative number'
        });
      }
      updates.systemLogsRetentionDays = days;
    }

    // The emit-buffer fields are checked against the stored configuration
    // rather than the request alone, because a partial update still has to
    // satisfy rules that span several fields. The read is skipped entirely when
    // the request carries none of them, so a plain site-URL save neither pays
    // for it nor fails on it.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const touchesEmitBuffer = EMIT_BUFFER_FIELDS.some(field => body[field] !== undefined);
    const emitBuffer = touchesEmitBuffer
      ? validateEmitBufferUpdates(body, await configService.getConfig())
      : { updates: {}, error: null };

    if (emitBuffer.error) {
      return res.status(400).json({
        success: false,
        error: emitBuffer.error
      });
    }

    Object.assign(updates, emitBuffer.updates);

    // Require at least one field to update
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one field must be provided (siteUrl, logLevel, systemLogsMaxCount, systemLogsRetentionDays, emitBuffer*)'
      });
    }

    const config = await configService.updateConfig(updates);

    // If log level was updated, apply it immediately to SystemLogService
    if (updates.logLevel !== undefined) {
      const { SystemLogService } = await import('../logs/index.js');
      const logService = SystemLogService.getInstance();
      await logService.applyLogLevelFromConfig();
    }

    // Same idea for the emit buffer: push the saved values straight into the
    // running feed. Waiting for the config cache to expire would make a change
    // take up to a minute to appear, which is long enough that an operator
    // watching the buffer depth on /system would conclude the save had failed.
    if (Object.keys(emitBuffer.updates).length > 0) {
      BlockEmitter.configure(config);
    }

    res.json({ success: true, config });
  };

  getObserverStats = async (_req: Request, res: Response) => {
    const service = BlockchainObserverService.getInstance();
    const observers = service.getAllObserverStats();
    res.json({ success: true, observers });
  };
}
