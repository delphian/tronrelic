import { v4 as uuidv4 } from 'uuid';
import type { Collection } from 'mongodb';
import type { IDatabaseService, ICacheService, ISystemLogService } from '@tronrelic/types';
import type {
    IUserDocument,
    IWalletLink,
    IUser,
    ICreateUserInput,
    ILinkWalletInput,
    IUserPreferences
} from '../database/index.js';
import { SignatureService } from '../../auth/signature.service.js';

/**
 * User statistics for admin dashboard.
 */
export interface IUserStats {
    totalUsers: number;
    usersWithWallets: number;
    totalWalletLinks: number;
    activeToday: number;
    activeThisWeek: number;
    averageWalletsPerUser: number;
}

/**
 * Service for managing visitor identity and wallet linking.
 *
 * This singleton service handles user lifecycle including creation, wallet linking,
 * preference updates, and activity tracking. User data is cached in Redis for
 * performance with automatic invalidation on updates.
 *
 * ## Design Decisions
 *
 * - **Anonymous-first identity**: Users start with client-generated UUIDs, no registration required
 * - **Multi-wallet support**: One UUID can link to multiple TRON addresses
 * - **Server-side validation**: UUIDs are validated on server to prevent tampering
 * - **Cache strategy**: Individual user cache with 1-hour TTL, invalidated on updates
 *
 * ## Future Extensibility
 *
 * If plugins need access to user data, create `IUserService` in `@tronrelic/types`
 * and expose via `IPluginContext`. The `IUserDocument` stays internal.
 */
export class UserService {
    private static instance: UserService;
    private readonly collection: Collection<IUserDocument>;
    private readonly signatureService: SignatureService;
    private readonly CACHE_KEY_PREFIX = 'user:';
    private readonly CACHE_KEY_WALLET_PREFIX = 'user:wallet:';
    private readonly CACHE_TTL = 3600; // 1 hour

    /**
     * Create a user service.
     *
     * Private constructor enforces singleton pattern. Use setDependencies()
     * and getInstance() for access.
     *
     * @param database - Database service for MongoDB operations
     * @param cacheService - Redis cache for user data
     * @param logger - System log service for operations tracking
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly cacheService: ICacheService,
        private readonly logger: ISystemLogService
    ) {
        this.collection = database.getCollection<IUserDocument>('users');
        this.signatureService = new SignatureService();
    }

    /**
     * Initialize the singleton instance with dependencies.
     *
     * Must be called before getInstance(). Typically invoked during
     * application bootstrap in the user module's init() phase.
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
        if (!UserService.instance) {
            UserService.instance = new UserService(database, cacheService, logger);
        }
    }

    /**
     * Get the singleton user service instance.
     *
     * @throws Error if setDependencies() has not been called first
     * @returns Singleton user service instance
     */
    public static getInstance(): UserService {
        if (!UserService.instance) {
            throw new Error('UserService.setDependencies() must be called before getInstance()');
        }
        return UserService.instance;
    }

    /**
     * Reset singleton instance (for testing only).
     */
    public static resetInstance(): void {
        UserService.instance = undefined as any;
    }

    // ==================== Core CRUD Operations ====================

    /**
     * Get or create a user by UUID.
     *
     * If user exists, returns existing document. If not, creates new user
     * with default activity tracking initialized.
     *
     * @param id - UUID v4 identifier
     * @returns User document (existing or newly created)
     * @throws Error if UUID format is invalid
     */
    async getOrCreate(id: string): Promise<IUser> {
        if (!this.isValidUUID(id)) {
            throw new Error('Invalid UUID format. Must be a valid UUID v4.');
        }

        // Try cache first
        const cached = await this.getCachedUser(id);
        if (cached) {
            return cached;
        }

        // Try database
        const existing = await this.collection.findOne({ id });
        if (existing) {
            const user = this.toPublicUser(existing);
            await this.cacheUser(user);
            return user;
        }

        // Create new user
        const now = new Date();
        const newUser: Omit<IUserDocument, '_id'> = {
            id,
            wallets: [],
            preferences: {},
            activity: {
                firstSeen: now,
                lastSeen: now,
                pageViews: 1,
                sessionsCount: 1
            },
            createdAt: now,
            updatedAt: now
        };

        await this.collection.insertOne(newUser as any);
        this.logger.info({ userId: id }, 'User created');

        const user = this.toPublicUser(newUser as IUserDocument);
        await this.cacheUser(user);
        return user;
    }

