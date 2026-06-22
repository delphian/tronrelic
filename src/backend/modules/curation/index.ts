/**
 * @file index.ts
 *
 * Public surface of the curation module. The module class and its dependency
 * shape are consumed by the bootstrap; `runWithCurationAutoApprove` is imported
 * by the AI tool governor to wrap a governed handler call (the one runtime
 * primitive shared across the curation/ai-tools boundary); the service, queue,
 * and constants are exposed for tests and in-process consumers.
 */

export { CurationModule, CURATION_SERVICE } from './CurationModule.js';
export type { ICurationModuleDependencies } from './CurationModule.js';
export { CurationService, CURATIONS_CHANGED_EVENT, CURATION_AUTO_APPROVE_DECIDED_BY } from './services/curation-service.js';
export { CurationQueue } from './services/curation-queue.js';
export { runWithCurationAutoApprove, shouldAutoApproveCuration } from './services/curation-auto-approve-context.js';
export { CurationController } from './api/curation.controller.js';
export { createCurationAdminRouter } from './api/curation.router.js';
