/**
 * @fileoverview Forum service interface for cross-component service discovery.
 *
 * Exposes forum post CRUD and reaction operations via the service registry
 * so plugins and modules can create, query, and manage forum posts
 * programmatically. Intended for registration as 'forum' on the
 * IServiceRegistry by the forum plugin during its init() hook.
 */

/**
 * Embedded reaction on a forum post.
 */
export interface IForumReaction {
    walletAddress: string;
    emoji: string;
    createdAt: Date;
}

/**
 * A single forum post as returned by the service.
 */
export interface IForumPost {
    _id?: string;
    content: string;
    walletAddress: string;
    userId: string;
    signature: string;
    posX: number;
    posY: number;
    initialWidth: number;
    initialHeight: number;
    reactions: IForumReaction[];
    deleted?: boolean;
    createdAt: Date;
}

/**
 * Service interface for forum post operations.
 *
 * Provides full CRUD for forum posts and reaction management.
 * Consumers retrieve this via the service registry:
 *
 * ```typescript
 * const forum = context.services.get<IForumService>('forum');
 * if (forum) {
 *     const post = await forum.createPost(content, walletAddress, userId, message, signature, timestamp);
 * }
 * ```
 */
export interface IForumService {
    /**
     * Retrieve active posts from the last 7 days, newest first.
     *
     * @param limit - Maximum posts to return (capped at 200)
     * @returns Array of active forum posts
     */
    getActivePosts(limit: number): Promise<IForumPost[]>;

    /**
     * Retrieve a single post by its database ID.
     *
     * @param id - MongoDB ObjectId string
     * @returns The post or null if not found/deleted
     */
    getPostById(id: string): Promise<IForumPost | null>;

    /**
     * Retrieve all posts by a specific wallet address (no time filter).
     *
     * @param walletAddress - TRON wallet address (base58)
     * @param limit - Maximum posts to return (capped at 50)
     * @param offset - Number of posts to skip for pagination
     * @returns Array of posts by the wallet
     */
    getPostsByWallet(walletAddress: string, limit: number, offset: number): Promise<IForumPost[]>;

    /**
     * Create a new forum post with random canvas positioning.
     *
     * Content is sanitized and signature is cryptographically verified
     * against the wallet address before the post is persisted. Every
     * stored post carries a proven signature — this invariant holds
     * regardless of entry point (HTTP route or service registry).
     *
     * @param content - Post text (1-500 chars)
     * @param walletAddress - Author's verified TRON address
     * @param userId - Author's UUID
     * @param message - The exact message string that was signed
     * @param signature - TronLink hex-encoded signature
     * @param timestamp - Epoch ms when the message was signed (must be within 5 minutes)
     * @returns The created post
     * @throws If signature verification fails or timestamp is expired
     */
    createPost(content: string, walletAddress: string, userId: string, message: string, signature: string, timestamp: number): Promise<IForumPost>;

    /**
     * Soft-delete a post. Ownership matched by userId.
     *
     * @param postId - MongoDB ObjectId string
     * @param userId - UUID of the requesting user
     * @returns True if the post was soft-deleted
     */
    deletePost(postId: string, userId: string): Promise<boolean>;

    /**
     * Add or change a reaction on a post (one per wallet).
     *
     * @param postId - MongoDB ObjectId string
     * @param walletAddress - Reacting user's verified wallet
     * @param emoji - One of the allowed reaction emojis
     * @returns Updated reactions array
     */
    addReaction(postId: string, walletAddress: string, emoji: string): Promise<IForumReaction[]>;

    /**
     * Remove a wallet's reaction from a post.
     *
     * @param postId - MongoDB ObjectId string
     * @param walletAddress - Reacting user's verified wallet
     * @returns Updated reactions array
     */
    removeReaction(postId: string, walletAddress: string): Promise<IForumReaction[]>;
}