    /**
     * Get a user by UUID.
     *
     * @param id - UUID v4 identifier
     * @returns User document or null if not found
     */
    async getById(id: string): Promise<IUser | null> {
        if (!this.isValidUUID(id)) {
            return null;
        }

        // Try cache first
        const cached = await this.getCachedUser(id);
        if (cached) {
            return cached;
        }

        // Fetch from database
        const doc = await this.collection.findOne({ id });
        if (!doc) {
            return null;
        }

        const user = this.toPublicUser(doc);
        await this.cacheUser(user);
        return user;
    }

    /**
     * Get a user by linked wallet address.
     *
     * Useful for reverse lookups when you know the wallet but not the UUID.
     *
     * @param address - Base58 TRON address
     * @returns User document or null if no user has this wallet linked
     */
    async getByWallet(address: string): Promise<IUser | null> {
        // Normalize address
        let normalizedAddress: string;
        try {
            normalizedAddress = this.signatureService.normalizeAddress(address);
        } catch {
            return null;
        }

        // Try cache
        const cacheKey = `${this.CACHE_KEY_WALLET_PREFIX}${normalizedAddress}`;
        const cachedUserId = await this.cacheService.get<string>(cacheKey);
        if (cachedUserId) {
            return this.getById(cachedUserId);
        }

        // Query database
        const doc = await this.collection.findOne({ 'wallets.address': normalizedAddress });
        if (!doc) {
            return null;
        }

        // Cache the wallet-to-user mapping
        await this.cacheService.set(cacheKey, doc.id, this.CACHE_TTL);

        const user = this.toPublicUser(doc);
        await this.cacheUser(user);
        return user;
    }

    // ==================== Wallet Linking ====================

    /**
     * Connect a wallet to a user identity (without verification).
     *
     * Stores the wallet address as unverified. If wallet already exists,
     * updates lastUsed timestamp. Automatically recalculates isPrimary.
     *
     * This is the first step in the two-step wallet flow:
     * 1. Connect: Store address with verified=false (this method)
     * 2. Verify: Update to verified=true via linkWallet()
     *
     * @param userId - UUID of user to connect wallet to
     * @param address - Base58 TRON address
     * @returns Updated user document
     * @throws Error if user not found or address invalid
     */
    async connectWallet(userId: string, address: string): Promise<IUser> {
        // Validate user exists
        const doc = await this.collection.findOne({ id: userId });
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }

        // Normalize address
        let normalizedAddress: string;
        try {
            normalizedAddress = this.signatureService.normalizeAddress(address);
        } catch {
            throw new Error('Invalid TRON address format.');
        }

        // Check if wallet already linked to another user
        const existingLink = await this.collection.findOne({
            'wallets.address': normalizedAddress,
            id: { $ne: userId }
        });
        if (existingLink) {
            throw new Error('Wallet is already linked to another user identity.');
        }

        const now = new Date();
        const existingWalletIndex = doc.wallets.findIndex(w => w.address === normalizedAddress);

        if (existingWalletIndex >= 0) {
            // Wallet already exists - update lastUsed
            doc.wallets[existingWalletIndex].lastUsed = now;
        } else {
            // Add new unverified wallet
            const walletLink: IWalletLink = {
                address: normalizedAddress,
                linkedAt: now,
                isPrimary: false,
                verified: false,
                lastUsed: now
            };
            doc.wallets.push(walletLink);
        }

        // Recalculate primary wallet
        this.recalculatePrimaryWallet(doc.wallets);

        // Update database
        await this.collection.updateOne(
            { id: userId },
            {
                $set: {
                    wallets: doc.wallets,
                    updatedAt: now
                }
            }
        );

        this.logger.info({ userId, wallet: normalizedAddress, verified: false }, 'Wallet connected to user');

        // Invalidate cache
        await this.invalidateUserCache(userId);
        await this.cacheService.set(
            `${this.CACHE_KEY_WALLET_PREFIX}${normalizedAddress}`,
            userId,
            this.CACHE_TTL
        );

