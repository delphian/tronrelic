/**
 * @fileoverview Per-group MCP settings: storage, validation, and caching.
 *
 * Each user group carries settings for the MCP tools it grants: scrub secrets
 * from results, serve only to listed IP addresses, allow restricted tools, a
 * switch that turns the group's tools off, and call limits for the calls
 * charged to it. The served tool list reads these on every MCP request, so the
 * service keeps a short-lived copy in memory, the same way the kill switch and
 * the tool approvals do.
 *
 * The `anonymous` group is virtual: it stands for callers of the public
 * endpoint and has no record in the identity module. This service lists it
 * beside the real groups, starts it with conservative limits, and refuses any
 * change that would leave one of them unset.
 */

import type { Filter, UpdateFilter } from 'mongodb';
import type { IDatabaseService, IMcpGroup, IMcpGroupLimits, IMcpGroupPolicy, IMcpGroupPolicyPatch, ISystemLogService, IUserGroupService } from '@/types';
import { MCP_ANONYMOUS_GROUP_ID, MCP_USERS_GROUP_ID, normaliseIpAllowlistEntries } from '@/types';
import { IpAllowlistMatcher, validateIpAllowlist } from './IpAllowlistMatcher.js';

/** Collection holding one policy document per configured group. */
export const MCP_GROUP_POLICIES_COLLECTION = 'module_mcp_group_policies';

/**
 * How long the cached policies are trusted. A change made through this
 * instance clears the copy at once; a change made on another instance reaches
 * this one within the window.
 */
const POLICIES_CACHE_TTL_MS = 5_000;

/**
 * The limits the `anonymous` group starts with. Low enough that a stranger
 * looping on a tool costs little, high enough for a real person asking a
 * handful of questions. An admin can raise them, but never clear them.
 */
export const DEFAULT_ANONYMOUS_LIMITS: Readonly<IMcpGroupLimits> = {
    callsPerMinutePerCaller: 10,
    callsPerDayPerCaller: 200,
    callsPerDayGroup: 5_000
};

/** Limits every real group starts with: none of its own, so the platform ceilings alone apply. */
const NO_GROUP_LIMITS: Readonly<IMcpGroupLimits> = {
    callsPerMinutePerCaller: null,
    callsPerDayPerCaller: null,
    callsPerDayGroup: null
};

/**
 * Highest per-minute limit a group may set. It matches the platform's own
 * per-caller ceiling in the governor's policy engine, which applies whatever a
 * group says, so allowing a higher value here would only mislead the admin.
 */
const MAX_CALLS_PER_MINUTE = 60;

/** Highest day limit a group may set, a sanity bound against a typo with extra zeros. */
const MAX_CALLS_PER_DAY = 10_000_000;

/** The limit fields, in the order validation reports them. */
const LIMIT_KEYS: ReadonlyArray<keyof IMcpGroupLimits> = ['callsPerMinutePerCaller', 'callsPerDayPerCaller', 'callsPerDayGroup'];

/** Stored shape of a group's policy. */
interface IMcpGroupPolicyDocument {
    groupId: string;
    allowRestrictedTools: boolean;
    scrubSecrets: boolean;
    ipAllowlistEnabled: boolean;
    ipAllowlist: string[];
    /** Absent on documents written before groups could be switched off; read as on. */
    enabled?: boolean;
    /** Absent on documents written before groups had limits; read as the group's defaults. */
    limits?: Partial<IMcpGroupLimits>;
    updatedAt?: Date;
    updatedBy?: string;
}

/** Error thrown when an admin asks for a policy that cannot be stored. */
export class McpGroupPolicyError extends Error {
    /**
     * @param message - Sentence explaining the refusal, returned to the admin.
     * @param status - HTTP status the controller should answer with.
     */
    constructor(message: string, readonly status: 400 | 404 | 409) {
        super(message);
        this.name = 'McpGroupPolicyError';
    }
}

/**
 * Return the limits a group starts with: conservative ones for `anonymous`,
 * none of its own for every real group.
 *
 * @param groupId - The group the limits belong to.
 * @returns A fresh copy of the group's default limits.
 */
