/**
 * @fileoverview Tests for the central per-user settings store.
 *
 * Exercises the programmatic read/write path (single, namespace, and batch
 * reads, plus default fallback), the definition registry that gates the
 * self-service surface, and the singleton lifecycle — all against the in-memory
 * database mock so no live MongoDB is needed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { UserSettingsService } from '../services/user-settings.service.js';

/** No-op logger satisfying ISystemLogService for the service under test. */
function silentLogger(): ISystemLogService {
    const noop = (): void => undefined;
    const logger = {
        info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
        child: () => logger
    } as unknown as ISystemLogService;
    return logger;
}

describe('UserSettingsService', () => {
    let db: ReturnType<typeof createMockDatabaseService>;
    let service: UserSettingsService;

    beforeEach(() => {
        db = createMockDatabaseService();
        UserSettingsService.resetForTests();
        UserSettingsService.setDependencies(db, silentLogger());
        service = UserSettingsService.getInstance();
    });

    describe('singleton lifecycle', () => {
        it('returns the same instance and throws before configuration', () => {
            expect(UserSettingsService.getInstance()).toBe(service);
            UserSettingsService.resetForTests();
            expect(() => UserSettingsService.getInstance()).toThrow(/setDependencies/);
        });
    });

    describe('programmatic read/write', () => {
        it('round-trips a value under (userId, namespace, key)', async () => {
            await service.set('user1', 'core', 'theme', 'dark');
            expect(await service.get('user1', 'core', 'theme')).toBe('dark');
        });

        it('upserts in place rather than duplicating', async () => {
            await service.set('user1', 'core', 'theme', 'dark');
            await service.set('user1', 'core', 'theme', 'light');
            expect(await service.get('user1', 'core', 'theme')).toBe('light');
        });

        it('isolates values by user, namespace, and key', async () => {
            await service.set('user1', 'core', 'theme', 'dark');
            expect(await service.get('user2', 'core', 'theme')).toBeNull();
            expect(await service.get('user1', 'core', 'lang')).toBeNull();
            expect(await service.get('user1', 'other', 'theme')).toBeNull();
        });

        it('reads every key in a namespace at once', async () => {
            await service.set('user1', 'core', 'theme', 'dark');
            await service.set('user1', 'core', 'lang', 'en');
            await service.set('user1', 'other', 'x', 1);
            expect(await service.getNamespace('user1', 'core')).toEqual({ theme: 'dark', lang: 'en' });
        });

        it('batch-reads one setting across many users, omitting those without a row', async () => {
            await service.set('user1', 'notifications', 'preferences', { mutedAll: true, overrides: {} });
            await service.set('user3', 'notifications', 'preferences', { mutedAll: false, overrides: {} });

            const map = await service.getForUsers(['user1', 'user2', 'user3'], 'notifications', 'preferences');
            expect(map.get('user1')).toEqual({ mutedAll: true, overrides: {} });
            expect(map.has('user2')).toBe(false);
            expect(map.get('user3')).toEqual({ mutedAll: false, overrides: {} });
        });

        it('returns an empty map for an empty user list without querying', async () => {
            expect((await service.getForUsers([], 'core', 'theme')).size).toBe(0);
        });

        it('deletes a value, reverting to null', async () => {
            await service.set('user1', 'core', 'theme', 'dark');
            await service.delete('user1', 'core', 'theme');
            expect(await service.get('user1', 'core', 'theme')).toBeNull();
        });
    });

    describe('definition registry', () => {
        it('falls back to the registered default when no row exists', async () => {
            service.registerDefinition({
                namespace: 'core', key: 'theme', label: 'Theme', userWritable: true,
                validate: (v) => v === 'dark' || v === 'light', defaultValue: 'light'
            });
            expect(await service.get('user1', 'core', 'theme')).toBe('light');
            await service.set('user1', 'core', 'theme', 'dark');
            expect(await service.get('user1', 'core', 'theme')).toBe('dark');
        });

        it('exposes and replaces definitions by (namespace, key)', () => {
            const validate = (): boolean => true;
            service.registerDefinition({ namespace: 'core', key: 'theme', label: 'Theme', userWritable: true, validate });
            expect(service.getDefinition('core', 'theme')?.label).toBe('Theme');
            service.registerDefinition({ namespace: 'core', key: 'theme', label: 'Appearance', userWritable: false, validate });
            expect(service.getDefinition('core', 'theme')?.label).toBe('Appearance');
            expect(service.getDefinition('core', 'theme')?.userWritable).toBe(false);
            expect(service.listDefinitions()).toHaveLength(1);
        });

        it('returns undefined for an unregistered definition', () => {
            expect(service.getDefinition('core', 'missing')).toBeUndefined();
        });
    });
});
