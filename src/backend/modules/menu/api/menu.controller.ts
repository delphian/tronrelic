import type { Request, Response } from 'express';
import { z } from 'zod';
import { MenuService } from '../services/menu.service.js';
import { ADMIN_NAMESPACES } from '../constants.js';
import { isAdmin } from '../../../api/middleware/admin-auth.js';
import type { IMenuNodeWithChildren, IMenuTree, IUser } from '@/types';
import { UserIdentityState } from '@/types';

/**
 * Acceptable namespace identifiers. Lowercase ASCII, hyphens allowed,
 * starts with a letter, capped at 64 characters. Bounds the surface for
 * resource exhaustion (`menu_namespace_config`, `menu_node_overrides`)
 * and prevents NUL/control bytes leaking into log lines and Mongo keys.
 */
const NAMESPACE_REGEX = /^[a-z][a-z0-9-]{0,63}$/;
const namespaceField = z
    .string()
    .regex(NAMESPACE_REGEX, 'Namespace must be lowercase alphanumeric with hyphens, starting with a letter, max 64 chars');

/**
 * Strings that surface in user-visible navigation (label, description).
 * Reject control bytes (\x00-\x1F\x7F) so a stolen-admin-token attacker
 * can't plant log-injection payloads or invisible Unicode glitches in
 * shared navigation. React escapes these at render time, but downstream
 * SSR meta tags / log queries / email templates do not.
 */
const SAFE_TEXT_REGEX = /^[^\x00-\x1F\x7F]*$/;

/**
 * URLs are limited to relative paths (`/...`) or absolute http(s) URLs.
 * Blocks `javascript:`, `data:`, `vbscript:`, `file:`, mailto:, and other
 * URI schemes that would weaponise a planted menu item if a non-React
 * consumer renders the href without further sanitisation.
 */
const URL_REGEX = /^(\/[^\s]*|https?:\/\/[^\s]+)$/;

/**
 * Icon identifiers are Lucide React component names: PascalCase
 * alphanumerics. Anything else is silently unrenderable today, but
 * permissive validation invites future bugs in consumers that look up
 * the string by name.
 */
const ICON_REGEX = /^[A-Z][A-Za-z0-9]{0,49}$/;

/**
 * MongoDB ObjectId stringified — 24 hex chars. Used to gate `:id` path
 * params and `parent` body fields so non-ObjectId input fails as 400
 * (ZodError) rather than escaping into the service where `new ObjectId()`
 * throws BSONError and surfaces as a 500.
 */
const OBJECT_ID_REGEX = /^[a-f0-9]{24}$/i;
const objectIdField = z
    .string()
    .regex(OBJECT_ID_REGEX, 'Invalid ObjectId');

/**
 * Coerce empty strings to `undefined` before applying the inner schema.
 * Frontend forms commonly submit `''` for cleared optional fields (the
 * input element's value on a blank input). Treating that as "field
 * omitted" lets the strict regexes below reject genuinely-malformed
 * input without rejecting routine "no value" submissions.
 */
function emptyStringAsUndefined<T extends z.ZodTypeAny>(schema: T) {
    return z.preprocess((val) => (typeof val === 'string' && val.length === 0 ? undefined : val), schema);
}

/**
 * Group ids written to `requiresGroups` must match the slug shape enforced by
 * `IUserGroupService.createGroup`. Validating client-side prevents bad input
 * from being persisted and propagating to filter checks at read time.
 */
const GROUP_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Allow-list of identity states. Must be non-empty when present — an empty
 * array would hide the node from every visitor, which is what `enabled: false`
 * already expresses cleanly.
 */
const allowedIdentityStatesField = z
    .array(z.nativeEnum(UserIdentityState))
    .min(1, 'allowedIdentityStates must contain at least one state, or be omitted entirely')
    .max(3)
    .optional();

const requiresGroupsField = z
    .array(z.string().regex(GROUP_ID_REGEX, 'Group ids must be lowercase kebab-case slugs'))
    .max(64)
    .optional();

