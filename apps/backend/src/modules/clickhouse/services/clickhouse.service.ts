/**
 * ClickHouse database service implementation.
 *
 * Provides access to ClickHouse for analytical queries, time-series data,
 * and high-volume batch inserts. Wraps the official @clickhouse/client package
 * with TronRelic-specific configuration and error handling.
 *
 * Why this service exists:
 * - Centralizes ClickHouse connection management
 * - Provides typed interface matching IClickHouseService
 * - Handles connection lifecycle (connect, ping, disconnect)
 * - Configures async inserts for high-throughput scenarios
 *
 * This service implements IClickHouseService (a shared interface) and therefore
 * follows the singleton pattern per TronRelic module conventions.
 */

import { createClient, type ClickHouseClient } from '@clickhouse/client';
import type { IClickHouseService, ISystemLogService } from '@tronrelic/types';

/**
 * ClickHouse service singleton implementation.
 *
 * Connects to ClickHouse during initialization and provides query, insert,
 * and DDL execution methods. Uses async inserts for improved write performance.
 */
export class ClickHouseService implements IClickHouseService {
    private static instance: ClickHouseService | null = null;

    private client!: ClickHouseClient;
    private logger: ISystemLogService;
    private connected: boolean = false;

    /** Interval handle for async insert error polling */
    private errorPollInterval: ReturnType<typeof setInterval> | null = null;

    /** Timestamp of last polled error to avoid duplicates */
    private lastErrorPollTime: Date = new Date();

    /** Polling interval in milliseconds (default: 30 seconds) */
    private static readonly ERROR_POLL_INTERVAL_MS = 30_000;

    /**
     * Private constructor - use setDependencies() and getInstance().
     *
     * @param logger - Scoped logger for ClickHouse operations
     */
    private constructor(logger: ISystemLogService) {
        this.logger = logger;
    }

    /**
     * Initialize the singleton with dependencies.
     *
     * Must be called once during module initialization before getInstance().
     *
     * @param logger - Scoped logger for ClickHouse operations
     */
    public static setDependencies(logger: ISystemLogService): void {
        if (!ClickHouseService.instance) {
            ClickHouseService.instance = new ClickHouseService(logger);
        }
    }

    /**
     * Get the singleton instance.
     *
     * @throws Error if setDependencies() was not called first
     * @returns ClickHouseService singleton instance
     */
    public static getInstance(): ClickHouseService {
        if (!ClickHouseService.instance) {
            throw new Error('ClickHouseService.setDependencies() must be called before getInstance()');
        }
        return ClickHouseService.instance;
    }

    /**
     * Check if the singleton has been initialized.
     *
     * @returns True if setDependencies() has been called
     */
    public static isInitialized(): boolean {
        return ClickHouseService.instance !== null;
    }

    /**
     * Reset the singleton (for testing purposes only).
     */
    public static resetInstance(): void {
        ClickHouseService.instance = null;
    }

    /**
     * Connect to ClickHouse using environment configuration.
     *
     * Reads connection parameters from environment variables:
     * - CLICKHOUSE_HOST: HTTP endpoint (default: http://localhost:8123)
     * - CLICKHOUSE_DATABASE: Database name (default: tronrelic)
     * - CLICKHOUSE_USER: Username (default: default)
     * - CLICKHOUSE_PASSWORD: Password (default: empty)
     *
     * @throws Error if connection fails or ping returns unsuccessful
     */
    async connect(): Promise<void> {
        const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
        const database = process.env.CLICKHOUSE_DATABASE || 'tronrelic';
        const username = process.env.CLICKHOUSE_USER || 'default';
        const password = process.env.CLICKHOUSE_PASSWORD || '';

        this.client = createClient({
            host,
            database,
            username,
            password,
            clickhouse_settings: {
                // Enable async inserts for better write throughput
                // Inserts are buffered and flushed in batches
                async_insert: 1,
                // Don't wait for async insert acknowledgment
                // Trades durability for speed (acceptable for analytics data)
                wait_for_async_insert: 0
            }
        });

        // Verify connection is working
        const alive = await this.ping();
        if (!alive) {
            throw new Error(`Failed to connect to ClickHouse at ${host}`);
        }

        this.connected = true;
        this.logger.info({ host, database }, 'Connected to ClickHouse');

        // Start polling for async insert errors
        this.startErrorPolling();
    }

    /**
     * Check if ClickHouse is connected.
     *
     * @returns True if connect() completed successfully
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Execute a SELECT query and return typed results.
     *
     * @param sql - ClickHouse SQL query with optional parameter placeholders
     * @param params - Query parameters (keys match placeholder names)
     * @returns Array of result rows typed as T
     */
    async query<T = Record<string, unknown>>(
        sql: string,
        params?: Record<string, unknown>
    ): Promise<T[]> {
        if (!this.connected) {
            throw new Error('ClickHouse not connected. Call connect() first.');
        }

        try {
            const result = await this.client.query({
                query: sql,
                query_params: params,
                format: 'JSONEachRow'
            });
            return await result.json<T>();
        } catch (error) {
            this.logger.error({ error, sql: sql.substring(0, 200) }, 'ClickHouse query failed');
            throw error;
        }
    }