export function defaultGroupLimits(groupId: string): IMcpGroupLimits {
    return { ...(groupId === MCP_ANONYMOUS_GROUP_ID ? DEFAULT_ANONYMOUS_LIMITS : NO_GROUP_LIMITS) };
}

/**
 * Build the policy a group has before an admin configures it: every
 * protection off, the group switched on, and its default limits.
 *
 * @param groupId - The group the policy belongs to.
 * @returns The group's starting policy.
 */
export function defaultGroupPolicy(groupId: string): IMcpGroupPolicy {
    return {
        groupId,
        allowRestrictedTools: false,
        scrubSecrets: false,
        ipAllowlistEnabled: false,
        ipAllowlist: [],
        enabled: true,
        limits: defaultGroupLimits(groupId)
    };
}

/**
 * Decide whether a change to one limit lets callers make more calls. Clearing
 * a limit or raising it widens; setting or lowering one narrows.
 */
function limitWidens(previous: number | null, next: number | null): boolean {
    return previous !== null && (next === null || next > previous);
}

/**
 * Decide whether moving from one policy to another gives anyone more access.
 *
 * The admin API lets the `ADMIN_API_TOKEN` service path narrow access during
 * an incident, but every widening needs a signed-in admin so a named person
 * stands behind it. A change widens access when it allows restricted tools,
 * turns scrubbing off, turns the IP allowlist off, adds an address to an
 * allowlist that stays on, switches the group back on, or raises or clears a
 * limit. Removing addresses, switching a protection or the group off, and
 * setting or lowering a limit only narrow.
 *
 * @param previous - The policy before the change.
 * @param next - The policy after the change.
 * @returns True when the change widens access.
 */
export function isWideningPolicyChange(previous: IMcpGroupPolicy, next: IMcpGroupPolicy): boolean {
    const allowsRestricted = !previous.allowRestrictedTools && next.allowRestrictedTools;
    const stopsScrubbing = previous.scrubSecrets && !next.scrubSecrets;
    const dropsAllowlist = previous.ipAllowlistEnabled && !next.ipAllowlistEnabled;
    const addsAddresses = previous.ipAllowlistEnabled && next.ipAllowlistEnabled
        && next.ipAllowlist.some(entry => !previous.ipAllowlist.includes(entry));
    const switchesOn = !previous.enabled && next.enabled;
    const loosensLimit = LIMIT_KEYS.some(key => limitWidens(previous.limits[key], next.limits[key]));
    return allowsRestricted || stopsScrubbing || dropsAllowlist || addsAddresses || switchesOn || loosensLimit;
}

/**
 * List what is wrong with a set of limits, as sentences for the admin.
 *
 * Each limit must be a whole number of at least 1, the per-minute limit no
 * higher than the platform ceiling, and the day limits no higher than a sanity
 * bound. The `anonymous` group must set every limit, because its callers are
 * strangers and an unset limit would leave only the platform ceiling.
 *
 * @param groupId - The group the limits are for.
 * @param limits - The limits to check.
 * @returns One sentence per problem, empty when the limits are valid.
 */
export function validateGroupLimits(groupId: string, limits: IMcpGroupLimits): string[] {
    const problems: string[] = [];
    for (const key of LIMIT_KEYS) {
        const value = limits[key];
        const max = key === 'callsPerMinutePerCaller' ? MAX_CALLS_PER_MINUTE : MAX_CALLS_PER_DAY;
        if (value === null) {
            if (groupId === MCP_ANONYMOUS_GROUP_ID) {
                problems.push(`The anonymous group must keep a value for ${key}, because its callers have not signed in.`);
            }
        } else if (!Number.isInteger(value) || value < 1 || value > max) {
            problems.push(`${key} must be a whole number from 1 to ${max.toLocaleString('en-US')}.`);
        }
    }
    return problems;
}

/**
 * Reads, validates, and writes the per-group MCP settings.
 */
export class McpGroupPolicyService {
    /** Policies last read from the database, keyed by group id, and when they were read. */
    private cache: { policies: Map<string, IMcpGroupPolicy>; readAt: number } | null = null;

    /**
     * Counts writes made through this instance. A read already in flight when
     * an admin tightened a policy may return the old one, and caching it would
     * keep the old setting for another cache window, so the read skips its
     * cache write when this counter moved.
     */
    private generation = 0;

