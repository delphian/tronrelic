/**
 * @fileoverview Tests for MCP tool exposure: default-hidden, per-group grants,
 * restricted tools and the group setting that allows them, the IP allowlist,
 * secret scrubbing flags, capability-fingerprint staleness, and what is served.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IAiTool, IAiToolCapability, IAiToolInfo, IDatabaseService } from '@/types';
import { MCP_USERS_GROUP_ID } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { MCP_TOOL_APPROVALS_COLLECTION, McpToolExposureError, McpToolExposureService } from '../services/mcp-tool-exposure.service.js';
import { McpGroupPolicyService } from '../services/McpGroupPolicyService.js';

/** A read-only, internal tool the floor accepts. */
const READ_CAP: IAiToolCapability = { sideEffect: 'read', reversible: true, sensitivity: 'internal' };

/** A read-only tool returning secret data, which the floor restricts. */
const SECRET_CAP: IAiToolCapability = { sideEffect: 'read', reversible: true, sensitivity: 'secret' };

/** Groups the stub group service knows about. */
const KNOWN_GROUPS = [MCP_USERS_GROUP_ID, 'admin', 'ops'];

/** An MCP user who is in no other group. */
const MEMBER = { groups: [MCP_USERS_GROUP_ID] };

/** An MCP user who is also an admin. */
const ADMIN_MEMBER = { groups: [MCP_USERS_GROUP_ID, 'admin'], ip: '203.0.113.7' };

/**
 * Build a tool with the given name and capability.
 *
 * @param name - Tool name.
 * @param capability - Declared capability, or undefined for an unclassified tool.
 * @returns The tool.
 */
function tool(name: string, capability: IAiToolCapability | undefined): IAiTool {
    return {
        name,
        description: `${name} description`,
        inputSchema: { type: 'object', properties: {} },
        capability,
        handler: async () => null
    };
}

/**
 * Build a registry stub over a mutable tool list, all enabled unless listed.
 *
 * @param tools - The registered tools.
 * @param disabled - Names switched off in the registry.
 * @param providers - Owner id per tool name, so ordering by owner can be tested; unlisted tools belong to `test`.
 * @returns A registry with the methods the service calls.
 */
function registry(tools: IAiTool[], disabled: string[] = [], providers: Record<string, string> = {}) {
    return {
        listToolInfo: vi.fn((): IAiToolInfo[] => tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            capability: t.capability,
            enabled: !disabled.includes(t.name),
            provider: providers[t.name] ?? 'test'
        }))),
        getEnabledTools: vi.fn(() => tools.filter(t => !disabled.includes(t.name))),
        getTool: vi.fn((name: string) => tools.find(t => t.name === name))
    } as any;
}

/** A group service stub that knows {@link KNOWN_GROUPS}. */
const userGroups = {
    getGroup: vi.fn(async (id: string) => (KNOWN_GROUPS.includes(id) ? { id, name: id, description: '', system: false } : null)),
    listGroups: vi.fn(async () => KNOWN_GROUPS.map(id => ({ id, name: id, description: '', system: false })))
} as any;

/** A silent logger. */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;

/**
 * Build the exposure service and the policy service it reads, over one database.
 *
 * @param database - The database both services share.
 * @param tools - The registered tools.
 * @param disabled - Names switched off in the registry.
 * @param providers - Owner id per tool name.
 * @returns Both services.
 */
function build(database: IDatabaseService, tools: IAiTool[], disabled: string[] = [], providers: Record<string, string> = {}) {
    const policies = new McpGroupPolicyService(database, userGroups, logger);
    const exposure = new McpToolExposureService(database, registry(tools, disabled, providers), policies, userGroups, logger);
    return { exposure, policies };
}

/**
 * Store a group policy change through the policy service.
 *
 * @param policies - The policy service.
 * @param groupId - The group to change.
 * @param patch - The settings to change.
 * @returns Resolves once stored.
 */
