/**
 * @fileoverview Per-group MCP settings: storage, validation, and caching.
 *
 * Each user group can carry three opt-in settings for the MCP tools it grants:
 * scrub secrets from results, serve only to listed IP addresses, and allow
 * restricted tools. All three start off. The served tool list reads these on
 * every MCP request, so the service keeps a short-lived copy in memory, the
 * same way the kill switch and the tool approvals do.
 */

import type { IDatabaseService, IMcpGroup, IMcpGroupPolicy, IMcpGroupPolicyPatch, ISystemLogService, IUserGroupService } from '@/types';
import { MCP_USERS_GROUP_ID, normaliseIpAllowlistEntries } from '@/types';
import { IpAllowlistMatcher, validateIpAllowlist } from './IpAllowlistMatcher.js';

/** Collection holding one policy document per configured group. */
export const MCP_GROUP_POLICIES_COLLECTION = 'module_mcp_group_policies';

/**
 * How long the cached policies are trusted. A change made through this
 * instance clears the copy at once; a change made on another instance reaches
 * this one within the window.
 */
const POLICIES_CACHE_TTL_MS = 5_000;

/** Stored shape of a group's policy. */
interface IMcpGroupPolicyDocument {
    groupId: string;
    allowRestrictedTools: boolean;
    scrubSecrets: boolean;
    ipAllowlistEnabled: boolean;
    ipAllowlist: string[];
    updatedAt?: Date;
    updatedBy?: string;
}

/** Error thrown when an admin asks for a policy that cannot be stored. */
export class McpGroupPolicyError extends Error {
    /**
     * @param message - Sentence explaining the refusal, returned to the admin.
     * @param status - HTTP status the controller should answer with.
     */
    constructor(message: string, readonly status: 400 | 404) {
        super(message);
        this.name = 'McpGroupPolicyError';
    }
}

/**
 * Build the policy a group has before an admin configures it: everything off.
 *
 * @param groupId - The group the policy belongs to.
 * @returns A policy with every setting off.
 */
export function defaultGroupPolicy(groupId: string): IMcpGroupPolicy {
    return { groupId, allowRestrictedTools: false, scrubSecrets: false, ipAllowlistEnabled: false, ipAllowlist: [] };
}

