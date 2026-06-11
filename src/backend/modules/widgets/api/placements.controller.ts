/**
 * @fileoverview Admin controller for widget-placement CRUD.
 *
 * Thin HTTP adapter over `IWidgetsService`. Validates the request
 * body, refuses unknown zone/type ids before mutation, and translates
 * service-layer errors into HTTP responses. All endpoints are mounted
 * behind `requireAdmin` and the platform's admin rate limiter — see
 * `WidgetsModule.run()` for the bind.
 *
 * The controller does not touch the placement service, registries, or
 * plugin-defaults cache directly. Every operation flows through
 * `IWidgetsService` on the service registry; `restorePluginDefaults`
 * is one service call rather than a hand-assembled patch.
 *
 * @module backend/modules/widgets/api/placements.controller
 */

import type { Request, Response } from 'express';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { JSONSchema7 } from 'json-schema';
import type {
    ISystemLogService,
    IWidgetsService,
    PlacementSource,
    IPlacementListFilter
} from '@/types';
import { normaliseRoutePattern } from '../placements/route-matcher.js';
import {
    MissingPluginDefaultsError,
    PluginPlacementDeletionForbiddenError,
    RestoreDefaultsOnOperatorRowError,
    UnknownWidgetTypeError,
    UnknownZoneError
} from '../widgets.errors.js';

/**
 * Per-field validation error reported back to the client in the
 * structured 400 body when `instanceConfig` fails a widget type's
 * declared schema. `path` is the JSON Pointer to the offending field
 * (empty string for root-level errors); `message` is AJV's human-
 * readable summary.
 */
interface IInstanceConfigFieldError {
    readonly path: string;
    readonly message: string;
}

/**
 * Upper bound on a placement's `order` field. Lower numbers render
 * first within a zone. Generous (10,000) so operators can use
 * coarse-grained values like 100/200/300 without colliding with
 * plugin defaults that cluster around 100.
 */
const MAX_ORDER = 10_000;

/**
 * Upper bound on a placement `title` override length. Matches the
 * column budget of the rendered card heading.
 */
const MAX_TITLE_LENGTH = 80;

/**
 * Upper bound on a placement `titleUrl` length. Internal paths are
 * short by nature; 512 leaves ample room for query strings and hash
 * fragments without inviting pathological inputs.
 */
const MAX_TITLE_URL_LENGTH = 512;

/**
 * Format gate for a placement `titleUrl`. The heading link is
 * internal-only: the value must be a single-leading-slash root-relative
 * path (e.g. `/markets`, `/u/TXyz?tab=holdings#summary`). The negative
 * lookahead rejects protocol-relative (`//host`) and the backslash
 * trick (`/\host`) that browsers normalise to off-site navigation;
 * forbidding whitespace and backslash anywhere blocks header/newline
 * injection. A leading `/` makes scheme URIs (`javascript:`, `data:`)
 * structurally impossible, so no separate scheme blocklist is needed.
 */
const INTERNAL_PATH_PATTERN = /^\/(?![/\\])[^\s\\]*$/;

/**
 * Format gate for zone ids. Lowercase-dotted (letters, digits,
 * hyphens, underscores, colons for namespaced cases), starts with a
 * letter, max 64 chars. Anything else is malformed input and must not
 * reach the Mongo query.
 */
const ZONE_ID_PATTERN = /^[a-z][a-z0-9_:-]{0,63}$/;

