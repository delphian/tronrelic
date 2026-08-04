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
 * Minimum search term length before `/suggest` will touch storage.
 *
 * The suggestion search matches a substring anywhere in an address or a tag,
 * which no existing index can bound, so a blank or one-character term would
 * make MongoDB group the entire assignment collection. Mirroring the client's
 * own minimum on the server means a hand-rolled or misbehaving caller cannot
 * trigger that sweep simply by omitting `search`.
 */
const MIN_SUGGEST_QUERY_LENGTH = 2;

/**
 * Controller exposing the read shapes: tags by addresses, addresses by tags,
 * the distinct tag vocabulary, and the address typeahead.
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
     * GET /suggest?search=&limit= — typeahead backing the shared
     * `AddressSelector` control.
     *
     * Returns whole addresses with their full tag lists, so one keystroke
     * populates a dropdown that can show both the address and why it matched.
     * Gated to registered users like every other read here, which is what lets
     * the selector degrade to a plain validated input for anonymous visitors
     * rather than exposing the tag vocabulary publicly.
     *
     * A term shorter than `MIN_SUGGEST_QUERY_LENGTH` returns an empty list
     * without touching storage, so no caller can turn the typeahead into an
     * unfiltered sweep of every assignment.
     */
    suggest = async (req: Request, res: Response): Promise<void> => {
        try {
            const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
            if (search.length < MIN_SUGGEST_QUERY_LENGTH) {
                res.json({ addresses: [] });
                return;
            }
            const limit = req.query.limit ? Number(req.query.limit) : undefined;
            res.json({ addresses: await this.service.searchAddresses({ search, limit }) });
        } catch (error) {
            this.fail(res, error, 'Failed to suggest addresses');
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
