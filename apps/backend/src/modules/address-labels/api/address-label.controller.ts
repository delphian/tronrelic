/**
 * Address label API controller.
 *
 * Handles HTTP requests for address label CRUD operations.
 * Separates admin endpoints (full CRUD) from public endpoints (read-only lookup).
 */

import type { Request, Response, NextFunction } from 'express';
import type {
    ISystemLogService,
    IAddressLabelFilter,
    ICreateAddressLabelInput,
    IUpdateAddressLabelInput,
    AddressCategory,
    AddressLabelSourceType
} from '@tronrelic/types';
import type { AddressLabelService } from '../services/address-label.service.js';

/**
 * Controller for address label HTTP endpoints.
 *
 * Provides handlers for:
 * - Public lookup by address
 * - Bulk lookup for multiple addresses
 * - Admin CRUD operations
 * - Statistics and export
 */
export class AddressLabelController {
    /**
     * Create the controller.
     *
     * @param labelService - Address label service instance
     * @param logger - System log service
     */
    constructor(
        private readonly labelService: AddressLabelService,
        private readonly logger: ISystemLogService
    ) {}

    // =========================================================================
    // Public Endpoints
    // =========================================================================

    /**
     * Look up a label by address.
     *
     * GET /api/address-labels/:address
     */
    async getByAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { address } = req.params;

            if (!address) {
                res.status(400).json({ error: 'Address is required' });
                return;
            }

            const label = await this.labelService.findByAddress(address);

            if (!label) {
                res.status(404).json({ error: 'Label not found' });
                return;
            }

            res.json({ label });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Bulk lookup labels for multiple addresses.
     *
     * POST /api/address-labels/bulk
     * Body: { addresses: string[] }
     */
    async bulkLookup(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { addresses } = req.body;

            if (!Array.isArray(addresses)) {
                res.status(400).json({ error: 'addresses must be an array' });
                return;
            }

            if (addresses.length > 100) {
                res.status(400).json({ error: 'Maximum 100 addresses per request' });
                return;
            }

            const labels = await this.labelService.findByAddresses(addresses);

            // Convert Map to object for JSON serialization
            const result: Record<string, unknown> = {};
            for (const [address, label] of labels) {
                result[address] = label;
            }

            res.json({ labels: result });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Resolve label with alternates.
     *
     * GET /api/address-labels/:address/resolve
     */
    async resolveLabel(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { address } = req.params;

            if (!address) {
                res.status(400).json({ error: 'Address is required' });
                return;
            }

            const resolved = await this.labelService.resolveLabel(address);

            if (!resolved) {
                res.status(404).json({ error: 'No labels found for address' });
                return;
            }

            res.json(resolved);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Search labels by text query.
     *
     * GET /api/address-labels/search?q=binance&limit=20
     */
    async search(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { q, limit } = req.query;

            if (!q || typeof q !== 'string') {
                res.status(400).json({ error: 'Query parameter q is required' });
                return;
            }

            const parsedLimit = limit ? parseInt(limit as string, 10) : 20;
            const labels = await this.labelService.search(q, parsedLimit);

            res.json({ labels });
        } catch (error) {
            next(error);
        }
    }

    // =========================================================================
    // Admin Endpoints
    // =========================================================================

    /**
     * List labels with filtering and pagination.
     *
     * GET /api/admin/address-labels
     */
    async list(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const {
                category,
                sourceType,
                source,
                tag,
                verified,
                minConfidence,
                search,
                page,
                limit
            } = req.query;

            const filter: IAddressLabelFilter = {};

            if (category) filter.category = category as AddressCategory;
            if (sourceType) filter.sourceType = sourceType as AddressLabelSourceType;
            if (source) filter.source = source as string;
            if (tag) filter.tag = tag as string;
            if (verified !== undefined) filter.verified = verified === 'true';
            if (minConfidence) filter.minConfidence = parseInt(minConfidence as string, 10);
            if (search) filter.search = search as string;

            const parsedPage = page ? parseInt(page as string, 10) : 1;
            const parsedLimit = limit ? parseInt(limit as string, 10) : 50;

            const result = await this.labelService.list(filter, parsedPage, parsedLimit);

            res.json(result);
        } catch (error) {
            next(error);
        }
    }