/**
 * Zod schema for creating a new menu node.
 *
 * Validates request body for POST /api/menu endpoint. All fields except label
 * are optional with sensible defaults applied by the service.
 */
const createNodeSchema = z.object({
    /**
     * Menu namespace for isolating multiple independent menu trees.
     * Defaults to 'main'.
     */
    namespace: namespaceField.optional(),

    /**
     * Display label for the menu item (required).
     */
    label: z
        .string()
        .min(1)
        .max(200)
        .regex(SAFE_TEXT_REGEX, 'Label may not contain control characters'),

    /**
     * Optional short description of the menu item's purpose.
     * Used in auto-generated category landing pages.
     */
    description: z
        .string()
        .max(500)
        .regex(SAFE_TEXT_REGEX, 'Description may not contain control characters')
        .optional(),

    /**
     * Optional navigation URL or route path.
     * Omit for container/category nodes (URL will be auto-derived from label).
     */
    url: emptyStringAsUndefined(
        z
            .string()
            .max(2048)
            .regex(URL_REGEX, 'URL must be a relative path starting with / or an http(s):// URL')
            .optional()
    ),

    /**
     * Optional icon identifier for visual representation.
     */
    icon: emptyStringAsUndefined(
        z
            .string()
            .regex(ICON_REGEX, 'Icon must be a Lucide React PascalCase identifier')
            .optional()
    ),

    /**
     * Sort order within the same parent level.
     * Lower numbers appear first. Defaults to 0.
     */
    order: z.number().int().min(0).max(100_000).optional(),

    /**
     * Parent node ID for hierarchical organization.
     * Null or omitted for root-level nodes.
     */
    parent: objectIdField.nullable().optional(),

    /**
     * Visibility flag controlling whether the node appears in navigation.
     * Defaults to true.
     */
    enabled: z.boolean().optional(),

    /**
     * Allow-list of identity states that may see the node.
     */
    allowedIdentityStates: allowedIdentityStatesField,

    /**
     * Required group memberships (OR-of-membership).
     */
    requiresGroups: requiresGroupsField,

    /**
     * Restrict the node to admin users — see IMenuNode.requiresAdmin.
     */
    requiresAdmin: z.boolean().optional()
});

/**
 * Zod schema for updating an existing menu node.
 *
 * Validates request body for PATCH /api/menu/:id endpoint. All fields are
 * optional, allowing partial updates.
 */
const updateNodeSchema = z.object({
    namespace: namespaceField.optional(),
    label: z
        .string()
        .min(1)
        .max(200)
        .regex(SAFE_TEXT_REGEX, 'Label may not contain control characters')
        .optional(),
    description: z
        .string()
        .max(500)
        .regex(SAFE_TEXT_REGEX, 'Description may not contain control characters')
        .optional(),
    url: emptyStringAsUndefined(
        z
            .string()
            .max(2048)
            .regex(URL_REGEX, 'URL must be a relative path starting with / or an http(s):// URL')
            .optional()
    ),
    icon: emptyStringAsUndefined(
        z
            .string()
            .regex(ICON_REGEX, 'Icon must be a Lucide React PascalCase identifier')
            .optional()
    ),
    order: z.number().int().min(0).max(100_000).optional(),
    parent: objectIdField.nullable().optional(),
    enabled: z.boolean().optional(),
    allowedIdentityStates: allowedIdentityStatesField,
    requiresGroups: requiresGroupsField,
    requiresAdmin: z.boolean().optional()
});

/**
 * Zod schema for setting namespace configuration.
 *
 * Validates request body for PUT /api/menu/namespace/:namespace/config endpoint.
 * All fields are optional to allow partial configuration updates.
 */
const namespaceConfigSchema = z.object({
    overflow: z.object({
        enabled: z.boolean(),
        collapseAtCount: z.number().int().min(1).max(20).optional()
    }).optional(),
    icons: z.object({
        enabled: z.boolean(),
        position: z.enum(['left', 'right', 'top']).optional()
    }).optional(),
    layout: z.object({
        orientation: z.enum(['horizontal', 'vertical']),
        maxItems: z.number().int().min(1).optional()
    }).optional(),
    styling: z.object({
        compact: z.boolean().optional(),
        showLabels: z.boolean().optional()
    }).optional()
});

