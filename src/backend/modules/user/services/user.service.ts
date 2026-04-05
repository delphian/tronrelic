import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import type { Collection } from 'mongodb';
import type {
    IDatabaseService,
    ICacheService,
    ISystemLogService,
    UserFilterType,
    IUserActivitySummary,
    IUserWalletSummary,
    IUserRetentionSummary,
    IUserPreferencesSummary,
    IPageTrafficHistory,
    IPageTrafficBucket,
    IRecentPageViewsResult,
    ITrafficSourcesHistory,
    IDailyTrafficSourceBucket,
    IGeoDistributionHistory,
    IDailyGeoBucket,
    IDeviceBreakdownHistory,
    IDailyDeviceBucket,
    ILandingPagesHistory,
    IDailyLandingPageBucket,
    ICampaignPerformanceHistory,
    IDailyCampaignBucket,
    ISessionDurationHistory,
    IDailySessionDurationBucket,
    IPagesPerSessionHistory,
    IDailyPagesPerSessionBucket,
    INewVsReturningHistory,
    IDailyNewVsReturningBucket,
    IWalletConversionHistory,
    IDailyWalletConversionBucket,
    IExitPagesHistory,
    IDailyExitPageBucket,
    BucketInterval
} from '@/types';
import type {
    IUserDocument,
    IWalletLink,
    IUser,
    ICreateUserInput,
    ILinkWalletInput,
    IUserPreferences,
    IUserSession,
    IPageVisit,
    IUtmParams,
    IReferral,
    DeviceCategory
} from '../database/index.js';
import {
    getCountryFromIP,
    extractReferrerDomain,
    extractSearchKeyword,
    getDeviceCategory,
    getScreenSizeCategory
} from './geo.service.js';
import type TronWeb from 'tronweb';
import { SignatureService } from '../../auth/signature.service.js';
import { GscService } from './gsc.service.js';

/**
 * Date range for analytics queries.
 *
 * Preset periods (24h, 7d, etc.) produce a range with only `since` set,
 * meaning "from since to now". Custom ranges set both `since` and `until`
 * to bound the query window at both ends.
 */
export interface IDateRange {
    /** Start of the query window (inclusive). */
    since: Date;
    /** End of the query window (inclusive). When omitted, queries run to now. */
    until?: Date;
}

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
 * Result of wallet connection attempt.
 *
 * When a wallet is already linked to another user, returns `loginRequired: true`
 * with the existing user ID. The frontend should prompt for signature verification
 * to prove wallet ownership before swapping identity.
 */
export interface IConnectWalletResult {
    /** Whether connection succeeded (wallet now linked to this user) */
    success: boolean;
    /** Updated user data (when success=true) */
    user?: IUser;
    /** Whether wallet is linked to another user and login is required */
    loginRequired?: boolean;
    /** The existing user ID that owns this wallet (when loginRequired=true) */
    existingUserId?: string;
}

/**
 * Result of wallet link/verification attempt.
 *
 * When identity swap occurs (wallet belonged to another user), returns
 * `identitySwapped: true` with the existing user's data.
 */
export interface ILinkWalletResult {
    /** The user data (either updated current user or swapped-to user) */
    user: IUser;
    /** Whether identity was swapped to existing wallet owner */
    identitySwapped?: boolean;
    /** The previous user ID before swap (for cleanup on frontend) */
    previousUserId?: string;
}

/**
 * Public profile data for a verified wallet address.
 */
export interface IPublicProfile {
    /** UUID of the user who owns this profile */
    userId: string;
    /** Verified wallet address for this profile */
    address: string;
    /** When the user account was created */
    createdAt: Date;
    /** Always true (only verified profiles are returned) */
    isVerified: true;
}

/**
 * Visitor origin summary for admin analytics.
 *
 * Represents traffic acquisition data from a visitor's first-ever session,
 * combined with lifetime engagement metrics.
 */