    /** IP matchers keyed by the policy object they were built from, so each list is parsed once. */
    private readonly matchers = new WeakMap<IMcpGroupPolicy, IpAllowlistMatcher>();

    /**
     * @param database - Core database service, for the policies collection.
     * @param userGroups - Group service, used to list groups and to refuse a
     *   policy for a group that does not exist.
     * @param logger - Module logger, used to record every change.
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly userGroups: Pick<IUserGroupService, 'listGroups' | 'getGroup'>,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Create the unique index on group id. Called once from module init.
     *
     * @returns Resolves when the index exists.
     */
    async createIndexes(): Promise<void> {
        await this.database.createIndex(MCP_GROUP_POLICIES_COLLECTION, { groupId: 1 }, { unique: true });
    }

    /**
     * Return every stored policy keyed by group id, reusing the last read when
     * it is young enough for the caller. A group with no stored policy is
     * absent from the map; use {@link policyFor} to get its defaults.
     *
     * @param maxAgeMs - How old a cached read the caller accepts. The endpoint
     *   passes the cache window; the admin page passes 0 to always read fresh.
     * @returns The stored policies.
     */
    async getPolicies(maxAgeMs: number = POLICIES_CACHE_TTL_MS): Promise<Map<string, IMcpGroupPolicy>> {
        const now = Date.now();
        let policies: Map<string, IMcpGroupPolicy>;
        if (this.cache && now - this.cache.readAt < maxAgeMs) {
            policies = this.cache.policies;
        } else {
            const generation = this.generation;
            const docs = await this.database.getCollection<IMcpGroupPolicyDocument>(MCP_GROUP_POLICIES_COLLECTION).find({}).toArray();
            policies = new Map(docs.map(doc => [doc.groupId, toPolicy(doc)]));
            if (generation === this.generation) {
                this.cache = { policies, readAt: now };
            }
        }
        return policies;
    }

    /**
     * Look up one group's policy in a map from {@link getPolicies}, falling
     * back to the defaults when the group has never been configured.
     *
     * @param policies - The stored policies.
     * @param groupId - The group to look up.
     * @returns The group's policy.
     */
    policyFor(policies: Map<string, IMcpGroupPolicy>, groupId: string): IMcpGroupPolicy {
        return policies.get(groupId) ?? defaultGroupPolicy(groupId);
    }

    /**
     * Decide whether a group's IP allowlist admits a request address.
     *
     * @param policy - The group's policy.
     * @param ip - The request address, or undefined when unknown.
     * @returns True when the allowlist is off, or on and the address matches.
     */
    allowsAddress(policy: IMcpGroupPolicy, ip: string | undefined): boolean {
        let allowed = true;
        if (policy.ipAllowlistEnabled) {
            let matcher = this.matchers.get(policy);
            if (!matcher) {
                matcher = new IpAllowlistMatcher(policy.ipAllowlist);
                this.matchers.set(policy, matcher);
            }
            allowed = matcher.allows(ip);
        }
        return allowed;
    }

    /**
     * List every user group with its MCP settings, for the admin page.
     * `mcp-users` comes first because it is the group every MCP user is in,
     * then the virtual `anonymous` group, then the rest in the identity
     * module's order.
     *
     * A real group stored under the reserved id `anonymous` (created before
     * the id was reserved) is left out, because the virtual group already
     * stands under that id; startup logs a warning about it.
     *
     * @returns One row per group.
     */
    async listGroups(): Promise<IMcpGroup[]> {
        const [groups, policies] = await Promise.all([this.userGroups.listGroups(), this.getPolicies(0)]);
        const real: IMcpGroup[] = groups
            .filter(group => group.id !== MCP_ANONYMOUS_GROUP_ID)
            .map(group => ({
                id: group.id,
                name: group.name,
                description: group.description,
                isGateGroup: group.id === MCP_USERS_GROUP_ID,
                isAnonymous: false,
                policy: this.policyFor(policies, group.id)
            }));
        const anonymous: IMcpGroup = {
            id: MCP_ANONYMOUS_GROUP_ID,
            name: 'Anonymous (no sign-in)',
            description: 'Callers of the public endpoint who have not signed in. Only tools marked public can be granted, and every limit must be set.',
            isGateGroup: false,
            isAnonymous: true,
            policy: this.policyFor(policies, MCP_ANONYMOUS_GROUP_ID)
        };
        const gate = real.filter(group => group.isGateGroup);
        const others = real.filter(group => !group.isGateGroup);
        return [...gate, anonymous, ...others];
    }

