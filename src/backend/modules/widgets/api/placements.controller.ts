/**
 * @fileoverview Admin controller for widget-placement CRUD.
 *
 * Powers the `/system/widgets` placement editor. All endpoints are
 * mounted behind `requireAdmin` and the platform's admin rate
 * limiter — see `WidgetsModule.run()` for the bind.
 *
 * The controller validates input against the live zone and widget-
 * type registries before touching the placement service. A request
 * naming an unknown zone or type is refused before any state change.
 * Pattern validation for `routes` flows through
 * `normaliseRoutePattern` so the matcher's accepted grammar (exact,
 * `/seg/*`, `/seg/**`) is the single source of truth.
 *
 * @module backend/modules/widgets/api/placements.controller
 */

import type { Request, Response } from 'express';
import type {
    ISystemLogService,
    IPlacementService,
    IZoneRegistry,
    IWidgetTypeRegistry,
    PlacementSource
} from '@/types';
import { normaliseRoutePattern } from '../placements/route-matcher.js';
import type { IPluginRegistrationDefaults } from '../../../services/widget/widget.service.js';

/**
 * Resolver for plugin defaults. Provided by `WidgetsModule.init()` so
 * the controller does not import the legacy widget service directly.
 */
export type PluginDefaultsResolver = (
    pluginId: string,
    typeId: string
) => IPluginRegistrationDefaults | null;

/**
 * Constructor dependencies for the placements controller.
 */
export interface IPlacementsControllerDeps {
    placements: IPlacementService;
    zones: IZoneRegistry;
    widgetTypes: IWidgetTypeRegistry;
    getPluginDefault: PluginDefaultsResolver;
    logger: ISystemLogService;
}

/**
 * Upper bound on a placement's `order` field. Lower numbers render
 * first within a zone. The bound is generous (10,000) so operators can
 * use coarse-grained values like 100/200/300 without colliding with
 * plugin defaults that cluster around 100.
 */
const MAX_ORDER = 10_000;

/**
 * Upper bound on a placement `title` override length. Matches the
 * existing legacy widget-config `title` constraint and the column
 * budget of the rendered card heading.
 */
const MAX_TITLE_LENGTH = 80;

/**
 * Format gate for zone ids. Zone ids are lowercase-dotted (letters,
 * digits, hyphens, underscores, colons for namespaced cases), start
 * with a letter, and never exceed 64 characters. Anything else is a
 * malformed input and must not reach the Mongo query.
 */
const ZONE_ID_PATTERN = /^[a-z][a-z0-9_:-]{0,63}$/;

/**
 * Format gate for plugin ids. Same shape as a zone id minus the
 * colon — plugin ids never carry namespaced segments.
 */
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Read a query-string value, coerce it to a string, validate it
 * against the supplied regex, and return the sanitised result.
 *
 * Two-step defence:
 *
 * 1. Explicit `String(...)` coercion neutralises Express's parsed-
 *    object form (`?zoneId[$ne]=foo` becomes a `[object Object]`
 *    literal that fails the regex). CodeQL's taint analysis
 *    recognises `String(taint)` as a coercion sanitiser.
 * 2. The regex enforces a known-safe shape, so even if a coerced
 *    value somehow carried Mongo operators they could not survive
 *    the test.
 *
 * Returns `undefined` when the value is missing or fails validation.
 * Callers omit the filter key in that case, preserving the existing
 * "no filter" semantic.
 */
function safeStringParam(value: unknown, pattern: RegExp): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') return undefined;
    const coerced = String(value);
    if (coerced.length === 0) return undefined;
    return pattern.test(coerced) ? coerced : undefined;
}

/**
 * Admin controller for placement CRUD plus restore-defaults.
 */
export class PlacementsController {
    constructor(private readonly deps: IPlacementsControllerDeps) {}

