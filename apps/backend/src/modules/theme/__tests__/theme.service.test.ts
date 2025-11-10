/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ThemeService } from '../services/theme.service.js';
import type { ICacheService, ISystemLogService } from '@tronrelic/types';
import type { IThemeDocument, ICreateThemeInput, IUpdateThemeInput } from '../database/index.js';
import { ObjectId } from 'mongodb';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

/**
 * Mock CacheService for testing Redis operations with tag support.
 *
 * Simulates the two-level cache strategy:
 * - Individual theme keys: themes:id:{uuid}
 * - Active themes list: themes:active
 * - Tag-based invalidation for cleanup
 */
class MockCacheService implements ICacheService {
    private cache = new Map<string, { value: any; ttl?: number; tags?: string[] }>();

    async get<T = any>(key: string): Promise<T | null> {
        const entry = this.cache.get(key);
        return entry ? entry.value : null;
    }

    async set<T = any>(key: string, value: T, ttl?: number, tags?: string[]): Promise<void> {
        this.cache.set(key, { value, ttl, tags });
    }

    async del(key: string): Promise<number> {
        const deleted = this.cache.delete(key);
        return deleted ? 1 : 0;
    }

    /**
     * Invalidate all cache entries with matching tag.
     * Simulates CacheService behavior of searching by tags array.
     */
    async invalidate(tag: string): Promise<void> {
        const keysToDelete: string[] = [];

        for (const [key, entry] of this.cache.entries()) {
            if (entry.tags && entry.tags.includes(tag)) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            this.cache.delete(key);
        }
    }

    async keys(pattern: string): Promise<string[]> {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return Array.from(this.cache.keys()).filter(k => regex.test(k));
    }

    /**
     * Test helper: Get cache entry with metadata.
     */
    getEntry(key: string) {
        return this.cache.get(key);
    }

    /**
     * Test helper: Clear all cache entries.
     */
    clear(): void {
        this.cache.clear();
    }
}


/**
 * Mock SystemLogService for testing logging operations.
 *
 * Supports both signatures:
 * - log(level, message, metadata)
 * - info/warn/error/debug(metadata, message) OR (message, metadata)
 */
class MockSystemLogService implements ISystemLogService {
    public logs: Array<{ level: string; message: string; metadata?: any }> = [];
    public level: string = 'info';

    info(messageOrMetadata: string | any, metadataOrMessage?: any): void {
        if (typeof messageOrMetadata === 'string') {
            this.logs.push({ level: 'info', message: messageOrMetadata, metadata: metadataOrMessage });
        } else {
            this.logs.push({ level: 'info', message: metadataOrMessage, metadata: messageOrMetadata });
        }
    }

    warn(messageOrMetadata: string | any, metadataOrMessage?: any): void {
        if (typeof messageOrMetadata === 'string') {
            this.logs.push({ level: 'warn', message: messageOrMetadata, metadata: metadataOrMessage });
        } else {
            this.logs.push({ level: 'warn', message: metadataOrMessage, metadata: messageOrMetadata });
        }
    }

    error(messageOrMetadata: string | any, metadataOrMessage?: any): void {
        if (typeof messageOrMetadata === 'string') {
            this.logs.push({ level: 'error', message: messageOrMetadata, metadata: metadataOrMessage });
        } else {
            this.logs.push({ level: 'error', message: metadataOrMessage, metadata: messageOrMetadata });
        }
    }

    debug(messageOrMetadata: string | any, metadataOrMessage?: any): void {
        if (typeof messageOrMetadata === 'string') {
            this.logs.push({ level: 'debug', message: messageOrMetadata, metadata: metadataOrMessage });
        } else {
            this.logs.push({ level: 'debug', message: metadataOrMessage, metadata: messageOrMetadata });
        }
    }

    trace(messageOrMetadata: string | any, metadataOrMessage?: any): void {
        if (typeof messageOrMetadata === 'string') {
            this.logs.push({ level: 'trace', message: messageOrMetadata, metadata: metadataOrMessage });
        } else {
            this.logs.push({ level: 'trace', message: metadataOrMessage, metadata: messageOrMetadata });
        }
    }

