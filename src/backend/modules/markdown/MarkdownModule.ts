/**
 * @fileoverview Markdown module: owns and publishes the shared markdown renderer.
 *
 * Why a module: CMS pages and blog posts both turn authored markdown into HTML
 * that is injected unescaped, so the sanitize rules are a security boundary the
 * whole platform shares and cannot be switched off. The module owns no storage,
 * routes, or jobs. Its lifecycle is configuring the renderer in `init()`, where
 * the pages module receives it directly, and publishing it as `'markdown'` in
 * `run()`, where plugins find it.
 */

import type { IModule, IModuleMetadata, IServiceRegistry } from '@/types';
import { logger } from '../../lib/logger.js';
import { MarkdownRendererService } from './services/markdown-renderer.service.js';

/** Name the renderer is published under on the service registry. */
export const MARKDOWN_SERVICE_NAME = 'markdown';

/** Dependencies the markdown module needs at bootstrap. */
export interface IMarkdownModuleDependencies {
    /** Registry the renderer is published on, so plugins can resolve it. */
    serviceRegistry: IServiceRegistry;
}

/**
 * Two-phase module: `init()` configures the renderer, `run()` publishes it.
 */
export class MarkdownModule implements IModule<IMarkdownModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'markdown',
        name: 'Markdown',
        version: '1.0.0',
        description: 'The shared markdown-to-sanitized-HTML renderer used by CMS pages and plugins.'
    };

    private serviceRegistry: IServiceRegistry | null = null;
    private service: MarkdownRendererService | null = null;
    private readonly logger = logger.child({ module: 'markdown' });

    /**
     * Phase 1: configure the renderer singleton.
     *
     * @param deps - Injected collaborators.
     */
    async init(deps: IMarkdownModuleDependencies): Promise<void> {
        if (!deps.serviceRegistry) {
            throw new Error('MarkdownModule requires a service registry');
        }
        this.serviceRegistry = deps.serviceRegistry;
        MarkdownRendererService.setDependencies({ logger: this.logger });
        this.service = MarkdownRendererService.getInstance();
        this.logger.info('Markdown module initialized');
    }

    /**
     * Phase 2: publish the renderer so plugins, which load after modules, can
     * resolve it.
     *
     * @throws If called before `init()`.
     */
    async run(): Promise<void> {
        if (!this.serviceRegistry || !this.service) {
            throw new Error('MarkdownModule.run() called before init()');
        }
        this.serviceRegistry.register(MARKDOWN_SERVICE_NAME, this.service);
        this.logger.info(`Markdown module running; renderer published as '${MARKDOWN_SERVICE_NAME}'`);
    }

    /**
     * Hand the renderer to bootstrap, which passes it to the pages module during
     * the init phase, before `run()` has published it.
     *
     * @returns The configured renderer.
     * @throws If called before `init()`.
     */
    getRenderer(): MarkdownRendererService {
        if (!this.service) {
            throw new Error('MarkdownModule.getRenderer() called before init()');
        }
        return this.service;
    }
}
