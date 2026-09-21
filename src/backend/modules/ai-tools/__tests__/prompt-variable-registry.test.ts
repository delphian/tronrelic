/**
 * @file prompt-variable-registry.test.ts
 *
 * Covers the core prompt-variable registry and its lethal-trifecta feed: dynamic
 * registration + classification override, static CRUD with fail-safe default and
 * shadow rejection, expansion across both kinds, the secret-name surface the
 * trifecta detector consumes, and that a secret variable forms the private-data
 * leg in `detectTrifecta`.
 *
 * Also covers `skipSecret`, the option core sets on the pass that builds a
 * stored copy of a prompt. The assertions there are deliberately about what does
 * *not* happen — the resolver is never called and the value appears nowhere in
 * the output — because a regression would be silent otherwise: the expanded text
 * would still look plausible while quietly carrying a secret into a collection
 * that is never pruned.
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

        it('returns static content in listInfo so the edit form can prefill it', async () => {
            await registry.createStatic({ name: 'note', description: 'd', category: 'c', content: 'BODY', sensitivity: 'internal' });

            const info = (await registry.listInfo()).find(i => i.name === 'note');
            expect(info?.content).toBe('BODY');
            expect(info?.kind).toBe('static');
        });

        it('rejects a static name that shadows a registered dynamic variable', async () => {
            registry.registerVariable({ name: 'system-status', description: 'd', category: 'c', resolve: async () => 'x' });

            await expect(registry.createStatic({ name: 'system-status', description: 'd', category: 'c', content: 'y' }))
                .rejects.toBeInstanceOf(DuplicateVariableNameError);
        });

        it('refuses a dynamic registration that would shadow an existing static (no masquerade)', async () => {
            await registry.createStatic({ name: 'site-info', description: 'd', category: 'c', content: 'ADMIN', sensitivity: 'internal' });

            // A plugin registering a dynamic of the same name must not take over —
            // the admin static stays authoritative and reachable.
            registry.registerVariable({ name: 'site-info', description: 'd', category: 'c', resolve: async () => 'PLUGIN' });

            expect(await registry.resolve('site-info')).toBe('ADMIN');
            const infos = await registry.listInfo();
            expect(infos.filter(i => i.name === 'site-info')).toHaveLength(1);
            expect(infos.find(i => i.name === 'site-info')?.kind).toBe('static');
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

        it('skipSecret leaves a secret variable as its token and still expands the rest', async () => {
            registry.registerVariable({ name: 'pub', description: 'd', category: 'c', sensitivity: 'public', resolve: async () => 'PUBLIC' });
            await registry.createStatic({ name: 'seed', description: 'd', category: 'c', content: 'SECRET', sensitivity: 'secret' });

            // The default pass is what builds a request, so it must still splice
            // the secret in — that is the whole purpose of a secret variable.
            expect(await registry.expandAll('{%pub%} / {%seed%}')).toBe('PUBLIC / SECRET');

            // The skipping pass is what builds a stored copy. The secret's token
            // survives verbatim, so a reader can see where it went, and the
            // value appears nowhere in the output.
            const stored = await registry.expandAll('{%pub%} / {%seed%}', { skipSecret: true });
            expect(stored).toBe('PUBLIC / {%seed%}');
            expect(stored).not.toContain('SECRET');
        });

        it('skipSecret never resolves the skipped variable and omits it from the metadata', async () => {
            const resolveSecret = vi.fn(async () => 'SECRET');
            registry.registerVariable({ name: 'vault', description: 'd', category: 'c', sensitivity: 'secret', resolve: resolveSecret });
            registry.registerVariable({ name: 'pub', description: 'd', category: 'c', sensitivity: 'public', resolve: async () => 'PUBLIC' });

            const { expanded, variables } = await registry.expandWithMetadata('{%vault%} {%pub%}', { skipSecret: true });

            expect(expanded).toBe('{%vault%} PUBLIC');
            // Not resolved at all rather than resolved and masked: no copy of the
            // value is produced, so nothing downstream can leak one by accident,
            // and a resolver that reads a key store is not run for a pass whose
            // output is only filed away.
            expect(resolveSecret).not.toHaveBeenCalled();
            // The metadata describes what the pass expanded, so a skipped
            // variable is absent rather than listed with a zero size.
            expect(variables.map(variable => variable.name)).toEqual(['pub']);
        });

        it('a variable reclassified below secret expands into the stored copy again', async () => {
            // The per-variable escape hatch: an operator who wants a value
            // recorded classifies it down, rather than switching the protection
            // off globally.
            await registry.createStatic({ name: 'note', description: 'd', category: 'c', content: 'VALUE', sensitivity: 'secret' });
            expect(await registry.expandAll('{%note%}', { skipSecret: true })).toBe('{%note%}');

            await registry.classify('note', 'internal');
            expect(await registry.expandAll('{%note%}', { skipSecret: true })).toBe('VALUE');
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
