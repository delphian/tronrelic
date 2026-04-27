import type {
    IMenuService,
    IMenuNode,
    IMenuTree,
    IMenuNodeWithChildren,
    IMenuEvent,
    IMenuValidation,
    MenuEventType,
    MenuEventSubscriber,
    IDatabaseService,
    IMenuNamespaceConfig,
    IServiceRegistry,
    IUserGroupService,
    IUser,
    UserIdentityState as UserIdentityStateType
} from '@/types';
import { UserIdentityState } from '@/types';
import { logger } from '../../../lib/logger.js';
import { WebSocketService } from '../../../services/websocket.service.js';
import { ObjectId } from 'mongodb';
import type { IMenuNodeDocument, IMenuNamespaceConfigDocument, IMenuNodeOverrideDocument } from '../database/index.js';
import { ADMIN_NAMESPACES } from '../constants.js';

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
    private menuTree: Map<string, Map<string, IMenuNode>> = new Map(); // namespace -> node map
    private subscribers: Map<MenuEventType, MenuEventSubscriber[]> = new Map();
    private initialized = false;
    private database: IDatabaseService;
    private serviceRegistry: IServiceRegistry;
    private readonly DEFAULT_NAMESPACE = 'main';
    private readonly OVERRIDES_COLLECTION = 'menu_node_overrides';
    private persistedNodeIds = new Set<string>();

    // Admin-only namespace list lives in `../constants.ts` so the HTTP
    // gate (controller) and the WebSocket suppression (this service) can
    // never drift. Suppressing the broadcast while leaving the read path
    // open would desync the admin nav across browser tabs without
    // securing anything, so the two enforcements must stay in lock-step.

    /**
     * Private constructor enforcing singleton pattern with dependency injection.
     *
     * @param database - Database service for menu node storage
     * @param serviceRegistry - Service registry for late-binding lookup of
     *                          `IUserGroupService` (used by the gating filter to
     *                          evaluate `requiresAdmin`)
     */
    private constructor(database: IDatabaseService, serviceRegistry: IServiceRegistry) {
        this.database = database;
        this.serviceRegistry = serviceRegistry;
    }

    /**
     * Configure the singleton with its dependencies.
     *
     * Must be called once during application bootstrap before getInstance().
     * The service registry is held for lazy `IUserGroupService` lookup at read
     * time — by the time anyone calls `getTree()` with a user, the user module
     * has registered `'user-groups'`.
     *
     * @param database - Database service for menu node storage
     * @param serviceRegistry - Service registry for late-binding service lookup
     */
    public static setDependencies(database: IDatabaseService, serviceRegistry: IServiceRegistry): void {
        if (!MenuService.instance) {
            MenuService.instance = new MenuService(database, serviceRegistry);
        }
    }

    /**
     * @deprecated Use `setDependencies(database, serviceRegistry)` instead. Retained for
     * tests and external callers that haven't migrated; throws at read time if a node
     * uses `requiresAdmin` because the registry is unavailable.
     */
    public static setDatabase(database: IDatabaseService): void {
        if (!MenuService.instance) {
            const stub: IServiceRegistry = {
                register: () => { /* no-op stub */ },
                unregister: () => false,
                get: () => undefined,
                has: () => false,
                getNames: () => [],
                watch: () => () => { /* no-op disposer */ }
            };
            MenuService.instance = new MenuService(database, stub);
        }
    }

    /**
     * Get the singleton instance of MenuService.
     *
     * Creates the instance on first call and returns the same instance on
     * subsequent calls, ensuring a single source of truth for menu state.
     *
     * @returns The singleton MenuService instance
     * @throws Error if setDependencies() was not called first
     */
    public static getInstance(): MenuService {
        if (!MenuService.instance) {
            throw new Error('MenuService.setDependencies() must be called before getInstance()');
        }
        return MenuService.instance;
    }

    /**
     * Reset the singleton (test-only).
     *
     * @internal
     */
    public static __resetForTests(): void {
        // Used by Vitest suites to swap in a fresh instance with mock deps.
        MenuService.instance = undefined as unknown as MenuService;
    }

    /**
     * Initialize the menu service by loading tree from database and creating defaults.
     *
     * This method should be called once during application bootstrap after database
     * connection is established. It loads all menu nodes from MongoDB into memory,
     * builds the tree structure, and creates a default 'Home' root node if the menu
     * is empty (first startup).
     *
     * Emits three lifecycle events during initialization:
     * 1. 'init' - Immediately when initialization begins (functionality TBD)
     * 2. 'ready' - When service is ready to accept registrations and API calls
     * 3. 'loaded' - When menu tree is fully built and ready for consumption
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
            // Emit 'init' event - service startup begins
            await this.emitLifecycleEvent('init');

            // Load all nodes from database using native MongoDB collection
            const collection = this.database.getCollection<IMenuNodeDocument>('menu_nodes');
            const nodes = await collection.find({}).toArray();

            // Ensure overrides index exists for fast lookups
            const overridesCollection = this.database.getCollection<IMenuNodeOverrideDocument>(this.OVERRIDES_COLLECTION);
            await overridesCollection.createIndex(
                { namespace: 1, url: 1 },
                { unique: true }
            ).catch(err => logger.debug({ err }, 'Overrides index already exists'));

            // Build in-memory tree organized by namespace
            this.menuTree.clear();
            this.persistedNodeIds.clear();
            for (const node of nodes) {
                const normalized = this.normalizeNode(node);
                const namespace = normalized.namespace || this.DEFAULT_NAMESPACE;

                if (!this.menuTree.has(namespace)) {
                    this.menuTree.set(namespace, new Map());
                }

                this.menuTree.get(namespace)!.set(normalized._id!, normalized);
                this.persistedNodeIds.add(normalized._id!);
            }

            // Create default 'Home' root node if menu is empty
            const totalNodes = Array.from(this.menuTree.values()).reduce((sum, ns) => sum + ns.size, 0);
            if (totalNodes === 0) {
                logger.info('Menu is empty, creating default Home node');
                await this.createDefaultHomeNode();
            }

            // Mark as initialized (service is ready to accept registrations)
            this.initialized = true;

            // Emit 'ready' event - service can now accept API calls and registrations
            await this.emitLifecycleEvent('ready');

            // Emit 'loaded' event - menu tree is fully built and ready for consumption
            await this.emitLifecycleEvent('loaded');

            logger.info({ nodeCount: totalNodes, namespaceCount: this.menuTree.size }, 'MenuService initialized');
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
     * Validates the node through before:create event subscribers, optionally saves
     * to database (for admin-created entries), updates in-memory tree, emits
     * after:create event, and broadcasts WebSocket update to all clients.
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
     * // Memory-only entry (default) - plugins use this for runtime pages
     * const pluginPage = await menuService.create({
     *     label: 'Whale Alerts',
     *     url: '/plugins/whale-alerts',
     *     icon: 'Fish',
     *     order: 100,
     *     parent: null,
     *     enabled: true
     * });
     *
     * // Persisted entry - admin API uses this for manual menu entries
     * const adminEntry = await menuService.create({
     *     label: 'Dashboard',
     *     url: '/dashboard',
     *     icon: 'LayoutDashboard',
     *     order: 0,
     *     parent: null,
     *     enabled: true
     * }, true);
     * ```
     */
    public async create(nodeData: Partial<IMenuNode>, persist = false): Promise<IMenuNode> {
        const namespace = nodeData.namespace || this.DEFAULT_NAMESPACE;
        // Auto-derive URL for container nodes that omit it.
        // Slugifies the label and prepends parent URL for hierarchical paths.
        let derivedUrl = nodeData.url;
        if (!derivedUrl && nodeData.label) {
            const slug = nodeData.label.toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '')
                .replace(/-+/g, '-')
                .replace(/^-+|-+$/g, '');
            if (!slug) {
                throw new Error(`Cannot auto-derive URL from label "${nodeData.label}": slugification produced an empty string. Provide an explicit url.`);
            }
            if (nodeData.parent) {
                const parentNode = this.getNode(nodeData.parent);
                const baseUrl = parentNode?.url === '/' ? '' : (parentNode?.url || '');
                derivedUrl = `${baseUrl}/${slug}`;
            } else {
                derivedUrl = `/${slug}`;
            }
        }

        const node: IMenuNode = {
            namespace,
            label: nodeData.label || '',
            description: nodeData.description,
            url: derivedUrl,
            icon: nodeData.icon,
            order: nodeData.order ?? 0,
            parent: nodeData.parent ?? null,
            enabled: nodeData.enabled ?? true,
            allowedIdentityStates: nodeData.allowedIdentityStates,
            requiresGroups: nodeData.requiresGroups,
            requiresAdmin: nodeData.requiresAdmin
        };

        // Reject duplicate URLs within the same namespace. Without this,
        // multiple plugins (or a stolen-token attacker) can shadow a
        // legitimate menu item by registering one with a colliding URL —
        // `resolve()` returns the first match, so the winner is order-
        // dependent and unstable across deploys.
        if (derivedUrl) {
            const namespaceMap = this.menuTree.get(namespace);
            if (namespaceMap) {
                for (const existing of namespaceMap.values()) {
                    if (existing.url === derivedUrl) {
                        throw new Error(`URL "${derivedUrl}" already exists in namespace "${namespace}"`);
                    }
                }
            }
        }

        // Emit before:create event
        const validation = await this.emitEvent('before:create', node);
        if (!validation.continue) {
            throw new Error(validation.error || 'Menu creation cancelled by subscriber');
        }

        let created: IMenuNode;

        if (persist) {
            // Save to database for persistence across restarts (admin entries)
            const collection = this.database.getCollection<IMenuNodeDocument>('menu_nodes');
            const now = new Date();
            const docToInsert: Partial<IMenuNodeDocument> = {
                namespace,
                label: node.label,
                description: node.description,
                url: node.url,
                icon: node.icon,
                order: node.order,
                parent: node.parent ? new ObjectId(node.parent) : null,
                enabled: node.enabled,
                allowedIdentityStates: node.allowedIdentityStates,
                requiresGroups: node.requiresGroups,
                requiresAdmin: node.requiresAdmin,
                createdAt: now,
                updatedAt: now
            };

            const result = await collection.insertOne(docToInsert as IMenuNodeDocument);
            const insertedDoc = await collection.findOne({ _id: result.insertedId });

            if (!insertedDoc) {
                throw new Error('Failed to retrieve inserted menu node');
            }

            created = this.normalizeNode(insertedDoc);
            this.persistedNodeIds.add(created._id!);
        } else {
            // Memory-only entry (plugin pages, runtime entries)
            // Apply any saved overrides so user customizations survive restarts
            const override = node.url ? await this.loadOverride(namespace, node.url) : null;

            created = {
                _id: new ObjectId().toString(),
                namespace,
                label: override?.label ?? node.label,
                description: override?.description ?? node.description,
                url: node.url,
                icon: override?.icon ?? node.icon,
                order: override?.order ?? node.order,
                parent: node.parent,
                enabled: override?.enabled ?? node.enabled,
                allowedIdentityStates: node.allowedIdentityStates,
                requiresGroups: node.requiresGroups,
                requiresAdmin: node.requiresAdmin,
                createdAt: new Date(),
                updatedAt: new Date()
            };
        }

        // Update in-memory tree
        if (!this.menuTree.has(namespace)) {
            this.menuTree.set(namespace, new Map());
        }
        this.menuTree.get(namespace)!.set(created._id!, created);

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
     * Validates the update through before:update event subscribers, optionally applies
     * changes to database (for persisted entries), updates in-memory tree, emits
     * after:update event, and broadcasts WebSocket update to all clients.
     *
     * Subscribers receive both the new node data and the previous node state in the
     * event payload, allowing comparison of what changed.
     *
     * @param id - The _id of the node to update
     * @param updates - Partial node data to apply (only provided fields are updated)
     * @param persist - If true, saves changes to database. If false (default), memory-only update
     * @returns Promise resolving to the updated node
     * @throws Error if node not found, validation fails, or database operation fails
     *
     * @example
     * ```typescript
     * // Memory-only update (default) - for runtime entries
     * const updated = await menuService.update(nodeId, {
     *     label: 'New Label',
     *     order: 5
     * });
     *
     * // Persisted update - for admin entries
     * const persistedUpdate = await menuService.update(nodeId, {
     *     label: 'New Label',
     *     order: 5
     * }, true);
     * ```
     */
    public async update(id: string, updates: Partial<IMenuNode>, persist = false): Promise<IMenuNode> {
        // Find the node across all namespaces
        let existing: IMenuNode | undefined;
        let existingNamespace: string | undefined;

        for (const [ns, nodes] of this.menuTree) {
            const node = nodes.get(id);
            if (node) {
                existing = node;
                existingNamespace = ns;
                break;
            }
        }

        if (!existing || !existingNamespace) {
            throw new Error(`Menu node not found: ${id}`);
        }

        const updated: IMenuNode = { ...existing, ...updates, _id: id };
        const newNamespace = updated.namespace || existingNamespace;

        // If the URL or namespace is changing, refuse to clobber an existing
        // node at the new (namespace, url) coordinate. Same rationale as the
        // collision check in create() — silent shadowing breaks `resolve()`
        // determinism.
        const urlChanged = updates.url !== undefined && updates.url !== existing.url;
        const namespaceChanged = newNamespace !== existingNamespace;
        if (updated.url && (urlChanged || namespaceChanged)) {
            const targetMap = this.menuTree.get(newNamespace);
            if (targetMap) {
                for (const candidate of targetMap.values()) {
                    if (candidate._id !== id && candidate.url === updated.url) {
                        throw new Error(`URL "${updated.url}" already exists in namespace "${newNamespace}"`);
                    }
                }
            }
        }

        // Reject parent changes that would create a cycle. Cycles make nodes
        // unreachable from any root (so they vanish from the tree view) and
        // can wedge any walker that doesn't track visited ids. Walk ancestors
        // of the proposed parent; if we encounter `id`, the proposed parent
        // is a descendant of the node being updated. The visited set bounds
        // the walk in case the existing tree is already corrupt.
        if (updates.parent !== undefined && updates.parent !== null && updates.parent !== existing.parent) {
            if (updates.parent === id) {
                throw new Error('Cannot set node as its own parent');
            }
            const visited = new Set<string>();
            let cursor: string | null = updates.parent;
            while (cursor && !visited.has(cursor)) {
                if (cursor === id) {
                    throw new Error(`Circular parent reference: ${id} would become an ancestor of itself`);
                }
                visited.add(cursor);
                cursor = this.getNode(cursor)?.parent ?? null;
            }
        }

        // Emit before:update event with previous state
        const validation = await this.emitEvent('before:update', updated, existing);
        if (!validation.continue) {
            throw new Error(validation.error || 'Menu update cancelled by subscriber');
        }

        if (persist) {
            if (this.persistedNodeIds.has(id)) {
                // Node exists in menu_nodes — update it directly
                const collection = this.database.getCollection<IMenuNodeDocument>('menu_nodes');
                const updateDoc: Partial<IMenuNodeDocument> = {
                    ...(updates.namespace !== undefined && { namespace: updates.namespace }),
                    ...(updates.label !== undefined && { label: updates.label }),
                    ...(updates.description !== undefined && { description: updates.description }),
                    ...(updates.url !== undefined && { url: updates.url }),
                    ...(updates.icon !== undefined && { icon: updates.icon }),
                    ...(updates.order !== undefined && { order: updates.order }),
                    ...(updates.parent !== undefined && { parent: updates.parent ? new ObjectId(updates.parent) : null }),
                    ...(updates.enabled !== undefined && { enabled: updates.enabled }),
                    ...(updates.allowedIdentityStates !== undefined && { allowedIdentityStates: updates.allowedIdentityStates }),
                    ...(updates.requiresGroups !== undefined && { requiresGroups: updates.requiresGroups }),
                    ...(updates.requiresAdmin !== undefined && { requiresAdmin: updates.requiresAdmin }),
                    updatedAt: new Date()
                };

                await collection.updateOne({ _id: new ObjectId(id) }, { $set: updateDoc });
            } else if (existing.url) {
                // Memory-only node with a URL — save overrides so changes survive restarts
                await this.saveOverride(existing.namespace || this.DEFAULT_NAMESPACE, existing.url, updates);
            }
        }
        updated.updatedAt = new Date();

        // Update in-memory tree (handle namespace change)
        if (newNamespace !== existingNamespace) {
            // Remove from old namespace
            this.menuTree.get(existingNamespace)!.delete(id);

            // Add to new namespace
            if (!this.menuTree.has(newNamespace)) {
                this.menuTree.set(newNamespace, new Map());
            }
            this.menuTree.get(newNamespace)!.set(id, updated);
        } else {
            // Same namespace, just update
            this.menuTree.get(existingNamespace)!.set(id, updated);
        }

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
     * Validates the deletion through before:delete event subscribers, optionally removes
     * from database (for persisted entries), updates in-memory tree, emits after:delete
     * event, and broadcasts WebSocket update to all clients.
     *
     * WARNING: This does NOT cascade delete children. Subscribers should implement
     * cascade logic if needed by subscribing to before:delete and handling children.
     *
     * @param id - The _id of the node to delete
     * @param persist - If true, removes from database. If false (default), memory-only deletion
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
     * // Delete memory-only node (default)
     * await menuService.delete(nodeId);
     *
     * // Delete persisted node (admin entries)
     * await menuService.delete(nodeId, true);
     * ```
     */
    public async delete(id: string, persist = false): Promise<void> {
        // Find the node across all namespaces
        let existing: IMenuNode | undefined;
        let existingNamespace: string | undefined;

        for (const [ns, nodes] of this.menuTree) {
            const node = nodes.get(id);
            if (node) {
                existing = node;
                existingNamespace = ns;
                break;
            }
        }

        if (!existing || !existingNamespace) {
            throw new Error(`Menu node not found: ${id}`);
        }

        // Emit before:delete event
        const validation = await this.emitEvent('before:delete', existing);
        if (!validation.continue) {
            throw new Error(validation.error || 'Menu deletion cancelled by subscriber');
        }

        if (persist) {
            // Delete from database for persisted entries only
            const collection = this.database.getCollection<IMenuNodeDocument>('menu_nodes');
            await collection.deleteOne({ _id: new ObjectId(id) });
        }

        // Remove from in-memory tree
        this.menuTree.get(existingNamespace)!.delete(id);

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
    public getTree(namespace?: string): IMenuTree {
        const ns = namespace || this.DEFAULT_NAMESPACE;
        const namespaceMap = this.menuTree.get(ns);

        if (!namespaceMap) {
            // Namespace doesn't exist, return empty tree
            return {
                roots: [],
                all: [],
                generatedAt: new Date()
            };
        }

        const all = Array.from(namespaceMap.values());
        const roots = this.buildTree(all);

        return {
            roots,
            all,
            generatedAt: new Date()
        };
    }

    /**
     * Get the menu tree filtered to nodes the given user is permitted to see.
     *
     * Applies the gating rules declared on each node (`allowedIdentityStates`,
     * `requiresGroups`, `requiresAdmin`) using the cookie-resolved user. An
     * `undefined` user is treated as an anonymous visitor with no group
     * memberships, so only nodes with no gates (or with `'anonymous'` in their
     * `allowedIdentityStates`) appear.
     *
     * The admin predicate (`requiresAdmin: true`) resolves through
     * `IUserGroupService.isAdmin`, looked up lazily from the service registry.
     * If the user-groups service is not registered, admin-gated nodes are
     * hidden from non-admin token holders by default.
     *
     * @param namespace - Menu namespace (defaults to 'main')
     * @param user - Cookie-resolved user, or undefined for anonymous
     * @returns Filtered tree containing only nodes the user may see
     */
    public async getTreeForUser(namespace: string | undefined, user: IUser | undefined): Promise<IMenuTree> {
        const tree = this.getTree(namespace);
        const groupsService = this.serviceRegistry.get<IUserGroupService>('user-groups');
        const isUserAdmin = user && groupsService ? await groupsService.isAdmin(user.id) : false;

        const visible = tree.all.filter((node) => this.passesGate(node, user, isUserAdmin));
        return {
            roots: this.buildTree(visible),
            all: visible,
            generatedAt: tree.generatedAt
        };
    }

    /**
     * Get a single child of the named parent that the given user may see.
     *
     * Same gating rules as {@link getTreeForUser}; returns the user-filtered
     * children sorted by order.
     */
    public async getChildrenForUser(
        parentId: string | null,
        namespace: string | undefined,
        user: IUser | undefined
    ): Promise<IMenuNode[]> {
        const groupsService = this.serviceRegistry.get<IUserGroupService>('user-groups');
        const isUserAdmin = user && groupsService ? await groupsService.isAdmin(user.id) : false;
        return this.getChildren(parentId, namespace).filter((node) => this.passesGate(node, user, isUserAdmin));
    }

    /**
     * Decide whether a single node is visible to the given user.
     *
     * The three gating fields are ANDed together — a missing field is
     * tautologically true. The order of checks is intentional: cheap
     * in-memory predicates first, then the precomputed admin flag.
     *
     * @param node - The node under consideration
     * @param user - Cookie-resolved user, or undefined for anonymous
     * @param isUserAdmin - Result of `groups.isAdmin(user.id)`, precomputed
     *                      so a tree filter can amortize one DB round-trip
     *                      across hundreds of nodes
     */
    private passesGate(node: IMenuNode, user: IUser | undefined, isUserAdmin: boolean): boolean {
        const identityState: UserIdentityStateType = user?.identityState ?? UserIdentityState.Anonymous;
        const userGroups: string[] = user?.groups ?? [];

        // Identity-state allow-list: if set, the user's state must be in it.
        if (node.allowedIdentityStates && node.allowedIdentityStates.length > 0) {
            if (!node.allowedIdentityStates.includes(identityState)) return false;
        }

        // Required groups: if set, the user must be in at least one.
        if (node.requiresGroups && node.requiresGroups.length > 0) {
            const hasAny = node.requiresGroups.some((gid) => userGroups.includes(gid));
            if (!hasAny) return false;
        }

        // Admin predicate: routes through IUserGroupService.isAdmin so future
        // seeded admin tiers (e.g. super-admin) automatically qualify.
        if (node.requiresAdmin && !isUserAdmin) return false;

        return true;
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
    public getChildren(parentId: string | null, namespace?: string): IMenuNode[] {
        const ns = namespace || this.DEFAULT_NAMESPACE;
        const namespaceMap = this.menuTree.get(ns);

        if (!namespaceMap) {
            return [];
        }

        return Array.from(namespaceMap.values())
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
        // Search across all namespaces
        for (const nodes of this.menuTree.values()) {
            const node = nodes.get(id);
            if (node) {
                return node;
            }
        }
        return undefined;
    }

    public getNamespaces(): string[] {
        return Array.from(this.menuTree.keys()).sort();
    }

    /**
     * Get configuration for a menu namespace.
     *
     * Returns the configuration object containing UI rendering preferences for the
     * specified namespace. If no configuration has been explicitly saved, returns
     * sensible defaults with hamburger menu enabled at 768px width, icons enabled,
     * and horizontal layout.
     *
     * @param namespace - The menu namespace to retrieve config for (defaults to 'main')
     * @returns Promise resolving to namespace configuration with defaults if not found
     */
    public async getNamespaceConfig(namespace?: string): Promise<IMenuNamespaceConfig> {
        const ns = namespace || this.DEFAULT_NAMESPACE;
        const collection = this.database.getCollection<IMenuNamespaceConfigDocument>('menu_namespace_config');

        const doc = await collection.findOne({ namespace: ns });

        if (doc) {
            return this.normalizeNamespaceConfig(doc);
        }

        // Return defaults if no config found
        return {
            namespace: ns,
            overflow: {
                enabled: true
            },
            icons: {
                enabled: true,
                position: 'left'
            },
            layout: {
                orientation: 'horizontal'
            },
            styling: {
                compact: false,
                showLabels: true
            }
        };
    }

    /**
     * Set configuration for a menu namespace.
     *
     * Creates or updates the configuration for the specified namespace. If a configuration
     * already exists, the provided fields are merged with existing values (partial update).
     * After updating the database, broadcasts a WebSocket event to notify connected clients
     * of the configuration change.
     *
     * @param namespace - The menu namespace to configure
     * @param config - Partial configuration to apply (only provided fields are updated)
     * @returns Promise resolving to the complete updated configuration
     * @throws Error if database operation fails
     */
    public async setNamespaceConfig(namespace: string, config: Partial<IMenuNamespaceConfig>): Promise<IMenuNamespaceConfig> {
        const collection = this.database.getCollection<IMenuNamespaceConfigDocument>('menu_namespace_config');
        const now = new Date();

        // Check if config already exists
        const existing = await collection.findOne({ namespace });

        if (existing) {
            // Update existing config
            const updateDoc: Partial<IMenuNamespaceConfigDocument> = {
                ...(config.overflow !== undefined && { overflow: config.overflow }),
                ...(config.icons !== undefined && { icons: config.icons }),
                ...(config.layout !== undefined && { layout: config.layout }),
                ...(config.styling !== undefined && { styling: config.styling }),
                updatedAt: now
            };

            await collection.updateOne(
                { namespace },
                { $set: updateDoc }
            );

            const updated = await collection.findOne({ namespace });
            if (!updated) {
                throw new Error('Failed to retrieve updated namespace config');
            }

            const normalized = this.normalizeNamespaceConfig(updated);

            // Broadcast WebSocket update
            await this.broadcastNamespaceConfigUpdate(normalized);

            logger.info({ namespace }, 'Menu namespace configuration updated');
            return normalized;
        } else {
            // Create new config
            const docToInsert: Partial<IMenuNamespaceConfigDocument> = {
                namespace,
                overflow: config.overflow,
                icons: config.icons,
                layout: config.layout,
                styling: config.styling,
                createdAt: now,
                updatedAt: now
            };

            const result = await collection.insertOne(docToInsert as IMenuNamespaceConfigDocument);
            const inserted = await collection.findOne({ _id: result.insertedId });

            if (!inserted) {
                throw new Error('Failed to retrieve inserted namespace config');
            }

            const normalized = this.normalizeNamespaceConfig(inserted);

            // Broadcast WebSocket update
            await this.broadcastNamespaceConfigUpdate(normalized);

            logger.info({ namespace }, 'Menu namespace configuration created');
            return normalized;
        }
    }

    /**
     * Delete configuration for a menu namespace.
     *
     * Removes the stored configuration from the database. After deletion, future calls to
     * getNamespaceConfig() will return default values instead of persisted settings.
     * Broadcasts a WebSocket event to notify connected clients that the namespace has
     * reverted to default configuration.
     *
     * @param namespace - The menu namespace to delete configuration for
     * @returns Promise that resolves when deletion is complete
     * @throws Error if namespace not found or database operation fails
     */
    public async deleteNamespaceConfig(namespace: string): Promise<void> {
        const collection = this.database.getCollection<IMenuNamespaceConfigDocument>('menu_namespace_config');

        const existing = await collection.findOne({ namespace });
        if (!existing) {
            throw new Error(`Namespace configuration not found: ${namespace}`);
        }

        await collection.deleteOne({ namespace });

        // Get default config to broadcast
        const defaultConfig = await this.getNamespaceConfig(namespace);

        // Broadcast WebSocket update with defaults
        await this.broadcastNamespaceConfigUpdate(defaultConfig);

        logger.info({ namespace }, 'Menu namespace configuration deleted');
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
     * Emit a lifecycle event to backend subscribers only.
     *
     * Lifecycle events (init, ready, loaded) signal different stages of service
     * initialization to backend subscribers like plugins. These events do NOT
     * broadcast via WebSocket because clients are not connected during backend
     * startup. Clients should fetch initial menu data via API or SSR.
     *
     * @param eventType - The lifecycle event type (init, ready, or loaded)
     */
    private async emitLifecycleEvent(eventType: 'init' | 'ready' | 'loaded'): Promise<void> {
        const subscribers = this.subscribers.get(eventType) || [];
        const validation: IMenuValidation = { continue: true };

        for (const subscriber of subscribers) {
            try {
                await subscriber({
                    type: eventType,
                    node: {} as IMenuNode, // Lifecycle events don't have a node
                    validation,
                    timestamp: new Date()
                });
            } catch (error) {
                logger.error({ eventType, error }, 'Lifecycle event subscriber threw error');
            }
        }

        logger.debug({ eventType, subscriberCount: subscribers.length }, `Menu lifecycle event '${eventType}' emitted to backend subscribers`);
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
            const ns = node.namespace || this.DEFAULT_NAMESPACE;

            // Admin namespaces never broadcast publicly. The signal goes to
            // every connected socket via `io.emit`, so any system-namespace
            // mutation would otherwise leak the existence of admin URLs to
            // anonymous visitors. Admin UIs reload via authenticated fetch
            // after each mutation, so the suppression is invisible to them.
            if (ADMIN_NAMESPACES.has(ns)) {
                logger.debug({ eventType, nodeId: node._id, namespace: ns }, 'Suppressed admin-namespace WebSocket broadcast');
                return;
            }

            // Per-user gating (allowedIdentityStates / requiresGroups /
            // requiresAdmin) means there is no single tree shape that fits
            // every connected client. Send a refetch signal instead — each
            // client re-requests `GET /api/menu` with its own cookie and the
            // server returns the filtered view. Identifiers are kept in the
            // payload so clients can scope cache invalidation to one
            // namespace, but no node body is shipped.
            const wsService = WebSocketService.getInstance();
            wsService.emit({
                event: 'menu:update',
                payload: {
                    event: eventType,
                    namespace: ns,
                    nodeId: node._id,
                    timestamp: new Date()
                }
            });

            logger.debug({ eventType, nodeId: node._id, namespace: ns }, 'Menu refetch signal broadcast via WebSocket');
        } catch (error) {
            logger.error({ error }, 'Failed to broadcast menu refetch signal');
            // Don't throw - WebSocket failure shouldn't break menu operations
        }
    }

    /**
     * Load a saved override for a memory-only menu node.
     *
     * Looks up user-customized properties by (namespace, url) from the overrides
     * collection. Returns null if no override exists.
     *
     * @param namespace - Menu namespace
     * @param url - Node URL (stable identifier across restarts)
     * @returns Override document or null
     */
    private async loadOverride(namespace: string, url: string): Promise<IMenuNodeOverrideDocument | null> {
        try {
            const collection = this.database.getCollection<IMenuNodeOverrideDocument>(this.OVERRIDES_COLLECTION);
            const result = await collection.findOne({ namespace, url });

            return result;
        } catch (error) {
            logger.error({ error, namespace, url }, 'Failed to load menu node override');
            return null;
        }
    }

    /**
     * Save user-customized properties for a memory-only menu node.
     *
     * Upserts an override document keyed by (namespace, url) so that when a plugin
     * re-registers the same menu item on next startup, user customizations are applied.
     *
     * @param namespace - Menu namespace
     * @param url - Node URL (stable identifier across restarts)
     * @param updates - The properties being changed by the admin
     */
    private async saveOverride(namespace: string, url: string, updates: Partial<IMenuNode>): Promise<void> {
        try {
            const collection = this.database.getCollection<IMenuNodeOverrideDocument>(this.OVERRIDES_COLLECTION);
            const now = new Date();

            const overrideFields: Partial<IMenuNodeOverrideDocument> = {
                ...(updates.order !== undefined && { order: updates.order }),
                ...(updates.icon !== undefined && { icon: updates.icon }),
                ...(updates.label !== undefined && { label: updates.label }),
                ...(updates.description !== undefined && { description: updates.description }),
                ...(updates.enabled !== undefined && { enabled: updates.enabled }),
                updatedAt: now
            };

            await collection.updateOne(
                { namespace, url },
                {
                    $set: overrideFields,
                    $setOnInsert: { namespace, url, createdAt: now }
                },
                { upsert: true }
            );

            logger.debug({ namespace, url, overrideFields }, 'Menu node override saved');
        } catch (error) {
            logger.error({ error, namespace, url }, 'Failed to save menu node override');
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
     * _id as string. Handles both ObjectId and string parent references.
     *
     * @param doc - MongoDB document from native collection
     * @returns Normalized menu node
     */
    private normalizeNode(doc: IMenuNodeDocument): IMenuNode {
        return {
            _id: doc._id.toString(),
            namespace: doc.namespace || this.DEFAULT_NAMESPACE,
            label: doc.label,
            description: doc.description,
            url: doc.url,
            icon: doc.icon,
            order: doc.order ?? 0,
            parent: doc.parent ? doc.parent.toString() : null,
            enabled: doc.enabled ?? true,
            allowedIdentityStates: doc.allowedIdentityStates,
            requiresGroups: doc.requiresGroups,
            requiresAdmin: doc.requiresAdmin,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
        };
    }

    /**
     * Normalize a namespace config database document to IMenuNamespaceConfig interface.
     *
     * Converts MongoDB document (with _id as ObjectId) to plain object with
     * _id as string for framework independence.
     *
     * @param doc - MongoDB document from native collection
     * @returns Normalized namespace config
     */
    private normalizeNamespaceConfig(doc: IMenuNamespaceConfigDocument): IMenuNamespaceConfig {
        return {
            _id: doc._id.toString(),
            namespace: doc.namespace,
            overflow: doc.overflow,
            icons: doc.icons,
            layout: doc.layout,
            styling: doc.styling,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
        };
    }

    /**
     * Broadcast namespace config update via WebSocket to all connected clients.
     *
     * Emits a WebSocket event with the namespace configuration. Clients can use
     * this to update their menu rendering behavior in real-time without page refresh.
     *
     * @param config - The updated namespace configuration
     */
    private async broadcastNamespaceConfigUpdate(config: IMenuNamespaceConfig): Promise<void> {
        try {
            const wsService = WebSocketService.getInstance();

            wsService.emit({
                event: 'menu:namespace-config:update',
                payload: {
                    namespace: config.namespace,
                    config,
                    timestamp: new Date()
                }
            });

            logger.debug({ namespace: config.namespace }, 'Menu namespace config update broadcast via WebSocket');
        } catch (error) {
            logger.error({ error }, 'Failed to broadcast namespace config update');
            // Don't throw - WebSocket failure shouldn't break config operations
        }
    }

    /**
     * Create the default 'Home' root node on first startup.
     *
     * Called by initialize() when the menu tree is empty. Creates a single root
     * node pointing to the home page as the default menu structure.
     */
    private async createDefaultHomeNode(): Promise<void> {
        const collection = this.database.getCollection<IMenuNodeDocument>('menu_nodes');
        const now = new Date();

        const homeDoc: Partial<IMenuNodeDocument> = {
            namespace: this.DEFAULT_NAMESPACE,
            label: 'Home',
            url: '/',
            icon: 'Home',
            order: 0,
            parent: null,
            enabled: true,
            createdAt: now,
            updatedAt: now
        };

        const result = await collection.insertOne(homeDoc as IMenuNodeDocument);
        const insertedDoc = await collection.findOne({ _id: result.insertedId });

        if (!insertedDoc) {
            throw new Error('Failed to create default Home node');
        }

        const normalized = this.normalizeNode(insertedDoc);
        const namespace = normalized.namespace || this.DEFAULT_NAMESPACE;

        if (!this.menuTree.has(namespace)) {
            this.menuTree.set(namespace, new Map());
        }
        this.menuTree.get(namespace)!.set(normalized._id!, normalized);

        logger.info({ nodeId: normalized._id, namespace }, 'Default Home menu node created');
    }
}
