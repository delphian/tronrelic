import { v4 as uuidv4 } from 'uuid';
import type { Collection } from 'mongodb';
import type { IDatabaseService, ICacheService, ISystemLogService } from '@tronrelic/types';
import type { IThemeDocument, ICreateThemeInput, IUpdateThemeInput } from '../database/index.js';

/**
 * Ordered theme for frontend injection.
 * Includes only the fields needed for SSR rendering and theme toggle.
 */
export interface IOrderedTheme {
    id: string;
    name: string;
    icon: string;
    css: string;
}

/**
 * Service for managing theme CRUD operations and dependency resolution.
 *
 * This singleton service handles theme lifecycle including creation, updates,
 * deletion, activation, and most importantly, resolving theme dependencies
 * for correct load order. Active themes are cached in Redis for performance.
 */
export class ThemeService {
    private static instance: ThemeService;
    private readonly collection: Collection<IThemeDocument>;
    private readonly CACHE_KEY_ACTIVE = 'themes:active';
    private readonly CACHE_KEY_PREFIX = 'themes:id:';
    private readonly CACHE_TTL = 3600; // 1 hour

    /**
     * Create a theme service.
     *
     * Private constructor enforces singleton pattern. Use setDependencies()
     * and getInstance() for access.
     *
     * @param database - Database service for MongoDB operations
     * @param cacheService - Redis cache for active theme list
     * @param logger - System log service for operations tracking
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly cacheService: ICacheService,
        private readonly logger: ISystemLogService
    ) {
        this.collection = database.getCollection<IThemeDocument>('themes');
    }

    /**
     * Initialize the singleton instance with dependencies.
     *
     * Must be called before getInstance(). Typically invoked during
     * application bootstrap in the theme module's init() phase.
     *
     * @param database - Database service
     * @param cacheService - Cache service
     * @param logger - System log service
     */
    public static setDependencies(
        database: IDatabaseService,
        cacheService: ICacheService,
        logger: ISystemLogService
    ): void {
        if (!ThemeService.instance) {
            ThemeService.instance = new ThemeService(database, cacheService, logger);
        }
    }

    /**
     * Get the singleton theme service instance.
     *
     * @throws Error if setDependencies() has not been called first
     * @returns Singleton theme service instance
     */
    public static getInstance(): ThemeService {
        if (!ThemeService.instance) {
            throw new Error('ThemeService.setDependencies() must be called before getInstance()');
        }
        return ThemeService.instance;
    }

    /**
     * List all themes with metadata.
     *
     * Returns complete theme documents including CSS content. For public-facing
     * endpoints, consider filtering out CSS content to reduce response size.
     *
     * @returns Array of all theme documents
     */
    async listThemes(): Promise<IThemeDocument[]> {
        return this.collection.find({}).toArray();
    }

    /**
     * Get a single theme by UUID.
     *
     * @param id - Theme UUID
     * @returns Theme document or null if not found
     */
    async getTheme(id: string): Promise<IThemeDocument | null> {
        // Try cache first
        const cacheKey = `${this.CACHE_KEY_PREFIX}${id}`;
        const cached = await this.cacheService.get<IThemeDocument>(cacheKey);
        if (cached) {
            return cached;
        }

        // Fetch from database
        const theme = await this.collection.findOne({ id });
        if (theme) {
            // Cache for 1 hour
            await this.cacheService.set(cacheKey, theme, this.CACHE_TTL);
        }

        return theme;
    }