/**
 * Controller handling HTTP requests for menu system operations.
 *
 * Provides REST API endpoints for CRUD operations on menu nodes and retrieving
 * the complete menu tree. All endpoints require admin authentication via the
 * requireAdmin middleware applied at the router level.
 *
 * Endpoints:
 * - GET /api/menu - Get complete menu tree
 * - POST /api/menu - Create new menu node
 * - PATCH /api/menu/:id - Update existing menu node
 * - DELETE /api/menu/:id - Delete menu node
 *
 * All responses follow the format:
 * ```json
 * { "success": true, "data": {...} }
 * ```
 *
 * Error responses use the format:
 * ```json
 * { "success": false, "error": "Error message" }
 * ```
 */
/**
 * Recursively strip disabled nodes from a built tree. Mutates a copy
 * (the input is not modified) so the public response sees only items
 * the operator has explicitly enabled.
 */
function filterEnabledTree(roots: IMenuNodeWithChildren[]): IMenuNodeWithChildren[] {
    return roots
        .filter((node) => node.enabled)
        .map((node) => ({
            ...node,
            children: filterEnabledTree(node.children)
        }));
}

/**
 * Build a public-safe view of a tree by removing disabled nodes from
 * both the hierarchical `roots` and the flat `all` list.
 */
function publicTreeView(tree: IMenuTree): IMenuTree {
    return {
        roots: filterEnabledTree(tree.roots),
        all: tree.all.filter((n) => n.enabled),
        generatedAt: tree.generatedAt
    };
}

/**
 * Reject a request that targets an admin-only namespace from an
 * anonymous caller. Returns true if the response was sent (caller
 * should bail), false if the request may proceed.
 *
 * `MenuService` resolves an omitted namespace to `DEFAULT_NAMESPACE`
 * (`'main'`), so the gate must mirror that resolution before checking
 * the admin set — otherwise a hypothetical entry like `'main'` would
 * be silently bypassed when the caller omits the query param.
 */
const DEFAULT_NAMESPACE = 'main';
function denyIfAdminNamespace(req: Request, res: Response, namespace: string | undefined): boolean {
    const effective = namespace || DEFAULT_NAMESPACE;
    if (ADMIN_NAMESPACES.has(effective) && !isAdmin(req)) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return true;
    }
    return false;
}

export class MenuController {
    /**
     * MenuService instance injected via constructor.
     *
     * With the MenuModule pattern, the service is guaranteed to be initialized
     * before the controller is created, so we can safely store it as a property
     * instead of using lazy access.
     *
     * @param service - MenuService instance for menu operations
     */
    constructor(private readonly service: MenuService) {}

    /**
     * Get the complete menu tree structure.
     *
     * Returns hierarchical representation of all menu nodes organized by parent-child
     * relationships. Root nodes are in the `roots` array, each potentially containing
     * nested children. The `all` array provides a flat list for quick lookups.
     *
     * **Route:** GET /api/menu
     *
     * **Authentication:** Public (no authentication required)
     *
     * **Response:**
     * ```json
     * {
     *   "success": true,
     *   "tree": {
     *     "roots": [
     *       {
     *         "_id": "507f1f77bcf86cd799439011",
     *         "label": "Home",
     *         "url": "/",
     *         "icon": "Home",
     *         "order": 0,
     *         "parent": null,
     *         "enabled": true,
     *         "children": []
     *       }
     *     ],
     *     "all": [...],
     *     "generatedAt": "2025-01-21T12:00:00.000Z"
     *   }
     * }
     * ```
     *
     * @param req - Express request object
     * @param res - Express response object
     */
    getTree = async (req: Request, res: Response) => {
        try {
            const rawNamespace = req.query.namespace;
            const namespace = typeof rawNamespace === 'string' && rawNamespace.length > 0
                ? rawNamespace
                : undefined;

            if (namespace !== undefined && !NAMESPACE_REGEX.test(namespace)) {
                res.status(400).json({ success: false, error: 'Invalid namespace' });
                return;
            }

            if (denyIfAdminNamespace(req, res, namespace)) return;

            // Admin token holders see the full unfiltered tree (including
            // disabled nodes and gated entries) so the admin UI can render
            // and edit them. Regular visitors get the per-user filtered
            // view: enabled-only AND gating-aware.
            if (isAdmin(req)) {
                res.json({ success: true, tree: this.service.getTree(namespace) });
                return;
            }

            const user = (req as Request & { user?: IUser }).user;
            const filtered = await this.service.getTreeForUser(namespace, user);
            res.json({ success: true, tree: publicTreeView(filtered) });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to get menu tree';
            res.status(500).json({ success: false, error: message });
        }
    };

