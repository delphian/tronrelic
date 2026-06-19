/**
 * @file variables/blockchain.ts
 *
 * Built-in dynamic prompt variables in the "Blockchain & Network" category.
 * Registered by {@link registerBuiltinVariables} via registerBlockchainVariables.
 *
 * Lifted from the trp-ai-assistant plugin to core unchanged in behaviour; the
 * resolvers now read injected core services (`deps`) instead of `IPluginContext`.
 */

import type { IPromptVariableRegistry } from '@/types';
import type { IBuiltinVariableDeps } from './types.js';

/**
 * Major TRON transaction contract types for the tx-types breakdown. Each entry
 * maps an internal contract type name to a human-readable label.
 */
export const MAJOR_TX_TYPES: Array<{ type: string; label: string }> = [
    { type: 'TransferContract', label: 'TRX Transfers' },
    { type: 'TriggerSmartContract', label: 'Smart Contract Calls (incl. USDT)' },
    { type: 'TransferAssetContract', label: 'TRC-10 Token Transfers' },
    { type: 'FreezeBalanceV2Contract', label: 'TRX Staking (Freeze)' },
    { type: 'UnfreezeBalanceV2Contract', label: 'TRX Unstaking (Unfreeze)' },
    { type: 'DelegateResourceContract', label: 'Energy Delegations' },
    { type: 'UnDelegateResourceContract', label: 'Energy Undelegations' },
    { type: 'VoteWitnessContract', label: 'SR Votes' }
];

/**
 * Register all "Blockchain & Network" built-in variables on the given registry.
 *
 * @param registry - The core prompt-variable registry.
 * @param deps - Injected core services the resolvers read at expansion time.
 */
