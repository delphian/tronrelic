import type {
    IMenuService,
    IMenuNode,
    IMenuTree,
    IMenuNodeWithChildren,
    IMenuEvent,
    IMenuValidation,
    MenuEventType,
    MenuEventSubscriber
} from '@tronrelic/types';
import { MenuNodeModel } from '../../database/models/index.js';
import { logger } from '../../lib/logger.js';
import { WebSocketService } from '../../services/websocket.service.js';

/**
 * Singleton service managing the hierarchical menu system.
 *
 * Provides centralized control over menu structure with event-driven validation,
 * real-time WebSocket updates, and in-memory caching for fast tree access. The
 * service maintains the authoritative state of the menu in memory after loading
 * from MongoDB on initialization.
 *
 * Key responsibilities:
 * - CRUD operations for menu nodes (create, update, delete)
 * - Event system allowing subscribers to validate or observe changes
 * - WebSocket broadcasting of menu updates to connected clients
 * - In-memory tree structure for fast getTree() calls
 * - Default menu initialization (creates 'Home' root node on first startup)
 *
 * Event flow:
 * 1. Operation begins (e.g., create)
 * 2. Emit before:* event with validation object
 * 3. Subscribers can modify validation.continue to halt operation
 * 4. If validation.continue is true, perform database operation
 * 5. Update in-memory tree
 * 6. Emit after:* event (cannot be halted)
 * 7. Broadcast WebSocket update to all clients
 *
 * Example usage:
 * ```typescript
 * const menuService = MenuService.getInstance();
 *
 * // Subscribe to menu creation events
 * menuService.subscribe('before:create', async (event) => {
 *     if (event.node.label.includes('forbidden')) {
 *         event.validation.continue = false;
 *         event.validation.error = 'Label contains forbidden text';
 *     }
 * });
 *
 * // Create a menu node
 * const node = await menuService.create({
 *     label: 'Dashboard',
 *     url: '/dashboard',
 *     order: 10,
 *     parent: null,
 *     enabled: true
 * });
 * ```
 */
export class MenuService implements IMenuService {
    private static instance: MenuService;
    private menuTree: Map<string, IMenuNode> = new Map();
    private subscribers: Map<MenuEventType, MenuEventSubscriber[]> = new Map();
    private initialized = false;

    /**
     * Private constructor enforcing singleton pattern.
     * Use getInstance() to access the service.
     */
    private constructor() {}

    /**
     * Get the singleton instance of MenuService.
     *
     * Creates the instance on first call and returns the same instance on
     * subsequent calls, ensuring a single source of truth for menu state.
     *
     * @returns The singleton MenuService instance
     */
    public static getInstance(): MenuService {
        if (!MenuService.instance) {
            MenuService.instance = new MenuService();
        }
        return MenuService.instance;
    }

    /**
     * Initialize the menu service by loading tree from database and creating defaults.
     *
     * This method should be called once during application bootstrap after database
     * connection is established. It loads all menu nodes from MongoDB into memory,
     * builds the tree structure, and creates a default 'Home' root node if the menu
     * is empty (first startup).
     *
     * Subsequent calls are no-ops to prevent re-initialization.
     *
     * @returns Promise that resolves when initialization is complete
     * @throws Error if database query fails
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            logger.debug('MenuService already initialized, skipping');
            return;
        }

        logger.info('Initializing MenuService...');

        try {
            // Load all nodes from database
            const nodes = await MenuNodeModel.find().lean();

            // Build in-memory tree
            this.menuTree.clear();
            for (const node of nodes) {
                this.menuTree.set(node._id.toString(), this.normalizeNode(node));
            }

            // Create default 'Home' root node if menu is empty
            if (this.menuTree.size === 0) {
                logger.info('Menu is empty, creating default Home node');
                await this.createDefaultHomeNode();
            }

            this.initialized = true;
            logger.info({ nodeCount: this.menuTree.size }, 'MenuService initialized');
        } catch (error) {
            logger.error({ error }, 'Failed to initialize MenuService');
            throw error;
        }
    }

    /**
     * Subscribe to menu events for validation or observation.
     *
     * Event subscribers receive event payloads and can modify the validation object
     * to halt operations (before:* events only) or observe completed changes (after:*
     * events). Multiple subscribers can register for the same event type and are
     * invoked in registration order.
     *
     * Before events (before:create, before:update, etc.):
     * - Allow validation and modification of the operation
     * - Can set validation.continue = false to halt processing
     * - No further subscribers are invoked if continue is false
     * - Database operation is skipped if any subscriber halts validation
     *
     * After events (after:create, after:update, etc.):
     * - Notify of completed operations (cannot be halted)
     * - Useful for logging, metrics, or cascading updates
     * - validation.continue is always true
     *
     * @param eventType - The event type to subscribe to (e.g., 'before:create')
     * @param callback - Async or sync function invoked when event occurs
     *
     * @example
     * ```typescript
     * menuService.subscribe('before:create', async (event) => {
     *     // Enforce naming convention
     *     if (!event.node.label.match(/^[A-Z]/)) {
     *         event.validation.continue = false;
     *         event.validation.error = 'Label must start with capital letter';
     *     }
     * });
     *
     * menuService.subscribe('after:delete', async (event) => {
     *     // Log deletion for audit trail
     *     console.log(`Menu node deleted: ${event.node.label}`);
     * });
     * ```
     */
    public subscribe(eventType: MenuEventType, callback: MenuEventSubscriber): void {
        if (!this.subscribers.has(eventType)) {
            this.subscribers.set(eventType, []);
        }
        this.subscribers.get(eventType)!.push(callback);
        logger.debug({ eventType }, 'Menu event subscriber registered');
    }

