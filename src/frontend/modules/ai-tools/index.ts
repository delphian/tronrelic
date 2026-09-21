/**
 * @fileoverview Public API of the frontend ai-tools module — the admin
 * dashboard's API client and the tool parameter view shared with plugins.
 * Consumers import from the module root.
 */

export * from './api/client';
export { AiToolSchemaView } from './components/AiToolSchemaView';
export { useViewportFill } from './hooks/useViewportFill';
export { useTranscriptScroll, type ITranscriptScroll } from './hooks/useTranscriptScroll';
