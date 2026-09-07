/**
 * @fileoverview Public API of the frontend ai-tools module — the admin
 * dashboard's API client. Consumers import from the module root.
 */

export * from './api/client';
export { useViewportFill } from './hooks/useViewportFill';
export { useTranscriptScroll, type ITranscriptScroll } from './hooks/useTranscriptScroll';