export function registerBlockchainVariables(
    registry: IPromptVariableRegistry,
    deps: IBuiltinVariableDeps
): void {
    registry.registerVariable({
        name: 'system-status',
        category: 'Blockchain & Network',
        description: 'Blockchain sync status: current block, timestamp, and transaction count',
        resolve: async () => {
            const block = await deps.blockchainService.getLatestBlock();

            if (!block) {
                return 'Blockchain Sync Status: No blocks processed yet.';
            }

            const lines = [
                'Blockchain Sync Status:',
                `  Latest Block: ${block.blockNumber}`,
                `  Block ID: ${block.blockId}`,
                `  Timestamp: ${block.timestamp.toISOString()}`,
                `  Transactions in Block: ${block.transactionCount}`,
                `  Processed At: ${block.processedAt.toISOString()}`
            ];

            return lines.join('\n');
        }
    });

    registry.registerVariable({
        name: 'chain-params',
        category: 'Blockchain & Network',
        description: 'TRON network parameters: energy fee, bandwidth, conversion rates, USDT costs',
        resolve: async () => {
            const params = await deps.chainParameters.getParameters();
            const energyFee = deps.chainParameters.getEnergyFee();
            const energyPer1TRX = deps.chainParameters.getEnergyFromTRX(1);

            let usdtStandard = 'N/A';
            let usdtFirstTime = 'N/A';

            try {
                usdtStandard = String(await deps.usdtParameters.getStandardTransferEnergy());
                usdtFirstTime = String(await deps.usdtParameters.getFirstTimeTransferEnergy());
            } catch {
                // USDT parameters may not be loaded yet
            }

            const lines = [
                'TRON Chain Parameters:',
                `  Network: ${params.network}`,
                `  Energy Fee: ${energyFee} SUN per unit`,
                `  Energy from 1 TRX: ${energyPer1TRX}`,
                `  Total Energy Limit: ${params.parameters.totalEnergyCurrentLimit.toLocaleString()}`,
                `  Total Frozen for Energy: ${params.parameters.totalFrozenForEnergy.toLocaleString()}`,
                `  Bandwidth Per TRX: ${params.parameters.bandwidthPerTrx}`,
                `  Standard USDT Transfer Energy: ${usdtStandard}`,
                `  First-time USDT Transfer Energy: ${usdtFirstTime}`,
                `  Fetched At: ${params.fetchedAt.toISOString()}`
            ];

            return lines.join('\n');
        }
    });

    registry.registerVariable({
        name: 'tx-activity',
        category: 'Blockchain & Network',
        description: 'Transaction volume summary for the last 24 hours with peak and averages',
        resolve: async () => {
            const timeseries = await deps.blockchainService.getTransactionTimeseries(1);

            if (!timeseries || timeseries.length === 0) {
                return 'Transaction Activity (24h): No data available.';
            }

            const totalTx = timeseries.reduce((sum, point) => sum + point.transactions, 0);
            const avgPerPeriod = Math.round(totalTx / timeseries.length);
            const peak = timeseries.reduce((max, point) => Math.max(max, point.transactions), 0);
            const avgPerBlock = timeseries.reduce((sum, point) => sum + point.avgPerBlock, 0) / timeseries.length;

            const lines = [
                'Transaction Activity (Last 24 Hours):',
                `  Total Transactions: ${totalTx.toLocaleString()}`,
                `  Data Points: ${timeseries.length}`,
                `  Average per Period: ${avgPerPeriod.toLocaleString()}`,
                `  Peak Period: ${peak.toLocaleString()} transactions`,
                `  Average per Block: ${avgPerBlock.toFixed(1)}`
            ];

            return lines.join('\n');
        }
    });

    registry.registerVariable({
        name: 'tx-types',
        category: 'Blockchain & Network',
        description: 'Transaction breakdown by contract type over the last 24 hours',
        resolve: async () => {
            const now = new Date();
            const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            const counts = await Promise.all(
                MAJOR_TX_TYPES.map(async ({ type, label }) => {
                    const count = await deps.blockchainService.countTransactionsByType(type, dayAgo, now);
                    return { label, count };
                })
            );

            const total = counts.reduce((sum, c) => sum + c.count, 0);

            const lines = [
                'Transaction Breakdown by Type (Last 24 Hours):',
                `  Total Counted: ${total.toLocaleString()}`,
                ''
            ];

            for (const { label, count } of counts) {
                const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
                lines.push(`  ${label}: ${count.toLocaleString()} (${pct}%)`);
            }

            return lines.join('\n');
        }
    });

    registry.registerVariable({
        name: 'tx-week',
        category: 'Blockchain & Network',
        description: '7-day transaction trend with daily totals and direction',
        resolve: async () => {
            const timeseries = await deps.blockchainService.getTransactionTimeseries(7);

            if (!timeseries || timeseries.length === 0) {
                return 'Transaction Trend (7 Days): No data available.';
            }

            // Group hourly data into daily buckets
            const dailyMap = new Map<string, { total: number; count: number }>();

            for (const point of timeseries) {
                const day = point.date.split('T')[0];
                const entry = dailyMap.get(day) || { total: 0, count: 0 };
                entry.total += point.transactions;
                entry.count += 1;
                dailyMap.set(day, entry);
            }

            const days = [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b));
            const weekTotal = days.reduce((sum, [, d]) => sum + d.total, 0);

            // Trend: compare last day to first day
            let trend = 'stable';
            if (days.length >= 2) {
                const firstDay = days[0][1].total;
                const lastDay = days[days.length - 1][1].total;
                const changePct = firstDay > 0 ? ((lastDay - firstDay) / firstDay) * 100 : 0;

                if (changePct > 10) trend = `up ${changePct.toFixed(0)}%`;
                else if (changePct < -10) trend = `down ${Math.abs(changePct).toFixed(0)}%`;
                else trend = `flat (${changePct > 0 ? '+' : ''}${changePct.toFixed(0)}%)`;
            }

            const lines = [
                'Transaction Trend (Last 7 Days):',
                `  Week Total: ${weekTotal.toLocaleString()}`,
                `  Daily Average: ${Math.round(weekTotal / Math.max(days.length, 1)).toLocaleString()}`,
                `  Trend: ${trend}`,
                ''
            ];

            for (const [date, data] of days) {
                lines.push(`  ${date}: ${data.total.toLocaleString()} transactions`);
            }

            return lines.join('\n');
        }
    });
}