export interface IVisitorOrigin {
    userId: string;
    firstSeen: Date;
    lastSeen: Date;
    country: string | null;
    referrerDomain: string | null;
    landingPage: string | null;
    device: string;
    utm: IUtmParams | null;
    searchKeyword: string | null;
    sessionsCount: number;
    pageViews: number;
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
 * - **Wallet-based login**: Users can recover identity by proving wallet ownership from new devices
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
    private gscService: GscService | null = null;
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
        private readonly logger: ISystemLogService,
        tronWeb: TronWeb
    ) {
        this.collection = database.getCollection<IUserDocument>('users');
        this.signatureService = new SignatureService(tronWeb);
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
     * @param tronWeb - Configured TronWeb instance from the service registry
     */
    public static setDependencies(
        database: IDatabaseService,
        cacheService: ICacheService,
        logger: ISystemLogService,
        tronWeb: TronWeb
    ): void {
        if (!UserService.instance) {
            UserService.instance = new UserService(database, cacheService, logger, tronWeb);
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

    /**
     * Inject the GscService for keyword enrichment in traffic source details.
     *
     * Called from UserModule.init() after GscService is initialized. This
     * avoids a hidden singleton lookup and makes the dependency explicit
     * for testing.
     *
     * @param gscService - Initialized GscService singleton
     */
    public setGscService(gscService: GscService): void {
        this.gscService = gscService;
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
            // Follow merge pointer (single hop — chains are flattened during merge)
            if (existing.mergedInto) {
                const target = await this.collection.findOne({ id: existing.mergedInto });
                if (target) {
                    const user = this.toPublicUser(target);
                    await this.cacheUser(user);
                    return user;
                }
                // Broken pointer — target was deleted. Log and treat as non-existent
                // rather than returning the tombstone as a valid user.
                this.logger.error(
                    { userId: id, mergedInto: existing.mergedInto },
                    'Broken merge pointer: target user does not exist'
                );
                return this.toPublicUser(existing);
            }
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
                countryCounts: {},
                origin: null
            },
            referral: null,
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
     * Follows merge pointers when a UUID has been merged into another user
     * via wallet-based identity reconciliation. Pointer chains are flattened
     * during merge, so resolution is always a single hop.
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

        // Follow merge pointer (single hop — chains are flattened during merge)
        if (doc.mergedInto) {
            const target = await this.collection.findOne({ id: doc.mergedInto });
            if (!target) {
                return null;
            }
            const user = this.toPublicUser(target);
            await this.cacheUser(user);
            return user;
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

    /**
     * Get public profile by verified wallet address.
     *
     * Returns profile data only if the wallet is verified. Unverified wallets
     * or non-existent addresses return null.
     *
     * @param address - Base58 TRON address
     * @returns Public profile or null if not found/not verified
     */
    async getPublicProfile(address: string): Promise<IPublicProfile | null> {
        // Normalize address using signature service (handles TRON address format)
        let normalizedAddress: string;
        try {
            normalizedAddress = this.signatureService.normalizeAddress(address);
        } catch {
            return null;
        }

        // Look up user by wallet
        const user = await this.getByWallet(normalizedAddress);
        if (!user) {
            return null;
        }

        // Find the specific wallet and check if verified
        // Use normalized address for comparison (addresses are stored normalized)
        const wallet = user.wallets.find(w => w.address === normalizedAddress);
        if (!wallet || !wallet.verified) {
            return null;
        }

        return {
            userId: user.id,
            address: wallet.address,
            createdAt: user.createdAt,
            isVerified: true
        };
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
     * When wallet is already linked to another user, returns `loginRequired: true`
     * instead of throwing an error. Frontend should prompt for signature to login.
     *
     * @param userId - UUID of user to connect wallet to
     * @param address - Base58 TRON address
     * @returns Connection result with success status or login requirement
     * @throws Error if user not found or address invalid
     */
    async connectWallet(userId: string, address: string): Promise<IConnectWalletResult> {
        // Resolve to canonical document (single DB hit, follows merge pointer if needed)
        const doc = await this.resolveDocument(userId);
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }
        userId = doc.id;

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
            // Wallet belongs to another user - require login via signature
            this.logger.info(
                { userId, wallet: normalizedAddress, existingUserId: existingLink.id },
                'Wallet already linked to another user, login required'
            );
            return {
                success: false,
                loginRequired: true,
                existingUserId: existingLink.id
            };
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
        return {
            success: true,
            user: this.toPublicUser(updated!)
        };
    }

    /**
     * Link a wallet to a user identity.
     *
     * Verifies wallet ownership via TronLink signature before linking.
     * If wallet belongs to another user, performs identity swap (returns
     * existing user's data instead of current user).
     *
     * @param userId - UUID of user attempting to link wallet
     * @param input - Wallet address, signature message, and signature
     * @returns Link result with user data and optional identity swap indicator
     * @throws Error if signature invalid or user not found
     */
    async linkWallet(userId: string, input: ILinkWalletInput): Promise<ILinkWalletResult> {
        // Resolve to canonical UUID if this identity was merged
        // Resolve to canonical document (single DB hit, follows merge pointer if needed)
        const doc = await this.resolveDocument(userId);
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }
        userId = doc.id;

        // Verify signature proves wallet ownership
        const normalizedAddress = await this.signatureService.verifyMessage(
            input.address,
            input.message,
            input.signature
        );

        // Check message format - must include wallet address
        // Note: For identity swap (login), message may contain different userId
        if (!input.message.includes(normalizedAddress)) {
            throw new Error('Invalid message format. Message must include wallet address.');
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
            // Wallet belongs to another user — perform identity reconciliation.
            // The signer has proven wallet ownership, so merge the current UUID
            // (loser) into the existing wallet owner (winner).
            const winnerId = existingLink.id;
            const loserId = userId;
            const nowDate = new Date();

            // Transfer wallets from loser to winner (skip duplicates)
            const loserWallets = doc.wallets.filter(w =>
                !existingLink.wallets.some(ew => ew.address === w.address)
            );
            const mergedWallets = [...existingLink.wallets, ...loserWallets];

            // Mark the disputed wallet as verified on winner
            const disputedIdx = mergedWallets.findIndex(w => w.address === normalizedAddress);
            if (disputedIdx >= 0) {
                mergedWallets[disputedIdx].verified = true;
                mergedWallets[disputedIdx].lastUsed = nowDate;
            }

            // Recalculate primary wallet across merged set
            this.recalculatePrimaryWallet(mergedWallets);

            // Generate referral code on winner if they don't have one yet
            const winnerUpdateFields: Record<string, unknown> = {
                wallets: mergedWallets,
                'activity.lastSeen': nowDate,
                updatedAt: nowDate
            };
            if (!existingLink.referral?.code) {
                const referralCode = await this.generateUniqueReferralCode();
                winnerUpdateFields.referral = {
                    code: referralCode,
                    referredBy: existingLink.referral?.referredBy ?? null,
                    referredAt: existingLink.referral?.referredAt ?? null
                };
            }

            // Update winner with transferred wallets
            await this.collection.updateOne(
                { id: winnerId },
                { $set: winnerUpdateFields }
            );

            // Create tombstone on loser — clear wallets, set merge pointer
            await this.collection.updateOne(
                { id: loserId },
                {
                    $set: {
                        wallets: [],
                        mergedInto: winnerId,
                        updatedAt: nowDate
                    }
                }
            );

            // Flatten pointer chains: any UUID already pointing to loser now points to winner
            await this.collection.updateMany(
                { mergedInto: loserId },
                { $set: { mergedInto: winnerId } }
            );

            this.logger.info(
                {
                    previousUserId: loserId,
                    newUserId: winnerId,
                    wallet: normalizedAddress,
                    walletsTransferred: loserWallets.length
                },
                'Identity reconciliation: wallets transferred, tombstone created'
            );

            // Invalidate caches for both users and transferred wallet mappings
            await this.invalidateUserCache(winnerId);
            await this.invalidateUserCache(loserId);
            for (const w of doc.wallets) {
                await this.cacheService.invalidate(`${this.CACHE_KEY_WALLET_PREFIX}${w.address}`);
            }

            // Fetch and return the winner's updated data
            const updated = await this.collection.findOne({ id: winnerId });
            return {
                user: this.toPublicUser(updated!),
                identitySwapped: true,
                previousUserId: loserId
            };
        }

        // Normal flow - link wallet to current user
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

        // Generate referral code on first wallet verification if user doesn't have one
        const updateFields: Record<string, unknown> = {
            wallets: doc.wallets,
            updatedAt: nowDate
        };
        if (!doc.referral?.code) {
            const referralCode = await this.generateUniqueReferralCode();
            updateFields.referral = {
                code: referralCode,
                referredBy: doc.referral?.referredBy ?? null,
                referredAt: doc.referral?.referredAt ?? null
            };
            this.logger.info({ userId, referralCode }, 'Referral code generated on wallet verification');
        }

        // Update database
        await this.collection.updateOne(
            { id: userId },
            { $set: updateFields }
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
        return {
            user: this.toPublicUser(updated!)
        };
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
        // Resolve to canonical document (single DB hit, follows merge pointer if needed)
        const doc = await this.resolveDocument(userId);
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }
        userId = doc.id;

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
     * Updates the wallet's lastUsed timestamp to make it the most recently used,
     * then recalculates isPrimary using the standard algorithm.
     * No signature required — wallet ownership was verified during linking.
     * Cookie validation ensures only the owning user can call this endpoint.
     *
     * Note: If setting an unverified wallet but verified wallets exist, the
     * most recent verified wallet will still be selected as primary.
     * Verified wallets always take precedence.
     *
     * @param userId - UUID of user
     * @param address - Wallet address to set as primary
     * @returns Updated user document
     * @throws Error if user not found or wallet not linked
     */
    async setPrimaryWallet(
        userId: string,
        address: string
    ): Promise<IUser> {
        // Resolve to canonical document (single DB hit, follows merge pointer if needed)
        const doc = await this.resolveDocument(userId);
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }
        userId = doc.id;

        // Find wallet in user's list (case-insensitive match via normalized address)
        const walletIndex = doc.wallets.findIndex(w => w.address === address);
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

        this.logger.debug({ userId, primaryWallet: address }, 'Primary wallet updated');

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
        // Resolve to canonical document (single DB hit, follows merge pointer if needed)
        const doc = await this.resolveDocument(userId);
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }
        userId = doc.id;

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
        // Resolve to canonical document (single DB hit, follows merge pointer if needed)
        const doc = await this.resolveDocument(userId);
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }
        userId = doc.id;

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
        // Resolve to canonical document (single DB hit, follows merge pointer if needed)
        const doc = await this.resolveDocument(userId);
        if (!doc) {
            throw new Error(`User with id "${userId}" not found`);
        }
        userId = doc.id;

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
        screenWidth?: number,
        utm?: IUtmParams,
        landingPage?: string
    ): Promise<IUserSession> {
        try {
            // Resolve to canonical UUID if this identity was merged
            // Resolve to canonical document (single DB hit, follows merge pointer if needed)
            const doc = await this.resolveDocument(userId);
            if (!doc) {
                throw new Error(`User with id "${userId}" not found`);
            }
            userId = doc.id;

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
            const searchKeyword = extractSearchKeyword(referrer);

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
                country,
                utm: utm && Object.values(utm).some(v => v) ? utm : null,
                landingPage: landingPage || null,
                searchKeyword
            };

            // Capture traffic origin on first-ever session (set once, never overwritten).
            // If the user already has session history but no origin (pre-feature user),
            // derive origin from the oldest available session instead of the current one.
            if (!activity.origin) {
                const oldestExisting = activity.sessions.length > 0
                    ? activity.sessions[activity.sessions.length - 1]
                    : null;

                if (oldestExisting) {
                    activity.origin = {
                        referrerDomain: oldestExisting.referrerDomain,
                        landingPage: oldestExisting.landingPage ?? oldestExisting.pages?.[0]?.path ?? null,
                        country: oldestExisting.country,
                        device: oldestExisting.device,
                        utm: oldestExisting.utm,
                        searchKeyword: oldestExisting.searchKeyword
                    };
                } else {
                    activity.origin = {
                        referrerDomain,
                        landingPage: landingPage || null,
                        country,
                        device,
                        utm: newSession.utm,
                        searchKeyword
                    };
                }
            }

            // Add to front of sessions array
            activity.sessions.unshift(newSession);
            activity.sessionsCount++;
            activity.lastSeen = now;

            // Prune old sessions (keep last N)
            this.pruneOldSessions(activity);

            // Referral attribution: if this is the user's first session and they arrived
            // via a referral link (utm_source=referral), record who referred them.
            // Set once, never overwritten — same pattern as activity.origin.
            const sessionUpdateFields: Record<string, unknown> = {
                activity,
                updatedAt: now
            };
            if (!doc.referral?.referredBy && newSession.utm?.source === 'referral' && newSession.utm?.content) {
                const rawCode = typeof newSession.utm.content === 'string' ? newSession.utm.content : '';
                const referralCode = rawCode.trim().toLowerCase();

                // Validate referral code format: exactly 8 hexadecimal characters
                if (/^[0-9a-f]{8}$/.test(referralCode)) {
                    // Verify the referral code belongs to a real user
                    const referrer = await this.collection.findOne({ 'referral.code': referralCode });
                    if (referrer && referrer.id !== userId) {
                        // Set entire referral object to avoid MongoDB $set-on-null error
                        // when doc.referral is null (default for new users)
                        const existingReferral = doc.referral ?? { code: null, referredBy: null, referredAt: null };
                        sessionUpdateFields.referral = {
                            code: existingReferral.code ?? null,
                            referredBy: referralCode,
                            referredAt: now
                        };
                        this.logger.info(
                            { userId, referralCode, referrerId: referrer.id },
                            'Referral attribution recorded'
                        );
                    }
                }
            }

            // Update database
            await this.collection.updateOne(
                { id: userId },
                { $set: sessionUpdateFields }
            );

            await this.invalidateUserCache(userId);

            this.logger.debug(
                { userId, device, screenSize, country, referrerDomain, utm: newSession.utm, landingPage: newSession.landingPage, searchKeyword },
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
            // Resolve to canonical UUID if this identity was merged
            // Resolve to canonical document (single DB hit, follows merge pointer if needed)
            const doc = await this.resolveDocument(userId);
            if (!doc) {
                return; // Silently ignore if user doesn't exist
            }
            userId = doc.id;

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
                    country: null,
                    utm: null,
                    landingPage: null,
                    searchKeyword: null
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
                    country: null,
                    utm: null,
                    landingPage: null,
                    searchKeyword: null
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
            // Resolve to canonical document (single DB hit, follows merge pointer if needed)
            const doc = await this.resolveDocument(userId);
            if (!doc) {
                return;
            }
            userId = doc.id;

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
            // Resolve to canonical document (single DB hit, follows merge pointer if needed)
            const doc = await this.resolveDocument(userId);
            if (!doc) {
                return;
            }
            userId = doc.id;

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
            // Resolve to canonical document (single DB hit, follows merge pointer if needed)
            const doc = await this.resolveDocument(userId);
            if (!doc) {
                return;
            }
            userId = doc.id;

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
            countryCounts: activity.countryCounts || {},
            origin: activity.origin || null
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
            case 'live-now': {
                // Users with an active session AND recent activity within timeout window
                // Sessions are closed lazily, so we must also check lastSeen timestamp
                const timeoutThreshold = new Date(Date.now() - this.SESSION_TIMEOUT_MS);
                return {
                    'activity.sessions': {
                        $elemMatch: {
                            endedAt: null
                        }
                    },
                    'activity.lastSeen': { $gte: timeoutThreshold }
                };
            }

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
                            referrerDomain: { $ne: null, $exists: true }
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
                        totalWalletLinks: { $sum: { $size: { $ifNull: ['$wallets', []] } } }
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

    // ==================== Analytics ====================

    /**
     * Get daily unique visitor counts for the specified number of days.
     *
     * Uses MongoDB aggregation to unwind sessions and group by date.
     * Each user only stores the last 20 sessions, so historical counts
     * for very active users may be slightly undercounted.
     *
     * @param days - Number of days to look back (default: 90)
     * @returns Array of { date, count } objects sorted chronologically
     */
    async getDailyVisitorCounts(days: number = 90): Promise<{ date: string; count: number }[]> {
        const since = new Date();
        since.setUTCDate(since.getUTCDate() - days);
        since.setUTCHours(0, 0, 0, 0);

        const results = await this.collection.aggregate<{ _id: string; count: number }>([
            { $match: { 'activity.lastSeen': { $gte: since }, 'activity.sessions': { $exists: true, $ne: [] } } },
            { $unwind: '$activity.sessions' },
            { $match: { 'activity.sessions.startedAt': { $gte: since } } },
            {
                $group: {
                    _id: {
                        date: { $dateToString: { format: '%Y-%m-%d', date: '$activity.sessions.startedAt' } },
                        userId: '$id'
                    }
                }
            },
            {
                $group: {
                    _id: '$_id.date',
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]).toArray();

        return results.map(r => ({ date: `${r._id}T00:00:00Z`, count: r.count }));
    }

    /**
     * Get visitor origins with first-session traffic acquisition data.
     *
     * Returns users active within the given period, with traffic origin data
     * from their first-ever session. Falls back to oldest available session
     * for users created before the origin field was introduced.
     *
     * @param range - Date range for the query window
     * @param limit - Maximum results to return
     * @param skip - Number of results to skip for pagination
     * @returns Paginated list of visitor origins with total count
     */
    async getVisitorOrigins(
        range: IDateRange,
        limit: number = 50,
        skip: number = 0
    ): Promise<{ visitors: IVisitorOrigin[]; total: number }> {
        const query = this.buildDateFilter(range, 'activity.lastSeen');

        const [total, users] = await Promise.all([
            this.collection.countDocuments(query),
            this.collection
                .find(query)
                .sort({ 'activity.firstSeen': -1 })
                .skip(skip)
                .limit(limit)
                .toArray()
        ]);

        const visitors: IVisitorOrigin[] = users.map(user => {
            const origin = user.activity?.origin;
            const sessions = user.activity?.sessions ?? [];
            const oldestSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

            return {
                userId: user.id,
                firstSeen: user.activity?.firstSeen ?? user.createdAt,
                lastSeen: user.activity?.lastSeen ?? user.updatedAt,
                country: origin?.country ?? oldestSession?.country ?? null,
                referrerDomain: origin?.referrerDomain ?? oldestSession?.referrerDomain ?? null,
                landingPage: origin?.landingPage ?? oldestSession?.landingPage ?? oldestSession?.pages?.[0]?.path ?? null,
                device: origin?.device ?? oldestSession?.device ?? 'unknown',
                utm: origin?.utm ?? oldestSession?.utm ?? null,
                searchKeyword: origin?.searchKeyword ?? oldestSession?.searchKeyword ?? null,
                sessionsCount: user.activity?.sessionsCount ?? 0,
                pageViews: user.activity?.pageViews ?? 0
            };
        });

        return { visitors, total };
    }

    /**
     * Get new users who were first seen within the specified period.
     *
     * Filters by activity.firstSeen (when the user first visited) and sorts
     * by firstSeen descending so the most recent arrivals appear first.
     * This differs from getVisitorOrigins which filters by lastSeen (recent activity).
     *
     * @param range - Date range for the query window
     * @param limit - Maximum number of results to return
     * @param skip - Number of results to skip for pagination
     * @returns Paginated list of new user origins with total count
     */
    async getNewUsers(
        range: IDateRange,
        limit: number = 50,
        skip: number = 0
    ): Promise<{ visitors: IVisitorOrigin[]; total: number }> {
        const query = this.buildDateFilter(range, 'activity.firstSeen');

        const [total, users] = await Promise.all([
            this.collection.countDocuments(query),
            this.collection
                .find(query)
                .sort({ 'activity.firstSeen': -1 })
                .skip(skip)
                .limit(limit)
                .toArray()
        ]);

        const visitors: IVisitorOrigin[] = users.map(user => {
            const origin = user.activity?.origin;
            const sessions = user.activity?.sessions ?? [];
            const oldestSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

            return {
                userId: user.id,
                firstSeen: user.activity?.firstSeen ?? user.createdAt,
                lastSeen: user.activity?.lastSeen ?? user.updatedAt,
                country: origin?.country ?? oldestSession?.country ?? null,
                referrerDomain: origin?.referrerDomain ?? oldestSession?.referrerDomain ?? null,
                landingPage: origin?.landingPage ?? oldestSession?.landingPage ?? oldestSession?.pages?.[0]?.path ?? null,
                device: origin?.device ?? oldestSession?.device ?? 'unknown',
                utm: origin?.utm ?? oldestSession?.utm ?? null,
                searchKeyword: origin?.searchKeyword ?? oldestSession?.searchKeyword ?? null,
                sessionsCount: user.activity?.sessionsCount ?? 0,
                pageViews: user.activity?.pageViews ?? 0
            };
        });

        return { visitors, total };
    }

    // ==================== Aggregate Analytics ====================

    /**
     * Build a MongoDB date filter from a date range.
     *
     * For `activity.lastSeen` (user-level field): only applies `$gte` even for
     * bounded ranges, because `lastSeen` records the most recent visit globally.
     * A user active during March 1-7 who also visited March 20 has `lastSeen =
     * March 20`, so `$lte: March 7` would incorrectly exclude them. Instead, the
     * upper bound is enforced via `$elemMatch` on `activity.sessions` to check
     * whether any session falls within the window.
     *
     * For session-level fields (used after `$unwind`): applies both `$gte` and
     * `$lte` directly since each unwound document represents a single session.
     *
     * @param range - Date range with required since and optional until
     * @param field - MongoDB field path to filter on
     * @returns MongoDB filter object for the specified field(s)
     */
    private buildDateFilter(range: IDateRange, field: string): Record<string, any> {
        const condition: Record<string, Date> = { $gte: range.since };

        // User-level date fields record a single global timestamp (e.g. most
        // recent visit, first visit, referral date). Applying $lte directly would
        // exclude users whose global timestamp moved past the window end. Instead,
        // use $elemMatch on sessions to verify the user had activity within the window.
        const userLevelFields = ['activity.lastSeen', 'activity.firstSeen', 'referral.referredAt'];
        if (userLevelFields.includes(field) && range.until) {
            const filter: Record<string, any> = { [field]: condition };
            filter['activity.sessions'] = {
                $elemMatch: {
                    startedAt: { $gte: range.since, $lte: range.until }
                }
            };
            return filter;
        }

        // Session-level fields (post-$unwind) or open-ended ranges get bounds directly
        if (range.until) {
            condition.$lte = range.until;
        }
        return { [field]: condition };
    }

    /**
     * Classify a referrer domain into a traffic source category.
     *
     * Categories: 'organic' (search engines), 'social' (social media),
     * 'direct' (no referrer), or the raw domain for everything else.
     *
     * @param domain - Referrer domain or null
     * @returns Source category string
     */
    private classifyTrafficSource(domain: string | null): 'direct' | 'organic' | 'social' | 'referral' {
        if (!domain) return 'direct';

        const lower = domain.toLowerCase();

        // Search engines: prefix-match for multi-TLD engines, exact/subdomain for others
        const searchPrefixes = ['google.', 'yandex.'];
        const searchDomains = ['bing.com', 'yahoo.com', 'duckduckgo.com', 'baidu.com', 'ecosia.org', 'sogou.com', 'naver.com', 'search.naver.com'];
        if (searchPrefixes.some(p => lower.startsWith(p) || lower.includes('.' + p))) return 'organic';
        if (searchDomains.some(d => lower === d || lower.endsWith('.' + d))) return 'organic';

        // Social networks: exact domain or subdomain match
        const socialNetworks = ['twitter.com', 'x.com', 't.co', 'facebook.com', 'reddit.com', 'linkedin.com', 'telegram.org', 't.me', 'discord.com', 'youtube.com'];
        if (socialNetworks.some(sn => lower === sn || lower.endsWith('.' + sn))) return 'social';

        // Everything else is referral traffic (category stays finite for UI badges)
        return 'referral';
    }

    /**
     * Get aggregate traffic source breakdown for users active in the given period.
     *
     * Groups visitors by their first-session referrer domain, classified into
     * categories (direct, organic, social, or raw domain). Returns counts and
     * percentages for each source.
     *
     * @param range - Date range for the query window
     * @returns Traffic source breakdown with counts and percentages
     */
    async getTrafficSources(range: IDateRange): Promise<{
        sources: Array<{ source: string; category: string; count: number; percentage: number }>;
        total: number;
    }> {
        // Group by referrer domain in MongoDB, then classify small result set in JS.
        // This avoids loading all user documents into memory.
        const results = await this.collection.aggregate<{ _id: string | null; count: number }>([
            { $match: this.buildDateFilter(range, 'activity.lastSeen') },
            {
                $project: {
                    domain: {
                        $ifNull: [
                            '$activity.origin.referrerDomain',
                            { $arrayElemAt: ['$activity.sessions.referrerDomain', -1] }
                        ]
                    }
                }
            },
            { $group: { _id: '$domain', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray();

        const total = results.reduce((sum, r) => sum + r.count, 0);

        const sources = results.map(r => {
            const source = r._id || 'direct';
            const category = this.classifyTrafficSource(r._id);
            return {
                source,
                category,
                count: r.count,
                percentage: total > 0 ? Math.round((r.count / total) * 10000) / 100 : 0
            };
        });

        return { sources, total };
    }

    /**
     * Get detailed breakdown for a specific traffic source.
     *
     * Aggregates landing pages, countries, devices, UTM parameters,
     * and engagement/conversion metrics for all users whose first-session
     * referrer matches the given source domain.
     *
     * @param source - Referrer domain to drill into (use 'direct' for null referrer)
     * @param range - Date range for the query window
     * @returns Breakdown of landing pages, countries, devices, UTM, engagement, and conversions
     */
    async getTrafficSourceDetails(source: string, range: IDateRange): Promise<{
        source: string;
        visitors: number;
        landingPages: Array<{ path: string; count: number; percentage: number }>;
        countries: Array<{ country: string; count: number; percentage: number }>;
        devices: Array<{ device: string; count: number; percentage: number }>;
        utmCampaigns: Array<{ source: string; medium: string; campaign: string; count: number }>;
        searchKeywords: Array<{ keyword: string; count: number }>;
        gscKeywords?: Array<{ keyword: string; clicks: number; impressions: number; ctr: number; position: number }>;
        engagement: { avgSessions: number; avgPageViews: number; avgDuration: number };
        conversion: { walletsConnected: number; walletsVerified: number; conversionRate: number };
    }> {
        // Project a unified domain field using the same logic as getTrafficSources():
        // prefer activity.origin.referrerDomain, fall back to oldest session's referrerDomain.
        // Then match on the projected domain so legacy users without activity.origin are handled correctly.
        const domainMatch = source === 'direct' ? null : source;

        interface ISummaryResult {
            _id: null;
            visitors: number;
            avgSessions: number;
            avgPageViews: number;
            avgDuration: number;
            walletsConnected: number;
            walletsVerified: number;
        }
        interface IFacetResult {
            summary: ISummaryResult[];
            landingPages: Array<{ _id: string | null; count: number }>;
            countries: Array<{ _id: string | null; count: number }>;
            devices: Array<{ _id: string | null; count: number }>;
            utmCampaigns: Array<{ _id: { source: string; medium: string; campaign: string }; count: number }>;
            searchKeywords: Array<{ _id: string; count: number }>;
        }

        const results = await this.collection.aggregate<IFacetResult>([
            { $match: this.buildDateFilter(range, 'activity.lastSeen') },
            {
                $addFields: {
                    _sourceDomain: {
                        $ifNull: [
                            '$activity.origin.referrerDomain',
                            { $arrayElemAt: ['$activity.sessions.referrerDomain', -1] }
                        ]
                    }
                }
            },
            { $match: { _sourceDomain: domainMatch } },
            {
                $facet: {
                    summary: [
                        {
                            $group: {
                                _id: null,
                                visitors: { $sum: 1 },
                                avgSessions: { $avg: { $ifNull: ['$activity.sessionsCount', 0] } },
                                avgPageViews: { $avg: { $ifNull: ['$activity.pageViews', 0] } },
                                avgDuration: { $avg: { $ifNull: ['$activity.totalDurationSeconds', 0] } },
                                walletsConnected: {
                                    $sum: {
                                        $cond: [
                                            { $gt: [{ $size: { $ifNull: ['$wallets', []] } }, 0] },
                                            1, 0
                                        ]
                                    }
                                },
                                walletsVerified: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $gt: [{
                                                    $size: {
                                                        $filter: {
                                                            input: { $ifNull: ['$wallets', []] },
                                                            as: 'w',
                                                            cond: { $eq: ['$$w.verified', true] }
                                                        }
                                                    }
                                                }, 0]
                                            },
                                            1, 0
                                        ]
                                    }
                                }
                            }
                        }
                    ],
                    landingPages: [
                        {
                            $group: {
                                _id: {
                                    $ifNull: [
                                        '$activity.origin.landingPage',
                                        { $arrayElemAt: ['$activity.sessions.landingPage', -1] }
                                    ]
                                },
                                count: { $sum: 1 }
                            }
                        },
                        { $match: { _id: { $ne: null } } },
                        { $sort: { count: -1 } },
                        { $limit: 10 }
                    ],
                    countries: [
                        {
                            $group: {
                                _id: {
                                    $ifNull: [
                                        '$activity.origin.country',
                                        { $arrayElemAt: ['$activity.sessions.country', -1] }
                                    ]
                                },
                                count: { $sum: 1 }
                            }
                        },
                        { $match: { _id: { $ne: null } } },
                        { $sort: { count: -1 } },
                        { $limit: 10 }
                    ],
                    devices: [
                        {
                            $group: {
                                _id: {
                                    $ifNull: [
                                        '$activity.origin.device',
                                        { $arrayElemAt: ['$activity.sessions.device', -1] }
                                    ]
                                },
                                count: { $sum: 1 }
                            }
                        },
                        { $match: { _id: { $ne: null } } },
                        { $sort: { count: -1 } }
                    ],
                    utmCampaigns: [
                        { $match: { 'activity.origin.utm': { $ne: null } } },
                        {
                            $group: {
                                _id: {
                                    source: { $ifNull: ['$activity.origin.utm.source', '(none)'] },
                                    medium: { $ifNull: ['$activity.origin.utm.medium', '(none)'] },
                                    campaign: { $ifNull: ['$activity.origin.utm.campaign', '(none)'] }
                                },
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { count: -1 } },
                        { $limit: 10 }
                    ],
                    searchKeywords: [
                        { $match: { 'activity.origin.searchKeyword': { $ne: null } } },
                        {
                            $group: {
                                _id: '$activity.origin.searchKeyword',
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { count: -1 } },
                        { $limit: 10 }
                    ]
                }
            }
        ]).toArray();

        const data = results[0];
        const summary = data?.summary?.[0];
        const visitors = summary?.visitors ?? 0;

        const toPercentage = (count: number): number =>
            visitors > 0 ? Math.round((count / visitors) * 10000) / 100 : 0;

        // Enrich with GSC keyword data when source is a Google domain
        const isGoogleDomain = /^google\.\w+(\.\w+)?$/i.test(source);
        let gscKeywords: Array<{ keyword: string; clicks: number; impressions: number; ctr: number; position: number }> | undefined;
        let searchKeywords = (data?.searchKeywords ?? []).map(r => ({
            keyword: r._id,
            count: r.count
        }));

        if (isGoogleDomain && this.gscService) {
            try {
                if (await this.gscService.isConfigured()) {
                    const upperBound = range.until?.getTime() ?? Date.now();
                    const gscHours = Math.ceil((upperBound - range.since.getTime()) / (60 * 60 * 1000));
                    gscKeywords = await this.gscService.getKeywordsForPeriod(gscHours, 10);

                    // Populate searchKeywords from GSC clicks for backward compatibility
                    if (gscKeywords.length > 0 && searchKeywords.length === 0) {
                        searchKeywords = gscKeywords.map(kw => ({
                            keyword: kw.keyword,
                            count: kw.clicks
                        }));
                    }
                }
            } catch (error) {
                this.logger.error({ error }, 'GSC keyword enrichment failed');
            }
        }

        return {
            source,
            visitors,
            landingPages: (data?.landingPages ?? []).map(r => ({
                path: r._id ?? '(unknown)',
                count: r.count,
                percentage: toPercentage(r.count)
            })),
            countries: (data?.countries ?? []).map(r => ({
                country: r._id ?? '(unknown)',
                count: r.count,
                percentage: toPercentage(r.count)
            })),
            devices: (data?.devices ?? []).map(r => ({
                device: r._id ?? '(unknown)',
                count: r.count,
                percentage: toPercentage(r.count)
            })),
            utmCampaigns: (data?.utmCampaigns ?? []).map(r => ({
                source: r._id.source,
                medium: r._id.medium,
                campaign: r._id.campaign,
                count: r.count
            })),
            searchKeywords,
            gscKeywords,
            engagement: {
                avgSessions: Math.round((summary?.avgSessions ?? 0) * 10) / 10,
                avgPageViews: Math.round((summary?.avgPageViews ?? 0) * 10) / 10,
                avgDuration: Math.round(summary?.avgDuration ?? 0)
            },
            conversion: {
                walletsConnected: summary?.walletsConnected ?? 0,
                walletsVerified: summary?.walletsVerified ?? 0,
                conversionRate: visitors > 0
                    ? Math.round(((summary?.walletsVerified ?? 0) / visitors) * 10000) / 100
                    : 0
            }
        };
    }

    /**
     * Get top landing pages for users active in the given period.
     *
     * Aggregates the first-session landing page across visitors, including
     * average engagement metrics (sessions count, page views) per landing page.
     *
     * @param range - Date range for the query window
     * @param limit - Maximum landing pages to return (default: 20)
     * @returns Landing pages sorted by visitor count descending
     */
    async getTopLandingPages(range: IDateRange, limit: number = 20): Promise<{
        pages: Array<{ path: string; visitors: number; avgSessions: number; avgPageViews: number }>;
        totalPages: number;
        totalVisitors: number;
    }> {
        // Common pipeline stages before facet
        const commonStages = [
            { $match: this.buildDateFilter(range, 'activity.lastSeen') },
            {
                $project: {
                    landingPage: {
                        $ifNull: ['$activity.origin.landingPage', { $arrayElemAt: ['$activity.sessions.landingPage', -1] }]
                    },
                    sessionsCount: { $ifNull: ['$activity.sessionsCount', 0] },
                    pageViews: { $ifNull: ['$activity.pageViews', 0] }
                }
            },
            { $match: { landingPage: { $ne: null } } },
            {
                $group: {
                    _id: '$landingPage',
                    visitors: { $sum: 1 },
                    avgSessions: { $avg: '$sessionsCount' },
                    avgPageViews: { $avg: '$pageViews' }
                }
            }
        ];

        // Use $facet to get both limited results and total count in one query
        const facetResults = await this.collection.aggregate<{
            results: Array<{ _id: string; visitors: number; avgSessions: number; avgPageViews: number }>;
            meta: Array<{ totalPages: number; totalVisitors: number }>;
        }>([
            ...commonStages,
            {
                $facet: {
                    results: [
                        { $sort: { visitors: -1 } },
                        { $limit: limit }
                    ],
                    meta: [
                        { $group: { _id: null, totalPages: { $sum: 1 }, totalVisitors: { $sum: '$visitors' } } }
                    ]
                }
            }
        ]).toArray();

        const data = facetResults[0];
        const results = data?.results ?? [];
        const meta = data?.meta?.[0] ?? { totalPages: 0, totalVisitors: 0 };

        const pages = results.map(r => ({
            path: r._id,
            visitors: r.visitors,
            avgSessions: Math.round(r.avgSessions * 10) / 10,
            avgPageViews: Math.round(r.avgPageViews * 10) / 10
        }));

        return { pages, totalPages: meta.totalPages, totalVisitors: meta.totalVisitors };
    }

    /**
     * Get geographic distribution of users active in the given period.
     *
     * Uses the first-session origin country for each user, falling back
     * to the most recent session country when origin data is unavailable.
     *
     * @param range - Date range for the query window
     * @param limit - Maximum countries to return (default: 30)
     * @returns Countries sorted by visitor count descending
     */
    async getGeoDistribution(range: IDateRange, limit: number = 30): Promise<{
        countries: Array<{ country: string; count: number; percentage: number }>;
        total: number;
    }> {
        const results = await this.collection.aggregate<{ _id: string | null; count: number }>([
            { $match: this.buildDateFilter(range, 'activity.lastSeen') },
            {
                $project: {
                    country: {
                        $ifNull: ['$activity.origin.country', { $arrayElemAt: ['$activity.sessions.country', -1] }]
                    }
                }
            },
            { $match: { country: { $ne: null } } },
            { $group: { _id: '$country', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: limit }
        ]).toArray();

        const total = results.reduce((sum, r) => sum + r.count, 0);
        const countries = results
            .filter(r => r._id !== null)
            .map(r => ({
                country: r._id as string,
                count: r.count,
                percentage: total > 0 ? Math.round((r.count / total) * 10000) / 100 : 0
            }));

        return { countries, total };
    }

    /**
     * Get device category breakdown for users active in the given period.
     *
     * Returns both device category (mobile/tablet/desktop) and screen size
     * category distributions from origin data.
     *
     * @param range - Date range for the query window
     * @returns Device and screen size breakdowns
     */
    async getDeviceBreakdown(range: IDateRange): Promise<{
        devices: Array<{ device: string; count: number; percentage: number }>;
        screenSizes: Array<{ screenSize: string; count: number; percentage: number }>;
        total: number;
    }> {
        const users = await this.collection
            .find(
                this.buildDateFilter(range, 'activity.lastSeen'),
                { projection: { 'activity.origin.device': 1, 'activity.sessions': { $slice: 1 } } }
            )
            .toArray();

        const deviceCounts = new Map<string, number>();
        const screenSizeCounts = new Map<string, number>();
        const total = users.length;

        for (const user of users) {
            const device = user.activity?.origin?.device
                ?? user.activity?.sessions?.[0]?.device
                ?? 'unknown';
            deviceCounts.set(device, (deviceCounts.get(device) ?? 0) + 1);

            const screenSize = user.activity?.sessions?.[0]?.screenSize ?? 'unknown';
            screenSizeCounts.set(screenSize, (screenSizeCounts.get(screenSize) ?? 0) + 1);
        }

        const devices = Array.from(deviceCounts.entries())
            .map(([device, count]) => ({
                device,
                count,
                percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0
            }))
            .sort((a, b) => b.count - a.count);

        const screenSizes = Array.from(screenSizeCounts.entries())
            .map(([screenSize, count]) => ({
                screenSize,
                count,
                percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0
            }))
            .sort((a, b) => b.count - a.count);

        return { devices, screenSizes, total };
    }

    /**
     * Get UTM campaign performance for users active in the given period.
     *
     * Groups users by their utm_source/medium/campaign combination and
     * calculates wallet conversion rates per campaign.
     *
     * @param range - Date range for the query window
     * @param limit - Maximum campaigns to return (default: 20)
     * @returns Campaign performance sorted by visitor count descending
     */
    async getCampaignPerformance(range: IDateRange, limit: number = 20): Promise<{
        campaigns: Array<{
            source: string;
            medium: string;
            campaign: string;
            visitors: number;
            walletsConnected: number;
            walletsVerified: number;
            conversionRate: number;
        }>;
        total: number;
    }> {
        const results = await this.collection.aggregate<{
            _id: { source: string; medium: string; campaign: string };
            visitors: number;
            walletsConnected: number;
            walletsVerified: number;
        }>([
            { $match: { ...this.buildDateFilter(range, 'activity.lastSeen'), 'activity.origin.utm': { $ne: null } } },
            {
                $project: {
                    utm: '$activity.origin.utm',
                    hasWallet: { $gt: [{ $size: { $ifNull: ['$wallets', []] } }, 0] },
                    hasVerifiedWallet: {
                        $gt: [{
                            $size: {
                                $filter: {
                                    input: { $ifNull: ['$wallets', []] },
                                    as: 'w',
                                    cond: { $eq: ['$$w.verified', true] }
                                }
                            }
                        }, 0]
                    }
                }
            },
            {
                $group: {
                    _id: {
                        source: { $ifNull: ['$utm.source', '(none)'] },
                        medium: { $ifNull: ['$utm.medium', '(none)'] },
                        campaign: { $ifNull: ['$utm.campaign', '(none)'] }
                    },
                    visitors: { $sum: 1 },
                    walletsConnected: { $sum: { $cond: ['$hasWallet', 1, 0] } },
                    walletsVerified: { $sum: { $cond: ['$hasVerifiedWallet', 1, 0] } }
                }
            },
            { $sort: { visitors: -1 } },
            { $limit: limit }
        ]).toArray();

        const total = results.reduce((sum, r) => sum + r.visitors, 0);
        const campaigns = results.map(r => ({
            source: r._id.source,
            medium: r._id.medium,
            campaign: r._id.campaign,
            visitors: r.visitors,
            walletsConnected: r.walletsConnected,
            walletsVerified: r.walletsVerified,
            conversionRate: r.visitors > 0
                ? Math.round((r.walletsVerified / r.visitors) * 10000) / 100
                : 0
        }));

        return { campaigns, total };
    }

    /**
     * Get engagement metrics for users active in the given period.
     *
     * Calculates average session duration, pages per session, bounce rate,
     * and average sessions per user from lifetime aggregate fields.
     *
     * @param range - Date range for the query window
     * @returns Engagement summary metrics
     */
    async getEngagementMetrics(range: IDateRange): Promise<{
        avgSessionDuration: number;
        avgPagesPerSession: number;
        bounceRate: number;
        avgSessionsPerUser: number;
        totalUsers: number;
    }> {
        // Sum totals across all sessions then divide by total session count
        // to avoid "average of averages" bias (where light users get equal weight
        // to heavy users). This produces true weighted averages.
        const results = await this.collection.aggregate<{
            _id: null;
            totalUsers: number;
            totalSessions: number;
            totalDuration: number;
            totalPages: number;
            singlePageSessions: number;
        }>([
            { $match: this.buildDateFilter(range, 'activity.lastSeen') },
            { $unwind: { path: '$activity.sessions', preserveNullAndEmptyArrays: false } },
            { $match: this.buildDateFilter(range, 'activity.sessions.startedAt') },
            {
                $group: {
                    _id: null,
                    userIds: { $addToSet: '$id' },
                    totalSessions: { $sum: 1 },
                    totalDuration: { $sum: '$activity.sessions.durationSeconds' },
                    totalPages: { $sum: { $size: { $ifNull: ['$activity.sessions.pages', []] } } },
                    singlePageSessions: {
                        $sum: {
                            $cond: [{ $lte: [{ $size: { $ifNull: ['$activity.sessions.pages', []] } }, 1] }, 1, 0]
                        }
                    }
                }
            },
            {
                $project: {
                    totalUsers: { $size: '$userIds' },
                    totalSessions: 1,
                    totalDuration: 1,
                    totalPages: 1,
                    singlePageSessions: 1
                }
            }
        ]).toArray();

        const data = results[0];
        if (!data || data.totalSessions === 0) {
            return { avgSessionDuration: 0, avgPagesPerSession: 0, bounceRate: 0, avgSessionsPerUser: 0, totalUsers: 0 };
        }

        return {
            avgSessionDuration: Math.round(data.totalDuration / data.totalSessions),
            avgPagesPerSession: Math.round((data.totalPages / data.totalSessions) * 10) / 10,
            bounceRate: Math.round((data.singlePageSessions / data.totalSessions) * 10000) / 100,
            avgSessionsPerUser: data.totalUsers > 0
                ? Math.round((data.totalSessions / data.totalUsers) * 10) / 10
                : 0,
            totalUsers: data.totalUsers
        };
    }

    /**
     * Get conversion funnel showing user progression through engagement stages.
     *
     * Stages: total visitors → return visitors → wallet connected → wallet verified.
     * Each stage includes count and drop-off percentage from the previous stage.
     *
     * @param range - Date range for the query window
     * @returns Funnel stages with counts and percentages
     */
    async getConversionFunnel(range: IDateRange): Promise<{
        stages: Array<{ stage: string; count: number; percentage: number; dropOff: number }>;
    }> {
        // Single aggregation with conditional sums instead of 4 separate queries.
        const results = await this.collection.aggregate<{
            _id: null;
            totalVisitors: number;
            returnVisitors: number;
            walletConnected: number;
            walletVerified: number;
        }>([
            { $match: this.buildDateFilter(range, 'activity.lastSeen') },
            {
                $group: {
                    _id: null,
                    totalVisitors: { $sum: 1 },
                    returnVisitors: {
                        $sum: { $cond: [{ $gt: [{ $ifNull: ['$activity.sessionsCount', 0] }, 1] }, 1, 0] }
                    },
                    walletConnected: {
                        $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$wallets', []] } }, 0] }, 1, 0] }
                    },
                    walletVerified: {
                        $sum: {
                            $cond: [{
                                $gt: [{
                                    $size: {
                                        $filter: {
                                            input: { $ifNull: ['$wallets', []] },
                                            as: 'w',
                                            cond: { $eq: ['$$w.verified', true] }
                                        }
                                    }
                                }, 0]
                            }, 1, 0]
                        }
                    }
                }
            }
        ]).toArray();

        const data = results[0] ?? { totalVisitors: 0, returnVisitors: 0, walletConnected: 0, walletVerified: 0 };

        const stages = [
            { stage: 'Total Visitors', count: data.totalVisitors },
            { stage: 'Return Visitors', count: data.returnVisitors },
            { stage: 'Wallet Connected', count: data.walletConnected },
            { stage: 'Wallet Verified', count: data.walletVerified }
        ].map((s, i, arr) => ({
            ...s,
            percentage: data.totalVisitors > 0 ? Math.round((s.count / data.totalVisitors) * 10000) / 100 : 0,
            dropOff: i === 0
                ? 0
                : arr[i - 1].count > 0
                    ? Math.round(((arr[i - 1].count - s.count) / arr[i - 1].count) * 10000) / 100
                    : 0
        }));

        return { stages };
    }

    /**
     * Get retention data showing new vs returning visitors over time.
     *
     * For each day in the period, counts users first seen that day (new)
     * versus users with earlier firstSeen who were active that day (returning).
     *
     * @param range - Date range for the query window
     * @returns Daily new vs returning visitor counts
     */
    async getRetention(range: IDateRange): Promise<{
        data: Array<{ date: string; newVisitors: number; returningVisitors: number }>;
    }> {
        // For preset periods shorter than 48h without an explicit until bound,
        // use exact hour math so "24 Hours" means exactly that. For longer periods
        // or custom ranges, the caller already provides midnight-aligned dates.
        const periodMs = (range.until ?? new Date()).getTime() - range.since.getTime();
        const effectiveSince = new Date(range.since);
        if (periodMs >= 48 * 60 * 60 * 1000 && !range.until) {
            effectiveSince.setHours(0, 0, 0, 0);
        }
        const effectiveRange: IDateRange = { since: effectiveSince, until: range.until };

        const results = await this.collection.aggregate<{
            _id: { date: string; isNew: boolean };
            count: number;
        }>([
            { $match: { 'activity.lastSeen': { $gte: effectiveRange.since }, 'activity.sessions': { $exists: true, $ne: [] } } },
            { $unwind: '$activity.sessions' },
            { $match: this.buildDateFilter(effectiveRange, 'activity.sessions.startedAt') },
            {
                $project: {
                    sessionDate: { $dateToString: { format: '%Y-%m-%d', date: '$activity.sessions.startedAt' } },
                    firstSeenDate: { $dateToString: { format: '%Y-%m-%d', date: '$activity.firstSeen' } },
                    userId: '$id'
                }
            },
            {
                $group: {
                    _id: { date: '$sessionDate', userId: '$userId', firstSeenDate: '$firstSeenDate' }
                }
            },
            {
                $project: {
                    date: '$_id.date',
                    isNew: { $eq: ['$_id.date', '$_id.firstSeenDate'] }
                }
            },
            {
                $group: {
                    _id: { date: '$date', isNew: '$isNew' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.date': 1 } }
        ]).toArray();

        const dateMap = new Map<string, { newVisitors: number; returningVisitors: number }>();

        for (const r of results) {
            const entry = dateMap.get(r._id.date) ?? { newVisitors: 0, returningVisitors: 0 };
            if (r._id.isNew) {
                entry.newVisitors = r.count;
            } else {
                entry.returningVisitors = r.count;
            }
            dateMap.set(r._id.date, entry);
        }

        const data = Array.from(dateMap.entries())
            .map(([date, counts]) => ({ date: `${date}T00:00:00Z`, ...counts }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return { data };
    }

    // ==================== Referral System ====================

    /**
     * Get referral statistics for a user.
     *
     * Counts how many users were referred by this user's code and how many
     * of those converted to verified wallet holders.
     *
     * @param userId - UUID of the referring user
     * @returns Referral code and stats, or null if user has no referral code
     */
    async getReferralStats(userId: string): Promise<{
        code: string;
        referredCount: number;
        convertedCount: number;
    } | null> {
        const doc = await this.collection.findOne({ id: userId });
        if (!doc?.referral?.code) {
            return null;
        }

        const referralCode = doc.referral.code;

        const [referredCount, convertedCount] = await Promise.all([
            this.collection.countDocuments({ 'referral.referredBy': referralCode }),
            this.collection.countDocuments({
                'referral.referredBy': referralCode,
                wallets: { $elemMatch: { verified: true } }
            })
        ]);

        return { code: referralCode, referredCount, convertedCount };
    }

    /**
     * Get aggregate referral program overview for admin dashboard.
     *
     * Returns program-wide metrics: total referrals, conversions, top referrers,
     * and recent referral activity. Provides the data needed to evaluate whether
     * the referral program is driving growth.
     *
     * @param range - Date range for "recent" activity
     * @param topLimit - Max top referrers to return (default: 15)
     * @returns Aggregate referral metrics
     */
    async getReferralOverview(range: IDateRange, topLimit: number = 15): Promise<{
        totalReferrals: number;
        totalConverted: number;
        conversionRate: number;
        usersWithCodes: number;
        topReferrers: Array<{
            userId: string;
            code: string;
            referredCount: number;
            convertedCount: number;
        }>;
        recentReferrals: Array<{
            userId: string;
            referredBy: string;
            referredAt: string;
            hasVerifiedWallet: boolean;
        }>;
    }> {
        // Filter for users with actual referral attribution (not just missing fields)
        const referredFilter = { 'referral.referredBy': { $ne: null, $exists: true } };

        // Aggregate totals in a single pipeline
        const totalsResult = await this.collection.aggregate<{
            _id: null;
            totalReferrals: number;
            totalConverted: number;
        }>([
            { $match: referredFilter },
            {
                $group: {
                    _id: null,
                    totalReferrals: { $sum: 1 },
                    totalConverted: {
                        $sum: {
                            $cond: [{
                                $gt: [{
                                    $size: {
                                        $filter: {
                                            input: { $ifNull: ['$wallets', []] },
                                            as: 'w',
                                            cond: { $eq: ['$$w.verified', true] }
                                        }
                                    }
                                }, 0]
                            }, 1, 0]
                        }
                    }
                }
            }
        ]).toArray();

        const totals = totalsResult[0] ?? { totalReferrals: 0, totalConverted: 0 };
        const usersWithCodes = await this.collection.countDocuments({
            'referral.code': { $ne: null, $exists: true }
        });

        // Top referrers: group referred users by referral code, count and rank
        const topReferrersResult = await this.collection.aggregate<{
            _id: string;
            referredCount: number;
            convertedCount: number;
        }>([
            { $match: referredFilter },
            {
                $group: {
                    _id: '$referral.referredBy',
                    referredCount: { $sum: 1 },
                    convertedCount: {
                        $sum: {
                            $cond: [{
                                $gt: [{
                                    $size: {
                                        $filter: {
                                            input: { $ifNull: ['$wallets', []] },
                                            as: 'w',
                                            cond: { $eq: ['$$w.verified', true] }
                                        }
                                    }
                                }, 0]
                            }, 1, 0]
                        }
                    }
                }
            },
            { $sort: { referredCount: -1 } },
            { $limit: topLimit }
        ]).toArray();

        // Resolve referral codes to user IDs in a single batch query (avoids N+1)
        const referralCodes = topReferrersResult.map(entry => entry._id);
        const referrersByCode: Record<string, string> = {};

        if (referralCodes.length > 0) {
            const referrerDocs = await this.collection
                .find(
                    { 'referral.code': { $in: referralCodes } },
                    { projection: { id: 1, 'referral.code': 1 } }
                )
                .toArray();

            for (const doc of referrerDocs) {
                const code = doc.referral?.code;
                if (code) {
                    referrersByCode[code] = doc.id;
                }
            }
        }

        const topReferrers: Array<{
            userId: string;
            code: string;
            referredCount: number;
            convertedCount: number;
        }> = topReferrersResult.map(entry => ({
            userId: referrersByCode[entry._id] ?? 'unknown',
            code: entry._id,
            referredCount: entry.referredCount,
            convertedCount: entry.convertedCount
        }));

        // Recent referrals within the period
        const referredAtFilter = this.buildDateFilter(range, 'referral.referredAt');
        const recentResult = await this.collection
            .find(
                { 'referral.referredBy': { $ne: null, $exists: true }, ...referredAtFilter },
                { projection: { id: 1, referral: 1, wallets: 1 } }
            )
            .sort({ 'referral.referredAt': -1 })
            .limit(25)
            .toArray();

        const recentReferrals = recentResult.map(doc => ({
            userId: doc.id,
            referredBy: doc.referral?.referredBy ?? '',
            referredAt: doc.referral?.referredAt ? (doc.referral.referredAt as Date).toISOString() : '',
            hasVerifiedWallet: (doc.wallets ?? []).some((w: { verified?: boolean }) => !!w.verified)
        }));

        return {
            totalReferrals: totals.totalReferrals,
            totalConverted: totals.totalConverted,
            conversionRate: totals.totalReferrals > 0
                ? Math.round((totals.totalConverted / totals.totalReferrals) * 10000) / 100
                : 0,
            usersWithCodes,
            topReferrers,
            recentReferrals
        };
    }

    /**
     * Generate a unique 8-character referral code.
     *
     * Uses cryptographic randomness and checks for collisions in the database.
     * Retries up to 5 times if a collision occurs (extremely unlikely with
     * 8 hex characters = 4 billion possible codes).
     *
     * @returns Unique referral code string
     * @throws Error if unable to generate unique code after retries
     */
    private async generateUniqueReferralCode(): Promise<string> {
        for (let attempt = 0; attempt < 5; attempt++) {
            const code = randomBytes(4).toString('hex');
            const existing = await this.collection.findOne({ 'referral.code': code });
            if (!existing) {
                return code;
            }
        }
        throw new Error('Failed to generate unique referral code after 5 attempts');
    }

    // ==================== Health Summary Methods ====================
    // These methods implement IUserService and provide aggregate stats
    // for cross-component consumers (e.g., AI assistant template variables).

    /**
     * Get aggregate user activity metrics for health monitoring.
     *
     * Combines user counts, engagement stats, and a 7-day daily visitor
     * trend. Reuses existing getStats(), getEngagementMetrics(), and
     * getDailyVisitorCounts() internally.
     *
     * @returns Activity summary snapshot
     */
    async getActivitySummary(): Promise<IUserActivitySummary> {
        const now = new Date();
        const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

        const [stats, engagement, dailyTrend, newToday, newThisWeek] = await Promise.all([
            this.getStats(),
            this.getEngagementMetrics({ since: weekStart }),
            this.getDailyVisitorCounts(7),
            this.collection.countDocuments({ 'activity.firstSeen': { $gte: todayStart } }),
            this.collection.countDocuments({ 'activity.firstSeen': { $gte: weekStart } })
        ]);

        return {
            totalUsers: stats.totalUsers,
            activeToday: stats.activeToday,
            activeThisWeek: stats.activeThisWeek,
            newUsersToday: newToday,
            newUsersThisWeek: newThisWeek,
            avgSessionDuration: engagement.avgSessionDuration,
            avgPagesPerSession: engagement.avgPagesPerSession,
            bounceRate: engagement.bounceRate,
            dailyTrend
        };
    }

    /**
     * Get wallet linking statistics for health monitoring.
     *
     * Tracks adoption rates, verification progress, and the conversion
     * funnel from anonymous visitor to verified wallet holder.
     *
     * @returns Wallet summary with counts, rates, and funnel stages
     */
    async getWalletSummary(): Promise<IUserWalletSummary> {
        const now = new Date();
        const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

        const [stats, walletBreakdown, funnel] = await Promise.all([
            this.getStats(),
            this.collection.aggregate<{
                _id: null;
                usersWithoutWallets: number;
                usersWithMultiple: number;
                verifiedWallets: number;
                unverifiedWallets: number;
                walletsLinkedToday: number;
                walletsLinkedThisWeek: number;
            }>([
                {
                    $facet: {
                        counts: [
                            {
                                $group: {
                                    _id: null,
                                    usersWithoutWallets: {
                                        $sum: { $cond: [{ $eq: [{ $size: { $ifNull: ['$wallets', []] } }, 0] }, 1, 0] }
                                    },
                                    usersWithMultiple: {
                                        $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$wallets', []] } }, 1] }, 1, 0] }
                                    }
                                }
                            }
                        ],
                        walletDetails: [
                            { $unwind: { path: '$wallets', preserveNullAndEmptyArrays: false } },
                            {
                                $group: {
                                    _id: null,
                                    verifiedWallets: {
                                        $sum: { $cond: [{ $eq: ['$wallets.verified', true] }, 1, 0] }
                                    },
                                    unverifiedWallets: {
                                        $sum: { $cond: [{ $ne: ['$wallets.verified', true] }, 1, 0] }
                                    },
                                    walletsLinkedToday: {
                                        $sum: { $cond: [{ $gte: ['$wallets.linkedAt', todayStart] }, 1, 0] }
                                    },
                                    walletsLinkedThisWeek: {
                                        $sum: { $cond: [{ $gte: ['$wallets.linkedAt', weekStart] }, 1, 0] }
                                    }
                                }
                            }
                        ]
                    }
                },
                {
                    $project: {
                        usersWithoutWallets: { $arrayElemAt: ['$counts.usersWithoutWallets', 0] },
                        usersWithMultiple: { $arrayElemAt: ['$counts.usersWithMultiple', 0] },
                        verifiedWallets: { $arrayElemAt: ['$walletDetails.verifiedWallets', 0] },
                        unverifiedWallets: { $arrayElemAt: ['$walletDetails.unverifiedWallets', 0] },
                        walletsLinkedToday: { $arrayElemAt: ['$walletDetails.walletsLinkedToday', 0] },
                        walletsLinkedThisWeek: { $arrayElemAt: ['$walletDetails.walletsLinkedThisWeek', 0] }
                    }
                }
            ]).toArray(),
            this.getConversionFunnel({ since: weekStart })
        ]);

        const breakdown = walletBreakdown[0];

        return {
            totalWalletLinks: stats.totalWalletLinks,
            usersWithWallets: stats.usersWithWallets,
            usersWithoutWallets: breakdown?.usersWithoutWallets ?? 0,
            usersWithMultipleWallets: breakdown?.usersWithMultiple ?? 0,
            averageWalletsPerUser: stats.averageWalletsPerUser,
            verifiedWallets: breakdown?.verifiedWallets ?? 0,
            unverifiedWallets: breakdown?.unverifiedWallets ?? 0,
            walletsLinkedToday: breakdown?.walletsLinkedToday ?? 0,
            walletsLinkedThisWeek: breakdown?.walletsLinkedThisWeek ?? 0,
            conversionFunnel: funnel.stages.map(s => ({
                stage: s.stage,
                count: s.count,
                percentage: s.percentage
            }))
        };
    }

    /**
     * Get user retention metrics for health monitoring.
     *
     * Provides new vs returning visitor breakdown, dormant user detection,
     * and a 7-day daily retention trend.
     *
     * @returns Retention summary with daily breakdown and dormant count
     */
    async getRetentionSummary(): Promise<IUserRetentionSummary> {
        const now = new Date();
        const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [retention, newToday, returningToday, dormantCount] = await Promise.all([
            this.getRetention({ since: weekStart }),
            this.collection.countDocuments({
                'activity.firstSeen': { $gte: todayStart }
            }),
            this.collection.countDocuments({
                'activity.lastSeen': { $gte: todayStart },
                'activity.firstSeen': { $lt: todayStart }
            }),
            this.collection.countDocuments({
                'activity.lastSeen': { $lt: thirtyDaysAgo },
                'activity.pageViews': { $gt: 10 }
            })
        ]);

        return {
            newUsersToday: newToday,
            returningUsersToday: returningToday,
            dormantUsers: dormantCount,
            dailyRetention: retention.data
        };
    }

    /**
     * Get user preference distribution for health monitoring.
     *
     * Aggregates theme choices and notification opt-in rates across
     * the user base.
     *
     * @returns Preference summary with theme distribution and opt-in rates
     */
    async getPreferencesSummary(): Promise<IUserPreferencesSummary> {
        const results = await this.collection.aggregate<{
            _id: null;
            totalWithPreferences: number;
            notificationsEnabled: number;
            totalUsers: number;
            themes: Array<{ _id: string; count: number }>;
        }>([
            {
                $facet: {
                    counts: [
                        {
                            $group: {
                                _id: null,
                                totalUsers: { $sum: 1 },
                                totalWithPreferences: {
                                    $sum: {
                                        $cond: [{
                                            $or: [
                                                { $ne: ['$preferences.theme', null] },
                                                { $eq: ['$preferences.notifications', true] }
                                            ]
                                        }, 1, 0]
                                    }
                                },
                                notificationsEnabled: {
                                    $sum: { $cond: [{ $eq: ['$preferences.notifications', true] }, 1, 0] }
                                }
                            }
                        }
                    ],
                    themes: [
                        {
                            $group: {
                                _id: { $ifNull: ['$preferences.theme', 'unset'] },
                                count: { $sum: 1 }
                            }
                        }
                    ]
                }
            },
            {
                $project: {
                    totalUsers: { $arrayElemAt: ['$counts.totalUsers', 0] },
                    totalWithPreferences: { $arrayElemAt: ['$counts.totalWithPreferences', 0] },
                    notificationsEnabled: { $arrayElemAt: ['$counts.notificationsEnabled', 0] },
                    themes: '$themes'
                }
            }
        ]).toArray();

        const data = results[0];
        const totalUsers = data?.totalUsers ?? 0;
        const notificationsEnabled = data?.notificationsEnabled ?? 0;

        const themeDistribution: Record<string, number> = {};
        if (data?.themes) {
            for (const entry of data.themes) {
                themeDistribution[entry._id] = entry.count;
            }
        }

        return {
            themeDistribution,
            notificationOptInRate: totalUsers > 0
                ? Math.round((notificationsEnabled / totalUsers) * 10000) / 100
                : 0,
            totalWithPreferences: data?.totalWithPreferences ?? 0
        };
    }

    // ==================== Bucket Interval Helpers ====================

    /**
     * Parse a BucketInterval string into its numeric amount and time unit.
     *
     * @param interval - Duration string like '1h', '4h', '1d'
     * @returns Parsed unit ('hour' or 'day') and numeric amount
     */
    private parseBucketInterval(interval: BucketInterval): { unit: 'hour' | 'day'; amount: number } {
        const match = interval.match(/^(\d+)(h|d)$/);
        if (!match) {
            throw new Error(`Invalid bucket interval: ${interval}`);
        }

        const amount = parseInt(match[1], 10);
        if (amount <= 0) {
            throw new Error(`Bucket interval amount must be positive: ${interval}`);
        }

        return {
            amount,
            unit: match[2] === 'h' ? 'hour' : 'day'
        };
    }

    /**
     * Compute the "since" cutoff date for a bucket query.
     *
     * Aligns to the appropriate boundary (hour or day in UTC) so
     * bucket edges are clean and predictable.
     *
     * @param interval - Duration per bucket (e.g., '1h', '1d')
     * @param count - Number of buckets
     * @returns Date representing the start of the oldest bucket
     */
    private computeBucketSince(interval: BucketInterval, count: number): Date {
        if (!Number.isInteger(count) || count <= 0) {
            throw new Error(`Bucket count must be a positive integer: ${count}`);
        }
        const { unit, amount } = this.parseBucketInterval(interval);
        const since = new Date();

        if (unit === 'hour') {
            since.setTime(since.getTime() - amount * count * 60 * 60 * 1000);
            since.setUTCMinutes(0, 0, 0);
            // Snap to amount-aligned hour boundary so cutoff matches $dateTrunc bin edges
            since.setUTCHours(since.getUTCHours() - (since.getUTCHours() % amount));
        } else {
            since.setUTCDate(since.getUTCDate() - amount * count);
            since.setUTCHours(0, 0, 0, 0);
        }

        return since;
    }

    /**
     * Build a MongoDB expression that truncates a date field to the bucket boundary.
     *
     * For '1d' intervals, uses $dateToString with '%Y-%m-%d' format for backwards
     * compatibility. For all other intervals, uses $dateTrunc (MongoDB 5.0+) then
     * formats the result to a readable string.
     *
     * @param dateField - MongoDB field path (e.g., '$activity.sessions.startedAt')
     * @param interval - Duration per bucket (e.g., '1h', '1d')
     * @returns MongoDB aggregation expression producing a bucket date string
     */
    private buildBucketDateExpr(dateField: string, interval: BucketInterval): object {
        const { unit, amount } = this.parseBucketInterval(interval);

        if (unit === 'day' && amount === 1) {
            return { $dateToString: { format: '%Y-%m-%d', date: dateField } };
        }

        const format = unit === 'hour' ? '%Y-%m-%dT%H:00' : '%Y-%m-%d';

        return {
            $dateToString: {
                format,
                date: { $dateTrunc: { date: dateField, unit, binSize: amount } }
            }
        };
    }

    // ==================== Page Traffic Analytics ====================

    /**
     * Get page traffic history broken into time-interval buckets.
     *
     * Unwinds session page data across all users, groups by bucket and path,
     * and returns the top N paths per bucket with an "other" rollup for
     * remaining traffic. Buckets are ordered chronologically (oldest first).
     *
     * @param bucketInterval - Duration per bucket, e.g. '1h' or '1d' (default '1d')
     * @param bucketCount - Number of buckets to return (default 14)
     * @param topN - Number of top paths per bucket (default 30)
     * @returns Traffic buckets with top paths and "other" rollup
     */
    async getPageTrafficHistory(bucketInterval: BucketInterval = '1d', bucketCount = 14, topN = 30): Promise<IPageTrafficHistory> {
        const since = this.computeBucketSince(bucketInterval, bucketCount);

        const results = await this.collection.aggregate<{
            _id: string;
            paths: Array<{ path: string; views: number }>;
            totalViews: number;
        }>([
            {
                $match: {
                    'activity.lastSeen': { $gte: since },
                    'activity.sessions': { $exists: true, $ne: [] }
                }
            },
            { $unwind: '$activity.sessions' },
            { $match: { 'activity.sessions.startedAt': { $gte: since } } },
            { $unwind: '$activity.sessions.pages' },
            { $match: { 'activity.sessions.pages.timestamp': { $gte: since } } },
            {
                $group: {
                    _id: {
                        date: this.buildBucketDateExpr('$activity.sessions.pages.timestamp', bucketInterval),
                        path: '$activity.sessions.pages.path'
                    },
                    views: { $sum: 1 }
                }
            },
            { $sort: { '_id.date': 1, views: -1 } },
            {
                $group: {
                    _id: '$_id.date',
                    paths: { $push: { path: '$_id.path', views: '$views' } },
                    totalViews: { $sum: '$views' }
                }
            },
            { $sort: { _id: 1 } }
        ]).toArray();

        const buckets: IPageTrafficBucket[] = results.map(day => {
            const topPaths = day.paths.slice(0, topN);
            const topViews = topPaths.reduce((sum, p) => sum + p.views, 0);

            return {
                date: day._id,
                totalViews: day.totalViews,
                topPaths,
                otherViews: day.totalViews - topViews
            };
        });

        return { days: buckets.length, bucketCount: buckets.length, bucketInterval, buckets };
    }

    /**
     * Get recent individual page view events.
     *
     * Unwinds session page data across all users for the specified time
     * window, returning individual page view events sorted most-recent-first.
     * Capped at the requested limit to prevent unbounded output.
     *
     * @param hours - How many hours back to query (default 24)
     * @param limit - Maximum events to return (default 500)
     * @returns Recent page view events, most recent first
     */
    async getRecentPageViews(hours = 24, limit = 500): Promise<IRecentPageViewsResult> {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const results = await this.collection.aggregate<{
            userId: string;
            path: string;
            timestamp: Date;
        }>([
            {
                $match: {
                    'activity.lastSeen': { $gte: since },
                    'activity.sessions': { $exists: true, $ne: [] }
                }
            },
            { $unwind: '$activity.sessions' },
            { $match: { 'activity.sessions.startedAt': { $gte: since } } },
            { $unwind: '$activity.sessions.pages' },
            { $match: { 'activity.sessions.pages.timestamp': { $gte: since } } },
            {
                $project: {
                    _id: 0,
                    userId: '$id',
                    path: '$activity.sessions.pages.path',
                    timestamp: '$activity.sessions.pages.timestamp'
                }
            },
            { $sort: { timestamp: -1 } },
            { $limit: limit }
        ]).toArray();

        const views = results.map(r => ({
            timestamp: r.timestamp.toISOString(),
            userId: r.userId,
            path: r.path
        }));

        return { count: views.length, views };
    }

    /**
     * Get traffic sources broken into time-interval buckets with optional GSC keywords.
     *
     * Unwinds sessions to group visitors by bucket interval and referrer domain,
     * classifies each source, and merges GSC keyword data when available.
     *
     * @param bucketInterval - Duration per bucket (e.g., '1h', '1d')
     * @param bucketCount - Number of buckets to return (default 14)
     * @param topN - Top sources per bucket (default 15)
     * @returns Daily traffic source buckets with GSC keyword data
     */
    async getTrafficSourcesByDay(bucketInterval: BucketInterval = '1d', bucketCount = 14, topN = 15): Promise<ITrafficSourcesHistory> {
        const since = this.computeBucketSince(bucketInterval, bucketCount);

        const results = await this.collection.aggregate<{
            _id: { date: string; domain: string | null };
            count: number;
        }>([
            {
                $match: {
                    'activity.lastSeen': { $gte: since },
                    'activity.sessions': { $exists: true, $ne: [] }
                }
            },
            { $unwind: '$activity.sessions' },
            { $match: { 'activity.sessions.startedAt': { $gte: since } } },
            {
                $group: {
                    _id: {
                        date: this.buildBucketDateExpr('$activity.sessions.startedAt', bucketInterval),
                        domain: { $ifNull: ['$activity.sessions.referrerDomain', null] },
                        userId: '$_id'
                    }
                }
            },
            {
                $group: {
                    _id: {
                        date: '$_id.date',
                        domain: '$_id.domain'
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.date': 1, count: -1 } }
        ]).toArray();

        const dayMap = new Map<string, IDailyTrafficSourceBucket>();

        for (const row of results) {
            const date = row._id.date;
            if (!dayMap.has(date)) {
                dayMap.set(date, { date, totalVisitors: 0, sources: [] });
            }
            const bucket = dayMap.get(date)!;
            bucket.totalVisitors += row.count;
            if (bucket.sources.length < topN) {
                const source = row._id.domain || 'direct';
                bucket.sources.push({
                    source,
                    category: this.classifyTrafficSource(row._id.domain),
                    count: row.count
                });
            }
        }

        const buckets = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        let keywords: ITrafficSourcesHistory['keywords'] = [];
        if (this.gscService) {
            try {
                if (await this.gscService.isConfigured()) {
                    const { unit, amount } = this.parseBucketInterval(bucketInterval);
                    const gscDays = unit === 'hour' ? Math.ceil((amount * bucketCount) / 24) : amount * bucketCount;
                    const gscData = await this.gscService.getKeywordsByDay(gscDays, 15);
                    keywords = gscData.buckets;
                }
            } catch {
                // GSC unavailable — proceed without keywords
            }
        }

        return { days: buckets.length, bucketCount: buckets.length, bucketInterval, buckets, keywords };
    }

    /**
     * Get geographic distribution broken into time-interval buckets.
     *
     * Unwinds sessions to group visitors by bucket interval and country code.
     *
     * @param bucketInterval - Duration per bucket (e.g., '1h', '1d')
     * @param bucketCount - Number of buckets to return (default 14)
     * @param topN - Top countries per bucket (default 20)
     * @returns Daily geo distribution buckets
     */
    async getGeoDistributionByDay(bucketInterval: BucketInterval = '1d', bucketCount = 14, topN = 20): Promise<IGeoDistributionHistory> {
        const since = this.computeBucketSince(bucketInterval, bucketCount);

        const results = await this.collection.aggregate<{
            _id: { date: string; country: string | null };
            count: number;
        }>([
            {
                $match: {
                    'activity.lastSeen': { $gte: since },
                    'activity.sessions': { $exists: true, $ne: [] }
                }
            },
            { $unwind: '$activity.sessions' },
            { $match: { 'activity.sessions.startedAt': { $gte: since } } },
            {
                $group: {
                    _id: {
                        date: this.buildBucketDateExpr('$activity.sessions.startedAt', bucketInterval),
                        country: { $ifNull: ['$activity.sessions.country', null] },
                        userId: '$_id'
                    }
                }
            },
            {
                $group: {
                    _id: {
                        date: '$_id.date',
                        country: '$_id.country'
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.date': 1, count: -1 } }
        ]).toArray();

        const dayMap = new Map<string, IDailyGeoBucket>();

        for (const row of results) {
            const date = row._id.date;
            if (!dayMap.has(date)) {
                dayMap.set(date, { date, totalVisitors: 0, countries: [] });
            }
            const bucket = dayMap.get(date)!;
            bucket.totalVisitors += row.count;
            if (bucket.countries.length < topN && row._id.country) {
                bucket.countries.push({ country: row._id.country, count: row.count });
            }
        }

        const buckets = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        return { days: buckets.length, bucketCount: buckets.length, bucketInterval, buckets };
    }

    /**
     * Get device breakdown broken into time-interval buckets.
     *
     * Unwinds sessions to group by bucket interval and device category.
     * Device categories are a fixed set (desktop, mobile, tablet, unknown)
     * so no topN cap is needed.
     *
     * @param bucketInterval - Duration per bucket (e.g., '1h', '1d')
     * @param bucketCount - Number of buckets to return (default 14)
     * @returns Device breakdown buckets
     */
    async getDeviceBreakdownByDay(bucketInterval: BucketInterval = '1d', bucketCount = 14): Promise<IDeviceBreakdownHistory> {
        const since = this.computeBucketSince(bucketInterval, bucketCount);

        const results = await this.collection.aggregate<{
            _id: { date: string; device: string };
            count: number;
        }>([
            {
                $match: {
                    'activity.lastSeen': { $gte: since },
                    'activity.sessions': { $exists: true, $ne: [] }
                }
            },
            { $unwind: '$activity.sessions' },
            { $match: { 'activity.sessions.startedAt': { $gte: since } } },
            {
                $group: {
                    _id: {
                        date: this.buildBucketDateExpr('$activity.sessions.startedAt', bucketInterval),
                        device: { $ifNull: ['$activity.sessions.device', 'unknown'] }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.date': 1, count: -1 } }
        ]).toArray();

        const dayMap = new Map<string, IDailyDeviceBucket>();

        for (const row of results) {
            const date = row._id.date;
            if (!dayMap.has(date)) {
                dayMap.set(date, { date, totalSessions: 0, devices: [] });
            }
            const bucket = dayMap.get(date)!;
            bucket.totalSessions += row.count;
            bucket.devices.push({ device: row._id.device, count: row.count });
        }

        const buckets = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        return { days: buckets.length, bucketCount: buckets.length, bucketInterval, buckets };
    }

    /**
     * Get landing page performance broken into time-interval buckets.
     *
     * Unwinds sessions to group by bucket interval and landing page, calculates
     * bounce rate per page (sessions with 1 or fewer pages).
     *
     * @param bucketInterval - Duration per bucket (e.g., '1h', '1d')
     * @param bucketCount - Number of buckets to return (default 14)
     * @param topN - Top landing pages per bucket (default 20)
     * @returns Landing page buckets with bounce counts
     */
    async getLandingPagesByDay(bucketInterval: BucketInterval = '1d', bucketCount = 14, topN = 20): Promise<ILandingPagesHistory> {
        const since = this.computeBucketSince(bucketInterval, bucketCount);

        const results = await this.collection.aggregate<{
            _id: { date: string; landingPage: string };
            entries: number;
            bounces: number;
        }>([
            {
                $match: {
                    'activity.lastSeen': { $gte: since },
                    'activity.sessions': { $exists: true, $ne: [] }
                }
            },
            { $unwind: '$activity.sessions' },
            { $match: { 'activity.sessions.startedAt': { $gte: since } } },
            {
                $group: {
                    _id: {
                        date: this.buildBucketDateExpr('$activity.sessions.startedAt', bucketInterval),
                        landingPage: { $ifNull: ['$activity.sessions.landingPage', '(unknown)'] }
                    },
                    entries: { $sum: 1 },
                    bounces: {
                        $sum: {
                            $cond: [
                                { $lte: [{ $size: { $ifNull: ['$activity.sessions.pages', []] } }, 1] },
                                1, 0
                            ]
                        }
                    }
                }
            },
            { $sort: { '_id.date': 1, entries: -1 } }
        ]).toArray();

        const dayMap = new Map<string, IDailyLandingPageBucket>();

        for (const row of results) {
            const date = row._id.date;
            if (!dayMap.has(date)) {
                dayMap.set(date, { date, totalSessions: 0, pages: [] });
            }
            const bucket = dayMap.get(date)!;
            bucket.totalSessions += row.entries;
            if (bucket.pages.length < topN) {
                bucket.pages.push({
                    path: row._id.landingPage,
                    entries: row.entries,
                    bounces: row.bounces
                });
            }
        }

        const buckets = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        return { days: buckets.length, bucketCount: buckets.length, bucketInterval, buckets };
    }

    /**
     * Get UTM campaign performance broken into time-interval buckets.
     *
     * Unwinds sessions to group by bucket interval and UTM source/medium/campaign.
     *
     * @param bucketInterval - Duration per bucket (e.g., '1h', '1d')
     * @param bucketCount - Number of buckets to return (default 14)
     * @param topN - Top campaigns per bucket (default 10)
     * @returns Campaign performance buckets
     */
    async getCampaignPerformanceByDay(bucketInterval: BucketInterval = '1d', bucketCount = 14, topN = 10): Promise<ICampaignPerformanceHistory> {
        const since = this.computeBucketSince(bucketInterval, bucketCount);

        const results = await this.collection.aggregate<{
            _id: { date: string; source: string; medium: string; campaign: string };
            visitors: number;
        }>([
            {
                $match: {
                    'activity.lastSeen': { $gte: since },
                    'activity.sessions': { $exists: true, $ne: [] }
                }
            },
            { $unwind: '$activity.sessions' },
            {
                $match: {
                    'activity.sessions.startedAt': { $gte: since },
                    'activity.sessions.utm': { $ne: null }
                }
            },
            {
                $group: {
                    _id: {
                        date: this.buildBucketDateExpr('$activity.sessions.startedAt', bucketInterval),
                        source: { $ifNull: ['$activity.sessions.utm.source', '(none)'] },
                        medium: { $ifNull: ['$activity.sessions.utm.medium', '(none)'] },
                        campaign: { $ifNull: ['$activity.sessions.utm.campaign', '(none)'] },
                        userId: '$_id'
                    }
                }
            },
            {
                $group: {
                    _id: {
                        date: '$_id.date',
                        source: '$_id.source',
                        medium: '$_id.medium',
                        campaign: '$_id.campaign'
                    },
                    visitors: { $sum: 1 }
                }
            },
            { $sort: { '_id.date': 1, visitors: -1 } }
        ]).toArray();

        const dayMap = new Map<string, IDailyCampaignBucket>();

        for (const row of results) {
            const date = row._id.date;
            if (!dayMap.has(date)) {
                dayMap.set(date, { date, totalVisitors: 0, campaigns: [] });
            }
            const bucket = dayMap.get(date)!;
            bucket.totalVisitors += row.visitors;
            if (bucket.campaigns.length < topN) {
                bucket.campaigns.push({
                    source: row._id.source,
                    medium: row._id.medium,
                    campaign: row._id.campaign,
                    visitors: row.visitors
                });
            }
        }

        const buckets = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        return { days: buckets.length, bucketCount: buckets.length, bucketInterval, buckets };
    }

    /**
     * Get session duration distribution broken into time-interval buckets.
     *
     * Unwinds sessions and classifies each by duration into buckets:
     * 0-10s, 10-60s, 1-5m, 5-15m, 15m+. Shows engagement depth
     * beyond simple averages.
     *
     * @param bucketInterval - Duration per bucket (e.g., '1h', '1d')
     * @param bucketCount - Number of buckets to return (default 14)
     * @returns Session duration distribution buckets
     */
    async getSessionDurationByDay(bucketInterval: BucketInterval = '1d', bucketCount = 14): Promise<ISessionDurationHistory> {
        const since = this.computeBucketSince(bucketInterval, bucketCount);

        const results = await this.collection.aggregate<{
            _id: string;
            total: number;
            under10s: number;
            s10to60: number;
            m1to5: number;
            m5to15: number;
            over15m: number;
        }>([
            {
                $match: {
                    'activity.lastSeen': { $gte: since },
                    'activity.sessions': { $exists: true, $ne: [] }
                }
            },
            { $unwind: '$activity.sessions' },
            { $match: { 'activity.sessions.startedAt': { $gte: since } } },
            {
                $group: {
                    _id: this.buildBucketDateExpr('$activity.sessions.startedAt', bucketInterval),
                    total: { $sum: 1 },
                    under10s: { $sum: { $cond: [{ $lte: [{ $ifNull: ['$activity.sessions.durationSeconds', 0] }, 10] }, 1, 0] } },
                    s10to60: { $sum: { $cond: [{ $and: [{ $gt: [{ $ifNull: ['$activity.sessions.durationSeconds', 0] }, 10] }, { $lte: [{ $ifNull: ['$activity.sessions.durationSeconds', 0] }, 60] }] }, 1, 0] } },
                    m1to5: { $sum: { $cond: [{ $and: [{ $gt: [{ $ifNull: ['$activity.sessions.durationSeconds', 0] }, 60] }, { $lte: [{ $ifNull: ['$activity.sessions.durationSeconds', 0] }, 300] }] }, 1, 0] } },
                    m5to15: { $sum: { $cond: [{ $and: [{ $gt: [{ $ifNull: ['$activity.sessions.durationSeconds', 0] }, 300] }, { $lte: [{ $ifNull: ['$activity.sessions.durationSeconds', 0] }, 900] }] }, 1, 0] } },
                    over15m: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$activity.sessions.durationSeconds', 0] }, 900] }, 1, 0] } }
                }
            },
            { $sort: { _id: 1 } }
        ]).toArray();

        const buckets: IDailySessionDurationBucket[] = results.map(r => ({
            date: r._id,
            totalSessions: r.total,
            under10s: r.under10s,
            s10to60: r.s10to60,
            m1to5: r.m1to5,
            m5to15: r.m5to15,
            over15m: r.over15m
        }));

        return { days: buckets.length, bucketCount: buckets.length, bucketInterval, buckets };
    }

    /**
     * Get pages-per-session distribution broken into time-interval buckets.
     *
     * Unwinds sessions and classifies each by page count: 1 (bounce),
     * 2-3, 4-6, 7+. Complements bounce rate by showing depth of engagement.
     *
     * @param bucketInterval - Duration per bucket (e.g., '1h', '1d')
     * @param bucketCount - Number of buckets to return (default 14)
     * @returns Pages-per-session distribution buckets
     */
    async getPagesPerSessionByDay(bucketInterval: BucketInterval = '1d', bucketCount = 14): Promise<IPagesPerSessionHistory> {
        const since = this.computeBucketSince(bucketInterval, bucketCount);

        const results = await this.collection.aggregate<{
            _id: string;
            total: number;
            onePage: number;
            twoToThree: number;
            fourToSix: number;
            sevenPlus: number;
        }>([
            {
                $match: {
                    'activity.lastSeen': { $gte: since },
                    'activity.sessions': { $exists: true, $ne: [] }
                }
            },
            { $unwind: '$activity.sessions' },
            { $match: { 'activity.sessions.startedAt': { $gte: since } } },
            {
                $addFields: {
                    _pageCount: { $size: { $ifNull: ['$activity.sessions.pages', []] } }
                }
            },
            {
                $group: {
                    _id: this.buildBucketDateExpr('$activity.sessions.startedAt', bucketInterval),
                    total: { $sum: 1 },
                    onePage: { $sum: { $cond: [{ $lte: ['$_pageCount', 1] }, 1, 0] } },
                    twoToThree: { $sum: { $cond: [{ $and: [{ $gte: ['$_pageCount', 2] }, { $lte: ['$_pageCount', 3] }] }, 1, 0] } },
                    fourToSix: { $sum: { $cond: [{ $and: [{ $gte: ['$_pageCount', 4] }, { $lte: ['$_pageCount', 6] }] }, 1, 0] } },
                    sevenPlus: { $sum: { $cond: [{ $gte: ['$_pageCount', 7] }, 1, 0] } }
                }
            },
            { $sort: { _id: 1 } }
        ]).toArray();

        const buckets: IDailyPagesPerSessionBucket[] = results.map(r => ({
            date: r._id,
            totalSessions: r.total,
            onePage: r.onePage,
            twoToThree: r.twoToThree,
            fourToSix: r.fourToSix,
            sevenPlus: r.sevenPlus
        }));

        return { days: buckets.length, bucketCount: buckets.length, bucketInterval, buckets };
    }

    /**
     * Get new vs returning visitor breakdown by time-interval bucket.
     *
     * Unwinds sessions and classifies each user as new (firstSeen within
     * that bucket) or returning (firstSeen before that bucket).
     *
     * @param bucketInterval - Duration per bucket (e.g., '1h', '1d')
     * @param bucketCount - Number of buckets to return (default 14)
     * @returns New vs returning visitor buckets
     */
    async getNewVsReturningByDay(bucketInterval: BucketInterval = '1d', bucketCount = 14): Promise<INewVsReturningHistory> {
        const since = this.computeBucketSince(bucketInterval, bucketCount);

        const results = await this.collection.aggregate<{
            _id: string;
            total: number;
            newVisitors: number;
            returningVisitors: number;
        }>([
            {
                $match: {
                    'activity.lastSeen': { $gte: since },
                    'activity.sessions': { $exists: true, $ne: [] }
                }
            },
            { $unwind: '$activity.sessions' },
            { $match: { 'activity.sessions.startedAt': { $gte: since } } },
            {
                $group: {
                    _id: {
                        date: this.buildBucketDateExpr('$activity.sessions.startedAt', bucketInterval),
                        userId: '$id'
                    },
                    firstSeen: { $first: '$activity.firstSeen' },
                    sessionDate: { $first: '$activity.sessions.startedAt' }
                }
            },
            {
                $group: {
                    _id: '$_id.date',
                    total: { $sum: 1 },
                    newVisitors: {
                        $sum: {
                            $cond: [
                                { $eq: [
                                    this.buildBucketDateExpr('$firstSeen', bucketInterval),
                                    '$_id.date'
                                ] },
                                1, 0
                            ]
                        }
                    }
                }
            },
            {
                $addFields: {
                    returningVisitors: { $subtract: ['$total', '$newVisitors'] }
                }
            },
            { $sort: { _id: 1 } }
        ]).toArray();

        const buckets: IDailyNewVsReturningBucket[] = results.map(r => ({
            date: r._id,
            totalVisitors: r.total,
            newVisitors: r.newVisitors,
            returningVisitors: r.returningVisitors
        }));

        return { days: buckets.length, bucketCount: buckets.length, bucketInterval, buckets };
    }

    /**
     * Get wallet conversion funnel broken into time-interval buckets.
     *
     * For each bucket, counts unique visitors and how many have wallets
     * connected or verified. Shows conversion rate trends over time.
     *
     * @param bucketInterval - Duration per bucket (e.g., '1h', '1d')
     * @param bucketCount - Number of buckets to return (default 14)
     * @returns Wallet conversion funnel buckets
     */
    async getWalletConversionByDay(bucketInterval: BucketInterval = '1d', bucketCount = 14): Promise<IWalletConversionHistory> {
        const since = this.computeBucketSince(bucketInterval, bucketCount);

        const results = await this.collection.aggregate<{
            _id: string;
            total: number;
            walletsConnected: number;
            walletsVerified: number;
        }>([
            {
                $match: {
                    'activity.lastSeen': { $gte: since },
                    'activity.sessions': { $exists: true, $ne: [] }
                }
            },
            { $unwind: '$activity.sessions' },
            { $match: { 'activity.sessions.startedAt': { $gte: since } } },
            {
                $group: {
                    _id: {
                        date: this.buildBucketDateExpr('$activity.sessions.startedAt', bucketInterval),
                        userId: '$id'
                    },
                    hasWallet: {
                        $first: { $gt: [{ $size: { $ifNull: ['$wallets', []] } }, 0] }
                    },
                    hasVerified: {
                        $first: {
                            $gt: [{
                                $size: {
                                    $filter: {
                                        input: { $ifNull: ['$wallets', []] },
                                        as: 'w',
                                        cond: { $eq: ['$$w.verified', true] }
                                    }
                                }
                            }, 0]
                        }
                    }
                }
            },
            {
                $group: {
                    _id: '$_id.date',
                    total: { $sum: 1 },
                    walletsConnected: { $sum: { $cond: ['$hasWallet', 1, 0] } },
                    walletsVerified: { $sum: { $cond: ['$hasVerified', 1, 0] } }
                }
            },
            { $sort: { _id: 1 } }
        ]).toArray();

        const buckets: IDailyWalletConversionBucket[] = results.map(r => ({
            date: r._id,
            totalVisitors: r.total,
            walletsConnected: r.walletsConnected,
            walletsVerified: r.walletsVerified
        }));

        return { days: buckets.length, bucketCount: buckets.length, bucketInterval, buckets };
    }

    /**
     * Get exit page performance broken into time-interval buckets.
     *
     * Unwinds sessions, extracts the last page viewed in each session,
     * and groups by bucket interval + path. High exit counts on specific pages
     * suggest confusion or dead-ends.
     *
     * @param bucketInterval - Duration per bucket (e.g., '1h', '1d')
     * @param bucketCount - Number of buckets to return (default 14)
     * @param topN - Top exit pages per bucket (default 20)
     * @returns Exit page buckets
     */
    async getExitPagesByDay(bucketInterval: BucketInterval = '1d', bucketCount = 14, topN = 20): Promise<IExitPagesHistory> {
        const since = this.computeBucketSince(bucketInterval, bucketCount);

        const results = await this.collection.aggregate<{
            _id: { date: string; exitPage: string };
            exits: number;
        }>([
            {
                $match: {
                    'activity.lastSeen': { $gte: since },
                    'activity.sessions': { $exists: true, $ne: [] }
                }
            },
            { $unwind: '$activity.sessions' },
            { $match: { 'activity.sessions.startedAt': { $gte: since } } },
            {
                $addFields: {
                    _exitPage: { $arrayElemAt: ['$activity.sessions.pages.path', -1] }
                }
            },
            { $match: { _exitPage: { $ne: null } } },
            {
                $group: {
                    _id: {
                        date: this.buildBucketDateExpr('$activity.sessions.startedAt', bucketInterval),
                        exitPage: '$_exitPage'
                    },
                    exits: { $sum: 1 }
                }
            },
            { $sort: { '_id.date': 1, exits: -1 } }
        ]).toArray();

        const dayMap = new Map<string, IDailyExitPageBucket>();

        for (const row of results) {
            const date = row._id.date;
            if (!dayMap.has(date)) {
                dayMap.set(date, { date, totalSessions: 0, pages: [] });
            }
            const bucket = dayMap.get(date)!;
            bucket.totalSessions += row.exits;
            if (bucket.pages.length < topN) {
                bucket.pages.push({ path: row._id.exitPage, exits: row.exits });
            }
        }

        const buckets = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        return { days: buckets.length, bucketCount: buckets.length, bucketInterval, buckets };
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
        await this.collection.createIndex({ mergedInto: 1 }, { sparse: true });
        await this.collection.createIndex({ 'activity.lastSeen': 1 });
        await this.collection.createIndex({ 'activity.firstSeen': 1 });
        await this.collection.createIndex({ 'activity.sessions.endedAt': 1 });
        await this.collection.createIndex({ 'activity.sessions.startedAt': 1 });
        await this.collection.createIndex({ 'referral.code': 1 }, { unique: true, sparse: true });

        this.logger.info('User indexes created');
    }

    // ==================== Private Helpers ====================

    /**
     * Resolve a UUID to its canonical document in a single DB hit.
     *
     * For non-merged users (99.9% of requests) this is the only fetch
     * needed — callers use the returned document directly instead of
     * doing a separate findOne. For merged users (tombstones) it follows
     * the mergedInto pointer in one additional lookup. Pointer chains are
     * flattened during merge so resolution never exceeds two queries.
     *
     * All mutation methods call this instead of a separate resolve + findOne
     * pair, eliminating the redundant double-fetch.
     *
     * @param userId - UUID that may be a tombstone
     * @returns Canonical document, or null if user does not exist
     */
    private async resolveDocument(userId: string): Promise<IUserDocument | null> {
        const doc = await this.collection.findOne({ id: userId });
        if (!doc) {
            return null;
        }
        if (doc.mergedInto) {
            return this.collection.findOne({ id: doc.mergedInto });
        }
        return doc;
    }

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
            referral: doc.referral ?? null,
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