    /**
     * Create a new menu node.
     *
     * Validates input, emits before:create event for subscriber validation, saves
     * to database, updates in-memory tree, emits after:create event, and broadcasts
     * WebSocket update to all clients.
     *
     * Subscribers can halt creation by setting validation.continue = false in the
     * before:create event handler.
     *
     * **Route:** POST /api/menu
     *
     * **Authentication:** Requires admin token (via requireAdmin middleware)
     *
     * **Request Body:**
     * ```json
     * {
     *   "label": "Dashboard",
     *   "url": "/dashboard",
     *   "icon": "LayoutDashboard",
     *   "order": 10,
     *   "parent": null,
     *   "enabled": true,
     *   "requiredRole": "user"
     * }
     * ```
     *
     * **Response:**
     * ```json
     * {
     *   "success": true,
     *   "node": {
     *     "_id": "507f1f77bcf86cd799439011",
     *     "label": "Dashboard",
     *     "url": "/dashboard",
     *     "icon": "LayoutDashboard",
     *     "order": 10,
     *     "parent": null,
     *     "enabled": true,
     *     "requiredRole": "user",
     *     "createdAt": "2025-01-21T12:00:00.000Z",
     *     "updatedAt": "2025-01-21T12:00:00.000Z"
     *   }
     * }
     * ```
     *
     * **Error Response (400 - Validation Failed):**
     * ```json
     * {
     *   "success": false,
     *   "error": "Label must start with capital letter"
     * }
     * ```
     *
     * @param req - Express request object with validated body
     * @param res - Express response object
     */
    create = async (req: Request, res: Response) => {
        try {
            const nodeData = createNodeSchema.parse(req.body);
            // Admin API operations persist to database (persist=true)
            const node = await this.service.create(nodeData, true);
            res.json({ success: true, node });
        } catch (error) {
            if (error instanceof z.ZodError) {
                res.status(400).json({ success: false, error: error.errors[0].message });
            } else {
                const message = error instanceof Error ? error.message : 'Failed to create menu node';
                res.status(400).json({ success: false, error: message });
            }
        }
    };

