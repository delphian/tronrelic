/**
 * @fileoverview HTTP handlers for the `/a/<address>` page's data.
 *
 * Both routes sit behind `requireLogin`, applied when the module mounts the
 * router, because every request runs ClickHouse queries that cost real
 * capacity. Any signed-in account may look up any address: the data is public
 * chain history, so there is no ownership check. Every value from the request
 * is validated here before it reaches the service.
 */

import type { Request, Response } from 'express';
import type { AddressExplorerPeriod, IAddressExplorerTransfersCursor, ISystemLogService } from '@/types';
import { toVerifiedBase58 } from '../../../lib/tron-address.js';
import {
    ADDRESS_EXPLORER_PERIODS,
    ADDRESS_EXPLORER_SPAN_SECTIONS,
    type AddressExplorerService
} from '../services/AddressExplorerService.js';

/** The span used when the request names none. */
const DEFAULT_PERIOD: AddressExplorerPeriod = '7d';

/** Longest transfers cursor accepted. Real ones are a few hundred characters of base64url. */
const MAX_CURSOR_LENGTH = 2_048;

/** Characters a base64url cursor can contain. */
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Read the `:address` route parameter as a checksum-verified base58 address.
 *
 * @param req - The request.
 * @returns The address, or null when it is not a valid TRON address.
 */
function readAddress(req: Request): string | null {
    return toVerifiedBase58(String(req.params.address ?? '').trim());
}

/**
 * Handlers for the address page's section and transfers routes.
 */
export class AddressExplorerController {
    /**
     * @param service - Assembles the page's sections.
     * @param logger - The module's logger, for unexpected failures.
     */
    constructor(
        private readonly service: AddressExplorerService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /:address/sections/:section?period=24h|7d|21d — one span section of the page.
     *
     * The page requests each section separately so they are read in parallel
     * and each reaches the visitor as soon as it is ready. Responds 400 for an
     * invalid address, section, or span, and otherwise 200 with `{ section }`,
     * even when the read failed: the section carries its own failure reason.
     *
     * @param req - The request; `req.userId` is set by `requireLogin`.
     * @param res - The response.
     */
    getSpanSection = async (req: Request, res: Response): Promise<void> => {
        const address = readAddress(req);
        const sectionParam = String(req.params.section ?? '');
        const name = ADDRESS_EXPLORER_SPAN_SECTIONS.find(item => item === sectionParam);
        const periodParam = req.query.period === undefined ? DEFAULT_PERIOD : String(req.query.period);
        const period = ADDRESS_EXPLORER_PERIODS.find(item => item === periodParam);
        if (!req.userId) {
            res.status(401).json({ error: 'Authentication required' });
        } else if (!address) {
            res.status(400).json({ error: 'Not a valid TRON address' });
        } else if (!name) {
            res.status(400).json({ error: `section must be one of ${ADDRESS_EXPLORER_SPAN_SECTIONS.join(', ')}` });
        } else if (!period) {
            res.status(400).json({ error: `period must be one of ${ADDRESS_EXPLORER_PERIODS.join(', ')}` });
        } else {
            try {
                const section = await this.service.getSpanSection(name, address, period, req.userId);
                res.json({ section });
            } catch (error) {
                this.logger.error({ error, address, section: name, period }, 'Failed to read an address page section');
                res.status(500).json({ error: 'Failed to load address activity' });
            }
        }
    };

    /**
     * GET /:address/transfers?before=<ISO time>&cursor=<cursor> — an older page of transfers.
     *
     * `before` and `cursor` come from the `next` object of the previous page.
     * With neither, the newest page is returned. Responds 400 for an invalid
     * address, time, or cursor, and otherwise 200 with `{ transfers }`.
     *
     * @param req - The request; `req.userId` is set by `requireLogin`.
     * @param res - The response.
     */
    getTransfers = async (req: Request, res: Response): Promise<void> => {
        const address = readAddress(req);
        const before = req.query.before === undefined ? undefined : String(req.query.before);
        const cursor = req.query.cursor === undefined ? undefined : String(req.query.cursor);
        const beforeValid = before === undefined || Number.isFinite(Date.parse(before));
        const cursorValid = cursor === undefined || (cursor.length <= MAX_CURSOR_LENGTH && CURSOR_PATTERN.test(cursor));
        if (!req.userId) {
            res.status(401).json({ error: 'Authentication required' });
        } else if (!address) {
            res.status(400).json({ error: 'Not a valid TRON address' });
        } else if (!beforeValid || !cursorValid || (cursor !== undefined && before === undefined)) {
            res.status(400).json({ error: 'before must be an ISO 8601 time, and cursor needs before' });
        } else {
            try {
                const position: IAddressExplorerTransfersCursor | undefined = before ? { before, ...(cursor ? { cursor } : {}) } : undefined;
                const transfers = await this.service.getTransfers(address, req.userId, position);
                res.json({ transfers });
            } catch (error) {
                this.logger.error({ error, address }, 'Failed to read address page transfers');
                res.status(500).json({ error: 'Failed to load transfers' });
            }
        }
    };
}
