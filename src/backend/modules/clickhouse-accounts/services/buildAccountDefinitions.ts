/**
 * @fileoverview The ClickHouse accounts this platform declares.
 *
 * Accounts are declared here, in reviewed code, rather than created from the
 * admin page. An account only matters if some code connects as it, and its
 * grants decide what it can read at all, so adding one or widening its grants
 * should go through code review. An admin can tune a managed account's limits
 * from the admin page, up to the ceilings stated here.
 */

import type { IClickHouseAccountDefinition } from '@/types';

/** Id of the observed account the shared connection uses. */
export const DEFAULT_ACCOUNT_ID = 'default';

/** Id of the managed account AI agents read chain data through. */
export const AI_AGENT_ACCOUNT_ID = 'ai-agent';

/**
 * Build the list of declared accounts.
 *
 * The `default` account takes its ClickHouse user name from the running
 * connection, because operators can point `CLICKHOUSE_USER` at another user.
 * It is observed rather than managed: the chain writer, migrations, table
 * creation, and the admin table browser all use it, and a limit that cut off
 * one of the writer's inserts would leave a gap in the chain data.
 *
 * The `ai-agent` account can read the `tron` chain database and nothing else.
 * Its starting limits keep one query to a few seconds and a bounded scan, and
 * its concurrency limit is what bounds its total load on the server: however
 * many quota keys callers use, no more than that many of its queries run at
 * once.
 *
 * @param rootUser - The ClickHouse user the shared connection authenticates as.
 * @returns Every declared account, in the order the admin page lists them.
 */
export function buildAccountDefinitions(rootUser: string): IClickHouseAccountDefinition[] {
    const definitions: IClickHouseAccountDefinition[] = [
        {
            id: DEFAULT_ACCOUNT_ID,
            label: 'Application',
            description:
                'The shared connection the application uses for chain data writes, migrations, table ' +
                'creation, and the admin table browser. Observed only, so no limit can interrupt a chain write.',
            clickhouseUser: rootUser
        },
        {
            id: AI_AGENT_ACCOUNT_ID,
            label: 'AI agent',
            description:
                'Read-only access to the tron chain database for AI tools. ClickHouse enforces its ' +
                'per-query limits and hourly quota, so a tool cannot run a query these limits forbid.',
            clickhouseUser: 'tronrelic_ai_agent',
            policy: {
                grants: ['tron.*'],
                defaultDatabase: 'tron',
                poolSize: 2,
                defaultLimits: {
                    maxExecutionSeconds: 10,
                    maxRowsToRead: 50_000_000,
                    maxBytesToRead: 5_000_000_000,
                    maxMemoryBytes: 1_000_000_000,
                    maxThreads: 2,
                    maxResultRows: 5_000,
                    maxConcurrentQueries: 2,
                    hourlyQueries: 600,
                    hourlyReadRows: 2_000_000_000,
                    hourlyExecutionSeconds: 600
                },
                ceilings: {
                    maxExecutionSeconds: 60,
                    maxRowsToRead: 500_000_000,
                    maxBytesToRead: 50_000_000_000,
                    maxMemoryBytes: 4_000_000_000,
                    maxThreads: 8,
                    maxResultRows: 100_000,
                    maxConcurrentQueries: 8,
                    hourlyQueries: 5_000,
                    hourlyReadRows: 20_000_000_000,
                    hourlyExecutionSeconds: 3_600
                }
            }
        }
    ];

    return definitions;
}