/**
 * Format gate for plugin ids. Same shape as a zone id minus the
 * colon — plugin ids never carry namespaced segments.
 */
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Read a query-string value, coerce to string, validate against a
 * regex, return the sanitised value or undefined. The explicit
 * `String(...)` coercion neutralises Express's parsed-object form
 * (`?zoneId[$ne]=foo` becomes `[object Object]`), and the regex
 * enforces a known-safe shape.
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
    /**
     * Shared AJV instance. `allErrors` so a single bad submission
     * surfaces every offending field at once rather than feeding the
     * operator one error per round-trip. `strict: false` lets plugin
     * authors declare schemas with unrecognised keywords (e.g. UI
     * hints) without AJV refusing to compile.
     */
    private readonly ajv: Ajv;

    /**
     * Compile cache keyed on the schema *object identity*. Because
     * widget-type descriptors are frozen at mint time and re-minted on
     * every plugin re-enable, the schema reference changes whenever
     * the underlying contract changes — so a WeakMap keyed on the
     * schema is correct without an explicit invalidation hook, and the
     * entry is GC'd when the descriptor goes away.
     */
    private readonly validatorCache: WeakMap<JSONSchema7, ValidateFunction>;

    constructor(
        private readonly widgets: IWidgetsService,
        private readonly logger: ISystemLogService
    ) {
        this.ajv = new Ajv({ allErrors: true, strict: false });
        addFormats(this.ajv);
        this.validatorCache = new WeakMap();
    }

    /**
     * Validate `instanceConfig` against the widget type's declared
     * JSON Schema, when one is declared. Returns the structured
     * per-field errors on failure, or `null` when validation passes
     * (or no schema was declared — in which case the caller has
     * already enforced the shape-only "plain object" guard via
     * `parseInstanceConfig`). Compiled validators are cached on the
     * schema reference so the per-write cost is a single AJV invoke.
     *
     * @param typeId - Widget-type id whose schema gates this body.
     * @param instanceConfig - The operator-supplied config object.
     * @returns Array of per-field errors, or `null` when valid.
     */
    private validateInstanceConfigAgainstSchema(
        typeId: string,
        instanceConfig: Record<string, unknown>
    ): ReadonlyArray<IInstanceConfigFieldError> | null {
        const schema = this.widgets.getTypeConfigSchema(typeId);
        if (!schema) return null;

        let validator = this.validatorCache.get(schema);
        if (!validator) {
            // Plugin-supplied schemas can be malformed (unsupported
            // keyword, bad $ref, draft mismatch). Surface that as a
            // structured 400 so a schema-author bug never lands as a
            // 500 for the operator submitting a placement edit.
            try {
                validator = this.ajv.compile(schema);
                this.validatorCache.set(schema, validator);
            } catch (compileErr) {
                this.logger.error(
                    {
                        err: compileErr,
                        typeId
                    },
                    'Failed to compile widget configSchema'
                );
                return [{
                    path: '',
                    message: `Widget type schema compilation failed: ${compileErr instanceof Error ? compileErr.message : String(compileErr)}`
                }];
            }
        }

        if (validator(instanceConfig)) return null;

        const errors = validator.errors ?? [];
        return errors.map(err => ({
            path: err.instancePath,
            message: err.message ?? 'invalid value'
        }));
    }

    /**
     * GET /api/admin/system/widgets/placements
     */
    listPlacements = async (req: Request, res: Response): Promise<void> => {
        try {
            const filter: IPlacementListFilter = {};

            const zoneId = safeStringParam(req.query.zoneId, ZONE_ID_PATTERN);
            if (zoneId !== undefined) filter.zoneId = zoneId;

            const pluginId = safeStringParam(req.query.pluginId, PLUGIN_ID_PATTERN);
            if (pluginId !== undefined) filter.pluginId = pluginId;

            if (req.query.source === 'plugin') {
                filter.source = 'plugin' as PlacementSource;
            } else if (req.query.source === 'operator') {
                filter.source = 'operator' as PlacementSource;
            }
            if (req.query.enabledOnly === 'true' || req.query.enabledOnly === '1') {
                filter.enabledOnly = true;
            }

            const placements = await this.widgets.listPlacements(filter);
            res.json({ success: true, placements });
        } catch (err) {
            this.logger.error({ err }, 'Failed to list placements');
            res.status(500).json({ success: false, error: 'Failed to list placements' });
        }
    };

    /**
     * GET /api/admin/system/widgets/placements/:id
     */
    getPlacement = async (req: Request, res: Response): Promise<void> => {
        try {
            const placement = await this.widgets.findPlacementById(req.params.id);
            if (!placement) {
                res.status(404).json({ success: false, error: 'Placement not found' });
                return;
            }
            res.json({ success: true, placement });
        } catch (err) {
            this.logger.error({ err, id: req.params.id }, 'Failed to read placement');
            res.status(500).json({ success: false, error: 'Failed to read placement' });
        }
    };

    /**
     * POST /api/admin/system/widgets/placements
     */
    createPlacement = async (req: Request, res: Response): Promise<void> => {
        try {
            const parsed = this.parseCreateBody(req.body);
            if ('error' in parsed) {
                res.status(400).json({ success: false, error: parsed.error });
                return;
            }

            if (parsed.input.instanceConfig !== undefined) {
                const fieldErrors = this.validateInstanceConfigAgainstSchema(
                    parsed.input.typeId,
                    parsed.input.instanceConfig
                );
                if (fieldErrors) {
                    res.status(400).json({
                        success: false,
                        error: 'instanceConfig failed widget-type schema validation',
                        errors: fieldErrors
                    });
                    return;
                }
            }

            const placement = await this.widgets.createPlacement(parsed.input);
            res.status(201).json({ success: true, placement });
        } catch (err) {
            if (err instanceof UnknownWidgetTypeError || err instanceof UnknownZoneError) {
                res.status(400).json({ success: false, error: err.message });
                return;
            }
            this.logger.error({ err }, 'Failed to create placement');
            res.status(500).json({ success: false, error: 'Failed to create placement' });
        }
    };

    /**
     * PATCH /api/admin/system/widgets/placements/:id
     */
    updatePlacement = async (req: Request, res: Response): Promise<void> => {
        try {
            const parsed = this.parsePatchBody(req.body);
            if ('error' in parsed) {
                res.status(400).json({ success: false, error: parsed.error });
                return;
            }

            if (parsed.patch.instanceConfig !== undefined) {
                // PATCH bodies don't carry typeId — the schema gate is
                // determined by the existing row's typeId, so we have
                // to read first. 404 here matches the post-update 404
                // below; an operator patching a vanished placement
                // gets a consistent error regardless of which body
                // field was set.
                const existing = await this.widgets.findPlacementById(req.params.id);
                if (!existing) {
                    res.status(404).json({ success: false, error: 'Placement not found' });
                    return;
                }
                const fieldErrors = this.validateInstanceConfigAgainstSchema(
                    existing.typeId,
                    parsed.patch.instanceConfig
                );
                if (fieldErrors) {
                    res.status(400).json({
                        success: false,
                        error: 'instanceConfig failed widget-type schema validation',
                        errors: fieldErrors
                    });
                    return;
                }
            }

            const placement = await this.widgets.updatePlacement(req.params.id, parsed.patch);
            if (!placement) {
                res.status(404).json({ success: false, error: 'Placement not found' });
                return;
            }
            res.json({ success: true, placement });
        } catch (err) {
            if (err instanceof UnknownZoneError) {
                res.status(400).json({ success: false, error: err.message });
                return;
            }
            this.logger.error({ err, id: req.params.id }, 'Failed to update placement');
            res.status(500).json({ success: false, error: 'Failed to update placement' });
        }
    };

    /**
     * DELETE /api/admin/system/widgets/placements/:id
     */
    deletePlacement = async (req: Request, res: Response): Promise<void> => {
        try {
            const removed = await this.widgets.deletePlacement(req.params.id);
            if (!removed) {
                res.status(404).json({ success: false, error: 'Placement not found' });
                return;
            }
            res.status(204).end();
        } catch (err) {
            if (err instanceof PluginPlacementDeletionForbiddenError) {
                res.status(400).json({ success: false, error: err.message });
                return;
            }
            this.logger.error({ err, id: req.params.id }, 'Failed to delete placement');
            res.status(500).json({ success: false, error: 'Failed to delete placement' });
        }
    };

    /**
     * POST /api/admin/system/widgets/placements/:id/restore-defaults
     */
    restorePluginDefaults = async (req: Request, res: Response): Promise<void> => {
        try {
            const placement = await this.widgets.restorePluginDefaults(req.params.id);
            if (!placement) {
                res.status(404).json({ success: false, error: 'Placement not found' });
                return;
            }
            res.json({ success: true, placement });
        } catch (err) {
            if (err instanceof RestoreDefaultsOnOperatorRowError) {
                res.status(400).json({ success: false, error: err.message });
                return;
            }
            if (err instanceof MissingPluginDefaultsError) {
                res.status(409).json({ success: false, error: err.message });
                return;
            }
            this.logger.error({ err, id: req.params.id }, 'Failed to restore plugin defaults');
            res.status(500).json({ success: false, error: 'Failed to restore plugin defaults' });
        }
    };

    private parseCreateBody(body: unknown):
        | { input: { typeId: string; zoneId: string; routes: string[]; order?: number; title?: string; titleUrl?: string; instanceConfig?: Record<string, unknown>; enabled?: boolean } }
        | { error: string } {
        if (!body || typeof body !== 'object') {
            return { error: 'Request body must be an object' };
        }
        const b = body as Record<string, unknown>;

        if (typeof b.typeId !== 'string' || b.typeId.length === 0) {
            return { error: 'typeId is required' };
        }
        if (!this.widgets.hasType(b.typeId)) {
            return { error: `Unknown widget type id: '${b.typeId}'` };
        }

        if (typeof b.zoneId !== 'string' || b.zoneId.length === 0) {
            return { error: 'zoneId is required' };
        }
        if (!this.widgets.hasZone(b.zoneId)) {
            return { error: `Unknown zone id: '${b.zoneId}'` };
        }

        const routesResult = this.parseRoutes(b.routes);
        if ('error' in routesResult) return routesResult;

        const orderResult = this.parseOrder(b.order);
        if ('error' in orderResult) return orderResult;

        const titleResult = this.parseTitle(b.title);
        if ('error' in titleResult) return titleResult;

        const titleUrlResult = this.parseTitleUrl(b.titleUrl);
        if ('error' in titleUrlResult) return titleUrlResult;

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
                titleUrl: titleUrlResult.titleUrl,
                instanceConfig: instanceConfigResult.instanceConfig,
                enabled
            }
        };
    }

    private parsePatchBody(body: unknown):
        | { patch: { zoneId?: string; routes?: string[]; order?: number; title?: string | null; titleUrl?: string | null; instanceConfig?: Record<string, unknown>; enabled?: boolean } }
        | { error: string } {
        if (!body || typeof body !== 'object') {
            return { error: 'Request body must be an object' };
        }
        const b = body as Record<string, unknown>;
        const patch: { zoneId?: string; routes?: string[]; order?: number; title?: string | null; titleUrl?: string | null; instanceConfig?: Record<string, unknown>; enabled?: boolean } = {};

        if (b.zoneId !== undefined) {
            if (typeof b.zoneId !== 'string' || b.zoneId.length === 0) {
                return { error: 'zoneId must be a non-empty string' };
            }
            if (!this.widgets.hasZone(b.zoneId)) {
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
            if (b.title === null) {
                patch.title = null;
            } else {
                const result = this.parseTitle(b.title);
                if ('error' in result) return result;
                patch.title = result.title;
            }
        }

        if (b.titleUrl !== undefined) {
            if (b.titleUrl === null) {
                patch.titleUrl = null;
            } else {
                const result = this.parseTitleUrl(b.titleUrl);
                if ('error' in result) return result;
                patch.titleUrl = result.titleUrl;
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
     * Validate a `titleUrl` heading link. Accepts only internal,
     * root-relative paths — see {@link INTERNAL_PATH_PATTERN} for the
     * rejected forms. Returns the trimmed value, or a structured error
     * the caller maps to a 400.
     */
    private parseTitleUrl(value: unknown): { titleUrl?: string } | { error: string } {
        if (value === undefined) return { titleUrl: undefined };
        if (typeof value !== 'string') {
            return { error: 'titleUrl must be a string' };
        }
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return { error: 'titleUrl must be non-empty when provided' };
        }
        if (trimmed.length > MAX_TITLE_URL_LENGTH) {
            return { error: `titleUrl must be at most ${MAX_TITLE_URL_LENGTH} characters` };
        }
        if (!INTERNAL_PATH_PATTERN.test(trimmed)) {
            return { error: "titleUrl must be a root-relative path beginning with '/' (e.g. '/markets'); absolute or off-site URLs are not allowed" };
        }
        return { titleUrl: trimmed };
    }

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