    /**
     * Create a new label.
     *
     * POST /api/admin/address-labels
     */
    async create(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const input = this.parseCreateInput(req.body);

            if (!input) {
                res.status(400).json({ error: 'Invalid input' });
                return;
            }

            const label = await this.labelService.create(input);

            this.logger.info({ address: label.address, source: label.source }, 'Address label created via admin API');

            res.status(201).json({ label });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update an existing label.
     *
     * PATCH /api/admin/address-labels/:address
     * Body must include source to identify which label to update
     */
    async update(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { address } = req.params;
            const { source, ...updates } = req.body;

            if (!address) {
                res.status(400).json({ error: 'Address is required' });
                return;
            }

            if (!source) {
                res.status(400).json({ error: 'Source is required to identify the label' });
                return;
            }

            const label = await this.labelService.update(address, source, updates as IUpdateAddressLabelInput);

            this.logger.info({ address, source }, 'Address label updated via admin API');

            res.json({ label });
        } catch (error) {
            if (error instanceof Error && error.message.includes('not found')) {
                res.status(404).json({ error: error.message });
                return;
            }
            next(error);
        }
    }

    /**
     * Delete a label.
     *
     * DELETE /api/admin/address-labels/:address
     * Query: ?source=system
     */
    async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { address } = req.params;
            const { source } = req.query;

            if (!address) {
                res.status(400).json({ error: 'Address is required' });
                return;
            }

            if (!source || typeof source !== 'string') {
                res.status(400).json({ error: 'Source query parameter is required' });
                return;
            }

            await this.labelService.delete(address, source);

            this.logger.info({ address, source }, 'Address label deleted via admin API');

            res.status(204).send();
        } catch (error) {
            if (error instanceof Error && error.message.includes('not found')) {
                res.status(404).json({ error: error.message });
                return;
            }
            next(error);
        }
    }

    /**
     * Get label statistics.
     *
     * GET /api/admin/address-labels/stats
     */
    async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const stats = await this.labelService.getStats();
            res.json({ stats });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Import labels in bulk.
     *
     * POST /api/admin/address-labels/import
     */
    async importLabels(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { labels } = req.body;

            if (!Array.isArray(labels)) {
                res.status(400).json({ error: 'labels must be an array' });
                return;
            }

            const inputs = labels
                .map(l => this.parseCreateInput(l))
                .filter((l): l is ICreateAddressLabelInput => l !== null);

            if (inputs.length === 0) {
                res.status(400).json({ error: 'No valid labels to import' });
                return;
            }

            const result = await this.labelService.importLabels(inputs);

            this.logger.info({
                imported: result.imported,
                updated: result.updated,
                failed: result.failed
            }, 'Bulk import completed via admin API');

            res.json({ result });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Export labels.
     *
     * GET /api/admin/address-labels/export
     */
    async exportLabels(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { category, sourceType, source, verified } = req.query;

            const filter: IAddressLabelFilter = {};
            if (category) filter.category = category as AddressCategory;
            if (sourceType) filter.sourceType = sourceType as AddressLabelSourceType;
            if (source) filter.source = source as string;
            if (verified !== undefined) filter.verified = verified === 'true';

            const labels = await this.labelService.exportLabels(filter);

            res.json({ labels, count: labels.length });
        } catch (error) {
            next(error);
        }
    }

    // =========================================================================
    // Private Helpers
    // =========================================================================

    /**
     * Parse and validate create input from request body.
     */
    private parseCreateInput(body: unknown): ICreateAddressLabelInput | null {
        if (!body || typeof body !== 'object') {
            return null;
        }

        const input = body as Record<string, unknown>;

        if (!input.address || typeof input.address !== 'string') {
            return null;
        }

        if (!input.label || typeof input.label !== 'string') {
            return null;
        }

        if (!input.category || typeof input.category !== 'string') {
            return null;
        }

        if (!input.source || typeof input.source !== 'string') {
            return null;
        }

        if (!input.sourceType || typeof input.sourceType !== 'string') {
            return null;
        }

        return {
            address: input.address,
            label: input.label,
            category: input.category as AddressCategory,
            tags: Array.isArray(input.tags) ? input.tags : [],
            source: input.source,
            sourceType: input.sourceType as AddressLabelSourceType,
            confidence: typeof input.confidence === 'number' ? input.confidence : 50,
            verified: typeof input.verified === 'boolean' ? input.verified : false,
            tronMetadata: input.tronMetadata as ICreateAddressLabelInput['tronMetadata'],
            notes: typeof input.notes === 'string' ? input.notes : undefined,
            customMetadata: input.customMetadata as Record<string, unknown>
        };
    }
}