    /**
     * Insert rows into a table using batch insert.
     *
     * @param table - Target table name
     * @param rows - Array of row objects matching table schema
     */
    async insert<T extends Record<string, unknown>>(
        table: string,
        rows: T[]
    ): Promise<void> {
        if (!this.connected) {
            throw new Error('ClickHouse not connected. Call connect() first.');
        }

        if (rows.length === 0) {
            return;
        }

        try {
            await this.client.insert({
                table,
                values: rows,
                format: 'JSONEachRow'
            });
            this.logger.debug({ table, count: rows.length }, 'Inserted rows into ClickHouse');
        } catch (error) {
            this.logger.error({ error, table, count: rows.length }, 'ClickHouse insert failed');
            throw error;
        }
    }

    /**
     * Execute DDL or command statements.
     *
     * @param sql - DDL statement to execute
     */
    async exec(sql: string): Promise<void> {
        if (!this.connected) {
            throw new Error('ClickHouse not connected. Call connect() first.');
        }

        try {
            await this.client.exec({ query: sql });
            this.logger.debug({ sql: sql.substring(0, 100) }, 'Executed ClickHouse command');
        } catch (error) {
            this.logger.error({ error, sql: sql.substring(0, 200) }, 'ClickHouse exec failed');
            throw error;
        }
    }

    /**
     * Check if ClickHouse connection is healthy.
     *
     * @returns True if ClickHouse is reachable and responding
     */
    async ping(): Promise<boolean> {
        try {
            const result = await this.client.ping();
            return result.success;
        } catch (error) {
            this.logger.warn({ error }, 'ClickHouse ping failed');
            return false;
        }
    }

    /**
     * Close the ClickHouse connection.
     *
     * Should be called during graceful shutdown.
     */
    async close(): Promise<void> {
        if (!this.connected) {
            return;
        }

        // Stop error polling
        this.stopErrorPolling();

        try {
            await this.client.close();
            this.connected = false;
            this.logger.info('ClickHouse connection closed');
        } catch (error) {
            this.logger.warn({ error }, 'Error closing ClickHouse connection');
        }
    }

    /**
     * Get the underlying ClickHouse client for advanced operations.
     *
     * Use with caution - prefer the typed methods when possible.
     *
     * @returns Raw ClickHouse client instance
     */
    getClient(): ClickHouseClient {
        return this.client;
    }

    /**
     * Start periodic polling for async insert errors.
     *
     * ClickHouse async inserts (wait_for_async_insert: 0) return immediately
     * without waiting for confirmation. Errors occur in background processing
     * and are logged to system.asynchronous_insert_log. This polling surfaces
     * those errors in our application logs.
     */
    private startErrorPolling(): void {
        if (this.errorPollInterval) {
            return;
        }

        this.lastErrorPollTime = new Date();
        this.errorPollInterval = setInterval(() => {
            void this.pollAsyncInsertErrors();
        }, ClickHouseService.ERROR_POLL_INTERVAL_MS);

        this.logger.info('Started async insert error polling');
    }

    /**
     * Stop the error polling interval.
     */
    private stopErrorPolling(): void {
        if (this.errorPollInterval) {
            clearInterval(this.errorPollInterval);
            this.errorPollInterval = null;
            this.logger.info('Stopped async insert error polling');
        }
    }

    /**
     * Poll system.asynchronous_insert_log for errors since last check.
     *
     * Queries ClickHouse's internal log table for failed async inserts and
     * surfaces them as error logs in our application. Only retrieves errors
     * newer than the last poll to avoid duplicate logging.
     */
    private async pollAsyncInsertErrors(): Promise<void> {
        if (!this.connected) {
            return;
        }

        try {
            const errors = await this.client.query({
                query: `
                    SELECT
                        event_time,
                        database,
                        table,
                        format,
                        status,
                        exception,
                        bytes,
                        rows
                    FROM system.asynchronous_insert_log
                    WHERE (status = 'ParsingError' OR status = 'FlushError')
                      AND event_time > {lastPollTime:DateTime64(3)}
                    ORDER BY event_time ASC
                    LIMIT 100
                `,
                query_params: {
                    lastPollTime: this.lastErrorPollTime.getTime()
                },
                format: 'JSONEachRow'
            });

            const errorRows = await errors.json<{
                event_time: string;
                database: string;
                table: string;
                format: string;
                status: string;
                exception: string;
                bytes: number;
                rows: number;
            }>();

            this.logger.info({ errorCount: errorRows.length }, 'Polled ClickHouse async insert log');

            for (const row of errorRows) {
                this.logger.error({
                    table: `${row.database}.${row.table}`,
                    status: row.status,
                    format: row.format,
                    bytes: row.bytes,
                    rows: row.rows,
                    exception: row.exception.substring(0, 500)
                }, 'ClickHouse async insert failed');
            }

            if (errorRows.length > 0) {
                // Update last poll time to the most recent error
                const lastError = errorRows[errorRows.length - 1];
                this.lastErrorPollTime = new Date(lastError.event_time);
            } else {
                // No errors, update to current time
                this.lastErrorPollTime = new Date();
            }
        } catch (error) {
            // Don't spam logs if polling fails - just warn once
            this.logger.warn({ error }, 'Failed to poll async insert errors');
        }
    }
}
