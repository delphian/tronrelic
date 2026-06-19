/**
 * @file variables/system-health.ts
 *
 * Built-in dynamic prompt variables in the "System Health" category.
 * Registered by {@link registerBuiltinVariables} via registerSystemHealthVariables.
 *
 * Lifted from the trp-ai-assistant plugin to core unchanged in behaviour; the
 * resolvers now read injected core services (`deps`) instead of `IPluginContext`.
 */

import os from 'node:os';
import { readFileSync, statfsSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import type { IPromptVariableRegistry } from '@/types';
import type { IBuiltinVariableDeps } from './types.js';

/**
 * Register all "System Health" built-in variables on the given registry.
 *
 * @param registry - The core prompt-variable registry.
 * @param deps - Injected core services the resolvers read at expansion time.
 */
export function registerSystemHealthVariables(
    registry: IPromptVariableRegistry,
    deps: IBuiltinVariableDeps
): void {
    registry.registerVariable({
        name: 'observer-stats',
        category: 'System Health',
        description: 'Blockchain observer processing stats: throughput, errors, queue depth per observer',
        resolve: async () => {
            const aggregate = deps.observerRegistry.getAggregateStats();
            const observers = deps.observerRegistry.getAllObserverStats();
            const subscriptions = deps.observerRegistry.getSubscriptionStats();

            const lines = [
                'Observer Processing Statistics:',
                `  Total Observers: ${aggregate.totalObservers}`,
                `  Total Processed: ${aggregate.totalProcessed.toLocaleString()}`,
                `  Total Errors: ${aggregate.totalErrors.toLocaleString()}`,
                `  Total Dropped: ${aggregate.totalDropped.toLocaleString()}`,
                `  Queue Depth: ${aggregate.totalQueueDepth}`,
                `  Avg Processing Time: ${aggregate.avgProcessingTimeMs.toFixed(1)}ms`,
                `  Highest Error Rate: ${(aggregate.highestErrorRate * 100).toFixed(2)}%`,
                `  Observers with Errors: ${aggregate.observersWithErrors}`,
                ''
            ];

            // Subscription counts by tx type
            const subEntries = Object.entries(subscriptions);
            if (subEntries.length > 0) {
                lines.push('  Subscriptions by Transaction Type:');
                for (const [type, count] of subEntries) {
                    lines.push(`    ${type}: ${count} observer(s)`);
                }
                lines.push('');
            }

            // Per-observer breakdown
            if (observers.length > 0) {
                lines.push('  Per-Observer Detail:');
                for (const obs of observers) {
                    const errorRate = obs.totalProcessed > 0
                        ? ((obs.totalErrors / obs.totalProcessed) * 100).toFixed(1)
                        : '0.0';
                    lines.push(`    ${obs.name}:`);
                    lines.push(`      Processed: ${obs.totalProcessed.toLocaleString()} | Errors: ${obs.totalErrors} (${errorRate}%) | Queue: ${obs.queueDepth} | Avg: ${obs.avgProcessingTimeMs.toFixed(1)}ms`);
                }
            }

            return lines.join('\n');
        }
    });

    registry.registerVariable({
        name: 'log-summary',
        category: 'System Health',
        description: 'System log statistics: counts by level, by service, and unresolved issues',
        resolve: async () => {
            const stats = await deps.systemLog.getStatistics();

            const lines = [
                'System Log Summary:',
                `  Total Entries: ${stats.total.toLocaleString()}`,
                `  Unresolved: ${stats.unresolved}`,
                '',
                '  By Level:'
            ];

            for (const [level, count] of Object.entries(stats.byLevel)) {
                if (count > 0) {
                    lines.push(`    ${level}: ${count.toLocaleString()}`);
                }
            }

            const serviceEntries = Object.entries(stats.byService);
            if (serviceEntries.length > 0) {
                lines.push('');
                lines.push('  By Service:');
                // Sort by count descending, show top 15
                serviceEntries.sort(([, a], [, b]) => (b as number) - (a as number));
                for (const [service, count] of serviceEntries.slice(0, 15)) {
                    lines.push(`    ${service}: ${(count as number).toLocaleString()}`);
                }
                if (serviceEntries.length > 15) {
                    lines.push(`    ... and ${serviceEntries.length - 15} more services`);
                }
            }

            return lines.join('\n');
        }
    });

    let cachedAppVersion = 'unknown';
    try {
        const pkg = JSON.parse(readFileSync(pathResolve(process.cwd(), 'package.json'), 'utf-8'));
        cachedAppVersion = pkg.version ?? 'unknown';
    } catch {
        /* fallback */
    }

    registry.registerVariable({
        name: 'server-info',
        category: 'System Health',
        description: 'Server runtime environment: current time with UTC offset, Node.js version, uptime, memory, OS, hostname, CPU count, app version',
        resolve: async () => {
            const now = new Date();
            const offsetMin = now.getTimezoneOffset();
            const offsetSign = offsetMin <= 0 ? '+' : '-';
            const absOffset = Math.abs(offsetMin);
            const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
            const offsetMins = String(absOffset % 60).padStart(2, '0');
            const utcOffset = `${offsetSign}${offsetHours}:${offsetMins}`;

            let tzName = 'Unknown';
            try {
                tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
            } catch {
                /* fallback */
            }

            const mem = process.memoryUsage();
            const formatMb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
            const formatGb = (bytes: number): string => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;

            const uptimeSec = process.uptime();
            const days = Math.floor(uptimeSec / 86400);
            const hours = Math.floor((uptimeSec % 86400) / 3600);
            const minutes = Math.floor((uptimeSec % 3600) / 60);
            const uptimeStr = days > 0
                ? `${days}d ${hours}h ${minutes}m`
                : `${hours}h ${minutes}m`;

            const lines = [
                'Server Information:',
                '',
                '  Time & Locale:',
                `    Current Time (UTC): ${now.toISOString()}`,
                `    Server Timezone: ${tzName} (UTC${utcOffset})`,
                `    Process Uptime: ${uptimeStr}`,
                '',
                '  Runtime:',
                `    Node.js: ${process.version}`,
                `    NODE_ENV: ${process.env.NODE_ENV ?? 'not set'}`,
                `    PID: ${process.pid}`,
                `    Heap Used: ${formatMb(mem.heapUsed)} / ${formatMb(mem.heapTotal)}`,
                `    RSS: ${formatMb(mem.rss)}`,
                '',
                '  Platform:',
                `    OS: ${os.platform()} ${os.arch()}`,
                `    OS Release: ${os.release()}`,
                `    Hostname: ${os.hostname()}`,
                `    CPU Count: ${os.cpus().length}`,
                `    Load Average (1/5/15m): ${os.loadavg().map(v => v.toFixed(2)).join(' / ')}`,
                '',
                '  System Memory:',
                `    Total: ${formatGb(os.totalmem())}`,
                `    Free: ${formatGb(os.freemem())}`,
                `    Used: ${formatGb(os.totalmem() - os.freemem())}`,
            ];

            try {
                const diskStats = statfsSync('/');
                const diskTotal = diskStats.blocks * diskStats.bsize;
                const diskFree = diskStats.bavail * diskStats.bsize;
                lines.push(
                    '',
                    '  Disk (/):',
                    `    Total: ${formatGb(diskTotal)}`,
                    `    Free: ${formatGb(diskFree)}`,
                    `    Used: ${formatGb(diskTotal - diskFree)}`
                );
            } catch {
                /* statfsSync unavailable or permission denied */
            }

            lines.push(
                '',
                '  Application:',
                `    TronRelic Version: ${cachedAppVersion}`,
                `    Backend Port: ${process.env.PORT ?? '4000'}`
            );

            return lines.join('\n');
        }
    });
}