    /**
     * Decide whether a group id names a group tools can be granted to: a real
     * group the identity module knows, or the virtual `anonymous` group.
     *
     * @param groupId - The group id to check.
     * @returns True when the group exists.
     */
    async groupExists(groupId: string): Promise<boolean> {
        return groupId === MCP_ANONYMOUS_GROUP_ID || (await this.userGroups.getGroup(groupId)) !== null;
    }

    /**
     * Work out and validate the policy an admin's change would produce,
     * without storing it.
     *
     * The merged policy is validated as a whole: `mcp-users` and `anonymous`
     * can never allow restricted tools, every allowlist entry must parse, the
     * allowlist cannot be switched on while empty (that would cut every member
     * off from the group's tools with nothing on screen to explain why), and
     * the limits must pass {@link validateGroupLimits}.
     *
     * @param groupId - The group being configured.
     * @param patch - The settings to change. Within `limits`, an omitted limit
     *   keeps its stored value and `null` clears it.
     * @returns The policy before and after the change, so the caller can tell
     *   whether it widened access and whether restricted tools were switched off.
     * @throws {McpGroupPolicyError} 404 for an unknown group, 400 for an invalid policy.
     */
    async preview(groupId: string, patch: IMcpGroupPolicyPatch): Promise<{ previous: IMcpGroupPolicy; next: IMcpGroupPolicy }> {
        if (!(await this.groupExists(groupId))) {
            throw new McpGroupPolicyError(`User group "${groupId}" does not exist.`, 404);
        }
        const previous = this.policyFor(await this.getPolicies(0), groupId);
        const next: IMcpGroupPolicy = {
            groupId,
            allowRestrictedTools: patch.allowRestrictedTools ?? previous.allowRestrictedTools,
            scrubSecrets: patch.scrubSecrets ?? previous.scrubSecrets,
            ipAllowlistEnabled: patch.ipAllowlistEnabled ?? previous.ipAllowlistEnabled,
            ipAllowlist: patch.ipAllowlist ? normaliseIpAllowlistEntries(patch.ipAllowlist) : previous.ipAllowlist,
            enabled: patch.enabled ?? previous.enabled,
            limits: mergeLimits(previous.limits, patch.limits)
        };
        const problems = [...validateIpAllowlist(next.ipAllowlist), ...validateGroupLimits(groupId, next.limits)];
        if (groupId === MCP_USERS_GROUP_ID && next.allowRestrictedTools) {
            problems.unshift('The mcp-users group is every MCP user, so it can never be allowed restricted tools. Allow them on a narrower group instead.');
        }
        if (groupId === MCP_ANONYMOUS_GROUP_ID && next.allowRestrictedTools) {
            problems.unshift('The anonymous group is anyone on the internet, so it can never be allowed restricted tools.');
        }
        if (next.ipAllowlistEnabled && next.ipAllowlist.length === 0) {
            problems.push('Add at least one address or range before turning the IP allowlist on.');
        }
        if (problems.length > 0) {
            throw new McpGroupPolicyError(problems.join(' '), 400);
        }
        return { previous, next };
    }

