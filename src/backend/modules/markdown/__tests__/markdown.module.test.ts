/// <reference types="vitest" />

/**
 * @fileoverview Lifecycle tests for the markdown module: metadata, the split
 * between configuring the renderer in `init()` and publishing it in `run()`,
 * and the failures that must stop startup.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { IServiceRegistry } from '@/types';
import { MarkdownModule, MARKDOWN_SERVICE_NAME, MarkdownRendererService } from '../index.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';

describe('MarkdownModule', () => {
    let serviceRegistry: IServiceRegistry;

    beforeEach(() => {
        MarkdownRendererService.resetForTests();
        serviceRegistry = createMockServiceRegistry();
    });

    it('declares its metadata', () => {
        const module = new MarkdownModule();
        expect(module.metadata.id).toBe('markdown');
        expect(module.metadata.name).toBe('Markdown');
        expect(module.metadata.version).toBe('1.0.0');
    });

    describe('init()', () => {
        it('configures the renderer without publishing it', async () => {
            const module = new MarkdownModule();
            await module.init({ serviceRegistry });

            expect(module.getRenderer()).toBe(MarkdownRendererService.getInstance());
            expect(serviceRegistry.get(MARKDOWN_SERVICE_NAME)).toBeUndefined();
        });

        it('refuses to start without a service registry', async () => {
            const module = new MarkdownModule();
            await expect(module.init({ serviceRegistry: undefined as unknown as IServiceRegistry }))
                .rejects.toThrow('service registry');
        });
    });

    describe('run()', () => {
        it('publishes the renderer under its registry name', async () => {
            const module = new MarkdownModule();
            await module.init({ serviceRegistry });
            await module.run();

            expect(serviceRegistry.get(MARKDOWN_SERVICE_NAME)).toBe(module.getRenderer());
        });

        it('throws when called before init()', async () => {
            await expect(new MarkdownModule().run()).rejects.toThrow('before init()');
        });
    });

    it('throws when the renderer is requested before init()', () => {
        expect(() => new MarkdownModule().getRenderer()).toThrow('before init()');
    });
});
