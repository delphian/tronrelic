/// <reference types="vitest" />

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramBotService } from '../telegram-bot.service.js';
import type { IPluginDatabase, ISystemLogService } from '@tronrelic/types';

/**
 * Tests for TelegramBotService.
 *
 * This test suite verifies the configuration management and client lifecycle
 * functionality of TelegramBotService, including:
 * - Configuration loading and caching
 * - Configuration validation and persistence
 * - Bot token and webhook secret management
 * - Token masking for security
 * - Client initialization and hot-reload
 *
 * Why these tests matter:
 * After merging BotConfigService into TelegramBotService, we need to ensure
 * all configuration management logic works correctly, especially validation
 * and caching behavior that could cause subtle bugs in production.
 */
describe('TelegramBotService', () => {
    let mockDatabase: IPluginDatabase;
    let mockLogger: ISystemLogService;
    let service: TelegramBotService;

    /**
     * Reset mocks and create fresh service instance before each test.
     *
     * Why this matters:
     * Tests must be isolated. Configuration cache and client state from previous
     * tests could cause false positives or negatives.
     */
    beforeEach(() => {
        // Create fresh mock database
        mockDatabase = {
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
            getCollection: vi.fn()
        } as any;

        // Create fresh mock logger
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn().mockReturnThis()
        } as any;

        // Create fresh service instance
        service = new TelegramBotService(mockDatabase, mockLogger);
    });

    describe('Configuration Loading', () => {
        it('should load configuration from database', async () => {
            const dbConfig = {
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
                webhookSecret: 'test-webhook-secret-1234567890',
                rateLimitPerUser: 5,
                rateLimitWindowMs: 30000
            };

            mockDatabase.get = vi.fn().mockResolvedValue(dbConfig);

            const config = await service.loadConfig();

            expect(mockDatabase.get).toHaveBeenCalledWith('bot-config');
            expect(config).toEqual(dbConfig);
            expect(mockLogger.info).toHaveBeenCalledWith('Loaded bot configuration from database');
        });

        it('should cache configuration after first load', async () => {
            const dbConfig = {
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
            };

            mockDatabase.get = vi.fn().mockResolvedValue(dbConfig);

            // First call - should hit database
            await service.loadConfig();
            expect(mockDatabase.get).toHaveBeenCalledTimes(1);

            // Second call - should use cache
            await service.loadConfig();
            expect(mockDatabase.get).toHaveBeenCalledTimes(1); // Still 1, not 2
        });

        it('should merge database config with defaults', async () => {
            const dbConfig = {
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
                // rateLimitPerUser and rateLimitWindowMs not provided
            };

            mockDatabase.get = vi.fn().mockResolvedValue(dbConfig);

            const config = await service.loadConfig();

            // Should have bot token from database
            expect(config.botToken).toBe('123456789:ABCdefGHIjklMNOpqrsTUVwxyz');

            // Should have defaults
            expect(config.rateLimitPerUser).toBe(10);
            expect(config.rateLimitWindowMs).toBe(60000);
        });

        it('should return defaults when no database config exists', async () => {
            mockDatabase.get = vi.fn().mockResolvedValue(null);

            const config = await service.loadConfig();

            expect(config.rateLimitPerUser).toBe(10);
            expect(config.rateLimitWindowMs).toBe(60000);
            expect(config.botToken).toBeUndefined();
            expect(config.webhookSecret).toBeUndefined();

            expect(mockLogger.warn).toHaveBeenCalledWith('No bot token configured in database');
            expect(mockLogger.warn).toHaveBeenCalledWith('No webhook secret configured in database');
        });

        it('should clear cache when clearCache() is called', async () => {
            const dbConfig = { botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz' };
            mockDatabase.get = vi.fn().mockResolvedValue(dbConfig);

            // First load - hits database
            await service.loadConfig();
            expect(mockDatabase.get).toHaveBeenCalledTimes(1);

            // Clear cache
            service.clearCache();

            // Next load - hits database again
            await service.loadConfig();
            expect(mockDatabase.get).toHaveBeenCalledTimes(2);
        });
    });

    describe('Configuration Saving', () => {
        it('should save configuration to database', async () => {
            const configToSave = {
                botToken: '987654321:XYZabcDEFghiJKLmnoSTUvwxYZ',
                webhookSecret: 'new-webhook-secret-0987654321'
            };

            mockDatabase.get = vi.fn().mockResolvedValue({});
            mockDatabase.set = vi.fn().mockResolvedValue(undefined);

            await service.saveConfig(configToSave);

            expect(mockDatabase.set).toHaveBeenCalledWith('bot-config', configToSave);
            expect(mockLogger.info).toHaveBeenCalledWith('Bot configuration updated successfully');
        });

        it('should merge with existing config when saving partial updates', async () => {
            const existingConfig = {
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
                webhookSecret: 'old-secret',
                rateLimitPerUser: 10
            };

            const partialUpdate = {
                webhookSecret: 'new-secret'
            };

            mockDatabase.get = vi.fn().mockResolvedValue(existingConfig);
            mockDatabase.set = vi.fn().mockResolvedValue(undefined);

            await service.saveConfig(partialUpdate);

            // Should preserve botToken, update webhookSecret
            expect(mockDatabase.set).toHaveBeenCalledWith('bot-config', {
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
                webhookSecret: 'new-secret',
                rateLimitPerUser: 10
            });
        });

        it('should invalidate cache after saving', async () => {
            mockDatabase.get = vi.fn().mockResolvedValue({
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
            });
            mockDatabase.set = vi.fn().mockResolvedValue(undefined);

            // Load config to populate cache
            await service.loadConfig();
            expect(mockDatabase.get).toHaveBeenCalledTimes(1);

            // Save new config (this calls get() once to merge with existing config)
            await service.saveConfig({ webhookSecret: 'new-secret' });
            expect(mockDatabase.get).toHaveBeenCalledTimes(2); // 1 from load, 1 from save

            // Next load should hit database again (cache invalidated)
            await service.loadConfig();
            expect(mockDatabase.get).toHaveBeenCalledTimes(3); // 1 from load, 1 from save, 1 from second load
        });

        it('should validate bot token format when saving', async () => {
            const invalidToken = 'not-a-valid-token';

            await expect(service.saveConfig({ botToken: invalidToken }))
                .rejects
                .toThrow('Invalid bot token format');
        });

        it('should accept valid bot token format', async () => {
            const validToken = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz-1234567890';

            mockDatabase.get = vi.fn().mockResolvedValue({});
            mockDatabase.set = vi.fn().mockResolvedValue(undefined);

            await expect(service.saveConfig({ botToken: validToken }))
                .resolves
                .not.toThrow();
        });

        it('should reject bot token without colon separator', async () => {
            const invalidToken = '123456789ABCdefGHIjklMNOpqrsTUVwxyz';

            await expect(service.saveConfig({ botToken: invalidToken }))
                .rejects
                .toThrow('Invalid bot token format');
        });

        it('should reject suspiciously short bot token', async () => {
            const shortToken = '123:ABC';

            await expect(service.saveConfig({ botToken: shortToken }))
                .rejects
                .toThrow('Bot token is suspiciously short');
        });
    });

    describe('Masked Configuration', () => {
        it('should mask bot token in getMaskedConfig()', async () => {
            const dbConfig = {
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
                webhookSecret: 'test-webhook-secret-1234567890'
            };

            mockDatabase.get = vi.fn().mockResolvedValue(dbConfig);

            const maskedConfig = await service.getMaskedConfig();

            // Bot token should show only last 6 characters
            expect(maskedConfig.botToken).toBe('******UVwxyz'); // Last 6 chars of "...rsTUVwxyz"
            expect(maskedConfig.botTokenConfigured).toBe(true);

            // Webhook secret should show only last 6 characters
            expect(maskedConfig.webhookSecret).toBe('******567890');
            expect(maskedConfig.webhookSecretConfigured).toBe(true);
        });

        it('should return undefined for missing credentials', async () => {
            mockDatabase.get = vi.fn().mockResolvedValue({
                rateLimitPerUser: 10
            });

            const maskedConfig = await service.getMaskedConfig();

            expect(maskedConfig.botToken).toBeUndefined();
            expect(maskedConfig.botTokenConfigured).toBe(false);
            expect(maskedConfig.webhookSecret).toBeUndefined();
            expect(maskedConfig.webhookSecretConfigured).toBe(false);
        });

        it('should preserve non-sensitive config values', async () => {
            const dbConfig = {
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
                rateLimitPerUser: 5,
                rateLimitWindowMs: 30000
            };

            mockDatabase.get = vi.fn().mockResolvedValue(dbConfig);

            const maskedConfig = await service.getMaskedConfig();

            expect(maskedConfig.rateLimitPerUser).toBe(5);
            expect(maskedConfig.rateLimitWindowMs).toBe(30000);
        });

        it('should handle very short tokens gracefully', async () => {
            // This shouldn't happen in production (validation prevents it),
            // but masking logic should handle edge cases
            const dbConfig = {
                botToken: '12:ABC' // Too short, but test masking anyway
            };

            mockDatabase.get = vi.fn().mockResolvedValue(dbConfig);

            const maskedConfig = await service.getMaskedConfig();

            // Should mask completely if token is too short
            expect(maskedConfig.botToken).toBe('******');
        });
    });

    describe('Bot Token and Webhook Secret Getters', () => {
        it('should return bot token from getBotToken()', async () => {
            const dbConfig = {
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
            };

            mockDatabase.get = vi.fn().mockResolvedValue(dbConfig);

            const botToken = await service.getBotToken();

            expect(botToken).toBe('123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
        });

        it('should return undefined when bot token not configured', async () => {
            mockDatabase.get = vi.fn().mockResolvedValue({});

            const botToken = await service.getBotToken();

            expect(botToken).toBeUndefined();
        });

        it('should return webhook secret from getWebhookSecret()', async () => {
            const dbConfig = {
                webhookSecret: 'test-webhook-secret-1234567890'
            };

            mockDatabase.get = vi.fn().mockResolvedValue(dbConfig);

            const webhookSecret = await service.getWebhookSecret();

            expect(webhookSecret).toBe('test-webhook-secret-1234567890');
        });

        it('should return undefined when webhook secret not configured', async () => {
            mockDatabase.get = vi.fn().mockResolvedValue({});

            const webhookSecret = await service.getWebhookSecret();

            expect(webhookSecret).toBeUndefined();
        });
    });

    describe('Client Initialization', () => {
        it('should initialize client when bot token is configured', async () => {
            const dbConfig = {
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
            };

            mockDatabase.get = vi.fn().mockResolvedValue(dbConfig);

            const initialized = await service.initialize();

            expect(initialized).toBe(true);
            expect(service.isReady()).toBe(true);
            expect(service.getClient()).not.toBeNull();
            expect(mockLogger.info).toHaveBeenCalledWith('Telegram client initialized successfully');
        });

        it('should return false when bot token not configured', async () => {
            mockDatabase.get = vi.fn().mockResolvedValue({});

            const initialized = await service.initialize();

            expect(initialized).toBe(false);
            expect(service.isReady()).toBe(false);
            expect(service.getClient()).toBeNull();
            expect(mockLogger.warn).toHaveBeenCalledWith('Bot token not configured, Telegram client not initialized');
        });

        it('should reload client with new bot token', async () => {
            // Initial config
            mockDatabase.get = vi.fn().mockResolvedValue({
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
            });

            await service.initialize();
            const firstClient = service.getClient();
            expect(firstClient).not.toBeNull();

            // Update config with new token
            mockDatabase.get = vi.fn().mockResolvedValue({
                botToken: '987654321:XYZabcDEFghiJKLmnoSTUvwxYZ'
            });

            const reloaded = await service.reloadClient();

            expect(reloaded).toBe(true);
            expect(service.getClient()).not.toBeNull();
            expect(service.getClient()).not.toBe(firstClient); // New client instance
            expect(mockLogger.info).toHaveBeenCalledWith('Telegram client reloaded with updated configuration');
        });

        it('should clear client when reloading with no token', async () => {
            // Initial config with token
            mockDatabase.get = vi.fn().mockResolvedValue({
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
            });

            await service.initialize();
            expect(service.getClient()).not.toBeNull();

            // Update config to remove token
            mockDatabase.get = vi.fn().mockResolvedValue({});

            const reloaded = await service.reloadClient();

            expect(reloaded).toBe(false);
            expect(service.getClient()).toBeNull();
            expect(mockLogger.warn).toHaveBeenCalledWith('Bot token not configured, Telegram client cannot be reloaded');
        });

        it('should invalidate cache when reloading client', async () => {
            mockDatabase.get = vi.fn().mockResolvedValue({
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
            });

            await service.initialize();
            expect(mockDatabase.get).toHaveBeenCalledTimes(1);

            // Reload should clear cache and fetch fresh config
            await service.reloadClient();
            expect(mockDatabase.get).toHaveBeenCalledTimes(2);
        });
    });

    describe('Message Sending', () => {
        it('should throw error when sending message without initialized client', async () => {
            mockDatabase.get = vi.fn().mockResolvedValue({});
            await service.initialize();

            await expect(service.sendMessage('123456', 'Test message'))
                .rejects
                .toThrow('Telegram client not initialized');
        });

        it('should throw error when sending notification without initialized client', async () => {
            mockDatabase.get = vi.fn().mockResolvedValue({});
            await service.initialize();

            await expect(service.sendNotification(123456, 'Test notification'))
                .rejects
                .toThrow('Telegram client not initialized');
        });

        it('should return false for isSubscribed when not implemented', async () => {
            mockDatabase.get = vi.fn().mockResolvedValue({
                botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
            });
            await service.initialize();

            const isSubscribed = await service.isSubscribed(123456, 'whale-alerts');

            expect(isSubscribed).toBe(false);
            expect(mockLogger.info).toHaveBeenCalledWith(
                { telegramUserId: 123456, subscriptionType: 'whale-alerts' },
                'TelegramBotService.isSubscribed called (not yet implemented)'
            );
        });
    });
});