    fatal(messageOrMetadata: string | any, metadataOrMessage?: any): void {
        if (typeof messageOrMetadata === 'string') {
            this.logs.push({ level: 'fatal', message: messageOrMetadata, metadata: metadataOrMessage });
        } else {
            this.logs.push({ level: 'fatal', message: metadataOrMessage, metadata: messageOrMetadata });
        }
    }

    child(bindings: Record<string, any>): ISystemLogService {
        return this;
    }

    async initialize(logger?: any): Promise<void> {
        // No-op for tests
    }

    async saveLog(data: any): Promise<void> {
        // No-op for tests
    }

    async getLogs(query: any): Promise<any> {
        return {
            logs: [],
            total: 0,
            page: 1,
            limit: 50,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false
        };
    }

    async markAsResolved(logId: string, resolvedBy: string): Promise<void> {
        // No-op for tests
    }

    async cleanup(): Promise<number> {
        return 0;
    }

    async getStatistics(): Promise<any> {
        return {
            total: 0,
            byLevel: {},
            byService: {},
            unresolved: 0
        };
    }

    async getLogById(id: string): Promise<any> {
        return null;
    }

    async markAsUnresolved(id: string): Promise<any> {
        return null;
    }

    async deleteAllLogs(): Promise<number> {
        return 0;
    }

    async getStats(): Promise<any> {
        return {
            total: 0,
            byLevel: {},
            resolved: 0,
            unresolved: 0
        };
    }

    clear(): void {
        this.logs = [];
    }
}