    /**
     * GET /api/admin/system/widgets/placements
     *
     * Query params (all optional): `zoneId`, `pluginId`, `source`
     * (`plugin` | `operator`), `enabledOnly` (truthy → only enabled
     * rows). Each string param is coerced through `String(...)` and
     * gated against a format regex before reaching the placement
     * service — see `safeStringParam` for the NoSQL-injection defence.
     */
    listPlacements = async (req: Request, res: Response): Promise<void> => {
        try {
            const filter: {
                zoneId?: string;
                pluginId?: string;
                source?: PlacementSource;
                enabledOnly?: boolean;
            } = {};

            const zoneId = safeStringParam(req.query.zoneId, ZONE_ID_PATTERN);
            if (zoneId !== undefined) filter.zoneId = zoneId;

            const pluginId = safeStringParam(req.query.pluginId, PLUGIN_ID_PATTERN);
            if (pluginId !== undefined) filter.pluginId = pluginId;

            // `source` and `enabledOnly` ride on equality allowlists.
            // Assign the literal we just compared against rather than
            // the request value so CodeQL's taint tracking sees a
            // constant flowing into the filter, not a sanitised-but-
            // still-tainted user input.
            if (req.query.source === 'plugin') {
                filter.source = 'plugin';
            } else if (req.query.source === 'operator') {
                filter.source = 'operator';
            }
            if (req.query.enabledOnly === 'true' || req.query.enabledOnly === '1') {
                filter.enabledOnly = true;
            }

            const placements = await this.deps.placements.list(filter);
            res.json({ success: true, placements });
        } catch (err) {
            this.deps.logger.error({ err }, 'Failed to list placements');
            res.status(500).json({ success: false, error: 'Failed to list placements' });
        }
    };

    /**
     * GET /api/admin/system/widgets/placements/:id
     */
    getPlacement = async (req: Request, res: Response): Promise<void> => {
        try {
            const placement = await this.deps.placements.findById(req.params.id);
            if (!placement) {
                res.status(404).json({ success: false, error: 'Placement not found' });
                return;
            }
            res.json({ success: true, placement });
        } catch (err) {
            this.deps.logger.error({ err, id: req.params.id }, 'Failed to read placement');
            res.status(500).json({ success: false, error: 'Failed to read placement' });
        }
    };

    /**
     * POST /api/admin/system/widgets/placements
     *
     * Body: `{ typeId, zoneId, routes, order?, title?, instanceConfig?, enabled? }`.
     * Always creates an operator-source row; plugin-source rows are
     * only writable by the legacy widget-service compatibility shim.
     */
    createPlacement = async (req: Request, res: Response): Promise<void> => {
        try {
            const parsed = this.parseCreateBody(req.body);
            if ('error' in parsed) {
                res.status(400).json({ success: false, error: parsed.error });
                return;
            }

            const placement = await this.deps.placements.create(parsed.input, { source: 'operator' });
            res.status(201).json({ success: true, placement });
        } catch (err) {
            this.deps.logger.error({ err }, 'Failed to create placement');
            res.status(500).json({ success: false, error: 'Failed to create placement' });
        }
    };

    /**
     * PATCH /api/admin/system/widgets/placements/:id
     *
     * Body: any subset of `{ zoneId, routes, order, title, instanceConfig, enabled }`.
     * Operator-editable on every row regardless of source — the whole
     * point of the type+placement split is that operators own the
     * placement record.
     */
    updatePlacement = async (req: Request, res: Response): Promise<void> => {
        try {
            const parsed = this.parsePatchBody(req.body);
            if ('error' in parsed) {
                res.status(400).json({ success: false, error: parsed.error });
                return;
            }

            const placement = await this.deps.placements.update(req.params.id, parsed.patch);
            if (!placement) {
                res.status(404).json({ success: false, error: 'Placement not found' });
                return;
            }
            res.json({ success: true, placement });
        } catch (err) {
            this.deps.logger.error({ err, id: req.params.id }, 'Failed to update placement');
            res.status(500).json({ success: false, error: 'Failed to update placement' });
        }
    };

    /**
     * DELETE /api/admin/system/widgets/placements/:id
     *
     * Operator-source rows delete cleanly. Plugin-source rows are
     * refused with 400 — the supported paths are disable (via PATCH
     * `enabled: false`) and restore-defaults (which re-enables and
     * reverts operator changes). Plugin row deletion would only
     * re-appear on the next plugin re-register, leaving operator
     * customisations destroyed and the row identical to its plugin
     * default.
     */
    deletePlacement = async (req: Request, res: Response): Promise<void> => {
        try {
            const existing = await this.deps.placements.findById(req.params.id);
            if (!existing) {
                res.status(404).json({ success: false, error: 'Placement not found' });
                return;
            }
            if (existing.source === 'plugin') {
                res.status(400).json({
                    success: false,
                    error: 'Plugin-source placements cannot be deleted. Disable the row or restore plugin defaults instead.'
                });
                return;
            }

            const removed = await this.deps.placements.delete(req.params.id);
            if (!removed) {
                res.status(404).json({ success: false, error: 'Placement not found' });
                return;
            }
            res.status(204).end();
        } catch (err) {
            this.deps.logger.error({ err, id: req.params.id }, 'Failed to delete placement');
            res.status(500).json({ success: false, error: 'Failed to delete placement' });
        }
    };