    /**
     * Create a new theme with auto-generated or client-provided UUID and timestamps.
     *
     * @param input - Theme creation data (optional id, name, css, dependencies, isActive)
     * @returns Created theme document
     * @throws Error if theme with same name already exists or if provided UUID is invalid/duplicate
     */
    async createTheme(input: ICreateThemeInput): Promise<IThemeDocument> {
        let themeId: string;

        // Validate and assign UUID
        if (input.id) {
            // Client provided UUID - validate format
            if (!this.isValidUUID(input.id)) {
                throw new Error('Invalid UUID format. Must be a valid UUID v4.');
            }

            // Check for UUID collision
            const existingById = await this.collection.findOne({ id: input.id });
            if (existingById) {
                throw new Error(`Theme with ID "${input.id}" already exists`);
            }

            themeId = input.id;
            this.logger.debug({ themeId }, 'Using client-provided UUID');
        } else {
            // Server generates UUID
            themeId = uuidv4();
        }

        // Check for duplicate name
        const existingByName = await this.collection.findOne({ name: input.name });
        if (existingByName) {
            throw new Error(`Theme with name "${input.name}" already exists`);
        }

        const now = new Date();
        const normalizedCss = this.normalizeThemeCss(input.css, themeId);
        const theme: Omit<IThemeDocument, '_id'> = {
            id: themeId,
            name: input.name,
            icon: input.icon,
            css: normalizedCss,
            dependencies: input.dependencies || [],
            isActive: input.isActive || false,
            createdAt: now,
            updatedAt: now
        };

        const result = await this.collection.insertOne(theme as any);

        this.logger.info({ themeId: theme.id, name: theme.name }, 'Theme created');

        // Invalidate cache if theme is active
        if (theme.isActive) {
            await this.invalidateActiveCache();
        }

        return {
            _id: result.insertedId,
            ...theme
        } as IThemeDocument;
    }

    /**
     * Update an existing theme.
     *
     * @param id - Theme UUID
     * @param input - Fields to update (name, css, dependencies, isActive)
     * @returns Updated theme document
     * @throws Error if theme not found or name conflicts with another theme
     */
    async updateTheme(id: string, input: IUpdateThemeInput): Promise<IThemeDocument> {
        const theme = await this.collection.findOne({ id });
        if (!theme) {
            throw new Error(`Theme with id "${id}" not found`);
        }

        // Check for name conflicts (excluding current theme)
        if (input.name && input.name !== theme.name) {
            const duplicate = await this.collection.findOne({ name: input.name });
            if (duplicate) {
                throw new Error(`Theme with name "${input.name}" already exists`);
            }
        }

        const updates: Partial<IThemeDocument> = {
            ...input,
            updatedAt: new Date()
        };

        // Normalize CSS if being updated
        if (updates.css) {
            updates.css = this.normalizeThemeCss(updates.css, id);
        }

        await this.collection.updateOne({ id }, { $set: updates });

        this.logger.info({ themeId: id, updates: Object.keys(input) }, 'Theme updated');

        // Invalidate caches
        await this.invalidateThemeCache(id);
        if (input.isActive !== undefined || theme.isActive) {
            await this.invalidateActiveCache();
        }

        // Fetch and return updated document
        const updated = await this.collection.findOne({ id });
        return updated!;
    }

    /**
     * Delete a theme.
     *
     * Prevents deletion if the theme is a dependency of any active themes.
     * This ensures the system never enters a broken state with missing dependencies.
     *
     * @param id - Theme UUID to delete
     * @throws Error if theme not found or is a dependency of active themes
     */
    async deleteTheme(id: string): Promise<void> {
        const theme = await this.collection.findOne({ id });
        if (!theme) {
            throw new Error(`Theme with id "${id}" not found`);
        }

        // Check if theme is a dependency of any active themes
        const dependents = await this.collection.find({
            dependencies: id,
            isActive: true
        }).toArray();

        if (dependents.length > 0) {
            const dependentNames = dependents.map(t => t.name).join(', ');
            throw new Error(
                `Cannot delete theme "${theme.name}": it is a dependency of active themes: ${dependentNames}`
            );
        }

        await this.collection.deleteOne({ id });

        this.logger.info({ themeId: id, name: theme.name }, 'Theme deleted');

        // Invalidate caches
        await this.invalidateThemeCache(id);
        if (theme.isActive) {
            await this.invalidateActiveCache();
        }
    }

    /**
     * Toggle theme active status.
     *
     * @param id - Theme UUID
     * @param isActive - New active status
     * @returns Updated theme document
     * @throws Error if theme not found
     */
    async toggleTheme(id: string, isActive: boolean): Promise<IThemeDocument> {
        return this.updateTheme(id, { isActive });
    }

