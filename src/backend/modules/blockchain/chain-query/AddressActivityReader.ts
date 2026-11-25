/**
 * @fileoverview The address page's chain reads, served by the chain query tools' own queries.
 *
 * The `/a/<address>` page shows the same facts the wallet AI tools return, so
 * it reuses those tools' queries rather than keeping a second copy of the SQL.
 * This reader builds its own instances of the five wallet tools, which are
 * never registered on the AI tool registry, and calls their handlers directly:
 *
 * - The instances read as the page's own ClickHouse account, so page visitors
 *   and AI agents cannot spend each other's limits.
 * - Summary reads may span the whole stored history, where the registered
 *   tools stop at a week per call so a model paces itself.
 * - Each tool's model-facing envelope is turned into a typed section, and its
 *   error into a reason the page can explain. Model-facing notes and messages
 *   are dropped.
 *
 * @module backend/modules/blockchain/chain-query/AddressActivityReader
 */

import type {
    AddressExplorerErrorReason,
    AddressExplorerSection,
    IAddressActivityQuery,
    IAddressActivityReader,
    IAddressActivityTransfersPage,
    IAddressActivityTransfersQuery,
    IAddressExplorerActivity,
    IAddressExplorerCounterparties,
    IAddressExplorerCounterparty,
    IAddressExplorerCoverage,
    IAddressExplorerDelegation,
    IAddressExplorerDelegations,
    IAddressExplorerPermissionUpdate,
    IAddressExplorerPermissions,
    IAddressExplorerProfile,
    IAddressExplorerToken,
    IAddressExplorerTokenActivity,
    IAddressExplorerTransfer,
    IAiTool,
    IServiceRegistry
} from '@/types';
import { CHAIN_DATA_RETENTION_DAYS } from '../chain-data/buildChainDataSchema.js';
import { logger } from '../logger.js';
import { createChainQueryToolkit } from './ChainQueryToolkit.js';
import { buildAddressCounterpartiesTool } from './tools/buildAddressCounterpartiesTool.js';
import { buildAddressProfileTool } from './tools/buildAddressProfileTool.js';
import { buildAddressTransfersTool } from './tools/buildAddressTransfersTool.js';
import { buildPermissionChangesTool } from './tools/buildPermissionChangesTool.js';
import { buildResourceDelegationsTool } from './tools/buildResourceDelegationsTool.js';

/** Counterparty groups the page lists. */
const COUNTERPARTY_LIMIT = 25;

/** Transfers per page of the transfers list. */
const TRANSFER_PAGE_SIZE = 50;

/** Delegation events the page lists. */
const DELEGATION_LIMIT = 50;

/** Permission updates the page lists. */
const PERMISSION_LIMIT = 50;

/** The five tool instances the reader calls, one per section. */
export interface IAddressActivityTools {
    /** `blockchain-address-profile`, built with the page's window. */
    profile: IAiTool;
    /** `blockchain-address-counterparties`, built with the page's window. */
    counterparties: IAiTool;
    /** `blockchain-address-transfers`, which the page reads a week at a time. */
    transfers: IAiTool;
    /** `blockchain-resource-delegations`, built with the page's window. */
    delegations: IAiTool;
    /** `blockchain-permission-changes`, built with the page's window. */
    permissions: IAiTool;
}

/**
 * Turn a tool's failure into the reason the page shows.
 *
 * A read stopped by a size limit or by the call's deadline was too big for
 * this wallet, which the page answers by reading a shorter span. A used-up
 * quota or a full concurrency slot is not fixed by asking for less, so those
 * keep their own reasons.
 *
 * @param kind - The tool's `errorKind`.
 * @param reason - The tool's `errorReason`, set for limit errors.
 * @returns The page's reason.
 */
function toErrorReason(kind: unknown, reason: unknown): AddressExplorerErrorReason {
    let result: AddressExplorerErrorReason = 'failed';
    if (kind === 'unavailable') {
        result = 'unavailable';
    } else if (kind === 'limit') {
        result = reason === 'quota' ? 'quota' : reason === 'concurrency' ? 'busy' : 'too-large';
    }
    return result;
}

/**
 * Turn a tool's response envelope into a typed section.
 *
 * The envelope is built by `buildChainResponse` in this module, so its shape
 * is known; the cast is checked by the reader's tests rather than at runtime.
 * Only the fields the page renders are copied, which keeps the tool's cost
 * report and model-facing notes out of the browser.
 *
 * @param response - What the tool's handler returned.
 * @param pickData - Copies the section's own data out of the envelope.
 * @returns The section, read or failed.
 */
function toSection<T>(response: unknown, pickData: (payload: Record<string, unknown>) => T): AddressExplorerSection<T> {
    const payload = (response ?? {}) as Record<string, unknown>;
    let section: AddressExplorerSection<T>;
    if (payload.success === true) {
        section = {
            status: 'ok',
            window: payload.window as { from: string; to: string },
            coverage: payload.coverage as IAddressExplorerCoverage,
            tokens: (payload.tokens ?? {}) as Record<string, IAddressExplorerToken>,
            addressTags: (payload.addressTags ?? {}) as Record<string, string[]>,
            data: pickData(payload)
        };
    } else {
        const reason = toErrorReason(payload.errorKind, payload.errorReason);
        if (reason === 'failed') {
            // Input errors mean the page sent arguments the tool refused, which
            // is a bug here; the tool's own message says which argument.
            logger.warn({ errorKind: payload.errorKind, error: payload.error }, 'Address page chain read failed');
        }
        section = { status: 'error', reason };
    }
    return section;
}

