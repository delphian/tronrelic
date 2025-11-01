import type { IMenuNode } from './IMenuNode.js';
import type { IMenuTree } from './IMenuTree.js';
import type { MenuEventType, MenuEventSubscriber } from './IMenuEvent.js';
import type { IMenuNamespaceConfig } from './IMenuNamespaceConfig.js';

/**
 * Service interface for managing the hierarchical menu system.
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
 * @example
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
export interface IMenuService {
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
    initialize(): Promise<void>;

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
    subscribe(eventType: MenuEventType, callback: MenuEventSubscriber): void;

    /**
     * Create a new menu node in the tree.
     *
     * Validates the node through before:create event subscribers, optionally saves
     * to database (for persistent entries), updates in-memory tree, emits after:create
     * event, and broadcasts WebSocket update to all clients.
     *
     * Subscribers can halt creation by setting validation.continue = false in the
     * before:create event handler.
     *
     * @param nodeData - Partial menu node data (label, url, order, parent, etc.)
     * @param persist - If true, saves to database for persistence across restarts.
     *                  If false (default), creates memory-only entry (e.g., plugin pages)
     * @returns Promise resolving to the created node with assigned _id
     * @throws Error if validation fails or database operation fails
     *
     * @example
     * ```typescript
     * // Memory-only menu entry (default) - recreated on each startup
     * const pluginNode = await menuService.create({
     *     label: 'My Plugin',
     *     url: '/my-plugin',
     *     icon: 'Puzzle',
     *     order: 50,
     *     parent: null,
     *     enabled: true
     * });
     *
     * // Persisted menu entry - saved to database
     * const dashboardNode = await menuService.create({
     *     label: 'Dashboard',
     *     url: '/dashboard',
     *     icon: 'LayoutDashboard',
     *     order: 0,
     *     parent: null,
     *     enabled: true
     * }, true);
     * ```
     */
    create(nodeData: Partial<IMenuNode>, persist?: boolean): Promise<IMenuNode>;

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
    update(id: string, updates: Partial<IMenuNode>): Promise<IMenuNode>;

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
    delete(id: string): Promise<void>;

    /**
     * Get the complete menu tree structure for a specific namespace.
     *
     * Returns a hierarchical representation of all menu nodes organized by parent-child
     * relationships within the specified namespace. Root nodes (parent is null) are returned
     * in the `roots` array, each potentially containing nested children. The `all` array
     * provides a flat list for quick lookups.
     *
     * This method uses the in-memory tree for instant access without database queries.
     * The tree is rebuilt on initialization and kept in sync through create/update/delete
     * operations.
     *
     * @param namespace - The menu namespace to retrieve (defaults to 'main' for backward compatibility)
     * @returns Menu tree with roots, flat list, and generation timestamp
     *
     * @example
     * ```typescript
     * // Get main navigation tree (default)
     * const mainTree = menuService.getTree();
     * const mainTreeExplicit = menuService.getTree('main');
     *
     * // Get footer menu tree
     * const footerTree = menuService.getTree('footer');
     *
     * // Get admin sidebar tree
     * const adminTree = menuService.getTree('admin-sidebar');
     * ```
     */
    getTree(namespace?: string): IMenuTree;

    /**
     * Get child nodes of a specific parent within a namespace.
     *
     * Returns all nodes where parent matches the provided ID within the specified namespace,
     * sorted by order field. Uses the in-memory tree for fast access without database queries.
     *
     * @param parentId - The _id of the parent node (or null for root nodes)
     * @param namespace - The menu namespace to query (defaults to 'main')
     * @returns Array of child nodes sorted by order
     *
     * @example
     * ```typescript
     * // Get root nodes in main navigation
     * const mainRoots = menuService.getChildren(null);
     * const mainRootsExplicit = menuService.getChildren(null, 'main');
     *
     * // Get children of a specific node in footer
     * const footerChildren = menuService.getChildren(parentNodeId, 'footer');
     * ```
     */
    getChildren(parentId: string | null, namespace?: string): IMenuNode[];

    /**
     * Get a single node by ID.
     *
     * Retrieves a node from the in-memory tree without database access.
     *
     * @param id - The _id of the node to retrieve
     * @returns The node or undefined if not found
     *
     * @example
     * ```typescript
     * const node = menuService.getNode('507f1f77bcf86cd799439011');
     * if (node) {
     *     console.log('Found:', node.label);
     * }
     * ```
     */
    getNode(id: string): IMenuNode | undefined;

    /**
     * Get all available menu namespaces.
     *
     * Returns a list of all namespace identifiers currently in use across all menu nodes.
     * Useful for admin interfaces that need to display or manage multiple menu trees.
     *
     * @returns Array of namespace strings (e.g., ['main', 'footer', 'admin-sidebar'])
     *
     * @example
     * ```typescript
     * const namespaces = menuService.getNamespaces();
     * console.log('Available menus:', namespaces);
     * // Output: ['main', 'footer', 'admin-sidebar']
     *
     * // Iterate through all menus
     * for (const namespace of namespaces) {
     *     const tree = menuService.getTree(namespace);
     *     console.log(`${namespace} has ${tree.all.length} nodes`);
     * }
     * ```
     */
    getNamespaces(): string[];

    /**
     * Get configuration for a menu namespace.
     *
     * Returns the configuration object containing UI rendering preferences for the
     * specified namespace. If no configuration has been explicitly saved, returns
     * sensible defaults with hamburger menu enabled at 768px width, icons enabled,
     * and horizontal layout.
     *
     * The configuration controls how the menu is displayed, including:
     * - Hamburger menu behavior (enabled, trigger width)
     * - Icon display (enabled, position)
     * - Layout orientation (horizontal/vertical)
     * - Styling hints (compact mode, label visibility)
     *
     * @param namespace - The menu namespace to retrieve config for (defaults to 'main')
     * @returns Promise resolving to namespace configuration with defaults if not found
     *
     * @example
     * ```typescript
     * // Get main navigation config
     * const mainConfig = await menuService.getNamespaceConfig('main');
     * console.log('Hamburger enabled:', mainConfig.hamburgerMenu?.enabled);
     * console.log('Trigger width:', mainConfig.hamburgerMenu?.triggerWidth);
     *
     * // Get footer config with defaults
     * const footerConfig = await menuService.getNamespaceConfig('footer');
     * if (!footerConfig._id) {
     *     console.log('Using default config (not saved to database)');
     * }
     * ```
     */
    getNamespaceConfig(namespace?: string): Promise<IMenuNamespaceConfig>;

    /**
     * Set configuration for a menu namespace.
     *
     * Creates or updates the configuration for the specified namespace. If a configuration
     * already exists, the provided fields are merged with existing values (partial update).
     * After updating the database, broadcasts a WebSocket event to notify connected clients
     * of the configuration change.
     *
     * All timestamps (createdAt, updatedAt) are managed automatically by the service.
     * The namespace field cannot be changed after creation.
     *
     * @param namespace - The menu namespace to configure
     * @param config - Partial configuration to apply (only provided fields are updated)
     * @returns Promise resolving to the complete updated configuration
     * @throws Error if database operation fails
     *
     * @example
     * ```typescript
     * // Enable hamburger menu for main navigation at 1024px
     * const updated = await menuService.setNamespaceConfig('main', {
     *     hamburgerMenu: {
     *         enabled: true,
     *         triggerWidth: 1024
     *     }
     * });
     *
     * // Update only icon settings (hamburger config unchanged)
     * await menuService.setNamespaceConfig('footer', {
     *     icons: {
     *         enabled: false
     *     }
     * });
     *
     * // Set compact mode for admin sidebar
     * await menuService.setNamespaceConfig('admin-sidebar', {
     *     styling: {
     *         compact: true,
     *         showLabels: false
     *     }
     * });
     * ```
     */
    setNamespaceConfig(namespace: string, config: Partial<IMenuNamespaceConfig>): Promise<IMenuNamespaceConfig>;

    /**
     * Delete configuration for a menu namespace.
     *
     * Removes the stored configuration from the database. After deletion, future calls to
     * getNamespaceConfig() will return default values instead of persisted settings.
     * Broadcasts a WebSocket event to notify connected clients that the namespace has
     * reverted to default configuration.
     *
     * This is useful for resetting a namespace to defaults or removing unused configurations.
     * Does not affect the menu nodes themselves - only the rendering preferences.
     *
     * @param namespace - The menu namespace to delete configuration for
     * @returns Promise that resolves when deletion is complete
     * @throws Error if namespace not found or database operation fails
     *
     * @example
     * ```typescript
     * // Reset footer to default configuration
     * await menuService.deleteNamespaceConfig('footer');
     *
     * // After deletion, getNamespaceConfig returns defaults
     * const config = await menuService.getNamespaceConfig('footer');
     * console.log('Has ID:', config._id); // undefined - using defaults
     * ```
     */
    deleteNamespaceConfig(namespace: string): Promise<void>;
}
