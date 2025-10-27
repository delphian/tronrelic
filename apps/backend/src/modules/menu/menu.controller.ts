import type { Request, Response } from 'express';
import { z } from 'zod';
import { MenuService } from './menu.service.js';

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
    namespace: z.string().optional(),

    /**
     * Display label for the menu item (required).
     */
    label: z.string().min(1).max(200),

    /**
     * Optional navigation URL or route path.
     * Omit for container/category nodes.
     */
    url: z.string().optional(),

    /**
     * Optional icon identifier for visual representation.
     */
    icon: z.string().optional(),

    /**
     * Sort order within the same parent level.
     * Lower numbers appear first. Defaults to 0.
     */
    order: z.number().int().min(0).optional(),

    /**
     * Parent node ID for hierarchical organization.
     * Null or omitted for root-level nodes.
     */
    parent: z.string().nullable().optional(),

    /**
     * Visibility flag controlling whether the node appears in navigation.
     * Defaults to true.
     */
    enabled: z.boolean().optional(),

    /**
     * Optional access control role or permission requirement.
     */
    requiredRole: z.string().optional()
});

/**
 * Zod schema for updating an existing menu node.
 *
 * Validates request body for PATCH /api/menu/:id endpoint. All fields are
 * optional, allowing partial updates.
 */
const updateNodeSchema = z.object({
    namespace: z.string().optional(),
    label: z.string().min(1).max(200).optional(),
    url: z.string().optional(),
    icon: z.string().optional(),
    order: z.number().int().min(0).optional(),
    parent: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    requiredRole: z.string().optional()
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
     * **Authentication:** Requires admin token (via requireAdmin middleware)
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
            const namespace = req.query.namespace as string | undefined;
            const tree = this.service.getTree(namespace);
            res.json({ success: true, tree });
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
     * **Authentication:** Requires admin token (via requireAdmin middleware)
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
            const namespaces = this.service.getNamespaces();
            res.json({ success: true, namespaces });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to get namespaces';
            res.status(500).json({ success: false, error: message });
        }
    };
}
