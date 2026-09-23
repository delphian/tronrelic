/**
 * @fileoverview The blockchain module's scoped logger.
 *
 * Every file in this module logs through this child rather than the root
 * logger, so each entry is stored under the service name
 * `tronrelic:blockchain`. That name is what the Logs tab on `/system/system`
 * filters by; entries written through the root logger land under plain
 * `tronrelic`, mixed in with every other core component, and an operator
 * diagnosing block sync could not pick them out.
 *
 * The child reads the root logger's state each time it logs, so creating it
 * at import time, before the logs module initializes the root, is safe.
 *
 * @module backend/modules/blockchain/logger
 */
import { logger as rootLogger } from '../../lib/logger.js';

/** Logger for block sync, the buffer, the committer, and the TronGrid client. */
export const logger = rootLogger.child({ module: 'blockchain' });