    /**
     * Update an existing menu node.
     *
     * Validates input, emits before:update event for subscriber validation, applies
     * changes to database, updates in-memory tree, emits after:update event, and
     * broadcasts WebSocket update to all clients.
     *
     * Subscribers receive both the new node data and the previous node state in the
     * event payload, allowing comparison of what changed.
     *
     * **Route:** PATCH /api/menu/:id
     *
     * **Authentication:** Requires admin token (via requireAdmin middleware)
     *
     * **URL Parameters:**
     * - `id` - The _id of the node to update
     *
     * **Request Body (all fields optional):**
     * ```json
     * {
     *   "label": "Updated Label",
     *   "order": 5
     * }
     * ```
     *
     * **Response:**
     * ```json
     * {
     *   "success": true,
     *   "node": {
     *     "_id": "507f1f77bcf86cd799439011",
     *     "label": "Updated Label",
     *     "url": "/dashboard",
     *     "order": 5,
     *     ...
     *   }
     * }
     * ```
     *
     * **Error Response (404 - Not Found):**
     * ```json
     * {
     *   "success": false,
     *   "error": "Menu node not found: 507f1f77bcf86cd799439011"
     * }
     * ```
     *
     * @param req - Express request object with validated body and id param
     * @param res - Express response object
     */
    update = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            if (!OBJECT_ID_REGEX.test(id)) {
                res.status(400).json({ success: false, error: 'Invalid ObjectId' });
                return;
            }
            const updates = updateNodeSchema.parse(req.body);
            // Admin API operations persist to database (persist=true)
            const node = await this.service.update(id, updates, true);
            res.json({ success: true, node });
        } catch (error) {
            if (error instanceof z.ZodError) {
                res.status(400).json({ success: false, error: error.errors[0].message });
            } else {
                const message = error instanceof Error ? error.message : 'Failed to update menu node';
                const status = message.includes('not found') ? 404 : 400;
                res.status(status).json({ success: false, error: message });
            }
        }
    };

    /**
     * Delete a menu node from the tree.
     *
     * Validates deletion through before:delete event subscribers, removes from
     * database, updates in-memory tree, emits after:delete event, and broadcasts
     * WebSocket update to all clients.
     *
     * WARNING: This does NOT cascade delete children. Subscribers should implement
     * cascade logic if needed by subscribing to before:delete and handling children.
     *
     * **Route:** DELETE /api/menu/:id
     *
     * **Authentication:** Requires admin token (via requireAdmin middleware)
     *
     * **URL Parameters:**
     * - `id` - The _id of the node to delete
     *
     * **Response:**
     * ```json
     * {
     *   "success": true
     * }
     * ```
     *
     * **Error Response (404 - Not Found):**
     * ```json
     * {
     *   "success": false,
     *   "error": "Menu node not found: 507f1f77bcf86cd799439011"
     * }
     * ```
     *
     * **Error Response (400 - Validation Failed by Subscriber):**
     * ```json
     * {
     *   "success": false,
     *   "error": "Cannot delete node with children"
     * }
     * ```
     *
     * @param req - Express request object with id param
     * @param res - Express response object
     */
    delete = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            if (!OBJECT_ID_REGEX.test(id)) {
                res.status(400).json({ success: false, error: 'Invalid ObjectId' });
                return;
            }
            // Admin API operations persist to database (persist=true)
            await this.service.delete(id, true);
            res.json({ success: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete menu node';
            const status = message.includes('not found') ? 404 : 400;
            res.status(status).json({ success: false, error: message });
        }
    };

    /**
     * Get all available menu namespaces.
     *
     * Returns a list of all namespace identifiers currently in use across all menu nodes.
     * Useful for admin interfaces that need to manage multiple menu trees.
     *
     * **Route:** GET /api/menu/namespaces
     *
     * **Authentication:** Public (no authentication required)
     *
     * **Response:**
     * ```json
     * {
     *   "success": true,
     *   "namespaces": ["admin-sidebar", "footer", "main", "mobile"]
     * }
     * ```
     *
     * @param req - Express request object
     * @param res - Express response object
     */
    getNamespaces = async (req: Request, res: Response) => {
        try {
            const all = this.service.getNamespaces();
            // Hide admin-only namespaces from anonymous callers so they
            // can't enumerate the admin surface via this endpoint.
            const namespaces = isAdmin(req)
                ? all
                : all.filter((ns) => !ADMIN_NAMESPACES.has(ns));
            res.json({ success: true, namespaces });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to get namespaces';
            res.status(500).json({ success: false, error: message });
        }
    };

    /**
     * Get configuration for a menu namespace.
     *
     * Returns the configuration object containing UI rendering preferences for the
     * specified namespace. If no configuration has been explicitly saved, returns
     * sensible defaults with hamburger menu enabled at 768px width, icons enabled,
     * and horizontal layout.
     *
     * **Route:** GET /api/menu/namespace/:namespace/config
     *
     * **Authentication:** Public (no authentication required)
     *
     * **URL Parameters:**
     * - `namespace` - The namespace identifier (e.g., 'main', 'footer', 'admin-sidebar')
     *
     * **Response:**
     * ```json
     * {
     *   "success": true,
     *   "config": {
     *     "namespace": "main",
     *     "hamburgerMenu": {
     *       "enabled": true,
     *       "triggerWidth": 768
     *     },
     *     "icons": {
     *       "enabled": true,
     *       "position": "left"
     *     },
     *     "layout": {
     *       "orientation": "horizontal"
     *     },
     *     "styling": {
     *       "compact": false,
     *       "showLabels": true
     *     }
     *   }
     * }
     * ```
     *
     * @param req - Express request object with namespace param
     * @param res - Express response object
     */
    getNamespaceConfig = async (req: Request, res: Response) => {
        try {
            const { namespace } = req.params;
            if (!NAMESPACE_REGEX.test(namespace)) {
                res.status(400).json({ success: false, error: 'Invalid namespace' });
                return;
            }
            if (denyIfAdminNamespace(req, res, namespace)) return;
            const config = await this.service.getNamespaceConfig(namespace);
            res.json({ success: true, config });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to get namespace config';
            res.status(500).json({ success: false, error: message });
        }
    };

    /**
     * Set configuration for a menu namespace.
     *
     * Creates or updates the configuration for the specified namespace. If a configuration
     * already exists, the provided fields are merged with existing values (partial update).
     * After updating the database, broadcasts a WebSocket event to notify connected clients
     * of the configuration change.
     *
     * **Route:** PUT /api/menu/namespace/:namespace/config
     *
     * **Authentication:** Requires admin token (via requireAdmin middleware)
     *
     * **URL Parameters:**
     * - `namespace` - The namespace identifier to configure
     *
     * **Request Body (all fields optional for partial update):**
     * ```json
     * {
     *   "hamburgerMenu": {
     *     "enabled": true,
     *     "triggerWidth": 1024
     *   },
     *   "icons": {
     *     "enabled": false
     *   }
     * }
     * ```
     *
     * **Response:**
     * ```json
     * {
     *   "success": true,
     *   "config": {
     *     "_id": "507f1f77bcf86cd799439011",
     *     "namespace": "main",
     *     "hamburgerMenu": {
     *       "enabled": true,
     *       "triggerWidth": 1024
     *     },
     *     "icons": {
     *       "enabled": false,
     *       "position": "left"
     *     },
     *     "createdAt": "2025-01-21T12:00:00.000Z",
     *     "updatedAt": "2025-01-21T12:05:00.000Z"
     *   }
     * }
     * ```
     *
     * **Error Response (400 - Validation Failed):**
     * ```json
     * {
     *   "success": false,
     *   "error": "triggerWidth must be at least 320"
     * }
     * ```
     *
     * @param req - Express request object with namespace param and validated body
     * @param res - Express response object
     */
    setNamespaceConfig = async (req: Request, res: Response) => {
        try {
            const { namespace } = req.params;
            if (!NAMESPACE_REGEX.test(namespace)) {
                res.status(400).json({ success: false, error: 'Invalid namespace' });
                return;
            }
            const configData = namespaceConfigSchema.parse(req.body);
            const config = await this.service.setNamespaceConfig(namespace, configData);
            res.json({ success: true, config });
        } catch (error) {
            if (error instanceof z.ZodError) {
                res.status(400).json({ success: false, error: error.errors[0].message });
            } else {
                const message = error instanceof Error ? error.message : 'Failed to set namespace config';
                res.status(400).json({ success: false, error: message });
            }
        }
    };

    /**
     * Delete configuration for a menu namespace.
     *
     * Removes the stored configuration from the database. After deletion, future calls to
     * getNamespaceConfig() will return default values instead of persisted settings.
     * Broadcasts a WebSocket event to notify connected clients that the namespace has
     * reverted to default configuration.
     *
     * **Route:** DELETE /api/menu/namespace/:namespace/config
     *
     * **Authentication:** Requires admin token (via requireAdmin middleware)
     *
     * **URL Parameters:**
     * - `namespace` - The namespace identifier to delete configuration for
     *
     * **Response:**
     * ```json
     * {
     *   "success": true
     * }
     * ```
     *
     * **Error Response (404 - Not Found):**
     * ```json
     * {
     *   "success": false,
     *   "error": "Namespace configuration not found: footer"
     * }
     * ```
     *
     * @param req - Express request object with namespace param
     * @param res - Express response object
     */
    deleteNamespaceConfig = async (req: Request, res: Response) => {
        try {
            const { namespace } = req.params;
            if (!NAMESPACE_REGEX.test(namespace)) {
                res.status(400).json({ success: false, error: 'Invalid namespace' });
                return;
            }
            await this.service.deleteNamespaceConfig(namespace);
            res.json({ success: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete namespace config';
            const status = message.includes('not found') ? 404 : 400;
            res.status(status).json({ success: false, error: message });
        }
    };

    /**
     * Resolve a URL to a menu category node and its children.
     *
     * Searches the in-memory menu tree for a node matching the given URL that has
     * at least one enabled child. Returns the node and its direct children sorted
     * by order. Used by the frontend catch-all route to render auto-generated
     * category landing pages.
     *
     * **Route:** GET /api/menu/resolve
     *
     * **Authentication:** None (public endpoint)
     *
     * **Query Parameters:**
     * - `url` (required) - The URL to resolve (e.g., '/tools')
     * - `namespace` (optional) - Menu namespace to search in (defaults to 'main')
     *
     * **Response:**
     * ```json
     * {
     *   "success": true,
     *   "node": { "_id": "...", "label": "Tools", "description": "...", "url": "/tools", "icon": "Wrench" },
     *   "children": [
     *     { "_id": "...", "label": "Address Converter", "description": "...", "url": "/tools/address-converter", "icon": "ArrowLeftRight" }
     *   ]
     * }
     * ```
     *
     * @param req - Express request with url query parameter
     * @param res - Express response
     */
    resolve = async (req: Request, res: Response) => {
        try {
            if (!req.query.url || typeof req.query.url !== 'string') {
                res.status(400).json({ success: false, error: 'Missing required query parameter: url' });
                return;
            }

            if (req.query.url.length > 2048) {
                res.status(400).json({ success: false, error: 'URL too long' });
                return;
            }

            // Normalize: ensure leading slash and strip trailing slash
            let url = req.query.url;
            if (!url.startsWith('/')) url = '/' + url;
            if (url.length > 1 && url.endsWith('/')) url = url.slice(0, -1);

            const rawNamespace = req.query.namespace;
            const namespace = (typeof rawNamespace === 'string' && rawNamespace) ? rawNamespace : 'main';

            if (!NAMESPACE_REGEX.test(namespace)) {
                res.status(400).json({ success: false, error: 'Invalid namespace' });
                return;
            }
            if (denyIfAdminNamespace(req, res, namespace)) return;

            // Admin token holders bypass the per-user filter so they can
            // resolve any URL regardless of gating; regular visitors see only
            // the URLs (and children) their identity qualifies for.
            const callerIsAdmin = isAdmin(req);
            const user = (req as Request & { user?: IUser }).user;
            const tree = callerIsAdmin
                ? this.service.getTree(namespace)
                : await this.service.getTreeForUser(namespace, user);

            // Find node matching the URL
            const node = tree.all.find(n => n.url === url && n.enabled);
            if (!node) {
                res.status(404).json({ success: false, error: 'No menu node found for URL' });
                return;
            }

            // Get enabled children with URLs sorted by order, gated to the
            // calling visitor unless the caller is admin.
            const children = (callerIsAdmin
                ? this.service.getChildren(node._id!, namespace)
                : await this.service.getChildrenForUser(node._id!, namespace, user)
            ).filter(c => c.enabled && c.url);

            if (children.length === 0) {
                res.status(404).json({ success: false, error: 'No children found for category node' });
                return;
            }

            res.json({ success: true, node, children });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to resolve menu node';
            res.status(500).json({ success: false, error: message });
        }
    };
}
