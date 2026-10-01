/**
 * @fileoverview Tests for MCP tool exposure: default-hidden, the eligibility
 * floor, capability-fingerprint staleness, and what is served.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IAiTool, IAiToolCapability, IAiToolInfo } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { McpToolExposureError, McpToolExposureService } from '../services/mcp-tool-exposure.service.js';

/** A read-only, internal tool the floor accepts. */
const READ_CAP: IAiToolCapability = { sideEffect: 'read', reversible: true, sensitivity: 'internal' };

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
 * @returns A registry with the three methods the service calls.
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

/** A silent logger. */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;

describe('McpToolExposureService', () => {
    let tools: IAiTool[];

    beforeEach(() => {
        tools = [
            tool('chain-lookup', READ_CAP),
            tool('log-reader', { sideEffect: 'read', reversible: true, sensitivity: 'secret' }),
            tool('broadcast', { sideEffect: 'external', reversible: true, sensitivity: 'public' }),
            tool('unclassified', undefined)
        ];
    });

    it('serves nothing until an admin approves a tool', async () => {
        const service = new McpToolExposureService(createMockDatabaseService(), registry(tools), logger);
        expect(await service.getServedTools()).toEqual([]);
        const rows = await service.listExposures();
        expect(rows.every(row => !row.approved && !row.served)).toBe(true);
    });

    it('serves an approved eligible tool', async () => {
        const service = new McpToolExposureService(createMockDatabaseService(), registry(tools), logger);
        await service.setExposure('chain-lookup', true, 'admin-1');
        const served = await service.getServedTools();
        expect(served.map(t => t.name)).toEqual(['chain-lookup']);
    });

    it.each(['log-reader', 'broadcast', 'unclassified'])('refuses to approve ineligible tool %s', async (name) => {
        const service = new McpToolExposureService(createMockDatabaseService(), registry(tools), logger);
        await expect(service.setExposure(name, true, 'admin-1')).rejects.toBeInstanceOf(McpToolExposureError);
    });

    it('answers 404 for an unregistered tool', async () => {
        const service = new McpToolExposureService(createMockDatabaseService(), registry(tools), logger);
        await expect(service.setExposure('missing', true, 'admin-1')).rejects.toMatchObject({ status: 404 });
    });

    it('stops serving a tool whose capability changed after approval, until re-approved', async () => {
        const database = createMockDatabaseService();
        const service = new McpToolExposureService(database, registry(tools), logger);
        await service.setExposure('chain-lookup', true, 'admin-1');

        tools[0] = tool('chain-lookup', { ...READ_CAP, surfacesUntrustedContent: true });
        const changed = new McpToolExposureService(database, registry(tools), logger);
        expect(await changed.getServedTools()).toEqual([]);
        const row = (await changed.listExposures()).find(r => r.name === 'chain-lookup');
        expect(row).toMatchObject({ approved: true, stale: true, served: false });

        await changed.setExposure('chain-lookup', true, 'admin-1');
        expect((await changed.getServedTools()).map(t => t.name)).toEqual(['chain-lookup']);
    });

    it('does not serve an approved tool that is disabled in the registry', async () => {
        const database = createMockDatabaseService();
        const service = new McpToolExposureService(database, registry(tools), logger);
        await service.setExposure('chain-lookup', true, 'admin-1');
        const disabled = new McpToolExposureService(database, registry(tools, ['chain-lookup']), logger);
        expect(await disabled.getServedTools()).toEqual([]);
    });

    it('lists tools grouped by owner, then by name', async () => {
        const providers = { 'chain-lookup': 'trp-b', 'log-reader': 'core', 'broadcast': 'trp-b', 'unclassified': 'core' };
        const service = new McpToolExposureService(createMockDatabaseService(), registry(tools, [], providers), logger);
        const rows = await service.listExposures();
        expect(rows.map(row => `${row.provider}/${row.name}`)).toEqual([
            'core/log-reader',
            'core/unclassified',
            'trp-b/broadcast',
            'trp-b/chain-lookup'
        ]);
    });

    it('withdraws an approval', async () => {
        const service = new McpToolExposureService(createMockDatabaseService(), registry(tools), logger);
        await service.setExposure('chain-lookup', true, 'admin-1');
        await service.setExposure('chain-lookup', false, 'admin-1');
        expect(await service.getServedTools()).toEqual([]);
    });
});
