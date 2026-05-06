import { Router } from 'express';
import type { FilesController } from './files.controller.js';

/**
 * Create the Files admin router. Mounted at `/api/admin/files` with
 * `requireAdmin` middleware. Static routes (`/sources`, `/settings`) come
 * before `/:id` so the dynamic id parameter does not capture them.
 */
export function createFilesRouter(controller: FilesController): Router {
    const router = Router();

    router.get('/sources', controller.listFileSources.bind(controller));
    router.get('/settings', controller.getSettings.bind(controller));
    router.patch('/settings', controller.updateSettings.bind(controller));

    router.get('/', controller.listFiles.bind(controller));
    router.post('/', controller.getUploadMiddleware(), controller.uploadFile.bind(controller));
    router.delete('/:id', controller.deleteFile.bind(controller));

    return router;
}
