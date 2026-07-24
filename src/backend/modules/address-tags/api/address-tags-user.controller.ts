/**
 * @fileoverview Read-only HTTP layer for address tags, gated to registered
 * users.
 *
 * Thin wrapper by design: parses array inputs off the query string, delegates
 * to the service (the single business-logic authority), and maps validation
 * errors to 400s. The `requireLogin` gate is applied at mount time by the
 * module, so handlers only see authenticated requests.
 */

import type { Request, Response } from 'express';
import type { IAddressTagService, ISystemLogService } from '@/types';

/**
 * Controller exposing the three read shapes: tags by addresses, addresses by
 * tags, and the distinct tag vocabulary.
 */
export class AddressTagsUserController {
    /**
     * @param service - The central tag service all handlers delegate to.
     * @param logger - Module-scoped logger for failure diagnostics.
     */
    constructor(
        private readonly service: IAddressTagService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /by-address?addresses=a,b — all tags on the given addresses.
     */
    getByAddresses = async (req: Request, res: Response): Promise<void> => {
        try {
            const addresses = parseList(req.query.addresses);
            if (addresses.length === 0) {
                res.status(400).json({ error: 'addresses query parameter is required' });
                return;
            }
            res.json({ tags: await this.service.getTagsByAddresses(addresses) });
        } catch (error) {
            this.fail(res, error, 'Failed to load tags by address');
        }
    };

    /**
     * GET /by-tag?tags=x,y — all assignments carrying the given tags.
     */
    getByTags = async (req: Request, res: Response): Promise<void> => {
        try {
            const tags = parseList(req.query.tags);
            if (tags.length === 0) {
                res.status(400).json({ error: 'tags query parameter is required' });
                return;
            }
            res.json({ tags: await this.service.getAddressesByTags(tags) });
        } catch (error) {
            this.fail(res, error, 'Failed to load addresses by tag');
        }
    };

    /**
     * GET /tags?prefix=&limit= — the distinct tag vocabulary.
     */
    listTags = async (req: Request, res: Response): Promise<void> => {
        try {
            const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : undefined;
            const limit = req.query.limit ? Number(req.query.limit) : undefined;
            res.json({ tags: await this.service.listTags({ prefix, limit }) });
        } catch (error) {
            this.fail(res, error, 'Failed to list tags');
        }
    };

    /**
     * Map service validation throws to 400 and everything else to 500.
     *
     * @param res - Response to write the failure to.
     * @param error - The thrown error.
     * @param message - Log line describing which handler failed.
     */
    private fail(res: Response, error: unknown, message: string): void {
        const text = error instanceof Error ? error.message : 'Unknown error';
        if (/^Invalid|^Batch exceeds/.test(text)) {
            res.status(400).json({ error: text });
            return;
        }
        this.logger.error({ error }, message);
        res.status(500).json({ error: message });
    }
}

/**
 * Parse a comma-separated query value into a trimmed, non-empty string array.
 * Arrays fit awkwardly in GETs; comma-separation keeps reads cacheable and
 * bookmarkable where a POST body would not be.
 *
 * @param value - Raw Express query value.
 * @returns The parsed list, empty when absent.
 */
export function parseList(value: unknown): string[] {
    if (typeof value !== 'string') {
        return [];
    }
    return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}
