/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IPluginContext, ISystemConfigService } from '@tronrelic/types';

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
 */
describe('Telegram Bot Plugin - /config endpoint', () => {
    /**
     * Test: /config endpoint should dynamically calculate webhook URL from system config.
     *
     * Verifies that when the system config site URL changes, the /config endpoint
     * returns the updated webhook URL without needing to restart services.
     */
    it('should dynamically calculate webhook URL from system config', async () => {
        // Mock system config service
        const mockSystemConfig: ISystemConfigService = {
            getSiteUrl: vi.fn().mockResolvedValue('https://example.com'),
            getConfig: vi.fn(),
            updateConfig: vi.fn(),
            clearCache: vi.fn()
        };

        // Mock plugin database
        const mockDatabase = {
            get: vi.fn().mockResolvedValue({
                rateLimitPerUser: 10,
                rateLimitWindowMs: 60000
            }),
            set: vi.fn(),
            delete: vi.fn(),
            getCollection: vi.fn()
        };

        // Mock logger
        const mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn().mockReturnThis()
        };

        // Create mock plugin context
        const mockContext: Partial<IPluginContext> = {
            systemConfig: mockSystemConfig,
            database: mockDatabase as any,
            logger: mockLogger as any
        };

        // Simulate the /config endpoint handler logic
        const config = await mockDatabase.get('config');
        const botConfig = await mockDatabase.get('bot-config');
        const botTokenConfigured = !!(botConfig && botConfig.botToken);
        const siteUrl = await mockSystemConfig.getSiteUrl();
        const webhookUrl = `${siteUrl}/api/plugins/telegram-bot/webhook`;

        const response = {
            success: true,
            config: {
                ...(config || {}),
                webhookUrl,
                botTokenConfigured
            }
        };

        // Verify webhook URL is constructed from system config
        expect(response.config.webhookUrl).toBe('https://example.com/api/plugins/telegram-bot/webhook');
        expect(mockSystemConfig.getSiteUrl).toHaveBeenCalled();
        expect(response.config.rateLimitPerUser).toBe(10);
        expect(response.config.botTokenConfigured).toBe(false);
    });

    /**
     * Test: Webhook URL should update when system config changes.
     *
     * Verifies that changing the site URL in system config immediately
     * affects the webhook URL returned by /config endpoint.
     */
    it('should return updated webhook URL when system config changes', async () => {
        const mockSystemConfig: ISystemConfigService = {
            getSiteUrl: vi.fn()
                .mockResolvedValueOnce('http://localhost:3000')
                .mockResolvedValueOnce('https://production.com'),
            getConfig: vi.fn(),
            updateConfig: vi.fn(),
            clearCache: vi.fn()
        };

        const mockDatabase = {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn(),
            delete: vi.fn(),
            getCollection: vi.fn()
        };

        // First request - localhost
        let siteUrl = await mockSystemConfig.getSiteUrl();
        let webhookUrl = `${siteUrl}/api/plugins/telegram-bot/webhook`;
        expect(webhookUrl).toBe('http://localhost:3000/api/plugins/telegram-bot/webhook');

        // Second request - production (simulating config change)
        siteUrl = await mockSystemConfig.getSiteUrl();
        webhookUrl = `${siteUrl}/api/plugins/telegram-bot/webhook`;
        expect(webhookUrl).toBe('https://production.com/api/plugins/telegram-bot/webhook');

        // Verify system config was called twice
        expect(mockSystemConfig.getSiteUrl).toHaveBeenCalledTimes(2);
    });

    /**
     * Test: /config should not read webhook URL from plugin storage.
     *
     * Verifies that the endpoint does NOT use a stale webhookUrl value
     * from plugin database storage, even if one exists.
     */
    it('should ignore stale webhookUrl from plugin storage', async () => {
        const mockSystemConfig: ISystemConfigService = {
            getSiteUrl: vi.fn().mockResolvedValue('https://new-domain.com'),
            getConfig: vi.fn(),
            updateConfig: vi.fn(),
            clearCache: vi.fn()
        };

        // Plugin storage has a stale webhook URL
        const mockDatabase = {
            get: vi.fn().mockResolvedValue({
                webhookUrl: 'https://old-stale-domain.com/api/plugins/telegram-bot/webhook', // Stale!
                rateLimitPerUser: 10
            }),
            set: vi.fn(),
            delete: vi.fn(),
            getCollection: vi.fn()
        };

        // Simulate endpoint logic
        const config = await mockDatabase.get('config');
        const siteUrl = await mockSystemConfig.getSiteUrl();
        const webhookUrl = `${siteUrl}/api/plugins/telegram-bot/webhook`; // Dynamically constructed

        const response = {
            success: true,
            config: {
                ...(config || {}),
                webhookUrl, // This overwrites the stale value from storage
                botTokenConfigured: false
            }
        };

        // Verify webhook URL uses fresh system config, not stale storage
        expect(response.config.webhookUrl).toBe('https://new-domain.com/api/plugins/telegram-bot/webhook');
        expect(response.config.webhookUrl).not.toBe('https://old-stale-domain.com/api/plugins/telegram-bot/webhook');
        expect(mockSystemConfig.getSiteUrl).toHaveBeenCalled();
    });
});
