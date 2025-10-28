import { v4 as uuidv4 } from 'uuid';
import type { Collection } from 'mongodb';
import type { IDatabaseService, ICacheService, ISystemLogService } from '@tronrelic/types';
import type { IThemeDocument, ICreateThemeInput, IUpdateThemeInput } from '../database/index.js';

/**
 * Ordered theme for frontend injection.
 * Includes only the fields needed for SSR rendering.
 */
export interface IOrderedTheme {
    id: string;
    name: string;
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
     * Create a new theme with auto-generated UUID and timestamps.
     *
     * @param input - Theme creation data (name, css, dependencies, isActive)
     * @returns Created theme document
     * @throws Error if theme with same name already exists
     */
    async createTheme(input: ICreateThemeInput): Promise<IThemeDocument> {
        // Check for duplicate name
        const existing = await this.collection.findOne({ name: input.name });
        if (existing) {
            throw new Error(`Theme with name "${input.name}" already exists`);
        }

        const now = new Date();
        const theme: Omit<IThemeDocument, '_id'> = {
            id: uuidv4(),
            name: input.name,
            css: input.css,
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
     * Results are cached in Redis for 1 hour to avoid repeated database queries
     * and topological sorting on every page load.
     *
     * @returns Ordered array of active themes (id, name, css only)
     * @throws Error if circular dependencies are detected
     */
    async getActiveThemes(): Promise<IOrderedTheme[]> {
        // Try cache first
        const cached = await this.cacheService.get<IOrderedTheme[]>(this.CACHE_KEY_ACTIVE);
        if (cached) {
            return cached;
        }

        // Fetch active themes from database
        const themes = await this.collection.find({ isActive: true }).toArray();

        if (themes.length === 0) {
            return [];
        }

        // Sort by dependencies
        const ordered = this.sortThemesByDependencies(themes);

        // Extract only needed fields for frontend
        const result: IOrderedTheme[] = ordered.map(t => ({
            id: t.id,
            name: t.name,
            css: t.css
        }));

        // Cache for 1 hour
        await this.cacheService.set(this.CACHE_KEY_ACTIVE, result, this.CACHE_TTL);

        return result;
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
     * @param id - Theme UUID
     */
    private async invalidateThemeCache(id: string): Promise<void> {
        const cacheKey = `${this.CACHE_KEY_PREFIX}${id}`;
        await this.cacheService.invalidate(cacheKey);
    }

    /**
     * Invalidate Redis cache for active themes list.
     *
     * Called whenever any theme's active status changes or when theme
     * content/dependencies are modified for an active theme.
     */
    private async invalidateActiveCache(): Promise<void> {
        await this.cacheService.invalidate(this.CACHE_KEY_ACTIVE);
        this.logger.debug('Active themes cache invalidated');
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
