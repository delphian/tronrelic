/**
 * @fileoverview Admin HTTP handlers for the tools module's Bootstrap tab.
 *
 * `/system/tools` lists the CMS pages the module ships and lets an admin
 * create each one. These handlers adapt the module's bootstrap catalog to
 * HTTP, answering each refusal with the status `PAGE_BOOTSTRAP_REFUSAL_STATUS`
 * gives it, the same table plugin Bootstrap tabs use. The router mounting
 * them applies the admin gate, so the handlers assume an admin caller.
 */

import type { Request, Response } from 'express';
import type { IPageBootstrapCatalog, ISystemLogService } from '@/types';
import { PAGE_BOOTSTRAP_REFUSAL_STATUS } from '@/types';

/**
 * Handlers for `GET /bootstrap` and `POST /bootstrap/:id`.
 */
export class ToolsAdminController {
    /**
     * @param bootstrap - Lists the module's bootstrap pages and creates them.
     * @param logger - The tools module's logger, for failures with no known cause.
     */
    constructor(
        private readonly bootstrap: IPageBootstrapCatalog,
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
     * Answers 201 with the updated row and the curation item id, or the
     * status the refusal's reason maps to, such as 409 when a page already
     * holds the address or 503 when the curation queue is not running.
     *
     * @param req - Carries the entry id in `params.id`.
     * @param res - Answered with `{ success, page, curationId }` or an error body.
     */
    createBootstrapPage = async (req: Request, res: Response): Promise<void> => {
        try {
            const result = await this.bootstrap.create(String(req.params.id));
            if (result.created) {
                res.status(201).json({ success: true, page: result.row, curationId: result.curationId });
            } else {
                res.status(PAGE_BOOTSTRAP_REFUSAL_STATUS[result.reason]).json({ success: false, error: result.message });
            }
        } catch (error) {
            this.logger.error({ error, entry: req.params.id }, 'Failed to create a bootstrap page');
            res.status(500).json({ success: false, error: 'Failed to create the page' });
        }
    };
}