    /**
     * POST /api/admin/system/widgets/placements/:id/restore-defaults
     *
     * Reverts a plugin-source placement to the args the plugin
     * originally passed to `widgetService.register(...)`. Requires
     * the plugin to have registered in this process — defaults are
     * cached in memory and disappear on restart of a disabled plugin.
     */
    restorePluginDefaults = async (req: Request, res: Response): Promise<void> => {
        try {
            const existing = await this.deps.placements.findById(req.params.id);
            if (!existing) {
                res.status(404).json({ success: false, error: 'Placement not found' });
                return;
            }
            if (existing.source !== 'plugin') {
                res.status(400).json({
                    success: false,
                    error: 'Restore defaults is only valid for plugin-source placements. Operator-created rows have no plugin defaults to restore.'
                });
                return;
            }
            if (!existing.pluginId) {
                res.status(400).json({
                    success: false,
                    error: 'Placement is missing its owning plugin id. Cannot resolve defaults.'
                });
                return;
            }

            const defaults = this.deps.getPluginDefault(existing.pluginId, existing.typeId);
            if (!defaults) {
                res.status(409).json({
                    success: false,
                    error: 'Plugin has not registered in this process. Re-enable the plugin to repopulate defaults, then retry.'
                });
                return;
            }

            const placement = await this.deps.placements.restoreToPluginDefaults(req.params.id, {
                zoneId: defaults.zone,
                routes: defaults.routes,
                order: defaults.order,
                title: defaults.title
            });
            if (!placement) {
                res.status(404).json({ success: false, error: 'Placement not found' });
                return;
            }
            res.json({ success: true, placement });
        } catch (err) {
            this.deps.logger.error({ err, id: req.params.id }, 'Failed to restore plugin defaults');
            res.status(500).json({ success: false, error: 'Failed to restore plugin defaults' });
        }
    };

    /**
     * Parse and validate a create-placement request body. Returns the
     * normalised input shape on success or a 400-eligible error
     * message describing the first validation failure.
     */
    private parseCreateBody(body: unknown):
        | { input: { typeId: string; zoneId: string; routes: string[]; order?: number; title?: string; instanceConfig?: Record<string, unknown>; enabled?: boolean } }
        | { error: string } {
        if (!body || typeof body !== 'object') {
            return { error: 'Request body must be an object' };
        }
        const b = body as Record<string, unknown>;

        if (typeof b.typeId !== 'string' || b.typeId.length === 0) {
            return { error: 'typeId is required' };
        }
        if (!this.deps.widgetTypes.has(b.typeId)) {
            return { error: `Unknown widget type id: '${b.typeId}'` };
        }

        if (typeof b.zoneId !== 'string' || b.zoneId.length === 0) {
            return { error: 'zoneId is required' };
        }
        if (!this.deps.zones.has(b.zoneId)) {
            return { error: `Unknown zone id: '${b.zoneId}'` };
        }

        const routesResult = this.parseRoutes(b.routes);
        if ('error' in routesResult) return routesResult;

        const orderResult = this.parseOrder(b.order);
        if ('error' in orderResult) return orderResult;

        const titleResult = this.parseTitle(b.title);
        if ('error' in titleResult) return titleResult;

        const instanceConfigResult = this.parseInstanceConfig(b.instanceConfig);
        if ('error' in instanceConfigResult) return instanceConfigResult;

        const enabled = typeof b.enabled === 'boolean' ? b.enabled : true;

        return {
            input: {
                typeId: b.typeId,
                zoneId: b.zoneId,
                routes: routesResult.routes,
                order: orderResult.order,
                title: titleResult.title,
                instanceConfig: instanceConfigResult.instanceConfig,
                enabled
            }
        };
    }