    /**
     * Create a new menu node in the tree.
     *
     * Validates the node through before:create event subscribers, saves to database,
     * updates in-memory tree, emits after:create event, and broadcasts WebSocket
     * update to all clients.
     *
     * Subscribers can halt creation by setting validation.continue = false in the
     * before:create event handler.
     *
     * @param nodeData - Partial menu node data (label, url, order, parent, etc.)
     * @returns Promise resolving to the created node with assigned _id
     * @throws Error if validation fails or database operation fails
     *
     * @example
     * ```typescript
     * const dashboardNode = await menuService.create({
     *     label: 'Dashboard',
     *     url: '/dashboard',
     *     icon: 'LayoutDashboard',
     *     order: 0,
     *     parent: null,
     *     enabled: true
     * });
     * ```
     */
    public async create(nodeData: Partial<IMenuNode>): Promise<IMenuNode> {
        const node: IMenuNode = {
            label: nodeData.label || '',
            url: nodeData.url,
            icon: nodeData.icon,
            order: nodeData.order ?? 0,
            parent: nodeData.parent ?? null,
            enabled: nodeData.enabled ?? true,
            requiredRole: nodeData.requiredRole
        };

        // Emit before:create event
        const validation = await this.emitEvent('before:create', node);
        if (!validation.continue) {
            throw new Error(validation.error || 'Menu creation cancelled by subscriber');
        }

        // Save to database
        const doc = await MenuNodeModel.create(node);
        const created = this.normalizeNode(doc.toObject());

        // Update in-memory tree
        this.menuTree.set(created._id!, created);

        // Emit after:create event
        await this.emitEvent('after:create', created);

        // Broadcast WebSocket update
        await this.broadcastTreeUpdate('after:create', created);

        logger.info({ nodeId: created._id, label: created.label }, 'Menu node created');
        return created;
    }

    /**
     * Update an existing menu node.
     *
     * Validates the update through before:update event subscribers, applies changes
     * to database, updates in-memory tree, emits after:update event, and broadcasts
     * WebSocket update to all clients.
     *
     * Subscribers receive both the new node data and the previous node state in the
     * event payload, allowing comparison of what changed.
     *
     * @param id - The _id of the node to update
     * @param updates - Partial node data to apply (only provided fields are updated)
     * @returns Promise resolving to the updated node
     * @throws Error if node not found, validation fails, or database operation fails
     *
     * @example
     * ```typescript
     * const updated = await menuService.update(nodeId, {
     *     label: 'New Label',
     *     order: 5
     * });
     * ```
     */
    public async update(id: string, updates: Partial<IMenuNode>): Promise<IMenuNode> {
        const existing = this.menuTree.get(id);
        if (!existing) {
            throw new Error(`Menu node not found: ${id}`);
        }

        const updated: IMenuNode = { ...existing, ...updates, _id: id };

        // Emit before:update event with previous state
        const validation = await this.emitEvent('before:update', updated, existing);
        if (!validation.continue) {
            throw new Error(validation.error || 'Menu update cancelled by subscriber');
        }

        // Update database
        await MenuNodeModel.findByIdAndUpdate(id, updates);

        // Update in-memory tree
        this.menuTree.set(id, updated);

        // Emit after:update event
        await this.emitEvent('after:update', updated, existing);

        // Broadcast WebSocket update
        await this.broadcastTreeUpdate('after:update', updated);

        logger.info({ nodeId: id, label: updated.label }, 'Menu node updated');
        return updated;
    }