async function setPolicy(policies: McpGroupPolicyService, groupId: string, patch: Parameters<McpGroupPolicyService['preview']>[1]): Promise<void> {
    const { next } = await policies.preview(groupId, patch);
    await policies.save(next, 'admin-1');
}

describe('McpToolExposureService', () => {
    let tools: IAiTool[];
    let database: IDatabaseService;

    beforeEach(() => {
        tools = [
            tool('chain-lookup', READ_CAP),
            tool('log-reader', SECRET_CAP),
            tool('broadcast', { sideEffect: 'external', reversible: true, sensitivity: 'public' }),
            tool('unclassified', undefined)
        ];
        database = createMockDatabaseService();
    });

    it('serves nothing until an admin approves a tool', async () => {
        const { exposure } = build(database, tools);
        expect(await exposure.getServedTools(MEMBER)).toEqual([]);
        const rows = await exposure.listExposures();
        expect(rows.every(row => row.grants.length === 0 && !row.served)).toBe(true);
    });

    it('serves a tool approved for mcp-users to every MCP user', async () => {
        const { exposure } = build(database, tools);
        await exposure.setExposure('chain-lookup', MCP_USERS_GROUP_ID, true, 'admin-1');
        const served = await exposure.getServedTools(MEMBER);
        expect(served.map(entry => entry.tool.name)).toEqual(['chain-lookup']);
        expect(served[0]).toMatchObject({ restricted: false, scrubSecrets: false });
    });

    it('serves a tool approved for another group only to members of that group', async () => {
        const { exposure } = build(database, tools);
        await exposure.setExposure('chain-lookup', 'admin', true, 'admin-1');
        expect(await exposure.getServedTools(MEMBER)).toEqual([]);
        expect((await exposure.getServedTools(ADMIN_MEMBER)).map(entry => entry.tool.name)).toEqual(['chain-lookup']);
    });

    it.each(['log-reader', 'broadcast', 'unclassified'])('never grants restricted tool %s to mcp-users', async (name) => {
        const { exposure } = build(database, tools);
        await expect(exposure.setExposure(name, MCP_USERS_GROUP_ID, true, 'admin-1')).rejects.toMatchObject({ status: 400 });
    });

    it('refuses a restricted tool for a group that does not allow restricted tools', async () => {
        const { exposure } = build(database, tools);
        await expect(exposure.setExposure('log-reader', 'admin', true, 'admin-1')).rejects.toBeInstanceOf(McpToolExposureError);
    });

    it('grants and serves a restricted tool once the group allows restricted tools', async () => {
        const { exposure, policies } = build(database, tools);
        await setPolicy(policies, 'admin', { allowRestrictedTools: true });
        await exposure.setExposure('log-reader', 'admin', true, 'admin-1');
        const served = await exposure.getServedTools(ADMIN_MEMBER);
        expect(served).toEqual([expect.objectContaining({ restricted: true })]);
        expect(served[0].tool.name).toBe('log-reader');
    });

    it('stops serving a restricted grant as soon as the group stops allowing restricted tools', async () => {
        const { exposure, policies } = build(database, tools);
        await setPolicy(policies, 'admin', { allowRestrictedTools: true });
        await exposure.setExposure('log-reader', 'admin', true, 'admin-1');
        await setPolicy(policies, 'admin', { allowRestrictedTools: false });
        expect(await exposure.getServedTools(ADMIN_MEMBER)).toEqual([]);
    });

    it('removes a restricted grant when the group stops allowing restricted tools while it is written', async () => {
        const { exposure, policies } = build(database, tools);
        await setPolicy(policies, 'admin', { allowRestrictedTools: true });
        const allowing = await policies.getPolicies(0);
        vi.spyOn(policies, 'getPolicies').mockResolvedValueOnce(allowing).mockResolvedValueOnce(new Map());
        await expect(exposure.setExposure('log-reader', 'admin', true, 'admin-1')).rejects.toMatchObject({ status: 409 });
        expect((await exposure.listExposures()).find(row => row.name === 'log-reader')?.grants).toEqual([]);
    });

    it('withdraws only the restricted grants of one group', async () => {
        const { exposure, policies } = build(database, tools);
        await setPolicy(policies, 'admin', { allowRestrictedTools: true });
        await exposure.setExposure('log-reader', 'admin', true, 'admin-1');
        await exposure.setExposure('chain-lookup', 'admin', true, 'admin-1');
        expect(await exposure.withdrawRestrictedGrants('admin', 'admin-1')).toBe(1);
        const rows = await exposure.listExposures();
        expect(rows.find(row => row.name === 'log-reader')?.grants).toEqual([]);
        expect(rows.find(row => row.name === 'chain-lookup')?.grants.map(grant => grant.groupId)).toEqual(['admin']);
    });

    it('serves a group grant only from an address on the group\'s allowlist', async () => {
        const { exposure, policies } = build(database, tools);
        await setPolicy(policies, 'admin', { ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] });
        await exposure.setExposure('chain-lookup', 'admin', true, 'admin-1');
        expect(await exposure.getServedTools({ groups: ADMIN_MEMBER.groups, ip: '203.0.113.7' })).toHaveLength(1);
        expect(await exposure.getServedTools({ groups: ADMIN_MEMBER.groups, ip: '::ffff:203.0.113.7' })).toHaveLength(1);
        expect(await exposure.getServedTools({ groups: ADMIN_MEMBER.groups, ip: '198.51.100.1' })).toEqual([]);
        expect(await exposure.getServedTools({ groups: ADMIN_MEMBER.groups })).toEqual([]);
    });

    it('still serves a tool another group grants without an allowlist', async () => {
        const { exposure, policies } = build(database, tools);
        await setPolicy(policies, 'admin', { ipAllowlistEnabled: true, ipAllowlist: ['203.0.113.0/24'] });
        await exposure.setExposure('chain-lookup', 'admin', true, 'admin-1');
        await exposure.setExposure('chain-lookup', MCP_USERS_GROUP_ID, true, 'admin-1');
        expect(await exposure.getServedTools({ groups: ADMIN_MEMBER.groups, ip: '198.51.100.1' })).toHaveLength(1);
    });

    it('scrubs a tool when any group serving it asks for scrubbing', async () => {
        const { exposure, policies } = build(database, tools);
        await setPolicy(policies, 'admin', { scrubSecrets: true });
        await exposure.setExposure('chain-lookup', 'admin', true, 'admin-1');
        await exposure.setExposure('chain-lookup', MCP_USERS_GROUP_ID, true, 'admin-1');
        expect((await exposure.getServedTools(ADMIN_MEMBER))[0].scrubSecrets).toBe(true);
        expect((await exposure.getServedTools(MEMBER))[0].scrubSecrets).toBe(false);
    });

    it('does not count a grant left on a deleted group as served', async () => {
        const { exposure } = build(database, tools);
        await exposure.setExposure('chain-lookup', 'ops', true, 'admin-1');
        userGroups.listGroups.mockResolvedValueOnce(KNOWN_GROUPS.filter(id => id !== 'ops').map(id => ({ id, name: id, description: '', system: false })));
        const row = (await exposure.listExposures()).find(entry => entry.name === 'chain-lookup');
        expect(row).toMatchObject({ served: false, grants: [expect.objectContaining({ groupId: 'ops', served: false })] });
    });

    it('does not carry a deleted group\'s grants or settings over to a new group with the same id', async () => {
        const { exposure, policies } = build(database, tools);
        await setPolicy(policies, 'ops', { allowRestrictedTools: true, scrubSecrets: true });
        await exposure.setExposure('log-reader', 'ops', true, 'admin-1');
        await exposure.setExposure('chain-lookup', 'ops', true, 'admin-1');
        await exposure.setExposure('chain-lookup', MCP_USERS_GROUP_ID, true, 'admin-1');

        // What the http.groupDeleted handler does when 'ops' is deleted. The
        // stub group service still knows 'ops', which stands in for an admin
        // creating a new group under the same id afterwards.
        expect(await exposure.withdrawGroupGrants('ops')).toBe(2);
        expect(await policies.deleteForGroup('ops')).toBe(true);

        const recreated = { groups: [MCP_USERS_GROUP_ID, 'ops'] };
        const served = await exposure.getServedTools(recreated);
        expect(served.map(entry => entry.tool.name)).toEqual(['chain-lookup']);
        expect(served[0].scrubSecrets).toBe(false);
        expect(policies.policyFor(await policies.getPolicies(0), 'ops')).toMatchObject({ allowRestrictedTools: false, scrubSecrets: false });
    });

    it('answers 404 for an unregistered tool or an unknown group', async () => {
        const { exposure } = build(database, tools);
        await expect(exposure.setExposure('missing', MCP_USERS_GROUP_ID, true, 'admin-1')).rejects.toMatchObject({ status: 404 });
        await expect(exposure.setExposure('chain-lookup', 'no-such-group', true, 'admin-1')).rejects.toMatchObject({ status: 404 });
    });

    it('stops serving a tool whose capability changed after approval, until re-approved', async () => {
        const { exposure } = build(database, tools);
        await exposure.setExposure('chain-lookup', MCP_USERS_GROUP_ID, true, 'admin-1');

        tools[0] = tool('chain-lookup', { ...READ_CAP, surfacesUntrustedContent: true });
        const changed = build(database, tools).exposure;
        expect(await changed.getServedTools(MEMBER)).toEqual([]);
        const row = (await changed.listExposures()).find(r => r.name === 'chain-lookup');
        expect(row).toMatchObject({ stale: true, served: false });
        expect(row?.grants[0]).toMatchObject({ groupId: MCP_USERS_GROUP_ID, stale: true, served: false });

        await changed.setExposure('chain-lookup', MCP_USERS_GROUP_ID, true, 'admin-1');
        expect((await changed.getServedTools(MEMBER)).map(entry => entry.tool.name)).toEqual(['chain-lookup']);
    });

    it('does not serve an approved tool that is disabled in the registry', async () => {
        const { exposure } = build(database, tools);
        await exposure.setExposure('chain-lookup', MCP_USERS_GROUP_ID, true, 'admin-1');
        const disabled = build(database, tools, ['chain-lookup']).exposure;
        expect(await disabled.getServedTools(MEMBER)).toEqual([]);
    });

    it('ignores approvals stored before grants were per group', async () => {
        await database.getCollection(MCP_TOOL_APPROVALS_COLLECTION).insertOne({ toolName: 'chain-lookup', fingerprint: 'x', approvedAt: new Date() } as any);
        const { exposure } = build(database, tools);
        expect(await exposure.getServedTools(MEMBER)).toEqual([]);
    });

    it('lists tools grouped by owner, then by name', async () => {
        const providers = { 'chain-lookup': 'trp-b', 'log-reader': 'core', 'broadcast': 'trp-b', 'unclassified': 'core' };
        const { exposure } = build(database, tools, [], providers);
        const rows = await exposure.listExposures();
        expect(rows.map(row => `${row.provider}/${row.name}`)).toEqual([
            'core/log-reader',
            'core/unclassified',
            'trp-b/broadcast',
            'trp-b/chain-lookup'
        ]);
    });

    it('withdraws an approval for one group and leaves the others', async () => {
        const { exposure } = build(database, tools);
        await exposure.setExposure('chain-lookup', MCP_USERS_GROUP_ID, true, 'admin-1');
        await exposure.setExposure('chain-lookup', 'admin', true, 'admin-1');
        await exposure.setExposure('chain-lookup', MCP_USERS_GROUP_ID, false, 'admin-1');
        expect(await exposure.getServedTools(MEMBER)).toEqual([]);
        expect(await exposure.getServedTools(ADMIN_MEMBER)).toHaveLength(1);
    });
});