    /**
     * Store a policy produced by {@link preview}.
     *
     * Kept separate from validation so the controller can check whether the
     * change widens access, and refuse it on the service-token path, before
     * anything is written.
     *
     * When `previous` is given, only the settings that differ from it are
     * written. Two admins changing different settings at the same time each
     * preview from the same stored policy; writing every field would let the
     * later save silently put back the setting the earlier one changed, such
     * as turning scrubbing off again, and that reversal would never pass the
     * widening check that guards the service-token path.
     *
     * Two changes to the same setting need more than that. The widening check
     * runs against the policy `preview` read, so a change that only narrows
     * what it read can still widen what is stored by the time it lands:
     * narrowing an IP allowlist from `[A, B]` to `[A]` puts `A` back if an
     * admin replaced the list with `[C]` in between, and no signed-in admin
     * stands behind that. Each changed setting is therefore written only while
     * it still holds the previewed value, and a change that lost the race is
     * refused so the admin reads the current settings and decides again.
     *
     * @param next - The validated policy to store.
     * @param actor - Better Auth user id of the admin, or undefined on the service-token path.
     * @param previous - The policy {@link preview} merged the change into, so
     *   only the settings this change touched are overwritten, and only while
     *   they still hold the values the change was previewed against. Omit to
     *   write every setting unconditionally.
     * @returns The policy as stored, read back so it includes any setting
     *   another admin changed in the meantime.
     * @throws {McpGroupPolicyError} 409 when another writer changed one of the
     *   settings this change touches after {@link preview} read them.
     */
    async save(next: IMcpGroupPolicy, actor: string | undefined, previous?: IMcpGroupPolicy): Promise<IMcpGroupPolicy> {
        const updatedAt = new Date();
        const settings = {
            allowRestrictedTools: next.allowRestrictedTools,
            scrubSecrets: next.scrubSecrets,
            ipAllowlistEnabled: next.ipAllowlistEnabled,
            ipAllowlist: next.ipAllowlist,
            enabled: next.enabled,
            limits: next.limits
        };
        const changed: Partial<typeof settings> = {};
        for (const key of Object.keys(settings) as Array<keyof typeof settings>) {
            const same = previous !== undefined && JSON.stringify(previous[key]) === JSON.stringify(settings[key]);
            if (!same) {
                Object.assign(changed, { [key]: settings[key] });
            }
        }
        const collection = this.database.getCollection<IMcpGroupPolicyDocument>(MCP_GROUP_POLICIES_COLLECTION);
        // A change without a named actor clears the stored `updatedBy`, so the
        // page never credits the previous admin with a change they did not make.
        const update: UpdateFilter<IMcpGroupPolicyDocument> = {
            $set: { groupId: next.groupId, ...changed, updatedAt, ...(actor ? { updatedBy: actor } : {}) },
            ...(actor ? {} : { $unset: { updatedBy: '' } })
        };
        if (previous === undefined) {
            await collection.updateOne({ groupId: next.groupId }, update, { upsert: true });
        } else {
            // A group nobody has configured has no document, and `preview`
            // reported the defaults for it. Storing those values first gives
            // the guarded write below something to compare against, so
            // "matched nothing" can only mean the stored settings moved.
            await collection.updateOne(
                { groupId: next.groupId },
                {
                    $setOnInsert: {
                        groupId: next.groupId,
                        allowRestrictedTools: previous.allowRestrictedTools,
                        scrubSecrets: previous.scrubSecrets,
                        ipAllowlistEnabled: previous.ipAllowlistEnabled,
                        ipAllowlist: previous.ipAllowlist,
                        enabled: previous.enabled,
                        limits: previous.limits
                    }
                },
                { upsert: true }
            );
            // A document written before groups could be switched off or carry
            // limits lacks those fields, and `preview` reported their defaults.
            // Store the defaults first, as above, so the equality checks below
            // compare against real values instead of failing on a missing field.
            await collection.updateOne({ groupId: next.groupId, enabled: { $exists: false } }, { $set: { enabled: previous.enabled } });
            await collection.updateOne({ groupId: next.groupId, limits: { $exists: false } }, { $set: { limits: previous.limits } });
            // Compare and swap: the write lands only while every setting it
            // changes still holds the value `preview` read. Settings this change
            // leaves alone stay out of the condition, so two admins can still
            // change different settings at once.
            const expected: Filter<IMcpGroupPolicyDocument> = { groupId: next.groupId };
            for (const key of Object.keys(changed) as Array<keyof typeof settings>) {
                Object.assign(expected, { [key]: previous[key] });
            }
            const result = await collection.updateOne(expected, update);
            if (result.matchedCount === 0) {
                throw new McpGroupPolicyError(
                    'Another admin changed one of these settings while this change was being prepared. Reload the page and make the change again.',
                    409
                );
            }
        }
        this.generation++;
        this.cache = null;
        this.logger.warn(
            {
                groupId: next.groupId,
                allowRestrictedTools: next.allowRestrictedTools,
                scrubSecrets: next.scrubSecrets,
                ipAllowlistEnabled: next.ipAllowlistEnabled,
                ipAllowlistEntries: next.ipAllowlist.length,
                enabled: next.enabled,
                limits: next.limits,
                actor: actor ?? 'unattributed'
            },
            `MCP group policy changed: ${next.groupId}`
        );
        const stored = await collection.findOne({ groupId: next.groupId });
        return stored
            ? toPolicy(stored)
            : { ...next, updatedAt: updatedAt.toISOString(), ...(actor ? { updatedBy: actor } : {}) };
    }