    /**
     * Delete a menu node from the tree.
     *
     * Validates the deletion through before:delete event subscribers, removes from
     * database, updates in-memory tree, emits after:delete event, and broadcasts
     * WebSocket update to all clients.
     *
     * WARNING: This does NOT cascade delete children. Subscribers should implement
     * cascade logic if needed by subscribing to before:delete and handling children.
     *
     * @param id - The _id of the node to delete
     * @returns Promise that resolves when deletion is complete
     * @throws Error if node not found, validation fails, or database operation fails
     *
     * @example
     * ```typescript
     * // Subscribe to cascade delete children
     * menuService.subscribe('before:delete', async (event) => {
     *     const children = await menuService.getChildren(event.node._id!);
     *     for (const child of children) {
     *         await menuService.delete(child._id!);
     *     }
     * });
     *
     * // Delete node (children will be deleted by subscriber)
     * await menuService.delete(nodeId);
     * ```
     */
    public async delete(id: string): Promise<void> {
        const existing = this.menuTree.get(id);
        if (!existing) {
            throw new Error(`Menu node not found: ${id}`);
        }

        // Emit before:delete event
        const validation = await this.emitEvent('before:delete', existing);
        if (!validation.continue) {
            throw new Error(validation.error || 'Menu deletion cancelled by subscriber');
        }

        // Delete from database
        await MenuNodeModel.findByIdAndDelete(id);

        // Remove from in-memory tree
        this.menuTree.delete(id);

        // Emit after:delete event
        await this.emitEvent('after:delete', existing);

        // Broadcast WebSocket update
        await this.broadcastTreeUpdate('after:delete', existing);

        logger.info({ nodeId: id, label: existing.label }, 'Menu node deleted');
    }

    /**
     * Get the complete menu tree structure.
     *
     * Returns a hierarchical representation of all menu nodes organized by parent-child
     * relationships. Root nodes (parent is null) are returned in the `roots` array,
     * each potentially containing nested children. The `all` array provides a flat list
     * for quick lookups.
     *
     * This method uses the in-memory tree for instant access without database queries.
     * The tree is rebuilt on initialization and kept in sync through create/update/delete
     * operations.
     *
     * @returns Menu tree with roots, flat list, and generation timestamp
     *
     * @example
     * ```typescript
     * const tree = menuService.getTree();
     * console.log('Root nodes:', tree.roots);
     * console.log('Total nodes:', tree.all.length);
     * console.log('Generated at:', tree.generatedAt);
     * ```
     */
    public getTree(): IMenuTree {
        const all = Array.from(this.menuTree.values());
        const roots = this.buildTree(all);

        return {
            roots,
            all,
            generatedAt: new Date()
        };
    }

    /**
     * Get child nodes of a specific parent.
     *
     * Returns all nodes where parent matches the provided ID, sorted by order field.
     * Uses the in-memory tree for fast access without database queries.
     *
     * @param parentId - The _id of the parent node (or null for root nodes)
     * @returns Array of child nodes sorted by order
     *
     * @example
     * ```typescript
     * const rootNodes = menuService.getChildren(null);
     * const dashboardChildren = menuService.getChildren(dashboardNodeId);
     * ```
     */
    public getChildren(parentId: string | null): IMenuNode[] {
        return Array.from(this.menuTree.values())
            .filter(node => node.parent === parentId)
            .sort((a, b) => a.order - b.order);
    }

    /**
     * Get a single node by ID.
     *
     * Retrieves a node from the in-memory tree without database access.
     *
     * @param id - The _id of the node to retrieve
     * @returns The node or undefined if not found
     */
    public getNode(id: string): IMenuNode | undefined {
        return this.menuTree.get(id);
    }

    /**
     * Emit an event to all subscribers and collect validation results.
     *
     * Invokes all registered subscribers for the event type in order. For before:*
     * events, stops processing if any subscriber sets validation.continue = false.
     * For after:* events, always invokes all subscribers (validation cannot halt).
     *
     * @param eventType - The event type to emit
     * @param node - The node being operated on
     * @param previousNode - Optional previous state for update/move operations
     * @returns Validation object with continue flag and any error/warnings
     */
    private async emitEvent(
        eventType: MenuEventType,
        node: IMenuNode,
        previousNode?: IMenuNode
    ): Promise<IMenuValidation> {
        const validation: IMenuValidation = { continue: true };
        const subscribers = this.subscribers.get(eventType) || [];

        const event: IMenuEvent = {
            type: eventType,
            node,
            validation,
            previousNode,
            timestamp: new Date()
        };

        for (const subscriber of subscribers) {
            try {
                await subscriber(event);

                // Stop processing if subscriber halted validation (before:* events only)
                if (!validation.continue && eventType.startsWith('before:')) {
                    logger.debug(
                        { eventType, reason: validation.error },
                        'Event processing halted by subscriber'
                    );
                    break;
                }
            } catch (error) {
                logger.error(
                    { eventType, error },
                    'Menu event subscriber threw error'
                );
                // Continue processing other subscribers even if one fails
            }
        }

        return validation;
    }

