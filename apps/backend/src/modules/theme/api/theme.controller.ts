import type { Request, Response } from 'express';
import type { ISystemLogService } from '@tronrelic/types';
import type { ThemeService } from '../services/theme.service.js';
import type { ThemeValidator } from '../validators/theme.validator.js';
import type { ICreateThemeInput, IUpdateThemeInput } from '../database/index.js';

/**
 * HTTP controller for theme management endpoints.
 *
 * Handles request parsing, response formatting, and error handling for all
 * theme operations. Business logic is delegated to ThemeService and validation
 * to ThemeValidator.
 */
export class ThemeController {
    /**
     * Create a theme controller.
     *
     * @param themeService - Theme service for business logic
     * @param validator - CSS validator for syntax checking
     * @param logger - System log service for error tracking
     */
    constructor(
        private readonly themeService: ThemeService,
        private readonly validator: ThemeValidator,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /api/system/themes
     * List all themes (public endpoint).
     *
     * Returns all themes with complete metadata including CSS content.
     * For production use, consider a separate endpoint that excludes CSS
     * to reduce response payload size.
     */
    async listThemes(req: Request, res: Response): Promise<void> {
        try {
            const themes = await this.themeService.listThemes();
            res.json({ themes, total: themes.length });
        } catch (error) {
            this.logger.error({ error }, 'Failed to list themes');
            res.status(500).json({ error: 'Failed to list themes' });
        }
    }

    /**
     * GET /api/system/themes/:id
     * Get a single theme by UUID (public endpoint).
     */
    async getTheme(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const theme = await this.themeService.getTheme(id);

            if (!theme) {
                res.status(404).json({ error: `Theme with id "${id}" not found` });
                return;
            }

            res.json({ theme });
        } catch (error) {
            this.logger.error({ error, themeId: req.params.id }, 'Failed to get theme');
            res.status(500).json({ error: 'Failed to get theme' });
        }
    }

    /**
     * GET /api/system/themes/active
     * Get all active themes ordered by dependencies (public endpoint).
     *
     * Used by frontend for SSR theme injection. Returns minimal theme data
     * (id, name, css) in dependency order for performance.
     */
    async getActiveThemes(req: Request, res: Response): Promise<void> {
        try {
            const themes = await this.themeService.getActiveThemes();
            res.json({ themes });
        } catch (error) {
            this.logger.error({ error }, 'Failed to get active themes');
            res.status(500).json({
                error: error instanceof Error ? error.message : 'Failed to get active themes'
            });
        }
    }

    /**
     * POST /api/admin/system/themes
     * Create a new theme (admin only).
     *
     * Request body:
     * {
     *   name: string (required),
     *   css: string (required),
     *   dependencies: string[] (optional),
     *   isActive: boolean (optional, default: false)
     * }
     */
    async createTheme(req: Request, res: Response): Promise<void> {
        try {
            const input: ICreateThemeInput = req.body;

            // Validate required fields
            if (!input.name || !input.css) {
                res.status(400).json({ error: 'Name and css are required' });
                return;
            }

            // Validate CSS syntax
            const validation = await this.validator.validate(input.css);
            if (!validation.valid) {
                res.status(400).json({
                    error: 'Invalid CSS syntax',
                    errors: validation.errors
                });
                return;
            }

            const theme = await this.themeService.createTheme(input);
            res.status(201).json({ theme });
        } catch (error) {
            this.logger.error({ error, input: req.body }, 'Failed to create theme');
            res.status(400).json({
                error: error instanceof Error ? error.message : 'Failed to create theme'
            });
        }
    }

    /**
     * PUT /api/admin/system/themes/:id
     * Update an existing theme (admin only).
     *
     * Request body: Same as create, but all fields are optional.
     */
    async updateTheme(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const input: IUpdateThemeInput = req.body;

            // Validate CSS if provided
            if (input.css) {
                const validation = await this.validator.validate(input.css);
                if (!validation.valid) {
                    res.status(400).json({
                        error: 'Invalid CSS syntax',
                        errors: validation.errors
                    });
                    return;
                }
            }

            const theme = await this.themeService.updateTheme(id, input);
            res.json({ theme });
        } catch (error) {
            this.logger.error({ error, themeId: req.params.id, input: req.body }, 'Failed to update theme');

            if (error instanceof Error && error.message.includes('not found')) {
                res.status(404).json({ error: error.message });
            } else {
                res.status(400).json({
                    error: error instanceof Error ? error.message : 'Failed to update theme'
                });
            }
        }
    }

    /**
     * DELETE /api/admin/system/themes/:id
     * Delete a theme (admin only).
     *
     * Fails if theme is a dependency of any active themes.
     */
    async deleteTheme(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            await this.themeService.deleteTheme(id);
            res.json({ message: 'Theme deleted successfully' });
        } catch (error) {
            this.logger.error({ error, themeId: req.params.id }, 'Failed to delete theme');

            if (error instanceof Error && error.message.includes('not found')) {
                res.status(404).json({ error: error.message });
            } else if (error instanceof Error && error.message.includes('dependency')) {
                res.status(409).json({ error: error.message });
            } else {
                res.status(400).json({
                    error: error instanceof Error ? error.message : 'Failed to delete theme'
                });
            }
        }
    }

    /**
     * PATCH /api/admin/system/themes/:id/toggle
     * Toggle theme active status (admin only).
     *
     * Request body:
     * {
     *   isActive: boolean (required)
     * }
     */
    async toggleTheme(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { isActive } = req.body;

            if (typeof isActive !== 'boolean') {
                res.status(400).json({ error: 'isActive must be a boolean' });
                return;
            }

            const theme = await this.themeService.toggleTheme(id, isActive);
            res.json({
                theme,
                message: `Theme ${isActive ? 'enabled' : 'disabled'} successfully`
            });
        } catch (error) {
            this.logger.error({ error, themeId: req.params.id }, 'Failed to toggle theme');

            if (error instanceof Error && error.message.includes('not found')) {
                res.status(404).json({ error: error.message });
            } else {
                res.status(400).json({
                    error: error instanceof Error ? error.message : 'Failed to toggle theme'
                });
            }
        }
    }

    /**
     * POST /api/admin/system/themes/:id/validate
     * Validate theme CSS syntax without saving (admin only).
     *
     * Request body:
     * {
     *   css: string (required)
     * }
     */
    async validateCSS(req: Request, res: Response): Promise<void> {
        try {
            const { css } = req.body;

            if (!css) {
                res.status(400).json({ error: 'CSS content is required' });
                return;
            }

            const validation = await this.validator.validate(css);
            res.json(validation);
        } catch (error) {
            this.logger.error({ error }, 'Failed to validate CSS');
            res.status(500).json({ error: 'Failed to validate CSS' });
        }
    }
}
