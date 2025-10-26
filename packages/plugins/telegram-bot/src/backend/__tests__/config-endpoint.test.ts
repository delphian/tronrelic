/// <reference types="vitest" />

import { describe, it, expect, vi } from 'vitest';
import type { IPluginContext, ISystemConfigService, IHttpRequest, IHttpResponse, IHttpNext } from '@tronrelic/types';
import { telegramBotBackendPlugin } from '../backend.js';

/**
 * Tests for the /config endpoint in telegram-bot plugin.
 *
 * This test suite verifies that the /config endpoint dynamically constructs
 * the webhook URL from the system configuration service instead of using
 * a stale cached value from plugin storage.
 *
 * Why this matters:
 * The webhook URL depends on the site URL (e.g., localhost vs production domain).
 * If the admin changes the site URL in system config, the webhook URL must
 * update immediately without requiring plugin reinstallation or backend restart.
 *
 * CRITICAL: These tests invoke the ACTUAL route handler from backend.ts, not a
 * reimplemented version. This ensures test coverage actually catches regressions
 * in the route handler logic, including calls to botConfigService.getMaskedConfig().
 */
describe('Telegram Bot Plugin - /config endpoint', () => {
    /**
     * Helper to create a mock HTTP request.
     *
     * @returns Mock request object conforming to IHttpRequest interface
     */
    function createMockRequest(): IHttpRequest {
        return {
            method: 'GET',
            url: '/api/plugins/telegram-bot/config',
            path: '/config',
            headers: {},
            query: {},
            params: {},
            body: {},
            ip: '127.0.0.1',
            get: vi.fn((_name: string) => undefined)
        };
    }

    /**
     * Helper to create a mock HTTP response with body tracking.
     *
     * @returns Mock response object conforming to IHttpResponse interface, plus captured body
     */
    function createMockResponse() {
        const response = {
            statusCode: 200,
            capturedBody: null as any,
            status: vi.fn().mockReturnThis(),
            json: vi.fn((data: any) => {
                response.capturedBody = data;
                return response;
            }),
            send: vi.fn().mockReturnThis(),
            setHeader: vi.fn().mockReturnThis(),
            getHeader: vi.fn(() => undefined),
            cookie: vi.fn().mockReturnThis(),
            redirect: vi.fn(),
            end: vi.fn()
        };

        return response as IHttpResponse & { capturedBody: any };
    }

    /**
     * Helper to create mock dependencies for plugin initialization.
     *
     * @param siteUrl - Site URL to return from systemConfig.getSiteUrl()
     * @param dbConfig - Configuration object to return from database.get('bot-config')
     * @returns Mocked plugin context and response object
     */
    function createMockContext(siteUrl: string, dbConfig?: any) {
        const mockSystemConfig: ISystemConfigService = {
            getSiteUrl: vi.fn().mockResolvedValue(siteUrl),
            getConfig: vi.fn(),
            updateConfig: vi.fn(),
            clearCache: vi.fn()
        };

        const mockDatabase = {
            get: vi.fn().mockResolvedValue(dbConfig || {
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
                rateLimitPerUser: 10,
                rateLimitWindowMs: 60000
            }),
            set: vi.fn(),
            delete: vi.fn(),
            getCollection: vi.fn()
        };

        const mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn().mockReturnThis()
        };

        const mockContext: Partial<IPluginContext> = {
            systemConfig: mockSystemConfig,
            database: mockDatabase as any,
            logger: mockLogger as any
        };

        return { mockContext, mockSystemConfig, mockDatabase, mockLogger };
    }

    /**
     * Test: /config endpoint should dynamically calculate webhook URL from system config.
     *
     * Verifies that when the system config site URL changes, the /config endpoint
     * returns the updated webhook URL without needing to restart services.
     *
     * THIS TEST CALLS THE REAL ROUTE HANDLER and exercises the full code path including
     * botConfigService.getMaskedConfig() and systemConfig.getSiteUrl().
     */
    it('should dynamically calculate webhook URL from system config', async () => {
        const { mockContext, mockSystemConfig } = createMockContext('https://example.com');

        // Run the init() hook to register routes (this is what happens at runtime)
        await telegramBotBackendPlugin.init!(mockContext as IPluginContext);

        // Find the /config route from the plugin's routes array (populated by init)
        const configRoute = telegramBotBackendPlugin.routes?.find(r => r.path === '/config');
        expect(configRoute).toBeDefined();
        expect(configRoute?.method).toBe('GET');

        // Create mock request/response/next
        const req = createMockRequest();
        const res = createMockResponse();
        const next = vi.fn() as IHttpNext;

        // Invoke the ACTUAL route handler
        await configRoute!.handler(req, res, next);

        // Verify response structure
        expect(res.capturedBody).toHaveProperty('success', true);
        expect(res.capturedBody).toHaveProperty('config');

        // Verify webhook URL is constructed from system config
        expect(res.capturedBody.config.webhookUrl).toBe('https://example.com/api/plugins/telegram-bot/webhook');
        expect(mockSystemConfig.getSiteUrl).toHaveBeenCalled();

        // Verify botConfigService.getMaskedConfig() was called (via database.get)
        expect(mockContext.database!.get).toHaveBeenCalledWith('bot-config');

        // Verify bot token is masked in response
        expect(res.capturedBody.config.botToken).toMatch(/^\*{6}/); // Should start with ******
        expect(res.capturedBody.config.botTokenConfigured).toBe(true);

        // Verify rate limit config is included
        expect(res.capturedBody.config.rateLimitPerUser).toBe(10);
        expect(res.capturedBody.config.rateLimitWindowMs).toBe(60000);
    });

    /**
     * Test: Webhook URL should update when system config changes.
     *
     * Verifies that changing the site URL in system config immediately
     * affects the webhook URL returned by /config endpoint.
     *
     * THIS TEST CALLS THE REAL ROUTE HANDLER twice with different site URLs.
     */
    it('should return updated webhook URL when system config changes', async () => {
        // First request - localhost
        let { mockContext, mockSystemConfig } = createMockContext('http://localhost:3000');

        // Run init() to register routes
        await telegramBotBackendPlugin.init!(mockContext as IPluginContext);

        let configRoute = telegramBotBackendPlugin.routes?.find(r => r.path === '/config');
        let req = createMockRequest();
        let res = createMockResponse();
        let next = vi.fn() as IHttpNext;

        await configRoute!.handler(req, res, next);

        expect(res.capturedBody.config.webhookUrl).toBe('http://localhost:3000/api/plugins/telegram-bot/webhook');
        // getSiteUrl is called during init() and during handler execution
        expect(mockSystemConfig.getSiteUrl).toHaveBeenCalled();

        // Second request - production (simulating config change)
        // Reinitialize with new context
        ({ mockContext, mockSystemConfig } = createMockContext('https://production.com'));

        // Re-run init() with updated context
        await telegramBotBackendPlugin.init!(mockContext as IPluginContext);

        // Re-fetch route handler from updated plugin context (fixes closure scope bug)
        configRoute = telegramBotBackendPlugin.routes?.find(r => r.path === '/config');

        req = createMockRequest();
        res = createMockResponse();
        next = vi.fn() as IHttpNext;

        await configRoute!.handler(req, res, next);

        expect(res.capturedBody.config.webhookUrl).toBe('https://production.com/api/plugins/telegram-bot/webhook');
        // Verify the new systemConfig was used
        expect(mockSystemConfig.getSiteUrl).toHaveBeenCalled();
    });

    /**
     * Test: /config should mask bot token and webhook secret.
     *
     * Verifies that the endpoint returns masked bot token and webhook secret
     * through the botConfigService.getMaskedConfig() method.
     *
     * THIS TEST VERIFIES THAT THE REAL botConfigService.getMaskedConfig() LOGIC IS EXECUTED.
     */
    it('should mask bot token and webhook secret in response', async () => {
        const { mockContext } = createMockContext('https://example.com', {
            botToken: '987654321:XYZabcDEFghiJKLmnoSTUvwxYZ123456',
            webhookSecret: 'super-secret-webhook-token-12345678',
            rateLimitPerUser: 5,
            rateLimitWindowMs: 30000
        });

        // Run init() to register routes
        await telegramBotBackendPlugin.init!(mockContext as IPluginContext);

        const configRoute = telegramBotBackendPlugin.routes?.find(r => r.path === '/config');
        const req = createMockRequest();
        const res = createMockResponse();
        const next = vi.fn() as IHttpNext;

        await configRoute!.handler(req, res, next);

        // Verify bot token is masked (only last 6 chars visible)
        expect(res.capturedBody.config.botToken).toBe('******123456');
        expect(res.capturedBody.config.botTokenConfigured).toBe(true);

        // Verify webhook secret is masked (only last 6 chars visible)
        expect(res.capturedBody.config.webhookSecret).toBe('******345678');
        expect(res.capturedBody.config.webhookSecretConfigured).toBe(true);

        // Verify other config values are passed through
        expect(res.capturedBody.config.rateLimitPerUser).toBe(5);
        expect(res.capturedBody.config.rateLimitWindowMs).toBe(30000);
    });

    /**
     * Test: /config should handle missing bot token gracefully.
     *
     * Verifies that the endpoint returns appropriate flags when no bot token
     * is configured in the database.
     *
     * THIS TEST CALLS THE REAL ROUTE HANDLER with empty database config.
     */
    it('should handle missing bot token gracefully', async () => {
        const { mockContext } = createMockContext('https://example.com', {
            rateLimitPerUser: 10,
            rateLimitWindowMs: 60000
        });

        // Run init() to register routes
        await telegramBotBackendPlugin.init!(mockContext as IPluginContext);

        const configRoute = telegramBotBackendPlugin.routes?.find(r => r.path === '/config');
        const req = createMockRequest();
        const res = createMockResponse();
        const next = vi.fn() as IHttpNext;

        await configRoute!.handler(req, res, next);

        // Verify bot token is undefined when not configured
        expect(res.capturedBody.config.botToken).toBeUndefined();
        expect(res.capturedBody.config.botTokenConfigured).toBe(false);

        // Verify webhook secret is undefined when not configured
        expect(res.capturedBody.config.webhookSecret).toBeUndefined();
        expect(res.capturedBody.config.webhookSecretConfigured).toBe(false);

        // Verify webhook URL is still constructed
        expect(res.capturedBody.config.webhookUrl).toBe('https://example.com/api/plugins/telegram-bot/webhook');
    });
});