    /**
     * Parse and validate a patch-placement request body. Every field
     * is optional, but those provided must validate. `title: null`
     * is the explicit unset signal and is preserved through to the
     * service so it can `$unset` the field.
     */
    private parsePatchBody(body: unknown):
        | { patch: { zoneId?: string; routes?: string[]; order?: number; title?: string | null; instanceConfig?: Record<string, unknown>; enabled?: boolean } }
        | { error: string } {
        if (!body || typeof body !== 'object') {
            return { error: 'Request body must be an object' };
        }
        const b = body as Record<string, unknown>;
        const patch: { zoneId?: string; routes?: string[]; order?: number; title?: string | null; instanceConfig?: Record<string, unknown>; enabled?: boolean } = {};

        if (b.zoneId !== undefined) {
            if (typeof b.zoneId !== 'string' || b.zoneId.length === 0) {
                return { error: 'zoneId must be a non-empty string' };
            }
            if (!this.deps.zones.has(b.zoneId)) {
                return { error: `Unknown zone id: '${b.zoneId}'` };
            }
            patch.zoneId = b.zoneId;
        }

        if (b.routes !== undefined) {
            const result = this.parseRoutes(b.routes);
            if ('error' in result) return result;
            patch.routes = result.routes;
        }

        if (b.order !== undefined) {
            const result = this.parseOrder(b.order);
            if ('error' in result) return result;
            if (result.order !== undefined) patch.order = result.order;
        }

        if (b.title !== undefined) {
            // `null` is the explicit unset signal — preserve it
            // through to the service, which translates it to
            // `$unset: { title: '' }`. Anything else goes through
            // `parseTitle` for the standard string-shape checks.
            if (b.title === null) {
                patch.title = null;
            } else {
                const result = this.parseTitle(b.title);
                if ('error' in result) return result;
                patch.title = result.title;
            }
        }

        if (b.instanceConfig !== undefined) {
            const result = this.parseInstanceConfig(b.instanceConfig);
            if ('error' in result) return result;
            patch.instanceConfig = result.instanceConfig;
        }

        if (b.enabled !== undefined) {
            if (typeof b.enabled !== 'boolean') {
                return { error: 'enabled must be a boolean' };
            }
            patch.enabled = b.enabled;
        }

        return { patch };
    }

    /**
     * Validate and normalise the `routes` field. Accepts an array of
     * pattern strings; each must pass `normaliseRoutePattern`.
     */
    private parseRoutes(value: unknown): { routes: string[] } | { error: string } {
        if (!Array.isArray(value)) {
            return { error: 'routes must be an array of strings' };
        }
        const out: string[] = [];
        for (const entry of value) {
            if (typeof entry !== 'string') {
                return { error: 'Each routes entry must be a string' };
            }
            const normalised = normaliseRoutePattern(entry);
            if (normalised === null) {
                return { error: `Invalid route pattern: '${entry}'. Patterns must start with '/' and may end in '/*' or '/**'.` };
            }
            out.push(normalised);
        }
        return { routes: out };
    }

    /**
     * Validate the `order` field. Optional, must be a non-negative
     * integer at or below `MAX_ORDER`.
     */
    private parseOrder(value: unknown): { order?: number } | { error: string } {
        if (value === undefined) return { order: undefined };
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return { error: 'order must be a finite number' };
        }
        if (!Number.isInteger(value)) {
            return { error: 'order must be an integer' };
        }
        if (value < 0 || value > MAX_ORDER) {
            return { error: `order must be between 0 and ${MAX_ORDER}` };
        }
        return { order: value };
    }

    /**
     * Validate the optional `title` field for the create path.
     * Trimmed; empty after trim is rejected (an empty title carries
     * no meaning — pass `null` to the patch endpoint to clear an
     * existing override, or simply omit the field on create).
     */
    private parseTitle(value: unknown): { title?: string } | { error: string } {
        if (value === undefined) return { title: undefined };
        if (typeof value !== 'string') {
            return { error: 'title must be a string' };
        }
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return { error: 'title must be non-empty when provided' };
        }
        if (trimmed.length > MAX_TITLE_LENGTH) {
            return { error: `title must be at most ${MAX_TITLE_LENGTH} characters` };
        }
        return { title: trimmed };
    }

    /**
     * Validate the optional `instanceConfig` field. Must be a plain
     * object; the placement service is the schema-aware consumer —
     * the controller only enforces shape.
     */
    private parseInstanceConfig(value: unknown):
        | { instanceConfig?: Record<string, unknown> }
        | { error: string } {
        if (value === undefined) return { instanceConfig: undefined };
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return { error: 'instanceConfig must be a plain object' };
        }
        return { instanceConfig: value as Record<string, unknown> };
    }
}
