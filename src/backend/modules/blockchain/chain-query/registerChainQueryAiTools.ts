/**
 * @fileoverview Registering the chain query tools on the core AI tool registry.
 *
 * The tools let an AI agent walk the ClickHouse copy of the chain — a wallet's
 * profile, its transfers and counterparties, multi-hop fund flows, permission
 * changes, resource delegation, account activations, one transaction's full
 * trace, token activity, contract activity, payouts, call graph, and
 * deployments, and network statistics — under the `ai-agent` account's
 * server-enforced limits. Every query is written in this codebase; no tool
 * runs SQL the model wrote. The registry is published by the AI tools module during its `run()`
 * phase, after this is called, so the tools subscribe to its presence with
 * `watch()` rather than resolving it once.
 *
 * @module backend/modules/blockchain/chain-query/registerChainQueryAiTools
 */

import type { IAiTool, IAiToolRegistry, IServiceRegistry, ServiceWatchDisposer } from '@/types';
import { logger } from '../logger.js';
import { createChainQueryToolkit, type IChainQueryToolkit } from './ChainQueryToolkit.js';
import { buildAddressCounterpartiesTool } from './tools/buildAddressCounterpartiesTool.js';
import { buildAddressProfileTool } from './tools/buildAddressProfileTool.js';
import { buildAddressTransfersTool } from './tools/buildAddressTransfersTool.js';
import { buildContractActivityTool } from './tools/buildContractActivityTool.js';
import { buildContractCallGraphTool } from './tools/buildContractCallGraphTool.js';
import { buildContractDeploymentsTool } from './tools/buildContractDeploymentsTool.js';
import { buildContractEventsTool } from './tools/buildContractEventsTool.js';
import { buildContractPayoutsTool } from './tools/buildContractPayoutsTool.js';
import { buildFindTokenTool } from './tools/buildFindTokenTool.js';
import { buildNetworkStatsTool } from './tools/buildNetworkStatsTool.js';
import { buildNewAccountsTool } from './tools/buildNewAccountsTool.js';
import { buildPermissionChangesTool } from './tools/buildPermissionChangesTool.js';
import { buildResourceDelegationsTool } from './tools/buildResourceDelegationsTool.js';
import { buildTokenActivityTool } from './tools/buildTokenActivityTool.js';
import { buildTraceFlowTool } from './tools/buildTraceFlowTool.js';
import { buildTransactionTraceTool } from './tools/buildTransactionTraceTool.js';
import { CHAIN_QUERY_PROVIDER_ID } from './tools/chainQueryToolShared.js';

/**
 * Build every chain query tool against one toolkit, so they share its caches.
 *
 * @param toolkit - The shared chain query dependencies.
 * @returns The tools, in the order the admin page lists them: wallet tools,
 *          then the single-transaction trace, then token, contract, and network tools.
 */
export function buildChainQueryTools(toolkit: IChainQueryToolkit): IAiTool[] {
    return [
        buildAddressProfileTool(toolkit),
        buildAddressCounterpartiesTool(toolkit),
        buildAddressTransfersTool(toolkit),
        buildTraceFlowTool(toolkit),
        buildPermissionChangesTool(toolkit),
        buildResourceDelegationsTool(toolkit),
        buildNewAccountsTool(toolkit),
        buildTransactionTraceTool(toolkit),
        buildFindTokenTool(toolkit),
        buildTokenActivityTool(toolkit),
        buildContractActivityTool(toolkit),
        buildContractEventsTool(toolkit),
        buildContractPayoutsTool(toolkit),
        buildContractCallGraphTool(toolkit),
        buildContractDeploymentsTool(toolkit),
        buildNetworkStatsTool(toolkit)
    ];
}

/**
 * Register the chain query tools whenever the core `'ai-tools'` registry is available.
 *
 * Each tool is unregistered before it is registered, so the registry coming
 * back (an operator toggling it, a hot reload) does not trip the duplicate-name
 * guard. A tool that fails to register is logged and skipped rather than
 * thrown, because AI tooling is optional and must not stop core from starting.
 *
 * @param serviceRegistry - The registry to watch for `'ai-tools'`, and where the
 *                          toolkit finds ClickHouse accounts, tags, and prices.
 * @returns Disposer that removes the watch subscription.
 */
export function registerChainQueryAiTools(serviceRegistry: IServiceRegistry): ServiceWatchDisposer {
    const tools = buildChainQueryTools(createChainQueryToolkit(serviceRegistry));

    return serviceRegistry.watch<IAiToolRegistry>('ai-tools', {
        onAvailable: (registry) => {
            for (const tool of tools) {
                try {
                    registry.unregisterTool(tool.name);
                    registry.registerTool(tool, CHAIN_QUERY_PROVIDER_ID);
                } catch (error) {
                    logger.error({ error, tool: tool.name }, 'Failed to register a chain query AI tool');
                }
            }
            logger.info({ tools: tools.map(tool => tool.name) }, 'Registered chain query AI tools');
        }
    });
}