    /**
     * Remove a deleted group's stored policy. Called from the
     * `http.groupDeleted` hook.
     *
     * Group ids can be reused. Without this, a new group created under the
     * same id would start with the old group's settings, including "allow
     * restricted tools", which otherwise only a signed-in admin can switch on.
     *
     * @param groupId - The group that was deleted.
     * @returns True when a stored policy was removed.
     */
    async deleteForGroup(groupId: string): Promise<boolean> {
        const removed = await this.database.deleteMany(MCP_GROUP_POLICIES_COLLECTION, { groupId });
        this.generation++;
        this.cache = null;
        if (removed > 0) {
            this.logger.warn({ groupId }, `MCP group policy removed with deleted group ${groupId}`);
        }
        return removed > 0;
    }
}

/**
 * Convert a stored document into the public policy shape.
 *
 * @param doc - The stored policy document.
 * @returns The policy with dates as ISO strings and missing fields defaulted.
 */
function toPolicy(doc: IMcpGroupPolicyDocument): IMcpGroupPolicy {
    const policy: IMcpGroupPolicy = {
        groupId: doc.groupId,
        allowRestrictedTools: doc.allowRestrictedTools === true && doc.groupId !== MCP_USERS_GROUP_ID && doc.groupId !== MCP_ANONYMOUS_GROUP_ID,
        scrubSecrets: doc.scrubSecrets === true,
        ipAllowlistEnabled: doc.ipAllowlistEnabled === true,
        ipAllowlist: Array.isArray(doc.ipAllowlist) ? doc.ipAllowlist.filter(entry => typeof entry === 'string') : [],
        enabled: doc.enabled !== false,
        limits: storedLimits(doc.groupId, doc.limits)
    };
    if (doc.updatedAt) {
        policy.updatedAt = new Date(doc.updatedAt).toISOString();
    }
    if (doc.updatedBy) {
        policy.updatedBy = doc.updatedBy;
    }
    return policy;
}

/**
 * Read stored limits into a complete set, falling back to the group's defaults
 * for any limit that is missing or not a usable number.
 *
 * A document written before limits existed has none, and a hand-edited one
 * may hold junk. Falling back to the defaults, rather than to "no limit",
 * keeps the `anonymous` group capped whatever the stored document says.
 *
 * @param groupId - The group the limits belong to.
 * @param stored - The limits as stored, possibly absent or partial.
 * @returns A complete set of limits.
 */
function storedLimits(groupId: string, stored: Partial<IMcpGroupLimits> | undefined): IMcpGroupLimits {
    const defaults = defaultGroupLimits(groupId);
    const limits = { ...defaults };
    for (const key of LIMIT_KEYS) {
        const value = stored?.[key];
        const usable = typeof value === 'number' && Number.isInteger(value) && value >= 1;
        const clearable = value === null && groupId !== MCP_ANONYMOUS_GROUP_ID;
        if (usable || clearable) {
            limits[key] = value as number | null;
        }
    }
    return limits;
}

/**
 * Apply an admin's limit changes to the current limits. An omitted limit keeps
 * its current value and `null` clears it, so the admin page can change one
 * limit without resending the others.
 *
 * @param current - The limits before the change.
 * @param patch - The limits to change, possibly absent.
 * @returns The limits after the change, in a fixed key order so stored
 *   documents compare equal when their values do.
 */
function mergeLimits(current: IMcpGroupLimits, patch: Partial<IMcpGroupLimits> | undefined): IMcpGroupLimits {
    const merged = {} as IMcpGroupLimits;
    for (const key of LIMIT_KEYS) {
        merged[key] = patch && key in patch && patch[key] !== undefined ? patch[key] as number | null : current[key];
    }
    return merged;
}
