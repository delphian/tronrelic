/// <reference types="vitest" />

/**
 * @fileoverview Pins how the ClickHouse service derives account passwords.
 *
 * Account passwords are never stored, so the derivation is the only thing
 * that keeps the password ClickHouse holds and the password the backend
 * connects with in step. It has to be stable across restarts, different per
 * account, tied to the root password, and refused before `connect()` has
 * loaded that root password.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { ClickHouseService } from '../services/clickhouse.service.js';

/**
 * Build a service with connection settings set directly, as `connect()`
 * would, without opening a connection.
 *
 * @param password - Root password to derive from.
 * @returns The configured service.
 */
function serviceWithRootPassword(password: string): ClickHouseService {
    ClickHouseService.resetInstance();
    ClickHouseService.setDependencies({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ISystemLogService);
    const service = ClickHouseService.getInstance();
    (service as unknown as { config: unknown }).config = { host: 'http://localhost:8123', database: 'tronrelic', username: 'default', password };

    return service;
}

describe('ClickHouseService account connector', () => {
    beforeEach(() => {
        ClickHouseService.resetInstance();
    });

    it('derives a stable, per-account password hash', () => {
        const service = serviceWithRootPassword('root-secret');
        const first = service.accountPasswordHash('ai-agent');
        expect(first).toMatch(/^[a-f0-9]{64}$/);
        expect(service.accountPasswordHash('ai-agent')).toBe(first);
        expect(service.accountPasswordHash('other')).not.toBe(first);
    });

    it('changes every account password when the root password changes', () => {
        const before = serviceWithRootPassword('root-secret').accountPasswordHash('ai-agent');
        const after = serviceWithRootPassword('rotated-secret').accountPasswordHash('ai-agent');
        expect(after).not.toBe(before);
    });

    it('reports whether a root password is configured', () => {
        expect(serviceWithRootPassword('').hasRootPassword()).toBe(false);
        expect(serviceWithRootPassword('x').hasRootPassword()).toBe(true);
    });

    it('refuses to derive anything before connect()', () => {
        ClickHouseService.setDependencies({ info: vi.fn() } as unknown as ISystemLogService);
        expect(() => ClickHouseService.getInstance().accountPasswordHash('ai-agent')).toThrow(/connect\(\)/);
    });
});
