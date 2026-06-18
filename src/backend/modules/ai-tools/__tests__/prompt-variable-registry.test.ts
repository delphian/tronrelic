/**
 * @file prompt-variable-registry.test.ts
 *
 * Covers the core prompt-variable registry and its lethal-trifecta feed: dynamic
 * registration + classification override, static CRUD with fail-safe default and
 * shadow rejection, expansion across both kinds, the secret-name surface the
 * trifecta detector consumes, and that a secret variable forms the private-data
 * leg in `detectTrifecta`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IAiToolCapability, IAiToolInfo, ISystemLogService } from '@/types';
import {
    PromptVariableRegistry,
    DuplicateVariableNameError,
    PromptVariableNotFoundError,
    detectTrifecta
} from '../index.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

/** Minimal logger that swallows every level and returns itself for `child()`. */
function createMockLogger(): ISystemLogService {
    const logger = {
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
        child: vi.fn(() => logger)
    };
    return logger as unknown as ISystemLogService;
}

/** Build a loaded registry over a fresh mock database. */
async function buildRegistry(): Promise<PromptVariableRegistry> {
    const registry = new PromptVariableRegistry(createMockLogger(), createMockDatabaseService());
    await registry.load();
    return registry;
}

describe('PromptVariableRegistry', () => {
    let registry: PromptVariableRegistry;

    beforeEach(async () => {
        registry = await buildRegistry();
    });

    describe('dynamic variables', () => {
        it('registers a dynamic variable and expands it', async () => {
            registry.registerVariable({
                name: 'greeting',
                description: 'A greeting',
                category: 'Test',
                resolve: async () => 'hello world'
            }, 'test');

            expect(await registry.expandAll('say {%greeting%}')).toBe('say hello world');
        });

        it('defaults dynamic sensitivity to internal and honours a declared default', async () => {
            registry.registerVariable({ name: 'plain', description: 'd', category: 'c', resolve: async () => 'x' });
            registry.registerVariable({ name: 'declared-secret', description: 'd', category: 'c', sensitivity: 'secret', resolve: async () => 'x' });

            const infos = await registry.listInfo();
            expect(infos.find(i => i.name === 'plain')?.sensitivity).toBe('internal');
            expect(infos.find(i => i.name === 'declared-secret')?.sensitivity).toBe('secret');
            expect(infos.find(i => i.name === 'declared-secret')?.sensitivitySource).toBe('declared');
        });

        it('an admin classification override wins over the declared default and persists', async () => {
            registry.registerVariable({ name: 'cache-keys', description: 'd', category: 'c', resolve: async () => 'x' });

            await registry.classify('cache-keys', 'secret');

            expect(registry.getSecretVariableNames()).toContain('cache-keys');
            const info = (await registry.listInfo()).find(i => i.name === 'cache-keys');
            expect(info?.sensitivity).toBe('secret');
            expect(info?.sensitivitySource).toBe('override');
        });
    });

    describe('static variables', () => {
        it('creates a static variable defaulting to secret (fail-safe) and expands it', async () => {
            const created = await registry.createStatic({ name: 'api-note', description: 'd', category: 'c', content: 'SECRET-VALUE' });

            expect(created.sensitivity).toBe('secret');
            expect(await registry.expandAll('x {%api-note%}')).toBe('x SECRET-VALUE');
            expect(registry.getSecretVariableNames()).toContain('api-note');
        });

        it('rejects a static name that shadows a registered dynamic variable', async () => {
            registry.registerVariable({ name: 'system-status', description: 'd', category: 'c', resolve: async () => 'x' });

            await expect(registry.createStatic({ name: 'system-status', description: 'd', category: 'c', content: 'y' }))
                .rejects.toBeInstanceOf(DuplicateVariableNameError);
        });

        it('rejects a duplicate static name and an invalid name', async () => {
            await registry.createStatic({ name: 'note', description: 'd', category: 'c', content: 'y', sensitivity: 'internal' });

            await expect(registry.createStatic({ name: 'note', description: 'd', category: 'c', content: 'z' }))
                .rejects.toBeInstanceOf(DuplicateVariableNameError);
            await expect(registry.createStatic({ name: 'Bad Name!', description: 'd', category: 'c', content: 'z' }))
                .rejects.toThrow();
        });

        it('edits and deletes a static variable', async () => {
            await registry.createStatic({ name: 'note', description: 'd', category: 'c', content: 'old', sensitivity: 'public' });

            const updated = await registry.updateStatic('note', { content: 'new', sensitivity: 'internal' });
            expect(updated.content).toBe('new');
            expect(updated.sensitivity).toBe('internal');
            expect(await registry.expandAll('{%note%}')).toBe('new');

            expect(await registry.deleteStatic('note')).toBe(true);
            await expect(registry.resolve('note')).rejects.toThrow();
        });

        it('throws PromptVariableNotFoundError editing or classifying an unknown variable', async () => {
            await expect(registry.updateStatic('ghost', { content: 'x' })).rejects.toBeInstanceOf(PromptVariableNotFoundError);
            await expect(registry.classify('ghost', 'secret')).rejects.toBeInstanceOf(PromptVariableNotFoundError);
        });
    });

    describe('secret surfaces', () => {
        it('secretVariablesIn returns only referenced secret variables', async () => {
            registry.registerVariable({ name: 'pub', description: 'd', category: 'c', sensitivity: 'public', resolve: async () => 'x' });
            await registry.createStatic({ name: 'seed', description: 'd', category: 'c', content: 'S', sensitivity: 'secret' });

            expect(registry.secretVariablesIn('{%pub%} and {%seed%}')).toEqual(['seed']);
            expect(registry.secretVariablesIn('only {%pub%}')).toEqual([]);
        });
    });
});

describe('detectTrifecta with secret variables', () => {
    const reader: IAiToolInfo = {
        name: 'untrusted-reader', description: 'd', inputSchema: { type: 'object', properties: {} },
        capability: { sideEffect: 'read', surfacesUntrustedContent: true } as IAiToolCapability,
        enabled: true, provider: 'p'
    };
    const sink: IAiToolInfo = {
        name: 'open-sink', description: 'd', inputSchema: { type: 'object', properties: {} },
        capability: { sideEffect: 'external', reversible: true } as IAiToolCapability,
        enabled: true, provider: 'p'
    };
    const neverGated = () => false;

    it('reports lethal when a secret variable joins an untrusted reader and an open egress', () => {
        const status = detectTrifecta([reader, sink], neverGated, ['seed']);
        expect(status.severity).toBe('lethal');
        expect(status.privateDataVariables).toEqual(['seed']);
        expect(status.privateData).toEqual([]);
    });

    it('stays safe with the same tools but no secret variable', () => {
        const status = detectTrifecta([reader, sink], neverGated, []);
        expect(status.severity).toBe('safe');
        expect(status.privateDataVariables).toEqual([]);
    });

    it('stays safe when only a secret variable and a reader are present (no egress)', () => {
        const status = detectTrifecta([reader], neverGated, ['seed']);
        expect(status.severity).toBe('safe');
    });
});
