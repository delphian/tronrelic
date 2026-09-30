/**
 * @fileoverview Tests for revoking a user's connected apps after a group
 * membership change: only a user who is no longer in the group loses their
 * apps, and a failure is logged without rejecting.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { revokeGrantsOnGroupExit } from '../services/revokeGrantsOnGroupExit.js';

/**
 * Build a logger double whose methods are spies.
 *
 * @returns A logger the code under test can call freely.
 */
function buildLogger(): ISystemLogService {
    const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: () => logger
    } as unknown as ISystemLogService;
    return logger;
}

describe('revokeGrantsOnGroupExit', () => {
    it('revokes every app for a user who is no longer in the group', async () => {
        const groups = { isMember: vi.fn(async () => false) };
        const apps = { revokeAllForUser: vi.fn(async () => 2) };
        const logger = buildLogger();

        await revokeGrantsOnGroupExit('u1', 'mcp-users', groups, apps, logger);

        expect(groups.isMember).toHaveBeenCalledWith('u1', 'mcp-users');
        expect(apps.revokeAllForUser).toHaveBeenCalledWith('u1');
        expect(logger.info).toHaveBeenCalled();
    });

    it('leaves a current member\'s apps alone', async () => {
        const apps = { revokeAllForUser: vi.fn(async () => 0) };

        await revokeGrantsOnGroupExit('u1', 'mcp-users', { isMember: async () => true }, apps, buildLogger());

        expect(apps.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('logs an error and resolves when the revocation fails', async () => {
        const logger = buildLogger();
        const apps = { revokeAllForUser: vi.fn(async () => { throw new Error('store down'); }) };

        await expect(revokeGrantsOnGroupExit('u1', 'mcp-users', { isMember: async () => false }, apps, logger))
            .resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalled();
    });
});