describe('ThemeService', () => {
    let themeService: ThemeService;
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCacheService;
    let mockLogger: MockSystemLogService;

    beforeEach(() => {
        mockDatabase = createMockDatabaseService();
        mockCache = new MockCacheService();
        mockLogger = new MockSystemLogService();

        // Reset singleton instance
        (ThemeService as any).instance = undefined;

        // Initialize service
        ThemeService.setDependencies(mockDatabase, mockCache, mockLogger);
        themeService = ThemeService.getInstance();
    });

    afterEach(() => {
        mockDatabase.clear();
        mockCache.clear();
        mockLogger.clear();
    });

    describe('Singleton Pattern', () => {
        it('should return the same instance on multiple calls', () => {
            const instance1 = ThemeService.getInstance();
            const instance2 = ThemeService.getInstance();

            expect(instance1).toBe(instance2);
        });

        it('should throw error if getInstance called before setDependencies', () => {
            (ThemeService as any).instance = undefined;

            expect(() => ThemeService.getInstance()).toThrow(
                'ThemeService.setDependencies() must be called before getInstance()'
            );
        });
    });

    describe('createTheme', () => {
        it('should create a new theme with default values', async () => {
            const input: ICreateThemeInput = {
                name: 'Test Theme',
                icon: 'Sparkles',
                css: ':root { --color: blue; }'
            };

            const theme = await themeService.createTheme(input);

            expect(theme.name).toBe('Test Theme');
            expect(theme.css).toBe(':root { --color: blue; }');
            expect(theme.dependencies).toEqual([]);
            expect(theme.isActive).toBe(false);
            expect(theme.id).toBeDefined();
            expect(theme.createdAt).toBeInstanceOf(Date);
            expect(theme.updatedAt).toBeInstanceOf(Date);
        });

        it('should create a theme with custom dependencies and active status', async () => {
            const input: ICreateThemeInput = {
                name: 'Dependent Theme',
                icon: 'Link',
                css: ':root { --size: 10px; }',
                dependencies: ['theme-uuid-1'],
                isActive: true
            };

            const theme = await themeService.createTheme(input);

            expect(theme.dependencies).toEqual(['theme-uuid-1']);
            expect(theme.isActive).toBe(true);
        });

        it('should invalidate active cache when creating active theme', async () => {
            const input: ICreateThemeInput = {
                name: 'Active Theme',
                icon: 'Check',
                css: ':root { --test: 1; }',
                isActive: true
            };

            // Pre-populate cache
            await mockCache.set('themes:active', ['old-id'], 3600, ['themes:active']);

            await themeService.createTheme(input);

            // Cache should be cleared
            const cachedIds = await mockCache.get('themes:active');
            expect(cachedIds).toBeNull();
        });

        it('should not invalidate cache when creating inactive theme', async () => {
            const input: ICreateThemeInput = {
                name: 'Inactive Theme',
                icon: 'X',
                css: ':root { --test: 1; }',
                isActive: false
            };

            // Pre-populate cache
            await mockCache.set('themes:active', ['old-id'], 3600, ['themes:active']);

            await themeService.createTheme(input);

            // Cache should remain
            const cachedIds = await mockCache.get('themes:active');
            expect(cachedIds).toEqual(['old-id']);
        });

        it('should accept client-provided valid UUID v4', async () => {
            const clientId = '550e8400-e29b-41d4-a716-446655440000';
            const input: ICreateThemeInput = {
                id: clientId,
                name: 'Client UUID Theme',
                icon: 'Sparkles',
                css: '[data-theme="550e8400-e29b-41d4-a716-446655440000"] { --color: red; }'
            };

            const theme = await themeService.createTheme(input);

            expect(theme.id).toBe(clientId);
            expect(theme.name).toBe('Client UUID Theme');

            // Verify debug log was created
            const debugLogs = mockLogger.logs.filter(l => l.level === 'debug');
            const hasClientUuidLog = debugLogs.some(log =>
                log.metadata?.themeId === clientId
            );
            expect(hasClientUuidLog).toBe(true);
        });

        it('should reject invalid UUID format', async () => {
            const input: ICreateThemeInput = {
                id: 'not-a-valid-uuid',
                name: 'Invalid UUID Theme',
                icon: 'X',
                css: ':root { }'
            };

            await expect(themeService.createTheme(input)).rejects.toThrow(
                'Invalid UUID format. Must be a valid UUID v4.'
            );
        });

        it('should reject non-v4 UUID', async () => {
            const input: ICreateThemeInput = {
                id: '550e8400-e29b-11d4-a716-446655440000', // v1 UUID (notice "1" in version position)
                name: 'UUID v1 Theme',
                icon: 'X',
                css: ':root { }'
            };

            await expect(themeService.createTheme(input)).rejects.toThrow(
                'Invalid UUID format. Must be a valid UUID v4.'
            );
        });

        it('should reject duplicate client-provided UUID', async () => {
            const clientId = '550e8400-e29b-41d4-a716-446655440000';

            // Create first theme with this UUID
            await themeService.createTheme({
                id: clientId,
                name: 'First Theme',
                icon: 'Check',
                css: ':root { }'
            });

            // Attempt to create second theme with same UUID
            await expect(
                themeService.createTheme({
                    id: clientId,
                    name: 'Second Theme',
                    icon: 'X',
                    css: ':root { }'
                })
            ).rejects.toThrow(`Theme with ID "${clientId}" already exists`);
        });

        it('should handle both client-provided and server-generated UUIDs in same session', async () => {
            const clientId = '550e8400-e29b-41d4-a716-446655440000';

            // Create theme with client UUID
            const theme1 = await themeService.createTheme({
                id: clientId,
                name: 'Client UUID',
                icon: 'User',
                css: ':root { }'
            });

            // Create theme with server-generated UUID
            const theme2 = await themeService.createTheme({
                name: 'Server UUID',
                icon: 'Server',
                css: ':root { }'
            });

            expect(theme1.id).toBe(clientId);
            expect(theme2.id).toBeDefined();
            expect(theme2.id).not.toBe(clientId);
        });
    });

    describe('updateTheme', () => {
        let existingTheme: IThemeDocument;

        beforeEach(async () => {
            existingTheme = await themeService.createTheme({
                name: 'Original Theme',
                icon: 'Sparkles',
                css: ':root { --original: true; }',
                isActive: true
            });

            // Clear cache after creation
            mockCache.clear();
        });

        it('should update theme name and CSS', async () => {
            const update: IUpdateThemeInput = {
                name: 'Updated Theme',
                css: ':root { --updated: true; }'
            };

            const updated = await themeService.updateTheme(existingTheme.id, update);

            expect(updated.name).toBe('Updated Theme');
            expect(updated.css).toBe(':root { --updated: true; }');
            expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(existingTheme.updatedAt.getTime());
        });

        it('should invalidate both theme-specific and active cache when updating active theme', async () => {
            // Pre-populate cache
            await mockCache.set(`themes:id:${existingTheme.id}`, existingTheme, 3600, ['themes:active', existingTheme.id]);
            await mockCache.set('themes:active', [existingTheme.id], 3600, ['themes:active']);

            await themeService.updateTheme(existingTheme.id, { css: ':root { --new: true; }' });

            // Both caches should be cleared
            const themeCache = await mockCache.get(`themes:id:${existingTheme.id}`);
            const activeCache = await mockCache.get('themes:active');

            expect(themeCache).toBeNull();
            expect(activeCache).toBeNull();
        });

        it('should only invalidate theme-specific cache when updating inactive theme', async () => {
            // Make theme inactive
            await themeService.updateTheme(existingTheme.id, { isActive: false });
            mockCache.clear();

            // Pre-populate cache
            await mockCache.set(`themes:id:${existingTheme.id}`, existingTheme, 3600, [existingTheme.id]);
            await mockCache.set('themes:active', ['other-id'], 3600, ['themes:active']);

            await themeService.updateTheme(existingTheme.id, { css: ':root { --new: true; }' });

            // Theme cache cleared, active cache preserved
            const themeCache = await mockCache.get(`themes:id:${existingTheme.id}`);
            const activeCache = await mockCache.get('themes:active');

            expect(themeCache).toBeNull();
            expect(activeCache).toEqual(['other-id']);
        });

        it('should throw error when updating non-existent theme', async () => {
            await expect(
                themeService.updateTheme('non-existent-id', { name: 'Test' })
            ).rejects.toThrow('Theme with id "non-existent-id" not found');
        });
    });

    describe('deleteTheme', () => {
        let theme1: IThemeDocument;
        let theme2: IThemeDocument;

        beforeEach(async () => {
            theme1 = await themeService.createTheme({
                name: 'Theme 1',
                icon: 'Sparkles',
                css: ':root { --theme1: true; }',
                isActive: true
            });

            theme2 = await themeService.createTheme({
                name: 'Theme 2',
                icon: 'Ghost',
                css: ':root { --theme2: true; }',
                dependencies: [theme1.id],
                isActive: true
            });

            mockCache.clear();
        });

        it('should delete inactive theme without dependencies', async () => {
            const inactiveTheme = await themeService.createTheme({
                name: 'Inactive',
                icon: 'Moon',
                css: ':root { }',
                isActive: false
            });

            await themeService.deleteTheme(inactiveTheme.id);

            const themes = await themeService.listThemes();
            expect(themes.find(t => t.id === inactiveTheme.id)).toBeUndefined();
        });

        it('should fail to delete theme with dependent themes', async () => {
            await expect(
                themeService.deleteTheme(theme1.id)
            ).rejects.toThrow(/Cannot delete theme.*dependency of active themes/);
        });

        it('should invalidate caches when deleting active theme', async () => {
            // Pre-populate cache
            await mockCache.set(`themes:id:${theme2.id}`, theme2, 3600, ['themes:active', theme2.id]);
            await mockCache.set('themes:active', [theme1.id, theme2.id], 3600, ['themes:active']);

            // Delete theme2 (has no dependents)
            await themeService.deleteTheme(theme2.id);

            // Both caches should be cleared
            const themeCache = await mockCache.get(`themes:id:${theme2.id}`);
            const activeCache = await mockCache.get('themes:active');

            expect(themeCache).toBeNull();
            expect(activeCache).toBeNull();
        });
    });

    describe('getActiveThemes - Two-Level Cache', () => {
        let theme1: IThemeDocument;
        let theme2: IThemeDocument;
        let theme3: IThemeDocument;

        beforeEach(async () => {
            theme1 = await themeService.createTheme({
                name: 'Theme 1',
                icon: 'Sparkles',
                css: ':root { --theme1: red; }',
                isActive: true
            });

            theme2 = await themeService.createTheme({
                name: 'Theme 2',
                icon: 'Ghost',
                css: ':root { --theme2: blue; }',
                dependencies: [theme1.id],
                isActive: true
            });

            theme3 = await themeService.createTheme({
                name: 'Theme 3',
                icon: 'Moon',
                css: ':root { --theme3: green; }',
                isActive: false // inactive
            });

            mockCache.clear();
        });

        it('should fetch from database on cache miss and populate two-level cache', async () => {
            const result = await themeService.getActiveThemes();

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe(theme1.id); // Dependency first
            expect(result[1].id).toBe(theme2.id);

            // Verify Level 1: Active IDs list cached
            const cachedIds = await mockCache.get<string[]>('themes:active');
            expect(cachedIds).toEqual([theme1.id, theme2.id]);

            // Verify Level 2: Individual themes cached
            const cachedTheme1 = await mockCache.get(`themes:id:${theme1.id}`);
            const cachedTheme2 = await mockCache.get(`themes:id:${theme2.id}`);

            expect(cachedTheme1).toEqual({ id: theme1.id, name: theme1.name, icon: theme1.icon, css: theme1.css });
            expect(cachedTheme2).toEqual({ id: theme2.id, name: theme2.name, icon: theme2.icon, css: theme2.css });

            // Verify tags
            const entry1 = mockCache.getEntry(`themes:id:${theme1.id}`);
            const entry2 = mockCache.getEntry(`themes:id:${theme2.id}`);
            const entryList = mockCache.getEntry('themes:active');

            expect(entry1?.tags).toEqual(['themes:active', theme1.id]);
            expect(entry2?.tags).toEqual(['themes:active', theme2.id]);
            expect(entryList?.tags).toEqual(['themes:active']);
        });

        it('should serve from two-level cache on cache hit', async () => {
            // First call: populate cache
            await themeService.getActiveThemes();

            // Clear database to prove we're using cache
            mockDatabase.clear();

            // Second call: should use cache
            const result = await themeService.getActiveThemes();

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe(theme1.id);
            expect(result[1].id).toBe(theme2.id);
        });

        it('should fall back to database if individual theme cache missing', async () => {
            // Manually set only the IDs list, not individual themes
            await mockCache.set('themes:active', [theme1.id, theme2.id], 3600, ['themes:active']);

            const result = await themeService.getActiveThemes();

            expect(result).toHaveLength(2);

            // Cache should now be fully populated
            const cachedTheme1 = await mockCache.get(`themes:id:${theme1.id}`);
            const cachedTheme2 = await mockCache.get(`themes:id:${theme2.id}`);

            expect(cachedTheme1).toBeDefined();
            expect(cachedTheme2).toBeDefined();
        });

        it('should return empty array when no active themes', async () => {
            // Deactivate all themes
            await themeService.updateTheme(theme1.id, { isActive: false });
            await themeService.updateTheme(theme2.id, { isActive: false });
            mockCache.clear();

            const result = await themeService.getActiveThemes();

            expect(result).toEqual([]);

            // Empty result should be cached
            const cachedIds = await mockCache.get('themes:active');
            expect(cachedIds).toEqual([]);
        });

        it('should order themes by dependencies (topological sort)', async () => {
            const result = await themeService.getActiveThemes();

            // theme1 should come before theme2 (dependency order)
            const index1 = result.findIndex(t => t.id === theme1.id);
            const index2 = result.findIndex(t => t.id === theme2.id);

            expect(index1).toBeLessThan(index2);
        });
    });

    describe('Cache Invalidation by Tag', () => {
        let theme1: IThemeDocument;
        let theme2: IThemeDocument;

        beforeEach(async () => {
            theme1 = await themeService.createTheme({
                name: 'Theme 1',
                icon: 'Sparkles',
                css: ':root { }',
                isActive: true
            });

            theme2 = await themeService.createTheme({
                name: 'Theme 2',
                icon: 'Ghost',
                css: ':root { }',
                isActive: true
            });

            // Populate cache
            await themeService.getActiveThemes();
        });

        it('should invalidate only specific theme when updating by UUID tag', async () => {
            // Update theme1
            await themeService.updateTheme(theme1.id, { css: ':root { --new: 1; }' });

            // theme1 cache should be cleared
            const theme1Cache = await mockCache.get(`themes:id:${theme1.id}`);
            expect(theme1Cache).toBeNull();

            // Active list should be cleared (batch invalidation)
            const activeCache = await mockCache.get('themes:active');
            expect(activeCache).toBeNull();

            // theme2 individual cache should be cleared (has themes:active tag)
            const theme2Cache = await mockCache.get(`themes:id:${theme2.id}`);
            expect(theme2Cache).toBeNull();
        });

        it('should invalidate all themes when using themes:active tag', async () => {
            // Trigger active cache invalidation
            await themeService.updateTheme(theme1.id, { isActive: false });

            // All caches should be cleared
            const activeCache = await mockCache.get('themes:active');
            const theme1Cache = await mockCache.get(`themes:id:${theme1.id}`);
            const theme2Cache = await mockCache.get(`themes:id:${theme2.id}`);

            expect(activeCache).toBeNull();
            expect(theme1Cache).toBeNull();
            expect(theme2Cache).toBeNull();
        });
    });

    describe('Dependency Resolution', () => {
        it('should throw error on circular dependencies', async () => {
            const theme1 = await themeService.createTheme({
                name: 'Circular Theme 1',
                icon: 'Sparkles',
                css: ':root { }',
                isActive: true
            });

            const theme2 = await themeService.createTheme({
                name: 'Circular Theme 2',
                icon: 'Ghost',
                css: ':root { }',
                dependencies: [theme1.id],
                isActive: true
            });

            // Try to create circular dependency by making theme1 depend on theme2
            // This should fail when getActiveThemes() tries to resolve dependencies
            await themeService.updateTheme(theme1.id, { dependencies: [theme2.id] });

            // Clear cache to force dependency resolution
            mockCache.clear();

            // getActiveThemes() should detect the circular dependency
            await expect(
                themeService.getActiveThemes()
            ).rejects.toThrow(/Circular dependency detected/);
        });

        it('should warn about missing dependencies and continue', async () => {
            await themeService.createTheme({
                name: 'Theme with Missing Dep',
                icon: 'AlertTriangle',
                css: ':root { }',
                dependencies: ['non-existent-uuid'],
                isActive: true
            });

            const result = await themeService.getActiveThemes();

            // Should still return the theme
            expect(result).toHaveLength(1);

            // Should have logged warning
            const warnings = mockLogger.logs.filter(l => l.level === 'warn');
            expect(warnings.length).toBeGreaterThan(0);

            // Check that warning metadata contains reference to missing dependency
            const hasMissingDepWarning = warnings.some(w =>
                w.metadata && w.metadata.missingDepId === 'non-existent-uuid'
            );
            expect(hasMissingDepWarning).toBe(true);
        });
    });

    describe('toggleTheme', () => {
        it('should toggle theme active status', async () => {
            const theme = await themeService.createTheme({
                name: 'Toggle Test',
                icon: 'ToggleLeft',
                css: ':root { }',
                isActive: false
            });

            // Toggle on
            const toggled = await themeService.toggleTheme(theme.id, true);
            expect(toggled.isActive).toBe(true);

            // Toggle off
            const toggledOff = await themeService.toggleTheme(theme.id, false);
            expect(toggledOff.isActive).toBe(false);
        });
    });

    describe('listThemes', () => {
        it('should return all themes regardless of active status', async () => {
            await themeService.createTheme({ name: 'Active', icon: 'Check', css: ':root { }', isActive: true });
            await themeService.createTheme({ name: 'Inactive', icon: 'X', css: ':root { }', isActive: false });

            const all = await themeService.listThemes();

            expect(all).toHaveLength(2);
        });
    });

    describe('getTheme', () => {
        it('should return theme by ID', async () => {
            const created = await themeService.createTheme({ name: 'Test', icon: 'TestTube', css: ':root { }' });

            const found = await themeService.getTheme(created.id);

            expect(found).toBeDefined();
            expect(found?.id).toBe(created.id);
            expect(found?.name).toBe('Test');
        });

        it('should return null for non-existent ID', async () => {
            const found = await themeService.getTheme('non-existent-uuid');

            expect(found).toBeNull();
        });
    });
});
