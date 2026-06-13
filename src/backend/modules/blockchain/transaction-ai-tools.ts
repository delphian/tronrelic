/**
 * Core AI tool: retrieve a single TRON transaction's detail by id.
 *
 * Registered against the `ai-assistant` service through the service-registry
 * watch pattern (the assistant is a runtime-toggleable plugin that loads after
 * core, so we subscribe to its presence rather than resolving it once), the
 * same approach the logs module uses. The tool is strictly read-only and
 * backed by the cached `ITransactionDetailService`; every invocation passes
 * through `TransactionToolGuard`, which rate-limits and records usage for the
 * admin stats endpoint.
 */
import type {
    IAiAssistantService,
    IAiTool,
    IServiceRegistry,
    ITransactionDetailService,
    ServiceWatchDisposer
} from '@/types';
import { logger } from '../../lib/logger.js';
import { TransactionToolGuard } from './transaction-tool-guard.js';

/** Provider id passed to `registerTool` so the admin UI groups the tool under core. */
const PROVIDER_ID = 'core-blockchain';

/** Tool name. The `tronrelic-` prefix marks a platform-default tool. */
export const TRANSACTION_TOOL_NAME = 'tronrelic-get-transaction';

/** A TRON transaction id is a 64-character hex hash. */
const TXID_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Build the read-only transaction-lookup tool bound to a detail service and a
 * usage guard. Exported so tests can exercise the handler directly.
 *
 * @param detailService - Cached transaction-detail lookup service.
 * @param guard - Rate limiter and usage counter.
 * @returns The tool definition ready for `registerTool`.
 */
export function buildTransactionTool(detailService: ITransactionDetailService, guard: TransactionToolGuard): IAiTool {
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
            guard.beginInvocation();

            const txId = typeof input.txId === 'string' ? input.txId.trim() : '';
            if (!TXID_PATTERN.test(txId)) {
                guard.rejectInvalid();
                return { success: false, error: 'txId must be a 64-character hexadecimal transaction hash' };
            }

            if (!guard.tryConsume()) {
                return { success: false, error: 'Rate limit exceeded for the transaction lookup tool. Try again shortly.' };
            }

            const transaction = await detailService.getTransactionById(txId);
            guard.recordResolved(transaction !== null);
            return { success: true, transaction };
        }
    };
}

/**
 * Register the transaction-lookup tool with the ai-assistant service whenever
 * it becomes available. Unregister-then-register keeps re-availability
 * (plugin disable/enable, hot reload) from tripping the duplicate-name guard.
 * Registration failures are logged and swallowed — AI tooling is optional and
 * must never destabilize core.
 *
 * @param serviceRegistry - Shared registry to watch for `ai-assistant`.
 * @param detailService - Cached transaction-detail lookup service.
 * @returns Disposer that removes the watch subscription.
 */
export function registerTransactionAiTools(
    serviceRegistry: IServiceRegistry,
    detailService: ITransactionDetailService
): ServiceWatchDisposer {
    const log = logger.child({ module: 'transaction-ai-tools' });
    const tool = buildTransactionTool(detailService, TransactionToolGuard.getInstance());

    return serviceRegistry.watch<IAiAssistantService>('ai-assistant', {
        onAvailable: (ai) => {
            try {
                ai.unregisterTool(tool.name);
                ai.registerTool(tool, PROVIDER_ID);
                log.info({ tool: tool.name }, 'Registered transaction AI tool with ai-assistant');
            } catch (error) {
                log.error({ error }, 'Failed to register transaction AI tool with ai-assistant');
            }
        }
    });
}
