/**
 * Core AI tool: retrieve a single TRON transaction's detail by id.
 *
 * Registered on the core `'ai-tools'` registry through the service-registry
 * watch pattern (the registry is published by the AI tools module during its
 * `run()` phase, after this watch is set up, so we subscribe to its presence
 * rather than resolving it once). The tool is strictly read-only and backed by
 * the cached `ITransactionDetailService`. Rate limiting, audit, and per-tool
 * usage tallies are owned by the core governor and policy engine — this module
 * declares the tool's capability class and lets governance do the rest.
 */
import type {
    IAiTool,
    IAiToolRegistry,
    IServiceRegistry,
    ITransactionDetailService,
    ServiceWatchDisposer
} from '@/types';
import { logger } from '../../lib/logger.js';

/** Provider id passed to `registerTool` so the admin UI groups the tool under core. */
const PROVIDER_ID = 'core-blockchain';

/** Tool name. The `tronrelic-` prefix marks a platform-default tool. */
export const TRANSACTION_TOOL_NAME = 'tronrelic-get-transaction';

/** A TRON transaction id is a 64-character hex hash. */
const TXID_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Build the read-only transaction-lookup tool bound to a detail service.
 * Exported so tests can exercise the handler directly.
 *
 * @param detailService - Cached transaction-detail lookup service.
 * @returns The tool definition ready for `registerTool`.
 */
export function buildTransactionTool(detailService: ITransactionDetailService): IAiTool {
    return {
        name: TRANSACTION_TOOL_NAME,
        description:
            'Retrieve the full on-chain detail of a single TRON transaction by its ' +
            'transaction id (hash). Use when the user asks about one specific ' +
            'transaction — its block number, execution status (e.g. SUCCESS, REVERT, ' +
            'OUT_OF_ENERGY), sender and recipient addresses, TRX amount, fee, energy or ' +
            'bandwidth usage, or memo. The txId parameter (required) is the ' +
            '64-character hexadecimal transaction hash. Returns one transaction object, ' +
            'or a null transaction when the id cannot be resolved on-chain (which is not ' +
            'an error). Returns factual blockchain data only. This tool is read-only and ' +
            'rate-limited: it never submits, modifies, or broadcasts anything.',
        // Capability: read / internal — strictly read-only on-chain lookup. The
        // governor applies the read-class rate cap and writes the audit record.
        capability: { sideEffect: 'read', reversible: true, sensitivity: 'internal' },
        inputSchema: {
            type: 'object',
            description: 'The transaction to look up.',
            properties: {
                txId: {
                    type: 'string',
                    description: 'The 64-character hexadecimal TRON transaction hash to retrieve.'
                }
            },
            required: ['txId'],
            additionalProperties: false
        },
        handler: async (input: Record<string, unknown>) => {
            const txId = typeof input.txId === 'string' ? input.txId.trim() : '';
            if (!TXID_PATTERN.test(txId)) {
                return { success: false, error: 'txId must be a 64-character hexadecimal transaction hash' };
            }

            try {
                const transaction = await detailService.getTransactionById(txId);
                return { success: true, transaction };
            } catch (error) {
                logger.error({ error, txId }, 'Transaction lookup tool failed');
                return { success: false, error: 'An internal error occurred while retrieving the transaction.' };
            }
        }
    };
}

/**
 * Register the transaction-lookup tool on the core `'ai-tools'` registry
 * whenever it becomes available. Unregister-then-register keeps re-availability
 * (operator churn, hot reload) from tripping the duplicate-name guard.
 * Registration failures are logged and swallowed — AI tooling is optional and
 * must never destabilize core.
 *
 * @param serviceRegistry - Shared registry to watch for `'ai-tools'`.
 * @param detailService - Cached transaction-detail lookup service.
 * @returns Disposer that removes the watch subscription.
 */
export function registerTransactionAiTools(
    serviceRegistry: IServiceRegistry,
    detailService: ITransactionDetailService
): ServiceWatchDisposer {
    const log = logger.child({ module: 'transaction-ai-tools' });
    const tool = buildTransactionTool(detailService);

    return serviceRegistry.watch<IAiToolRegistry>('ai-tools', {
        onAvailable: (registry) => {
            try {
                registry.unregisterTool(tool.name);
                registry.registerTool(tool, PROVIDER_ID);
                log.info({ tool: tool.name }, 'Registered transaction AI tool with the core ai-tools registry');
            } catch (error) {
                log.error({ error }, 'Failed to register transaction AI tool with the core ai-tools registry');
            }
        }
    });
}
