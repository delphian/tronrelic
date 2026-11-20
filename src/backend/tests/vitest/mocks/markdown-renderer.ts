/**
 * @fileoverview Shared markdown renderer for Vitest.
 *
 * Tests of modules that render markdown, such as pages, need a renderer that
 * behaves exactly like production, so an assertion about sanitized HTML checks
 * the real sanitize rules rather than a stand-in. This helper hands back the
 * real `MarkdownRendererService`, configured with a silent logger.
 *
 * @module tests/vitest/mocks/markdown-renderer
 */

import type { IMarkdownRendererService, ISystemLogService } from '@/types';
import { MarkdownRendererService } from '../../../modules/markdown/index.js';

/**
 * Build the real markdown renderer with a logger that discards everything.
 *
 * Resets the singleton first, so a test file that configured it differently
 * cannot leak its logger into the next caller.
 *
 * @returns The production renderer, ready to pass wherever an
 *   `IMarkdownRendererService` is expected.
 */
export function createTestMarkdownRenderer(): IMarkdownRendererService {
    const noop = (): void => undefined;
    const logger = {
        info: noop,
        warn: noop,
        error: noop,
        debug: noop,
        trace: noop,
        fatal: noop,
        child: () => logger
    } as unknown as ISystemLogService;

    MarkdownRendererService.resetForTests();
    MarkdownRendererService.setDependencies({ logger });
    return MarkdownRendererService.getInstance();
}
