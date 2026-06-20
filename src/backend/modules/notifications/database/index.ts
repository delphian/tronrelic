/**
 * @fileoverview Database-layer barrel for the notifications module. Exposes the
 * three MongoDB document shapes the services persist: per-user preferences, the
 * singleton admin policy, and the audit history.
 */

import type { ObjectId } from 'mongodb';
import type {
    NotificationSeverity,
    INotificationAudience,
    INotificationChannelTally
} from '@/types';

/**
 * Per-user preference row. Keyed by Better Auth user id (unique). The dispatch
 * pipeline reads this per recipient before delivering on any channel; a missing
 * row means "all category defaults, nothing muted".
 */
export interface INotificationPreferencesDocument {
    _id?: ObjectId;
    /** Better Auth user id this row belongs to. */
    userId: string;
    /** Global mute — suppresses every mutable category on every channel. */
    mutedAll: boolean;
    /** category id → channel id → enabled. Missing entry falls back to the category default. */
    overrides: Record<string, Record<string, boolean>>;
    /** Last write time. */
    updatedAt: Date;
}

/**
 * The single admin-policy document. A `false` entry is a global kill switch for
 * that channel or category; a missing entry means enabled (default-on).
 */
export interface INotificationPolicyDocument {
    /** Fixed sentinel id — exactly one policy document exists. */
    _id: string;
    /** channel id → enabled. */
    channels: Record<string, boolean>;
    /** category id → enabled. */
    categories: Record<string, boolean>;
    /** Last write time. */
    updatedAt: Date;
}

/**
 * One audit row per blast. Labels and audience are snapshots taken at send time
 * so the history survives a plugin (and its category) being disabled later.
 */
export interface INotificationAuditDocument {
    _id?: ObjectId;
    /** Category id that fired. */
    categoryId: string;
    /** Category label snapshot. */
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
    /** Total recipients resolved from the audience. */
    recipientCount: number;
    /** Total (recipient × channel) suppressions by policy/preference. */
    suppressedCount: number;
    /** Per-channel delivered/suppressed tallies. */
    channels: INotificationChannelTally[];
    /** Optional human-readable attribution (e.g. the firing prompt id). */
    firedBy?: string;
    /** When the blast occurred — TTL-indexed for retention. */
    createdAt: Date;
}