        // Fetch and return updated document
        const updated = await this.collection.findOne({ id: userId });
        return this.toPublicUser(updated!);
    }

    /**
     * Link a wallet to a user identity.
     *
     * Verifies wallet ownership via TronLink signature before linking.
     * Prevents duplicate wallet links (same wallet can only be linked to one user).
     *
     * @param userId - UUID of user to link wallet to
     * @param input - Wallet address, signature message, and signature
     * @returns Updated user document
     * @throws Error if signature invalid, user not found, or wallet already linked
     */
    async linkWallet(userId: string, input: ILinkWalletInput): Promise<IUser> {
        // Validate user exists
        const doc = await this.collection.findOne({ id: userId });
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }

        // Verify signature proves wallet ownership
        const normalizedAddress = await this.signatureService.verifyMessage(
            input.address,
            input.message,
            input.signature
        );

        // Check message format (replay protection)
        if (!input.message.includes(normalizedAddress) || !input.message.includes(userId)) {
            throw new Error('Invalid message format. Message must include wallet address and user ID.');
        }

        // Check timestamp (prevent replay attacks - 5 minute window)
        const now = Date.now();
        if (Math.abs(now - input.timestamp) > 5 * 60 * 1000) {
            throw new Error('Signature timestamp expired. Please sign a new message.');
        }

        // Check if wallet already linked to another user
        const existingLink = await this.collection.findOne({
            'wallets.address': normalizedAddress,
            id: { $ne: userId }
        });
        if (existingLink) {
            throw new Error('Wallet is already linked to another user identity.');
        }

        const nowDate = new Date();
        const existingWalletIndex = doc.wallets.findIndex(w => w.address === normalizedAddress);

        if (existingWalletIndex >= 0) {
            // Wallet already connected - verify it and update lastUsed
            doc.wallets[existingWalletIndex].verified = true;
            doc.wallets[existingWalletIndex].lastUsed = nowDate;
        } else {
            // Add new verified wallet
            const walletLink: IWalletLink = {
                address: normalizedAddress,
                linkedAt: nowDate,
                isPrimary: false,
                verified: true,
                lastUsed: nowDate
            };
            doc.wallets.push(walletLink);
        }

        // Recalculate primary wallet
        this.recalculatePrimaryWallet(doc.wallets);

        // Update database
        await this.collection.updateOne(
            { id: userId },
            {
                $set: {
                    wallets: doc.wallets,
                    updatedAt: nowDate
                }
            }
        );

        this.logger.info({ userId, wallet: normalizedAddress, verified: true }, 'Wallet verified and linked to user');

        // Invalidate cache
        await this.invalidateUserCache(userId);
        await this.cacheService.set(
            `${this.CACHE_KEY_WALLET_PREFIX}${normalizedAddress}`,
            userId,
            this.CACHE_TTL
        );

        // Fetch and return updated document
        const updated = await this.collection.findOne({ id: userId });
        return this.toPublicUser(updated!);
    }

    /**
     * Unlink a wallet from a user identity.
     *
     * Requires wallet signature to prevent unauthorized unlinking.
     *
     * @param userId - UUID of user
     * @param address - Wallet address to unlink
     * @param message - Signature message
     * @param signature - TronLink signature
     * @returns Updated user document
     * @throws Error if signature invalid, user not found, or wallet not linked
     */
    async unlinkWallet(
        userId: string,
        address: string,
        message: string,
        signature: string
    ): Promise<IUser> {
        // Validate user exists
        const doc = await this.collection.findOne({ id: userId });
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }

        // Verify signature
        const normalizedAddress = await this.signatureService.verifyMessage(
            address,
            message,
            signature
        );

        // Check wallet is linked to this user
        const walletIndex = doc.wallets.findIndex(w => w.address === normalizedAddress);
        if (walletIndex === -1) {
            throw new Error('Wallet is not linked to this user.');
        }

        // Remove wallet
        doc.wallets.splice(walletIndex, 1);

        // Recalculate primary wallet
        this.recalculatePrimaryWallet(doc.wallets);

        // Update database
        await this.collection.updateOne(
            { id: userId },
            {
                $set: {
                    wallets: doc.wallets,
                    updatedAt: new Date()
                }
            }
        );

        this.logger.info({ userId, wallet: normalizedAddress }, 'Wallet unlinked from user');

        // Invalidate caches
        await this.invalidateUserCache(userId);
        await this.cacheService.invalidate(`${this.CACHE_KEY_WALLET_PREFIX}${normalizedAddress}`);

        // Fetch and return updated document
        const updated = await this.collection.findOne({ id: userId });
        return this.toPublicUser(updated!);
    }

    /**
     * Set primary wallet for a user.
     *
     * Requires wallet signature to verify ownership before changing primary.
     * Updates the wallet's lastUsed timestamp to make it the most recently used,
     * then recalculates isPrimary using the standard algorithm.
     *
     * Note: If setting an unverified wallet but verified wallets exist, the
     * most recent verified wallet will still be selected as primary.
     * Verified wallets always take precedence.
     *
     * @param userId - UUID of user
     * @param address - Wallet address to set as primary
     * @param message - Signature message
     * @param signature - TronLink signature
     * @returns Updated user document
     * @throws Error if signature invalid, user not found, or wallet not linked
     */
    async setPrimaryWallet(
        userId: string,
        address: string,
        message: string,
        signature: string
    ): Promise<IUser> {
        const doc = await this.collection.findOne({ id: userId });
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }

        // Verify signature proves wallet ownership
        const normalizedAddress = await this.signatureService.verifyMessage(
            address,
            message,
            signature
        );

        // Find wallet in user's list
        const walletIndex = doc.wallets.findIndex(w => w.address === normalizedAddress);
        if (walletIndex === -1) {
            throw new Error('Wallet is not linked to this user.');
        }

        // Update lastUsed to make this wallet the most recently used
        doc.wallets[walletIndex].lastUsed = new Date();

        // Recalculate primary wallet using standard algorithm
        this.recalculatePrimaryWallet(doc.wallets);

        // Update database
        await this.collection.updateOne(
            { id: userId },
            {
                $set: {
                    wallets: doc.wallets,
                    updatedAt: new Date()
                }
            }
        );

        this.logger.debug({ userId, primaryWallet: normalizedAddress }, 'Primary wallet updated');

        // Invalidate cache
        await this.invalidateUserCache(userId);

        // Fetch and return updated document
        const updated = await this.collection.findOne({ id: userId });
        return this.toPublicUser(updated!);
    }

    // ==================== Preferences ====================

    /**
     * Update user preferences.
     *
     * Merges provided preferences with existing ones (partial update).
     *
     * @param userId - UUID of user
     * @param preferences - Partial preferences to merge
     * @returns Updated user document
     * @throws Error if user not found
     */
    async updatePreferences(
        userId: string,
        preferences: Partial<IUserPreferences>
    ): Promise<IUser> {
        const doc = await this.collection.findOne({ id: userId });
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }

        // Merge preferences
        const mergedPreferences = {
            ...doc.preferences,
            ...preferences
        };

        // Update database
        await this.collection.updateOne(
            { id: userId },
            {
                $set: {
                    preferences: mergedPreferences,
                    updatedAt: new Date()
                }
            }
        );

        this.logger.debug(
            { userId, updatedKeys: Object.keys(preferences) },
            'User preferences updated'
        );

        // Invalidate cache
        await this.invalidateUserCache(userId);

        // Fetch and return updated document
        const updated = await this.collection.findOne({ id: userId });
        return this.toPublicUser(updated!);
    }

    // ==================== Activity Tracking ====================

    /**
     * Record user activity (page view).
     *
     * Updates lastSeen timestamp and increments pageViews counter.
     * Fire-and-forget operation - does not throw on failure.
     *
     * @param userId - UUID of user
     */
    async recordActivity(userId: string): Promise<void> {
        try {
            await this.collection.updateOne(
                { id: userId },
                {
                    $set: {
                        'activity.lastSeen': new Date(),
                        updatedAt: new Date()
                    },
                    $inc: {
                        'activity.pageViews': 1
                    }
                }
            );

            // Invalidate cache (user data changed)
            await this.invalidateUserCache(userId);
        } catch (error) {
            // Log but don't throw - activity tracking is non-critical
            this.logger.warn({ userId, error }, 'Failed to record user activity');
        }
    }

    /**
     * Record new session start.
     *
     * Increments session counter. Called when user returns after inactivity.
     *
     * @param userId - UUID of user
     */
    async recordSession(userId: string): Promise<void> {
        try {
            await this.collection.updateOne(
                { id: userId },
                {
                    $set: {
                        'activity.lastSeen': new Date(),
                        updatedAt: new Date()
                    },
                    $inc: {
                        'activity.sessionsCount': 1
                    }
                }
            );

            await this.invalidateUserCache(userId);
        } catch (error) {
            this.logger.warn({ userId, error }, 'Failed to record user session');
        }
    }

    // ==================== Admin Operations ====================

    /**
     * List all users with pagination.
     *
     * For admin dashboard. Returns users sorted by lastSeen descending.
     *
     * @param limit - Maximum users to return (default 50)
     * @param skip - Number of users to skip (for pagination)
     * @returns Array of user documents
     */
    async listUsers(limit = 50, skip = 0): Promise<IUser[]> {
        const docs = await this.collection
            .find({})
            .sort({ 'activity.lastSeen': -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        return docs.map(doc => this.toPublicUser(doc));
    }

    /**
     * Search users by UUID or wallet address.
     *
     * @param query - Partial UUID or wallet address
     * @param limit - Maximum results
     * @returns Matching users
     */
    async searchUsers(query: string, limit = 20): Promise<IUser[]> {
        const docs = await this.collection
            .find({
                $or: [
                    { id: { $regex: query, $options: 'i' } },
                    { 'wallets.address': { $regex: query, $options: 'i' } }
                ]
            })
            .limit(limit)
            .toArray();

        return docs.map(doc => this.toPublicUser(doc));
    }

    /**
     * Get user statistics for admin dashboard.
     *
     * @returns User statistics
     */
    async getStats(): Promise<IUserStats> {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);

        const [
            totalUsers,
            usersWithWallets,
            activeToday,
            activeThisWeek,
            walletStats
        ] = await Promise.all([
            this.collection.countDocuments({}),
            this.collection.countDocuments({ 'wallets.0': { $exists: true } }),
            this.collection.countDocuments({ 'activity.lastSeen': { $gte: todayStart } }),
            this.collection.countDocuments({ 'activity.lastSeen': { $gte: weekStart } }),
            this.collection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalWalletLinks: { $sum: { $size: '$wallets' } }
                    }
                }
            ]).toArray()
        ]);

        const totalWalletLinks = walletStats[0]?.totalWalletLinks ?? 0;
        const averageWalletsPerUser = totalUsers > 0
            ? totalWalletLinks / totalUsers
            : 0;

        return {
            totalUsers,
            usersWithWallets,
            totalWalletLinks,
            activeToday,
            activeThisWeek,
            averageWalletsPerUser
        };
    }

    /**
     * Count total users.
     *
     * @returns Total user count
     */
    async countUsers(): Promise<number> {
        return this.collection.countDocuments({});
    }

    // ==================== Index Management ====================

    /**
     * Create database indexes for user collection.
     *
     * Called during module initialization to ensure optimal query performance.
     */
    async createIndexes(): Promise<void> {
        await this.collection.createIndex({ id: 1 }, { unique: true });
        await this.collection.createIndex({ 'wallets.address': 1 });
        await this.collection.createIndex({ 'activity.lastSeen': 1 });

        this.logger.info('User indexes created');
    }

    // ==================== Private Helpers ====================

    /**
     * Recalculate which wallet should be primary.
     *
     * Primary selection logic:
     * 1. Most recent lastUsed among verified wallets
     * 2. Fallback: Most recent lastUsed among unverified wallets (if no verified)
     *
     * Mutates the wallets array in place.
     *
     * @param wallets - Array of wallet links to update
     */
    private recalculatePrimaryWallet(wallets: IWalletLink[]): void {
        if (wallets.length === 0) {
            return;
        }

        // Reset all primary flags
        wallets.forEach(w => { w.isPrimary = false; });

        // Find verified wallets sorted by lastUsed descending
        const verifiedWallets = wallets
            .filter(w => w.verified)
            .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime());

        if (verifiedWallets.length > 0) {
            // Primary = most recent verified wallet
            verifiedWallets[0].isPrimary = true;
            return;
        }

        // Fallback: most recent unverified wallet
        const sortedByLastUsed = [...wallets]
            .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime());
        sortedByLastUsed[0].isPrimary = true;
    }

    /**
     * Validate UUID v4 format.
     */
    private isValidUUID(str: string): boolean {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuidRegex.test(str);
    }

    /**
     * Convert MongoDB document to public user representation.
     */
    private toPublicUser(doc: IUserDocument | Omit<IUserDocument, '_id'>): IUser {
        return {
            id: doc.id,
            wallets: doc.wallets,
            preferences: doc.preferences,
            activity: doc.activity,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
        };
    }

    /**
     * Get user from cache.
     */
    private async getCachedUser(id: string): Promise<IUser | null> {
        const cacheKey = `${this.CACHE_KEY_PREFIX}${id}`;
        return this.cacheService.get<IUser>(cacheKey);
    }

    /**
     * Cache user data.
     */
    private async cacheUser(user: IUser): Promise<void> {
        const cacheKey = `${this.CACHE_KEY_PREFIX}${user.id}`;
        await this.cacheService.set(cacheKey, user, this.CACHE_TTL, [`user:${user.id}`]);
    }

    /**
     * Invalidate user cache.
     */
    private async invalidateUserCache(userId: string): Promise<void> {
        await this.cacheService.invalidate(`user:${userId}`);
        this.logger.debug({ userId }, 'User cache invalidated');
    }
}