/**
 * Decide whether moving from one policy to another gives anyone more access.
 *
 * The admin API lets the `ADMIN_API_TOKEN` service path narrow access during
 * an incident, but every widening needs a signed-in admin so a named person
 * stands behind it. A change widens access when it allows restricted tools,
 * turns scrubbing off, turns the IP allowlist off, or adds an address to an
 * allowlist that stays on. Removing addresses or switching a protection on
 * only narrows.
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
    return allowsRestricted || stopsScrubbing || dropsAllowlist || addsAddresses;
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
     * `mcp-users` comes first because it is the group every MCP user is in.
     *
     * @returns One row per group.
     */
    async listGroups(): Promise<IMcpGroup[]> {
        const [groups, policies] = await Promise.all([this.userGroups.listGroups(), this.getPolicies(0)]);
        return groups
            .map(group => ({
                id: group.id,
                name: group.name,
                description: group.description,
                isGateGroup: group.id === MCP_USERS_GROUP_ID,
                policy: this.policyFor(policies, group.id)
            }))
            .sort((a, b) => Number(b.isGateGroup) - Number(a.isGateGroup));
    }

    /**
     * Work out and validate the policy an admin's change would produce,
     * without storing it.
     *
     * The merged policy is validated as a whole: `mcp-users` can never allow
     * restricted tools, every allowlist entry must parse, and the allowlist
     * cannot be switched on while empty, because that would cut every member
     * off from the group's tools with nothing on screen to explain why.
     *
     * @param groupId - The group being configured.
     * @param patch - The settings to change.
     * @returns The policy before and after the change, so the caller can tell
     *   whether it widened access and whether restricted tools were switched off.
     * @throws {McpGroupPolicyError} 404 for an unknown group, 400 for an invalid policy.
     */
    async preview(groupId: string, patch: IMcpGroupPolicyPatch): Promise<{ previous: IMcpGroupPolicy; next: IMcpGroupPolicy }> {
        if (!(await this.userGroups.getGroup(groupId))) {
            throw new McpGroupPolicyError(`User group "${groupId}" does not exist.`, 404);
        }
        const previous = this.policyFor(await this.getPolicies(0), groupId);
        const next: IMcpGroupPolicy = {
            groupId,
            allowRestrictedTools: patch.allowRestrictedTools ?? previous.allowRestrictedTools,
            scrubSecrets: patch.scrubSecrets ?? previous.scrubSecrets,
            ipAllowlistEnabled: patch.ipAllowlistEnabled ?? previous.ipAllowlistEnabled,
            ipAllowlist: patch.ipAllowlist ? normaliseIpAllowlistEntries(patch.ipAllowlist) : previous.ipAllowlist
        };
        const problems = validateIpAllowlist(next.ipAllowlist);
        if (groupId === MCP_USERS_GROUP_ID && next.allowRestrictedTools) {
            problems.unshift('The mcp-users group is every MCP user, so it can never be allowed restricted tools. Allow them on a narrower group instead.');
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
     * written, and the others are written only if no document exists yet.
     * Two admins changing different settings at the same time each preview
     * from the same stored policy; writing every field would let the later
     * save silently put back the setting the earlier one changed, such as
     * turning scrubbing off again, and that reversal would never pass the
     * widening check that guards the service-token path.
     *
     * @param next - The validated policy to store.
     * @param actor - Better Auth user id of the admin, or undefined on the service-token path.
     * @param previous - The policy {@link preview} merged the change into, so
     *   only the settings this change touched are overwritten. Omit to write
     *   every setting.
     * @returns The policy as stored, read back so it includes any setting
     *   another admin changed in the meantime.
     */
    async save(next: IMcpGroupPolicy, actor: string | undefined, previous?: IMcpGroupPolicy): Promise<IMcpGroupPolicy> {
        const updatedAt = new Date();
        const settings = {
            allowRestrictedTools: next.allowRestrictedTools,
            scrubSecrets: next.scrubSecrets,
            ipAllowlistEnabled: next.ipAllowlistEnabled,
            ipAllowlist: next.ipAllowlist
        };
        const changed: Partial<typeof settings> = {};
        const unchanged: Partial<typeof settings> = {};
        for (const key of Object.keys(settings) as Array<keyof typeof settings>) {
            const same = previous !== undefined && JSON.stringify(previous[key]) === JSON.stringify(settings[key]);
            Object.assign(same ? unchanged : changed, { [key]: settings[key] });
        }
        const set = { groupId: next.groupId, ...changed, updatedAt, ...(actor ? { updatedBy: actor } : {}) };
        const collection = this.database.getCollection<IMcpGroupPolicyDocument>(MCP_GROUP_POLICIES_COLLECTION);
        // A change without a named actor clears the stored `updatedBy`, so the
        // page never credits the previous admin with a change they did not make.
        await collection.updateOne(
            { groupId: next.groupId },
            {
                $set: set,
                ...(Object.keys(unchanged).length > 0 ? { $setOnInsert: unchanged } : {}),
                ...(actor ? {} : { $unset: { updatedBy: '' } })
            },
            { upsert: true }
        );
        this.generation++;
        this.cache = null;
        this.logger.warn(
            {
                groupId: next.groupId,
                allowRestrictedTools: next.allowRestrictedTools,
                scrubSecrets: next.scrubSecrets,
                ipAllowlistEnabled: next.ipAllowlistEnabled,
                ipAllowlistEntries: next.ipAllowlist.length,
                actor: actor ?? 'unattributed'
            },
            `MCP group policy changed: ${next.groupId}`
        );
        const stored = await collection.findOne({ groupId: next.groupId });
        return stored
            ? toPolicy(stored)
            : { ...next, updatedAt: updatedAt.toISOString(), ...(actor ? { updatedBy: actor } : {}) };
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
        allowRestrictedTools: doc.allowRestrictedTools === true && doc.groupId !== MCP_USERS_GROUP_ID,
        scrubSecrets: doc.scrubSecrets === true,
        ipAllowlistEnabled: doc.ipAllowlistEnabled === true,
        ipAllowlist: Array.isArray(doc.ipAllowlist) ? doc.ipAllowlist.filter(entry => typeof entry === 'string') : []
    };
    if (doc.updatedAt) {
        policy.updatedAt = new Date(doc.updatedAt).toISOString();
    }
    if (doc.updatedBy) {
        policy.updatedBy = doc.updatedBy;
    }
    return policy;
}
