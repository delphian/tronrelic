/**
 * @fileoverview Persisted notification state: per-user preferences, admin
 * policy, and the audit history. These shapes cross the wire between the
 * notifications module's REST surface and its frontend; the dispatch pipeline
 * reads preferences and policy on every blast and appends an audit record.
 *
 * Unlike {@link import('./INotificationService.js').INotificationCategory},
 * which is code declared at boot, everything here is data: a category's
 * existence is code, but its admin enable-state, a user's opt-outs, and the
 * record of what was sent all persist.
 */

import type { NotificationSeverity, INotificationAudience, INotificationChannelTally } from './INotificationService.js';

/**
 * One user's notification preferences, keyed by Better Auth user id. The
 * dispatch layer reads this per recipient before delivering on any channel.
 */
export interface INotificationPreferences {
    /** Better Auth user id this preference set belongs to. */
    userId: string;
    /** Global mute — suppresses every mutable category across every channel. */
    mutedAll: boolean;
    /**
     * Per-(category, channel) opt-in overrides. A missing entry falls back to
     * the category's `channelDefaults`. `overrides[categoryId][channelId] === false`
     * silences that pairing for this user.
     */
    overrides: Record<string, Record<string, boolean>>;
}

/**
 * Patch shape accepted by the user preferences endpoint. Any omitted field is
 * left unchanged; `overrides` is shallow-merged at the category level.
 */
export interface INotificationPreferenceUpdate {
    /** New global-mute state, when changing it. */
    mutedAll?: boolean;
    /** Category→channel→enabled overrides to merge in. */
    overrides?: Record<string, Record<string, boolean>>;
}

/**
 * Admin global policy — channel and category kill switches. A `false` entry
 * disables that channel or category for *everyone*, evaluated before per-user
 * preferences. A missing entry means "enabled" (the default-on stance).
 */
export interface INotificationPolicy {
    /** channelId → enabled. Missing = enabled. */
    channels: Record<string, boolean>;
    /** categoryId → enabled. Missing = enabled. */
    categories: Record<string, boolean>;
}

/**
 * One audit row: a durable record of a single blast. Labels and audience are
 * *snapshots* taken at send time so the history survives a plugin (and its
 * category) being disabled or uninstalled later.
 */
export interface INotificationAuditRecord {
    /** Audit record id. */
    id: string;
    /** Category id that fired. */
    categoryId: string;
    /** Category label snapshot at send time. */
    categoryLabel: string;
    /** Owning source id snapshot (module/plugin). */
    source: string;
    /** Severity of the blast. */
    severity: NotificationSeverity;
    /** Headline snapshot. */
    title: string;
    /** Body snapshot, when present. */
    body?: string;
    /** Audience snapshot resolved for the blast. */
    audience: INotificationAudience;
    /** Total recipients resolved. */
    recipientCount: number;
    /** Total (recipient × channel) suppressions by policy/preference. */
    suppressedCount: number;
    /** Per-channel delivered/suppressed tallies. */
    channels: INotificationChannelTally[];
    /** Optional human-readable attribution (e.g. the firing prompt id). */
    firedBy?: string;
    /** When the blast occurred. */
    createdAt: Date;
}

/**
 * Query filter for the admin history endpoint. All fields optional; omitted
 * fields do not constrain the result.
 */
export interface INotificationAuditQuery {
    /** Restrict to one category id. */
    categoryId?: string;
    /** Restrict to one source id. */
    source?: string;
    /** Max rows to return (the service caps this). */
    limit?: number;
    /** Rows to skip, for pagination. */
    skip?: number;
}
