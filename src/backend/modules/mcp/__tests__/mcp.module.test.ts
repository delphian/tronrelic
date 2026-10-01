/**
 * @fileoverview Lifecycle tests for the MCP module: metadata, init/run phase
 * separation, MCP group creation, menu registration, and route mounting.
 */

import { describe, it, expect, vi } from 'vitest';
import { MCP_USERS_GROUP_ID } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { McpModule, type IMcpModuleDependencies } from '../index.js';

/**
 * Build the collaborators the module needs, with spies on every integration
 * point the tests assert against.
 *
 * @param groupExists - Whether the MCP group already exists.
 * @returns Mock dependencies for `init()`.
 */
function createDeps(groupExists = false): IMcpModuleDependencies & { app: { use: ReturnType<typeof vi.fn>; all: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } } {
    return {
        database: createMockDatabaseService(),
        app: { use: vi.fn(), all: vi.fn(), get: vi.fn() } as any,
        menuService: { create: vi.fn(async () => ({})) } as any,
        governor: { invoke: vi.fn(), recordServerToolInvocation: vi.fn() },
        toolRegistry: { listToolInfo: vi.fn(() => []), getEnabledTools: vi.fn(() => []), getTool: vi.fn() } as any,
        tokenVerifier: { verify: vi.fn(async () => null) },
        connectedApps: { listForUser: vi.fn(), listAll: vi.fn(), revoke: vi.fn(), revokeAllForUser: vi.fn(), hasGrant: vi.fn(), recordUse: vi.fn() },
        userGroups: {
            getGroup: vi.fn(async () => (groupExists ? { id: MCP_USERS_GROUP_ID } : null)),
            createGroup: vi.fn(async () => ({})),
            getMembers: vi.fn(async () => ({ userIds: [], total: 0 })),
            listGroups: vi.fn(async () => [])
        } as any,
        knownSecrets: [],
        resolveEndUser: vi.fn(async () => null),
        endpoint: {
            resourceUrl: 'https://tronrelic.test/mcp',
            resourceMetadataUrl: 'https://tronrelic.test/.well-known/oauth-protected-resource/mcp',
            issuer: 'https://tronrelic.test',
            siteHost: 'tronrelic.test'
        }
    } as any;
}

describe('McpModule', () => {
    it('exposes correct metadata', () => {
        const module = new McpModule();
        expect(module.metadata.id).toBe('mcp');
        expect(module.metadata.name).toBe('MCP');
        expect(module.metadata.version).toBe('1.1.0');
    });

    it('init() builds services without mounting routes or touching groups', async () => {
        const module = new McpModule();
        const deps = createDeps();
        await module.init(deps);
        expect(deps.app.use).not.toHaveBeenCalled();
        expect(deps.app.all).not.toHaveBeenCalled();
        expect(deps.app.get).not.toHaveBeenCalled();
        expect(deps.userGroups.createGroup).not.toHaveBeenCalled();
    });

    it('run() before init() throws', async () => {
        const module = new McpModule();
        await expect(module.run()).rejects.toThrow();
    });

    it('run() mounts the endpoint, both discovery paths, and the admin API', async () => {
        const module = new McpModule();
        const deps = createDeps();
        await module.init(deps);
        await module.run();
        expect(deps.app.all).toHaveBeenCalledWith('/mcp', expect.any(Function));
        expect(deps.app.get).toHaveBeenCalledWith('/.well-known/oauth-protected-resource/mcp', expect.any(Function));
        expect(deps.app.get).toHaveBeenCalledWith('/.well-known/oauth-protected-resource', expect.any(Function));
        expect(deps.app.use).toHaveBeenCalledWith('/api/admin/mcp', expect.any(Function));
    });

    it('run() creates the MCP group when it is missing', async () => {
        const module = new McpModule();
        const deps = createDeps(false);
        await module.init(deps);
        await module.run();
        expect(deps.userGroups.createGroup).toHaveBeenCalledWith(expect.objectContaining({ id: MCP_USERS_GROUP_ID }));
    });

    it('run() leaves an existing MCP group alone', async () => {
        const module = new McpModule();
        const deps = createDeps(true);
        await module.init(deps);
        await module.run();
        expect(deps.userGroups.createGroup).not.toHaveBeenCalled();
    });

    it('run() registers the admin nav item and admin-gated tabs including Database and Logs', async () => {
        const module = new McpModule();
        const deps = createDeps();
        await module.init(deps);
        await module.run();
        const calls = (deps.menuService.create as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0]);
        expect(calls).toContainEqual(expect.objectContaining({ namespace: 'main', url: '/system/mcp' }));
        const tabs = calls.filter(node => node.namespace === 'mcp');
        expect(tabs.map(node => node.url)).toEqual(expect.arrayContaining([
            '/system/mcp?tab=database',
            '/system/mcp?tab=logs'
        ]));
        expect(tabs.every(node => node.requiresAdmin === true)).toBe(true);
    });
});
