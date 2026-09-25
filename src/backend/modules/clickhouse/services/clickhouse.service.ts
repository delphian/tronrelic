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
 *
 * It also implements IClickHouseAccountConnector, the narrow surface the
 * clickhouse-accounts module uses to open connections as managed accounts.
 * Account passwords are derived from the root password here, so the root
 * password never leaves this class.
 */

import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { createHash, createHmac } from 'node:crypto';
import type {
    IClickHouseAccountConnector,
    IClickHouseInsertOptions,
    IClickHouseReader,
    IClickHouseService,
    ISystemLogService
} from '@/types';
import { ClickHouseAccountReader } from './ClickHouseAccountReader.js';

/**
 * Where and how the shared connection reaches ClickHouse, kept after
 * `connect()` so account readers reach the same server with the same
 * keep-alive and timeout behaviour.
 */
interface IClickHouseConnectionConfig {
    host: string;
    database: string;
    username: string;
    password: string;
}

/**
 * ClickHouse service singleton implementation.
 *
 * Connects to ClickHouse during initialization and provides query, insert,
 * and DDL execution methods. Uses async inserts for improved write performance.
 */
export class ClickHouseService implements IClickHouseService, IClickHouseAccountConnector {
    private static instance: ClickHouseService | null = null;

    /**
     * Prefix mixed into every account password derivation, so a derived
     * password can never equal an HMAC the root password is used for anywhere
     * else.
     */
    private static readonly ACCOUNT_PASSWORD_CONTEXT = 'tronrelic:clickhouse-account:';

    private client!: ClickHouseClient;
    private logger: ISystemLogService;
    private connected: boolean = false;
    private config: IClickHouseConnectionConfig | null = null;

    /** Clients opened for account readers, closed alongside the shared client. */
    private readonly accountClients: ClickHouseClient[] = [];

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
        this.config = { host, database, username, password };