/**
 * Reads one wallet's activity for the address page through the wallet tools' queries.
 */
export class AddressActivityReader implements IAddressActivityReader {
    /**
     * @param tools - The tool instances to call, built for the page's account and window.
     * @param retentionDays - How many days of chain data are stored.
     */
    constructor(
        private readonly tools: IAddressActivityTools,
        public readonly retentionDays: number
    ) {}

    /**
     * Read the wallet's totals, breakdown by token, and lookalike counterparties.
     *
     * @param query - The wallet, span, and quota key.
     * @returns The summary section.
     */
    async profile(query: IAddressActivityQuery): Promise<AddressExplorerSection<IAddressExplorerProfile>> {
        const response = await this.call(this.tools.profile, { address: query.address, hours: query.hours }, query.quotaKey);
        return toSection(response, (payload) => ({
            activity: payload.activity as IAddressExplorerActivity,
            byToken: (payload.byToken ?? []) as IAddressExplorerTokenActivity[],
            truncated: payload.truncated === true,
            lookalikeGroups: (payload.lookalikeGroups ?? []) as string[][]
        }));
    }

    /**
     * Read the wallet's busiest counterparties, by number of movements.
     *
     * @param query - The wallet, span, and quota key.
     * @returns The counterparties section.
     */
    async counterparties(query: IAddressActivityQuery): Promise<AddressExplorerSection<IAddressExplorerCounterparties>> {
        const response = await this.call(
            this.tools.counterparties,
            { address: query.address, hours: query.hours, limit: COUNTERPARTY_LIMIT },
            query.quotaKey
        );
        return toSection(response, (payload) => ({
            totalGroups: Number(payload.totalGroups ?? 0),
            truncated: payload.truncated === true,
            counterparties: (payload.counterparties ?? []) as IAddressExplorerCounterparty[]
        }));
    }

    /**
     * Read one page of the wallet's transfers inside one window, newest first.
     *
     * @param query - The wallet, window, position, and quota key.
     * @returns The page, with where the window continues.
     */
    async transfers(query: IAddressActivityTransfersQuery): Promise<AddressExplorerSection<IAddressActivityTransfersPage>> {
        const response = await this.call(
            this.tools.transfers,
            {
                address: query.address,
                since: query.from,
                until: query.to,
                limit: TRANSFER_PAGE_SIZE,
                ...(query.cursor ? { cursor: query.cursor } : {})
            },
            query.quotaKey
        );
        return toSection(response, (payload) => ({
            transfers: (payload.transfers ?? []) as IAddressExplorerTransfer[],
            nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : null
        }));
    }

    /**
     * Read the newest delegations the wallet made or received, both resources.
     *
     * @param query - The wallet, span, and quota key.
     * @returns The delegations section.
     */
    async delegations(query: IAddressActivityQuery): Promise<AddressExplorerSection<IAddressExplorerDelegations>> {
        const response = await this.call(
            this.tools.delegations,
            { view: 'events', address: query.address, hours: query.hours, limit: DELEGATION_LIMIT },
            query.quotaKey
        );
        return toSection(response, (payload) => ({
            events: (payload.events ?? []) as IAddressExplorerDelegation[],
            truncated: payload.truncated === true
        }));
    }

    /**
     * Read the wallet's permission changes, newest first.
     *
     * @param query - The wallet, span, and quota key.
     * @returns The permission changes section.
     */
    async permissions(query: IAddressActivityQuery): Promise<AddressExplorerSection<IAddressExplorerPermissions>> {
        const response = await this.call(
            this.tools.permissions,
            { view: 'updates', address: query.address, hours: query.hours, limit: PERMISSION_LIMIT },
            query.quotaKey
        );
        return toSection(response, (payload) => ({
            updates: (payload.updates ?? []) as IAddressExplorerPermissionUpdate[],
            truncated: payload.truncated === true
        }));
    }

    /**
     * Run one tool handler, charging its reads to the visitor's quota key.
     *
     * The trigger path is `programmatic` because no model is involved; the
     * handler uses only the quota key from the context.
     *
     * @param tool - The tool instance to run.
     * @param input - The tool's arguments.
     * @param quotaKey - The key the hourly quota is counted under.
     * @returns What the handler returned.
     */
    private async call(tool: IAiTool, input: Record<string, unknown>, quotaKey: string): Promise<unknown> {
        return tool.handler(input, undefined, { triggerPath: 'programmatic', quotaKey });
    }
}

/**
 * Build the address page's reader from the service registry.
 *
 * The tools resolve ClickHouse accounts, address tags, and price history from
 * the registry on each call, so this can run before those modules publish.
 *
 * @param serviceRegistry - Where the toolkit finds ClickHouse accounts, tags, and prices.
 * @param accountId - The managed ClickHouse account the page reads as.
 * @returns The reader.
 */
export function createAddressActivityReader(serviceRegistry: IServiceRegistry, accountId: string): AddressActivityReader {
    const toolkit = createChainQueryToolkit(serviceRegistry, {}, { accountId });
    const options = { addressWindowRules: { defaultHours: 168, maxHours: CHAIN_DATA_RETENTION_DAYS * 24 } };
    return new AddressActivityReader(
        {
            profile: buildAddressProfileTool(toolkit, options),
            counterparties: buildAddressCounterpartiesTool(toolkit, options),
            transfers: buildAddressTransfersTool(toolkit),
            delegations: buildResourceDelegationsTool(toolkit, options),
            permissions: buildPermissionChangesTool(toolkit, options)
        },
        CHAIN_DATA_RETENTION_DAYS
    );
}