    /**
     * Broadcast menu tree update via WebSocket to all connected clients.
     *
     * Emits a WebSocket event with the complete menu tree and the specific event
     * that triggered the update. Clients can use this to update their navigation
     * UI in real-time without polling.
     *
     * @param eventType - The event type that triggered the update
     * @param node - The node that was created/updated/deleted
     */
    private async broadcastTreeUpdate(eventType: MenuEventType, node: IMenuNode): Promise<void> {
        try {
            const wsService = WebSocketService.getInstance();
            const tree = this.getTree();

            wsService.emit({
                type: 'menu:update',
                payload: {
                    event: eventType,
                    node,
                    tree,
                    timestamp: new Date()
                }
            });

            logger.debug({ eventType, nodeId: node._id }, 'Menu tree update broadcast via WebSocket');
        } catch (error) {
            logger.error({ error }, 'Failed to broadcast menu tree update');
            // Don't throw - WebSocket failure shouldn't break menu operations
        }
    }

    /**
     * Build hierarchical tree structure from flat node list.
     *
     * Organizes nodes by parent-child relationships, creating nested children arrays.
     * Root nodes (parent is null or undefined) are returned as top-level array.
     *
     * @param nodes - Flat array of all nodes
     * @returns Array of root nodes with nested children
     */
    private buildTree(nodes: IMenuNode[]): IMenuNodeWithChildren[] {
        const nodeMap = new Map<string, IMenuNodeWithChildren>();
        const roots: IMenuNodeWithChildren[] = [];

        // First pass: create node map with empty children arrays
        for (const node of nodes) {
            nodeMap.set(node._id!, { ...node, children: [] });
        }

        // Second pass: build tree structure
        for (const node of nodes) {
            const nodeWithChildren = nodeMap.get(node._id!)!;

            if (!node.parent) {
                // Root node
                roots.push(nodeWithChildren);
            } else {
                // Child node - add to parent's children
                const parent = nodeMap.get(node.parent);
                if (parent) {
                    parent.children.push(nodeWithChildren);
                } else {
                    // Orphaned node (parent not found) - treat as root
                    roots.push(nodeWithChildren);
                }
            }
        }

        // Sort roots and all children by order
        const sortByOrder = (a: IMenuNodeWithChildren, b: IMenuNodeWithChildren) => a.order - b.order;
        roots.sort(sortByOrder);

        const sortChildren = (nodes: IMenuNodeWithChildren[]) => {
            for (const node of nodes) {
                if (node.children.length > 0) {
                    node.children.sort(sortByOrder);
                    sortChildren(node.children);
                }
            }
        };
        sortChildren(roots);

        return roots;
    }

    /**
     * Normalize a database document to IMenuNode interface.
     *
     * Converts MongoDB document (with _id as ObjectId) to plain object with
     * _id as string. Handles both Mongoose documents and plain objects.
     *
     * @param doc - MongoDB document or plain object
     * @returns Normalized menu node
     */
    private normalizeNode(doc: any): IMenuNode {
        return {
            _id: doc._id.toString(),
            label: doc.label,
            url: doc.url,
            icon: doc.icon,
            order: doc.order ?? 0,
            parent: doc.parent?.toString() ?? null,
            enabled: doc.enabled ?? true,
            requiredRole: doc.requiredRole,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
        };
    }

    /**
     * Create the default 'Home' root node on first startup.
     *
     * Called by initialize() when the menu tree is empty. Creates a single root
     * node pointing to the home page as the default menu structure.
     */
    private async createDefaultHomeNode(): Promise<void> {
        const homeNode = await MenuNodeModel.create({
            label: 'Home',
            url: '/',
            icon: 'Home',
            order: 0,
            parent: null,
            enabled: true
        });

        const normalized = this.normalizeNode(homeNode.toObject());
        this.menuTree.set(normalized._id!, normalized);

        logger.info({ nodeId: normalized._id }, 'Default Home menu node created');
    }
}