        this.client = createClient({
            host,
            database,
            username,
            password,
            ...ClickHouseService.sharedClientOptions(),
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
     * Connection options every client this service opens shares, so the shared
     * client and account readers behave the same under load.
     *
     * Keep-alive avoids the cold-start delay of opening a new socket, which can
     * take one to six seconds under memory pressure. The request timeout stops a
     * hung connection from waiting forever.
     *
     * @returns Keep-alive and timeout options for `createClient`.
     */
    private static sharedClientOptions(): { keep_alive: { enabled: boolean; idle_socket_ttl: number }; request_timeout: number } {
        return {
            keep_alive: {
                enabled: true,
                idle_socket_ttl: 60000
            },
            request_timeout: 30000
        };
    }

    /**
     * The ClickHouse user the shared connection authenticates as.
     *
     * @returns The root user name, which the `default` account reports on.
     * @throws Error if called before `connect()`.
     */
    rootUser(): string {
        return this.requireConfig().username;
    }

    /**
     * Whether `CLICKHOUSE_PASSWORD` is set. With no root password, every
     * derived account password is predictable from the account id alone.
     *
     * @returns True when a root password is configured.
     * @throws Error if called before `connect()`.
     */
    hasRootPassword(): boolean {
        return this.requireConfig().password.length > 0;
    }

    /**
     * SHA-256 of an account's derived password, for `IDENTIFIED WITH
     * sha256_hash`, so provisioning SQL carries a hash instead of the password.
     *
     * @param accountId - Account whose password to hash.
     * @returns Lowercase hex SHA-256 of the derived password.
     * @throws Error if called before `connect()`.
     */
    accountPasswordHash(accountId: string): string {
        return createHash('sha256').update(this.deriveAccountPassword(accountId)).digest('hex');
    }

    /**
     * Open a reader that connects as an account's ClickHouse user on its own
     * connection pool.
     *
     * The reader gets none of the shared client's async-insert settings,
     * because it only reads. Its client is tracked so `close()` shuts it down
     * with the shared one.
     *
     * The reader authenticates with ClickHouse's own `X-ClickHouse-User` and
     * `X-ClickHouse-Key` headers instead of a Basic `Authorization` header.
     * An account read carries a quota key, and ClickHouse (checked on 24.3)
     * refuses a request that combines a Basic `Authorization` header with a
     * quota key sent either as the `quota_key` parameter or as the
     * `X-ClickHouse-Quota` header, answering 403 `AUTHENTICATION_FAILED`.
     * Header authentication combined with `X-ClickHouse-Quota` is accepted.
     *
     * @param accountId - Account whose derived password to authenticate with.
     * @param clickhouseUser - ClickHouse user name to authenticate as.
     * @param database - Database the account is granted, used for unqualified
     *   table names. The application database is not used, because the
     *   account has no grant on it.
     * @param poolSize - Most sockets the reader may open at once.
     * @returns An account-bound reader.
     * @throws Error if called before `connect()`.
     */
    openReader(accountId: string, clickhouseUser: string, database: string, poolSize: number): IClickHouseReader {
        const config = this.requireConfig();
        const password = this.deriveAccountPassword(accountId);
        const client = createClient({
            host: config.host,
            database,
            username: clickhouseUser,
            password,
            set_basic_auth_header: false,
            http_headers: {
                'X-ClickHouse-User': clickhouseUser,
                'X-ClickHouse-Key': password
            },
            max_open_connections: poolSize,
            ...ClickHouseService.sharedClientOptions()
        });
        this.accountClients.push(client);

        return new ClickHouseAccountReader(accountId, client, this.logger);
    }

    /**
     * Derive an account's password from the root password.
     *
     * An HMAC keyed by the root password means nothing new has to be stored,
     * each account gets a different password, and rotating
     * `CLICKHOUSE_PASSWORD` rotates every account password with it once the
     * accounts are applied again at startup.
     *
     * @param accountId - Account the password is for.
     * @returns 64-character hex password.
     */
    private deriveAccountPassword(accountId: string): string {
        return createHmac('sha256', this.requireConfig().password)
            .update(`${ClickHouseService.ACCOUNT_PASSWORD_CONTEXT}${accountId}`)
            .digest('hex');
    }

    /**
     * Return the stored connection settings, failing loudly when `connect()`
     * has not run, rather than deriving passwords from an empty root password.
     *
     * @returns The settings `connect()` stored.
     * @throws Error if called before `connect()`.
     */
    private requireConfig(): IClickHouseConnectionConfig {
        if (!this.config) {
            throw new Error('ClickHouse not connected. Call connect() first.');
        }

        return this.config;
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
     * @param options - When `options.waitForCommit` is true the call
     *   overrides the connection-level `wait_for_async_insert: 0` setting
     *   so the promise only resolves once the async-insert flush has
     *   committed the rows. Used by code paths that need a thrown error
     *   to be the authoritative "this did not persist" signal — primarily
     *   one-shot migrations whose downstream Mongo deletes must not run
     *   ahead of a CH flush failure surfacing in the error poller.
     *   When `options.synchronous` is true the call turns async insert off
     *   (`async_insert: 0`), so the rows are stored directly and the call
     *   resolves once they are, without holding a pooled socket while the
     *   server's async buffer waits to be written. Used by callers that
     *   already batch their rows, such as the chain data writer.
     */
    async insert<T extends Record<string, unknown>>(
        table: string,
        rows: T[],
        options?: IClickHouseInsertOptions
    ): Promise<void> {
        if (!this.connected) {
            throw new Error('ClickHouse not connected. Call connect() first.');
        }

        if (rows.length > 0) {
            try {
                await this.client.insert({
                    table,
                    values: rows,
                    format: 'JSONEachRow',
                    clickhouse_settings: ClickHouseService.resolveInsertSettings(options)
                });
                this.logger.debug({ table, count: rows.length }, 'Inserted rows into ClickHouse');
            } catch (error) {
                this.logger.error({ error, table, count: rows.length }, 'ClickHouse insert failed');
                throw error;
            }
        }
    }

    /**
     * Turn a caller's insert options into the per-call ClickHouse settings
     * that override the connection-wide async insert defaults.
     *
     * Kept in one place so the rule that `synchronous` wins over
     * `waitForCommit` is stated once. A synchronous insert has no buffer to
     * wait for, so `wait_for_async_insert` would mean nothing alongside it.
     *
     * @param options - What the caller asked for, or undefined for the
     *                  connection defaults.
     * @returns The settings to send with the insert, or undefined to keep
     *          the connection defaults.
     */
    private static resolveInsertSettings(
        options?: IClickHouseInsertOptions
    ): { async_insert: 0 } | { wait_for_async_insert: 1 } | undefined {
        let settings: { async_insert: 0 } | { wait_for_async_insert: 1 } | undefined;
        if (options?.synchronous) {
            settings = { async_insert: 0 };
        } else if (options?.waitForCommit) {
            settings = { wait_for_async_insert: 1 };
        }
        return settings;
    }

    /**
     * Execute DDL or command statements.
     *
     * Uses the client's `command()` rather than `exec()`. `exec()` hands back a
     * response stream that the caller must read, and the pooled socket stays
     * taken until it is read or times out. Nothing here reads it, so a burst of
     * statements, such as the chain data writer creating its tables, would use
     * up the pool of ten sockets and stall every other ClickHouse call.
     * `command()` reads and discards the empty response, which frees the socket.
     *
     * @param sql - DDL statement to execute
     */
    async exec(sql: string): Promise<void> {
        if (!this.connected) {
            throw new Error('ClickHouse not connected. Call connect() first.');
        }

        try {
            await this.client.command({ query: sql });
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

        // Close account readers' clients first, so no account query is left
        // running against a server whose shared client has already gone.
        await Promise.allSettled(this.accountClients.map(client => client.close()));
        this.accountClients.length = 0;

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

    /** Timeout for error polling queries in milliseconds */
    private static readonly ERROR_POLL_QUERY_TIMEOUT_MS = 5000;

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
            // Use AbortController to enforce query timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
            }, ClickHouseService.ERROR_POLL_QUERY_TIMEOUT_MS);

            let errors;
            try {
                errors = await this.client.query({
                    query: `
                        SELECT
                            toUnixTimestamp64Milli(event_time_microseconds) AS event_time_ms,
                            database,
                            table,
                            format,
                            status,
                            exception,
                            bytes,
                            rows
                        FROM system.asynchronous_insert_log
                        WHERE (status = 'ParsingError' OR status = 'FlushError')
                          AND toUnixTimestamp64Milli(event_time_microseconds) > {lastPollTimeMs:Int64}
                        ORDER BY event_time_microseconds ASC
                        LIMIT 100
                    `,
                    query_params: {
                        // Compare epoch milliseconds on both sides of the filter. The
                        // cursor is built from toUnixTimestamp64Milli (floor semantics),
                        // so a raw `event_time_microseconds > {cursor:DateTime64(3)}`
                        // comparison re-matches the newest row forever whenever it has
                        // a sub-millisecond remainder. An integer parameter also avoids
                        // ClickHouse DateTime64 param parsing entirely — the construct
                        // behind two prior regressions (ISO-8601 string rejected; plain
                        // DateTime column failing toUnixTimestamp64Milli).
                        lastPollTimeMs: this.lastErrorPollTime.getTime()
                    },
                    format: 'JSONEachRow',
                    abort_signal: controller.signal
                });
            } finally {
                clearTimeout(timeoutId);
            }

            const errorRows = await errors.json<{
                /** Epoch milliseconds — ClickHouse quotes 64-bit ints as strings in JSON output */
                event_time_ms: string;
                database: string;
                table: string;
                format: string;
                status: string;
                exception: string;
                bytes: number;
                rows: number;
            }>();

            if (errorRows.length === 0) {
                // No errors, advance poll time to current time
                this.lastErrorPollTime = new Date();
                return;
            }

            this.logger.info({ errorCount: errorRows.length }, 'ClickHouse async insert errors detected');

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

            // Update last poll time to the most recent error. Use the epoch-ms
            // projection rather than a formatted event_time string: ClickHouse
            // emits DateTime64 as a timezone-less string in the *server's* zone,
            // which new Date() would parse as Node-local time — skewing the
            // cursor whenever the two hosts disagree on timezone.
            const lastError = errorRows[errorRows.length - 1];
            this.lastErrorPollTime = new Date(Number(lastError.event_time_ms));
        } catch (error) {
            // Check if this was a timeout (abort)
            if (error instanceof Error && error.name === 'AbortError') {
                this.logger.error(
                    { timeoutMs: ClickHouseService.ERROR_POLL_QUERY_TIMEOUT_MS },
                    'ClickHouse error polling query timed out'
                );
            } else {
                this.logger.warn({ error }, 'Failed to poll async insert errors');
            }
        }
    }
}
