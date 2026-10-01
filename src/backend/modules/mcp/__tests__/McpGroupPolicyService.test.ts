/**
 * @fileoverview Tests for the per-group MCP settings: defaults, validation,
 * the rule that keeps restricted tools off `mcp-users`, and which changes
 * count as widening access.
 */

import { describe, it, expect, vi } from 'vitest';
import { MCP_USERS_GROUP_ID } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { McpGroupPolicyService, defaultGroupPolicy, isWideningPolicyChange } from '../services/McpGroupPolicyService.js';

/** A silent logger. */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;

/** A group service stub that knows `mcp-users` and `admin`. */
const userGroups = {
    getGroup: vi.fn(async (id: string) => ([MCP_USERS_GROUP_ID, 'admin'].includes(id) ? { id, name: id, description: '', system: id === 'admin' } : null)),
    listGroups: vi.fn(async () => [
        { id: 'admin', name: 'Admins', description: '', system: true },
        { id: MCP_USERS_GROUP_ID, name: 'MCP users', description: '', system: false }
    ])
} as any;

/**
 * Build a policy service over a fresh mock database.
 *
 * @returns The service.
 */
function build(): McpGroupPolicyService {
    return new McpGroupPolicyService(createMockDatabaseService(), userGroups, logger);
}

describe('McpGroupPolicyService', () => {
    it('lists every group with everything off, mcp-users first', async () => {
        const groups = await build().listGroups();
        expect(groups.map(group => group.id)).toEqual([MCP_USERS_GROUP_ID, 'admin']);
        expect(groups[0].isGateGroup).toBe(true);
        expect(groups[1].policy).toEqual(defaultGroupPolicy('admin'));
    });

    it('stores a change and returns it from the next read', async () => {
        const service = build();
        const { next } = await service.preview('admin', { scrubSecrets: true, ipAllowlist: [' 203.0.113.7 ', '', '203.0.113.7'] });
        await service.save(next, 'admin-1');
        const stored = service.policyFor(await service.getPolicies(0), 'admin');
        expect(stored).toMatchObject({ scrubSecrets: true, ipAllowlist: ['203.0.113.7'], updatedBy: 'admin-1' });
    });

    it('refuses with 409 a change to a setting another admin changed after it was previewed', async () => {
        const service = build();
        const first = await service.preview('admin', { scrubSecrets: true });
        const second = await service.preview('admin', { scrubSecrets: true });
        await service.save(second.next, 'admin-2', second.previous);
        await expect(service.save(first.next, 'admin-1', first.previous)).rejects.toMatchObject({ status: 409 });
    });

    it('still lets two admins change different settings at the same time', async () => {
        const service = build();
        const scrub = await service.preview('admin', { scrubSecrets: true });
        const restricted = await service.preview('admin', { allowRestrictedTools: true });
        await service.save(scrub.next, 'admin-1', scrub.previous);
        await service.save(restricted.next, 'admin-2', restricted.previous);
        const stored = service.policyFor(await service.getPolicies(0), 'admin');
        expect(stored).toMatchObject({ scrubSecrets: true, allowRestrictedTools: true });
    });

    it('never lets mcp-users allow restricted tools', async () => {
        await expect(build().preview(MCP_USERS_GROUP_ID, { allowRestrictedTools: true })).rejects.toMatchObject({ status: 400 });
    });

    it('refuses an unknown group', async () => {
        await expect(build().preview('no-such-group', { scrubSecrets: true })).rejects.toMatchObject({ status: 404 });
    });

    it('refuses an invalid allowlist entry and switching on an empty allowlist', async () => {
        const service = build();
        await expect(service.preview('admin', { ipAllowlist: ['nope'] })).rejects.toMatchObject({ status: 400 });
        await expect(service.preview('admin', { ipAllowlistEnabled: true })).rejects.toMatchObject({ status: 400 });
    });
});

describe('isWideningPolicyChange', () => {
    const base = defaultGroupPolicy('admin');
    const locked = { ...base, scrubSecrets: true, ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] };

    it('treats switching protections on as narrowing', () => {
        expect(isWideningPolicyChange(base, locked)).toBe(false);
    });

    it('treats allowing restricted tools, dropping a protection, or adding an address as widening', () => {
        expect(isWideningPolicyChange(base, { ...base, allowRestrictedTools: true })).toBe(true);
        expect(isWideningPolicyChange(locked, { ...locked, scrubSecrets: false })).toBe(true);
        expect(isWideningPolicyChange(locked, { ...locked, ipAllowlistEnabled: false })).toBe(true);
        expect(isWideningPolicyChange(locked, { ...locked, ipAllowlist: ['203.0.113.0/24', '198.51.100.1'] })).toBe(true);
    });

    it('treats removing an address or disallowing restricted tools as narrowing', () => {
        expect(isWideningPolicyChange(locked, { ...locked, ipAllowlist: [] })).toBe(false);
        expect(isWideningPolicyChange({ ...base, allowRestrictedTools: true }, base)).toBe(false);
    });
});
