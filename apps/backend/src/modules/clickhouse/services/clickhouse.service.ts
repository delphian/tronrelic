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
}
