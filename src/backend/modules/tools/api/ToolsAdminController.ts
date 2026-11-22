/**
 * @fileoverview Admin HTTP handlers for the tools module's Bootstrap tab.
 *
 * `/system/tools` lists the CMS pages the module ships and lets an admin
 * create each one. These handlers adapt `ToolsBootstrapService` to HTTP and
 * give each refusal the status its cause deserves. The router mounting them
 * applies the admin gate, so the handlers assume an admin caller.
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import { isContentError } from '../../../services/content-error.js';
import { sendContentWriteError } from '../../../services/content-http.js';
import { PageInputError } from '../../pages/index.js';
import { ToolsBootstrapError } from '../services/ToolsBootstrapError.js';
import type { ToolsBootstrapService } from '../services/ToolsBootstrapService.js';

/**
 * Handlers for `GET /bootstrap` and `POST /bootstrap/:id`.
 */
export class ToolsAdminController {
    /**
     * @param bootstrap - Lists the bootstrap pages and creates them.
     * @param logger - The tools module's logger, for failures with no known cause.
     */
    constructor(
        private readonly bootstrap: ToolsBootstrapService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * List every bootstrap page with the state of its address.
     *
     * @param _req - Unused; the list takes no input.
     * @param res - Answered with `{ success, pages }`.
     */
    listBootstrapPages = async (_req: Request, res: Response): Promise<void> => {
        const pages = await this.bootstrap.list();
        res.json({ success: true, pages });
    };

    /**
     * Propose one bootstrap page for curator review.
     *
     * Answers 201 with the updated row and the curation item id. An unknown
     * entry is a 404, an address a page already holds is a 409 (from this
     * module's check, or from the pages module when two clicks race), and a
     * content service refusal takes its mapped status, such as 503 when the
     * curation queue is not running.
     *
     * @param req - Carries the entry id in `params.id`.
     * @param res - Answered with `{ success, page, curationId }` or an error body.
     */
    createBootstrapPage = async (req: Request, res: Response): Promise<void> => {
        try {
            const { page, curationId } = await this.bootstrap.create(String(req.params.id));
            res.status(201).json({ success: true, page, curationId });
        } catch (error) {
            if (error instanceof ToolsBootstrapError) {
                res.status(error.code === 'unknown-entry' ? 404 : 409).json({ success: false, error: error.message });
            } else if (error instanceof PageInputError) {
                res.status(409).json({ success: false, error: error.message });
            } else if (isContentError(error)) {
                sendContentWriteError(res, 'Failed to create the page', error);
            } else {
                this.logger.error({ error, entry: req.params.id }, 'Failed to create a bootstrap page');
                res.status(500).json({ success: false, error: 'Failed to create the page' });
            }
        }
    };
}