    /**
     * Get all active themes ordered by dependencies.
     *
     * This is the primary method used by the frontend for SSR injection.
     * Returns themes in dependency order (dependencies load before dependents)
     * with circular dependency detection and missing dependency warnings.
     *
     * Results are cached in Redis with a two-level strategy:
     * 1. Active theme IDs list (small, frequently invalidated)
     * 2. Individual theme data (large, rarely invalidated)
     *
     * This allows updating one theme without re-fetching all themes.
     *
     * @returns Ordered array of active themes (id, name, css only)
     * @throws Error if circular dependencies are detected
     */
    async getActiveThemes(): Promise<IOrderedTheme[]> {
        // Try to get list of active theme IDs from cache
        const cachedIds = await this.cacheService.get<string[]>(this.CACHE_KEY_ACTIVE);

        if (cachedIds && cachedIds.length > 0) {
            // Try to fetch individual themes from cache
            const cachedThemes: IOrderedTheme[] = [];
            let cacheMiss = false;

            for (const id of cachedIds) {
                const themeKey = `${this.CACHE_KEY_PREFIX}${id}`;
                const theme = await this.cacheService.get<IOrderedTheme>(themeKey);

                if (theme) {
                    cachedThemes.push(theme);
                } else {
                    cacheMiss = true;
                    break;
                }
            }

            // If all individual themes found in cache, return them
            if (!cacheMiss && cachedThemes.length === cachedIds.length) {
                this.logger.debug('Active themes served from cache (two-level hit)');
                return cachedThemes;
            }
        }

        // Cache miss - fetch from database
        const themes = await this.collection.find({ isActive: true }).toArray();

        if (themes.length === 0) {
            // Cache empty result
            await this.cacheService.set(
                this.CACHE_KEY_ACTIVE,
                [],
                this.CACHE_TTL,
                ['themes:active']
            );
            return [];
        }

        // Sort by dependencies
        const ordered = this.sortThemesByDependencies(themes);

        // Extract only needed fields for frontend
        const result: IOrderedTheme[] = ordered.map(t => ({
            id: t.id,
            name: t.name,
            icon: t.icon,
            css: t.css
        }));

        // Cache individual themes with proper tags
        await this.cacheActiveThemes(result);

        this.logger.debug({ count: result.length }, 'Active themes cached (two-level write)');

        return result;
    }

    /**
     * Cache active themes using two-level strategy.
     *
     * Level 1: List of active theme IDs (small, tagged with 'themes:active')
     * Level 2: Individual theme data (large, tagged with both 'themes:active' and theme UUID)
     *
     * This allows:
     * - Invalidating one theme by UUID without re-fetching others
     * - Invalidating all active themes with 'themes:active' tag
     * - Efficient granular updates at scale (10-20+ themes)
     *
     * @param themes - Ordered array of active themes to cache
     */
    private async cacheActiveThemes(themes: IOrderedTheme[]): Promise<void> {
        const activeTag = 'themes:active';

        // Cache individual themes
        for (const theme of themes) {
            const themeKey = `${this.CACHE_KEY_PREFIX}${theme.id}`;
            await this.cacheService.set(
                themeKey,
                theme,
                this.CACHE_TTL,
                [activeTag, theme.id]  // Tag with both 'themes:active' and UUID
            );
        }

        // Cache list of active theme IDs (preserves dependency order)
        const activeIds = themes.map(t => t.id);
        await this.cacheService.set(
            this.CACHE_KEY_ACTIVE,
            activeIds,
            this.CACHE_TTL,
            [activeTag]
        );
    }

