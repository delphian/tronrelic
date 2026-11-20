/**
 * @fileoverview Barrel for the shared markdown renderer contract.
 *
 * Re-exports the service interface and its options so the root types index
 * surfaces them with one export line.
 */

export type { IMarkdownRendererService } from './IMarkdownRendererService.js';
export type { IMarkdownRenderOptions } from './IMarkdownRenderOptions.js';
