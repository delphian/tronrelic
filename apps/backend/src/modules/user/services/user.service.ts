import { v4 as uuidv4 } from 'uuid';
import type { Collection } from 'mongodb';
import type { IDatabaseService, ICacheService, ISystemLogService, UserFilterType } from '@tronrelic/types';
import type {
    IUserDocument,
    IWalletLink,
    IUser,
    ICreateUserInput,
    ILinkWalletInput,
    IUserPreferences,
    IUserSession,
    IPageVisit,
    DeviceCategory
} from '../database/index.js';
import {
    getCountryFromIP,
    extractReferrerDomain,
    getDeviceCategory,
    getScreenSizeCategory
} from './geo.service.js';
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

    /** Maximum sessions to retain per user (oldest pruned first) */
    private readonly MAX_SESSIONS = 20;
    /** Maximum pages to track per session */
    private readonly MAX_PAGES_PER_SESSION = 100;
    /** Maximum unique paths to track in pageViewsByPath */
    private readonly MAX_TRACKED_PATHS = 50;
    /** Session timeout in ms (30 minutes of inactivity = new session) */
    private readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000;

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
            isLoggedIn: false,
            wallets: [],
            preferences: {},
            activity: {
                firstSeen: now,
                lastSeen: now,
                pageViews: 0,
                sessionsCount: 0,
                totalDurationSeconds: 0,
                sessions: [],
                pageViewsByPath: {},
                countryCounts: {}
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

    // ==================== Login State ====================

    /**
     * Log in a user (set isLoggedIn to true).
     *
     * This is a UI/feature gate - it controls what is surfaced to the user,
     * not their underlying identity. UUID tracking continues regardless.
     *
     * @param userId - UUID of user
     * @returns Updated user document
     * @throws Error if user not found
     */
    async login(userId: string): Promise<IUser> {
        const doc = await this.collection.findOne({ id: userId });
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }

        await this.collection.updateOne(
            { id: userId },
            {
                $set: {
                    isLoggedIn: true,
                    updatedAt: new Date()
                }
            }
        );

        this.logger.info({ userId }, 'User logged in');

        await this.invalidateUserCache(userId);

        const updated = await this.collection.findOne({ id: userId });
        return this.toPublicUser(updated!);
    }

    /**
     * Log out a user (set isLoggedIn to false).
     *
     * This is a UI/feature gate - wallets and all other data remain intact.
     * The user is still tracked by UUID under the hood.
     *
     * @param userId - UUID of user
     * @returns Updated user document
     * @throws Error if user not found
     */
    async logout(userId: string): Promise<IUser> {
        const doc = await this.collection.findOne({ id: userId });
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }

        await this.collection.updateOne(
            { id: userId },
            {
                $set: {
                    isLoggedIn: false,
                    updatedAt: new Date()
                }
            }
        );

        this.logger.info({ userId }, 'User logged out');

        await this.invalidateUserCache(userId);

        const updated = await this.collection.findOne({ id: userId });
        return this.toPublicUser(updated!);
    }

    // ==================== Session & Activity Tracking ====================

    /**
     * Start a new session for a user.
     *
     * Creates a new session entry with device, referrer, country, and screen size info.
     * If there's an active session within the timeout window, returns it instead.
     *
     * @param userId - UUID of user
     * @param clientIP - Client IP address (for country lookup, never stored)
     * @param userAgent - User-agent header (for device detection, never stored raw)
     * @param referrer - Referrer URL (domain extracted, full URL never stored)
     * @param screenWidth - Viewport width in pixels (client-provided)
     * @returns The active session
     */
    async startSession(
        userId: string,
        clientIP?: string,
        userAgent?: string,
        referrer?: string,
        screenWidth?: number
    ): Promise<IUserSession> {
        try {
            const doc = await this.collection.findOne({ id: userId });
            if (!doc) {
                throw new Error(`User with id "${userId}" not found`);
            }

            // Initialize activity fields if missing (migration support)
            const activity = this.ensureActivityFields(doc.activity);
            const now = new Date();

            // Check if there's an active session within timeout window
            const activeSession = activity.sessions[0];
            if (activeSession && !activeSession.endedAt) {
                const lastActivity = activeSession.pages.length > 0
                    ? new Date(activeSession.pages[activeSession.pages.length - 1].timestamp)
                    : new Date(activeSession.startedAt);

                if (now.getTime() - lastActivity.getTime() < this.SESSION_TIMEOUT_MS) {
                    // Session still active - return as-is (duration tracked by heartbeat)
                    return activeSession;
                }

                // Session timed out - close it
                activeSession.endedAt = lastActivity;
                activeSession.durationSeconds = Math.floor(
                    (lastActivity.getTime() - new Date(activeSession.startedAt).getTime()) / 1000
                );

                // Aggregate duration before pruning
                activity.totalDurationSeconds += activeSession.durationSeconds;
            }

            // Derive context from request (IP/UA never stored)
            const device = getDeviceCategory(userAgent);
            const referrerDomain = extractReferrerDomain(referrer);
            const country = getCountryFromIP(clientIP);
            const screenSize = getScreenSizeCategory(screenWidth);

            // Track country distribution
            if (country) {
                activity.countryCounts[country] = (activity.countryCounts[country] || 0) + 1;
            }

            // Create new session
            const newSession: IUserSession = {
                startedAt: now,
                endedAt: null,
                durationSeconds: 0,
                pages: [],
                device,
                screenWidth: screenWidth ?? null,
                screenSize,
                referrerDomain,
                country
            };

            // Add to front of sessions array
            activity.sessions.unshift(newSession);
            activity.sessionsCount++;
            activity.lastSeen = now;

            // Prune old sessions (keep last N)
            this.pruneOldSessions(activity);

            // Update database
            await this.collection.updateOne(
                { id: userId },
                {
                    $set: {
                        activity,
                        updatedAt: now
                    }
                }
            );

            await this.invalidateUserCache(userId);

            this.logger.debug(
                { userId, device, screenSize, country, referrerDomain },
                'Session started'
            );

            return newSession;
        } catch (error) {
            this.logger.warn({ userId, error }, 'Failed to start session');
            throw error;
        }
    }

    /**
     * Record a page visit in the current session.
     *
     * @param userId - UUID of user
     * @param path - Route path (e.g., '/accounts/TXyz...')
     */
    async recordPage(userId: string, path: string): Promise<void> {
        try {
            const doc = await this.collection.findOne({ id: userId });
            if (!doc) {
                return; // Silently ignore if user doesn't exist
            }

            const activity = this.ensureActivityFields(doc.activity);
            const now = new Date();

            // Get or create active session
            let activeSession = activity.sessions[0];
            if (!activeSession || activeSession.endedAt) {
                // No active session - create a minimal one
                activeSession = {
                    startedAt: now,
                    endedAt: null,
                    durationSeconds: 0,
                    pages: [],
                    device: 'unknown',
                    screenWidth: null,
                    screenSize: 'unknown',
                    referrerDomain: null,
                    country: null
                };
                activity.sessions.unshift(activeSession);
                activity.sessionsCount++;
            }

            // Check session timeout
            const lastActivity = activeSession.pages.length > 0
                ? new Date(activeSession.pages[activeSession.pages.length - 1].timestamp)
                : new Date(activeSession.startedAt);

            if (now.getTime() - lastActivity.getTime() >= this.SESSION_TIMEOUT_MS) {
                // Session timed out - close it and create new one
                activeSession.endedAt = lastActivity;
                activeSession.durationSeconds = Math.floor(
                    (lastActivity.getTime() - new Date(activeSession.startedAt).getTime()) / 1000
                );
                activity.totalDurationSeconds += activeSession.durationSeconds;

                activeSession = {
                    startedAt: now,
                    endedAt: null,
                    durationSeconds: 0,
                    pages: [],
                    device: 'unknown',
                    screenWidth: null,
                    screenSize: 'unknown',
                    referrerDomain: null,
                    country: null
                };
                activity.sessions.unshift(activeSession);
                activity.sessionsCount++;
            }

            // Add page visit (if under limit)
            if (activeSession.pages.length < this.MAX_PAGES_PER_SESSION) {
                const pageVisit: IPageVisit = {
                    path,
                    timestamp: now
                };
                activeSession.pages.push(pageVisit);
            }

            // Update session duration
            activeSession.durationSeconds = Math.floor(
                (now.getTime() - new Date(activeSession.startedAt).getTime()) / 1000
            );

            // Update aggregate counters
            activity.pageViews++;
            activity.lastSeen = now;

            // Update pageViewsByPath (with limit)
            if (Object.keys(activity.pageViewsByPath).length < this.MAX_TRACKED_PATHS || activity.pageViewsByPath[path]) {
                activity.pageViewsByPath[path] = (activity.pageViewsByPath[path] || 0) + 1;
            }

            // Prune old sessions
            this.pruneOldSessions(activity);

            // Update database
            await this.collection.updateOne(
                { id: userId },
                {
                    $set: {
                        activity,
                        updatedAt: now
                    }
                }
            );

            await this.invalidateUserCache(userId);
        } catch (error) {
            // Non-critical - log but don't throw
            this.logger.warn({ userId, path, error }, 'Failed to record page visit');
        }
    }

    /**
     * Update session heartbeat (extends session duration).
     *
     * Called periodically by frontend to keep session alive and track duration.
     *
     * @param userId - UUID of user
     */
    async heartbeat(userId: string): Promise<void> {
        try {
            const doc = await this.collection.findOne({ id: userId });
            if (!doc) {
                return;
            }

            const activity = this.ensureActivityFields(doc.activity);
            const now = new Date();

            const activeSession = activity.sessions[0];
            if (!activeSession || activeSession.endedAt) {
                return; // No active session to update
            }

            // Update duration
            activeSession.durationSeconds = Math.floor(
                (now.getTime() - new Date(activeSession.startedAt).getTime()) / 1000
            );
            activity.lastSeen = now;

            await this.collection.updateOne(
                { id: userId },
                {
                    $set: {
                        'activity.sessions.0.durationSeconds': activeSession.durationSeconds,
                        'activity.lastSeen': now,
                        updatedAt: now
                    }
                }
            );

            await this.invalidateUserCache(userId);
        } catch (error) {
            this.logger.warn({ userId, error }, 'Failed to update heartbeat');
        }
    }

    /**
     * End the current session explicitly.
     *
     * Called when user navigates away or closes the page.
     *
     * @param userId - UUID of user
     */
    async endSession(userId: string): Promise<void> {
        try {
            const doc = await this.collection.findOne({ id: userId });
            if (!doc) {
                return;
            }

            const activity = this.ensureActivityFields(doc.activity);
            const now = new Date();

            const activeSession = activity.sessions[0];
            if (!activeSession || activeSession.endedAt) {
                return; // No active session to end
            }

            // Close session
            activeSession.endedAt = now;
            activeSession.durationSeconds = Math.floor(
                (now.getTime() - new Date(activeSession.startedAt).getTime()) / 1000
            );

            // Use atomic update to avoid race conditions
            await this.collection.updateOne(
                { id: userId },
                {
                    $set: {
                        'activity.sessions.0': activeSession,
                        'activity.lastSeen': now,
                        updatedAt: now
                    },
                    $inc: {
                        'activity.totalDurationSeconds': activeSession.durationSeconds
                    }
                }
            );

            await this.invalidateUserCache(userId);

            this.logger.debug(
                { userId, durationSeconds: activeSession.durationSeconds },
                'Session ended'
            );
        } catch (error) {
            this.logger.warn({ userId, error }, 'Failed to end session');
        }
    }

    /**
     * Legacy method - record simple activity without session context.
     *
     * @deprecated Use recordPage() for page-aware tracking
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

            await this.invalidateUserCache(userId);
        } catch (error) {
            this.logger.warn({ userId, error }, 'Failed to record user activity');
        }
    }

    /**
     * Legacy method - record simple session start.
     *
     * @deprecated Use startSession() for full session tracking
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

    // ==================== Session Helpers ====================

    /**
     * Ensure activity object has all required fields (migration support).
     */
    private ensureActivityFields(activity: any): IUserDocument['activity'] {
        return {
            firstSeen: activity.firstSeen || new Date(),
            lastSeen: activity.lastSeen || new Date(),
            pageViews: activity.pageViews || 0,
            sessionsCount: activity.sessionsCount || 0,
            totalDurationSeconds: activity.totalDurationSeconds || 0,
            sessions: activity.sessions || [],
            pageViewsByPath: activity.pageViewsByPath || {},
            countryCounts: activity.countryCounts || {}
        };
    }

    /**
     * Prune old sessions to keep array bounded.
     *
     * Duration is already aggregated into totalDurationSeconds when sessions
     * end (via endSession or timeout), so we only need to truncate the array.
     */
    private pruneOldSessions(activity: IUserDocument['activity']): void {
        if (activity.sessions.length <= this.MAX_SESSIONS) {
            return;
        }

        // Keep only the most recent sessions
        activity.sessions = activity.sessions.slice(0, this.MAX_SESSIONS);
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
     * Filter users by predefined criteria.
     *
     * Applies a filter query, optionally combined with a text search.
     * Both filter and search work additively (AND logic).
     *
     * @param filter - Filter type to apply
     * @param limit - Maximum results (default 50)
     * @param skip - Pagination offset (default 0)
     * @param search - Optional text search for UUID or wallet address
     * @returns Filtered users and total count
     */
    async filterUsers(
        filter: UserFilterType,
        limit = 50,
        skip = 0,
        search?: string
    ): Promise<{ users: IUser[]; filteredTotal: number }> {
        const filterQuery = this.buildFilterQuery(filter);
        // Escape regex special characters to prevent ReDoS attacks
        const escapedSearch = search
            ? search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            : '';
        const searchQuery = escapedSearch
            ? {
                $or: [
                    { id: { $regex: escapedSearch, $options: 'i' } },
                    { 'wallets.address': { $regex: escapedSearch, $options: 'i' } }
                ]
            }
            : {};

        // Combine filter and search with AND logic
        const combinedQuery = Object.keys(filterQuery).length > 0 && Object.keys(searchQuery).length > 0
            ? { $and: [filterQuery, searchQuery] }
            : { ...filterQuery, ...searchQuery };

        const [docs, filteredTotal] = await Promise.all([
            this.collection
                .find(combinedQuery)
                .sort({ 'activity.lastSeen': -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            this.collection.countDocuments(combinedQuery)
        ]);

        return {
            users: docs.map(doc => this.toPublicUser(doc)),
            filteredTotal
        };
    }

    /**
     * Build MongoDB query for a filter type.
     *
     * @param filter - Filter type
     * @returns MongoDB query object
     */
    private buildFilterQuery(filter: UserFilterType): object {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(todayStart);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const thirtyDaysAgo = new Date(todayStart);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        switch (filter) {
            // ==================== Real-time ====================
            case 'live-now':
                // Users with an active session (endedAt is null)
                return {
                    'activity.sessions': {
                        $elemMatch: {
                            endedAt: null
                        }
                    }
                };

            // ==================== Engagement ====================
            case 'power-users':
                return {
                    'activity.pageViews': { $gt: 100 },
                    'activity.sessionsCount': { $gt: 10 }
                };

            case 'one-time':
                return {
                    'activity.sessionsCount': 1
                };

            case 'returning':
                return {
                    'activity.sessionsCount': { $gt: 1, $lte: 10 }
                };

            case 'long-sessions':
                return {
                    'activity.totalDurationSeconds': { $gt: 1800 } // 30 minutes
                };

            // ==================== Wallet Status ====================
            case 'verified-wallet':
                return {
                    'wallets.verified': true
                };

            case 'multi-wallet':
                return {
                    'wallets.1': { $exists: true } // At least 2 wallets
                };

            case 'no-wallet':
                // Note: This query is also used in 'conversion-candidates'.
                // If wallet-related filters grow, extract to a shared constant.
                return {
                    $or: [
                        { wallets: { $size: 0 } },
                        { wallets: { $exists: false } }
                    ]
                };

            case 'recently-connected':
                return {
                    'wallets.linkedAt': { $gte: weekAgo }
                };

            // ==================== Temporal ====================
            case 'active-today':
                return {
                    'activity.lastSeen': { $gte: todayStart }
                };

            case 'active-week':
                return {
                    'activity.lastSeen': { $gte: weekAgo }
                };

            case 'churned':
                return {
                    'activity.lastSeen': { $lt: thirtyDaysAgo },
                    'activity.sessionsCount': { $gt: 1 }
                };

            case 'new-users':
                return {
                    createdAt: { $gte: weekAgo }
                };

            // ==================== Device ====================
            // Note: Device/geographic/behavioral filters use $expr with array operations.
            // If admin page performance degrades at scale, consider pre-computing metrics
            // (e.g., deviceCounts, uniqueCountries, uniquePaths) on the user document.
            case 'mobile-users':
                // Users where majority of sessions are on mobile
                return {
                    $expr: {
                        $gt: [
                            {
                                $size: {
                                    $filter: {
                                        input: { $ifNull: ['$activity.sessions', []] },
                                        cond: { $eq: ['$$this.device', 'mobile'] }
                                    }
                                }
                            },
                            {
                                $divide: [
                                    { $size: { $ifNull: ['$activity.sessions', []] } },
                                    2
                                ]
                            }
                        ]
                    }
                };

            case 'desktop-users':
                // Users where majority of sessions are on desktop
                return {
                    $expr: {
                        $gt: [
                            {
                                $size: {
                                    $filter: {
                                        input: { $ifNull: ['$activity.sessions', []] },
                                        cond: { $eq: ['$$this.device', 'desktop'] }
                                    }
                                }
                            },
                            {
                                $divide: [
                                    { $size: { $ifNull: ['$activity.sessions', []] } },
                                    2
                                ]
                            }
                        ]
                    }
                };

            case 'multi-device':
                // Users with 2+ distinct device types in sessions
                return {
                    $expr: {
                        $gte: [
                            {
                                $size: {
                                    $setUnion: [
                                        {
                                            $map: {
                                                input: { $ifNull: ['$activity.sessions', []] },
                                                as: 's',
                                                in: '$$s.device'
                                            }
                                        },
                                        []
                                    ]
                                }
                            },
                            2
                        ]
                    }
                };

            // ==================== Screen Size ====================
            // Based on viewport width breakpoints from TronRelic design system
            case 'screen-mobile-sm':
                // < 360px (legacy devices)
                return {
                    'activity.sessions': {
                        $elemMatch: {
                            screenSize: 'mobile-sm'
                        }
                    }
                };

            case 'screen-mobile-md':
                // 360-479px (primary mobile)
                return {
                    'activity.sessions': {
                        $elemMatch: {
                            screenSize: 'mobile-md'
                        }
                    }
                };

            case 'screen-mobile-lg':
                // 480-767px (large phones)
                return {
                    'activity.sessions': {
                        $elemMatch: {
                            screenSize: 'mobile-lg'
                        }
                    }
                };

            case 'screen-tablet':
                // 768-1023px (tablets)
                return {
                    'activity.sessions': {
                        $elemMatch: {
                            screenSize: 'tablet'
                        }
                    }
                };

            case 'screen-desktop':
                // 1024-1199px (standard desktop)
                return {
                    'activity.sessions': {
                        $elemMatch: {
                            screenSize: 'desktop'
                        }
                    }
                };

            case 'screen-desktop-lg':
                // >= 1200px (large desktop)
                return {
                    'activity.sessions': {
                        $elemMatch: {
                            screenSize: 'desktop-lg'
                        }
                    }
                };

            // ==================== Geographic ====================
            case 'multi-region':
                // Users with 3+ countries in countryCounts
                return {
                    $expr: {
                        $gte: [
                            { $size: { $objectToArray: { $ifNull: ['$activity.countryCounts', {}] } } },
                            3
                        ]
                    }
                };

            case 'single-region':
                return {
                    $expr: {
                        $eq: [
                            { $size: { $objectToArray: { $ifNull: ['$activity.countryCounts', {}] } } },
                            1
                        ]
                    }
                };

            // ==================== Behavioral ====================
            case 'feature-explorers':
                // Users with 20+ unique paths
                return {
                    $expr: {
                        $gte: [
                            { $size: { $objectToArray: { $ifNull: ['$activity.pageViewsByPath', {}] } } },
                            20
                        ]
                    }
                };

            case 'focused-users':
                // Users with less than 5 unique paths
                return {
                    $expr: {
                        $and: [
                            { $gt: [{ $size: { $objectToArray: { $ifNull: ['$activity.pageViewsByPath', {}] } } }, 0] },
                            { $lt: [{ $size: { $objectToArray: { $ifNull: ['$activity.pageViewsByPath', {}] } } }, 5] }
                        ]
                    }
                };

            case 'referred-traffic':
                // Any session has a referrerDomain (exists and not null)
                return {
                    'activity.sessions': {
                        $elemMatch: {
                            referrerDomain: { $exists: true, $ne: null }
                        }
                    }
                };

            // ==================== Quick Picks (Compound) ====================
            case 'high-value':
                // Verified wallet + active this week + pageViews > 50
                return {
                    'wallets.verified': true,
                    'activity.lastSeen': { $gte: weekAgo },
                    'activity.pageViews': { $gt: 50 }
                };

            case 'at-risk':
                // Churned + has wallet
                return {
                    'activity.lastSeen': { $lt: thirtyDaysAgo },
                    'wallets.0': { $exists: true }
                };

            case 'conversion-candidates':
                // High engagement but no wallet
                return {
                    'activity.pageViews': { $gt: 50 },
                    $or: [
                        { wallets: { $size: 0 } },
                        { wallets: { $exists: false } }
                    ]
                };

            case 'all':
            default:
                return {};
        }
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
        await this.collection.createIndex({ 'activity.sessions.endedAt': 1 });

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
            isLoggedIn: doc.isLoggedIn ?? false,
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