    /**
     * Sort themes by dependencies using topological sort.
     *
     * Implements Kahn's algorithm for dependency resolution. Detects circular
     * dependencies and logs warnings for missing dependencies while gracefully
     * continuing with partial ordering.
     *
     * @param themes - Array of theme documents to sort
     * @returns Sorted array with dependencies before dependents
     * @throws Error if circular dependencies are detected
     */
    private sortThemesByDependencies(themes: IThemeDocument[]): IThemeDocument[] {
        // Build ID to theme map
        const themeMap = new Map<string, IThemeDocument>();
        themes.forEach(t => themeMap.set(t.id, t));

        // Build in-degree map (number of dependencies)
        const inDegree = new Map<string, number>();
        themes.forEach(theme => {
            inDegree.set(theme.id, 0);
        });

        // Calculate in-degrees and check for missing dependencies
        themes.forEach(theme => {
            theme.dependencies.forEach(depId => {
                if (!themeMap.has(depId)) {
                    this.logger.warn(
                        { themeId: theme.id, themeName: theme.name, missingDepId: depId },
                        'Theme references missing dependency - will be skipped'
                    );
                } else {
                    const current = inDegree.get(theme.id) || 0;
                    inDegree.set(theme.id, current + 1);
                }
            });
        });

        // Kahn's algorithm for topological sort
        const queue: IThemeDocument[] = [];
        const result: IThemeDocument[] = [];

        // Start with themes that have no dependencies
        themes.forEach(theme => {
            if (inDegree.get(theme.id) === 0) {
                queue.push(theme);
            }
        });

        while (queue.length > 0) {
            const theme = queue.shift()!;
            result.push(theme);

            // For each theme that depends on this one
            themes.forEach(dependent => {
                if (dependent.dependencies.includes(theme.id)) {
                    const degree = inDegree.get(dependent.id)! - 1;
                    inDegree.set(dependent.id, degree);

                    if (degree === 0) {
                        queue.push(dependent);
                    }
                }
            });
        }

        // Check for circular dependencies
        if (result.length !== themes.length) {
            const unprocessed = themes.filter(t => !result.includes(t));
            const unprocessedNames = unprocessed.map(t => t.name).join(', ');

            this.logger.error(
                { unprocessedThemes: unprocessedNames },
                'Circular dependency detected in themes'
            );

            throw new Error(
                `Circular dependency detected in themes: ${unprocessedNames}. Please check theme dependencies and remove cycles.`
            );
        }

        return result;
    }

    /**
     * Invalidate Redis cache for a specific theme.
     *
     * Removes all cache entries tagged with this theme's UUID. This clears
     * the individual theme data but preserves other themes in the cache.
     *
     * Granular invalidation - only the updated theme is re-fetched on next
     * getActiveThemes() call, not the entire list.
     *
     * @param id - Theme UUID to invalidate
     */
    private async invalidateThemeCache(id: string): Promise<void> {
        await this.cacheService.invalidate(id);
        this.logger.debug({ themeId: id }, 'Theme cache invalidated by UUID tag');
    }

    /**
     * Invalidate Redis cache for all active themes.
     *
     * Removes all cache entries tagged with 'themes:active'. This clears
     * both the active IDs list and all individual theme data.
     *
     * Called whenever:
     * - Any theme's active status changes (theme added/removed from active list)
     * - Theme content/dependencies modified for an active theme
     *
     * Batch invalidation - all themes must be re-fetched and re-sorted on
     * next getActiveThemes() call.
     */
    private async invalidateActiveCache(): Promise<void> {
        await this.cacheService.invalidate('themes:active');
        this.logger.debug('Active themes cache invalidated (batch)');
    }

    /**
     * Validate UUID v4 format.
     *
     * Checks if the provided string matches the UUID v4 specification with proper
     * version (4) and variant (8, 9, a, or b) bits.
     *
     * @param str - String to validate
     * @returns True if valid UUID v4, false otherwise
     */
    private isValidUUID(str: string): boolean {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuidRegex.test(str);
    }

    /**
     * Normalize CSS to ensure data-theme selectors match the theme's UUID.
     *
     * Replaces any `[data-theme="..."]` selectors with the correct theme ID.
     * This prevents mismatches when users edit CSS templates or copy from other themes.
     *
     * @param css - Raw CSS content
     * @param themeId - Theme UUID that should be used in selectors
     * @returns Normalized CSS with corrected data-theme selectors
     */
    private normalizeThemeCss(css: string, themeId: string): string {
        // Match [data-theme="anything"] or [data-theme='anything']
        const dataThemeRegex = /\[data-theme=["'][^"']*["']\]/g;
        return css.replace(dataThemeRegex, `[data-theme="${themeId}"]`);
    }

    /**
     * Create database indexes for theme collection.
     *
     * Called during module initialization to ensure optimal query performance.
     */
    async createIndexes(): Promise<void> {
        await this.collection.createIndex({ id: 1 }, { unique: true });
        await this.collection.createIndex({ name: 1 }, { unique: true });
        await this.collection.createIndex({ isActive: 1 });

        this.logger.info('Theme indexes created');
    }
}
