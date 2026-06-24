/**
 * @fileoverview Published contract for the platform notification service.
 *
 * The notifications module registers its `NotificationService` on the service
 * registry as `'notifications'`; modules and plugins consume it through
 * `services.get<INotificationService>('notifications')` or
 * `services.watch(...)`. A *source* (any module or plugin) declares the
 * notification categories it owns, then calls {@link INotificationService.notify}
 * whenever the underlying event occurs. The service resolves the audience to a
 * recipient set, resolves the request's content type into a descriptor, routes
 * to the channels whose capabilities can render it, applies per-user preferences
 * and admin policy, delivers through each surviving channel, and records an
 * audit row.
 *
 * Keeping the contract and its DTOs in `@/types` lets sources depend on the
 * abstraction without reaching into the notifications module's source, exactly
 * as plugins consume `'wallets'` or `'menu'`.
 */

import type { IContentDescriptor } from '../content/IContentDescriptor.js';
import type { IContentClassification } from '../content/IContentClassification.js';

/**
 * Visual severity of a notification. Maps to a toast tone on the client and to
 * styling/urgency on any future channel (email subject prefix, push priority).
 */
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

/**
 * A renderable feature of a content descriptor. A channel declares the set it
 * can render (`accepts`); dispatch routes a notification only to channels whose
 * `accepts` covers every feature the resolved descriptor actually carries, so a
 * text-only channel is skipped for a notification that needs inline media rather
 * than mangling it. This is the capability vocabulary that replaced a category
 * naming its channels — routing is now derived, not declared by the originator.
 */
export type NotificationContentFeature = 'title' | 'body' | 'media' | 'details';

/**
 * Disposer returned by {@link INotificationService.registerCategory} and
 * {@link INotificationService.registerChannel}. A plugin calls it from
 * `disable()` so its categories/channels vanish when the plugin is turned off;
 * modules register for the process lifetime and keep it only for symmetry.
 */
export type NotificationDisposer = () => void;

/**
 * Who a notification targets. The dispatch layer resolves this to a concrete
 * set of Better Auth user ids server-side — `groups` expands through the
 * `'user-groups'` service, `userIds` are taken verbatim. Resolution is
 * server-side on purpose: it is the only place per-user silencing can be
 * enforced without trusting the client.
 */
export interface INotificationAudience {
    /** Group ids whose members should receive the notification (e.g. `['admin']`). */
    groups?: string[];
    /** Explicit Better Auth user ids, in addition to any group members. */
    userIds?: string[];
}

/**
 * A notification type owned by a source (module or plugin). Its *existence* is
 * code, declared once at boot like a hook descriptor; its admin enable-state and
 * per-user opt-outs are data persisted elsewhere. A category carries audience
 * and policy only — it no longer names channels. Which channels a notification
 * reaches is derived at dispatch from the resolved content descriptor's features
 * matched against each channel's `accepts` (see {@link NotificationContentFeature}).
 */
export interface INotificationCategory {
    /** Stable id, namespaced by source (e.g. `'ai-tools.scheduled-prompt-run'`). */
    id: string;
    /** Human-readable label shown in the preference and admin UIs. */
    label: string;
    /** One-line description of when this fires, shown in the admin UI. */
    description: string;
    /** Owning module/plugin id — used for audit attribution and admin grouping. */
    source: string;
    /** Default recipients when a `notify()` call does not override the audience. */
    defaultAudience: INotificationAudience;
    /** Per-channel default opt-in state for users who have not set a preference, keyed by channel id. A channel with no entry defaults to opted-out. */
    channelDefaults: Record<string, boolean>;
    /** Whether users may opt out of this category. Defaults to true; set false for security-critical notices. */
    userConfigurable?: boolean;
    /** Whether admins may disable this category globally. Defaults to true. */
    adminConfigurable?: boolean;
    /** Whether a user's global mute suppresses this category. Defaults to true; set false for must-deliver notices. */
    mutable?: boolean;
}

/**
 * One resolved recipient handed to a channel transport. Carries the stable
 * Better Auth user id; each channel maps it to its own address space (a
 * `user:${id}` socket room for toast, an email address for a future email
 * channel).
 */
export interface INotificationRecipient {
    /** Better Auth user id of the recipient. */
    userId: string;
}

/**
 * The rendered, channel-agnostic message a transport delivers. Produced once
 * per `notify()` call by resolving the request's content type through the
 * central content registry and calling its `describe(ref)`, then passed to every
 * surviving channel so each renders consistent content. The renderable content
 * lives in `content` (the shared {@link IContentDescriptor}); the surrounding
 * fields are the notification envelope (identity, severity, timing) the channel
 * frames it with.
 */
export interface IRenderedNotification {
    /** Audit id of this blast — also used as the client-side notification id. */
    id: string;
    /** Category that produced the notification. */
    categoryId: string;
    /** Category label snapshot, so clients can label without a category lookup. */
    categoryLabel: string;
    /** Severity driving tone/urgency. */
    severity: NotificationSeverity;
    /** The resolved, channel-agnostic content (title/body/media/fields) a channel renders. */
    content: IContentDescriptor;
    /** Optional structured payload for richer client handling or a future inbox. */
    data?: Record<string, unknown>;
    /** When the notification was produced. */
    createdAt: Date;
}

/**
 * Outcome a channel transport reports back to the dispatcher, feeding the audit
 * record's per-channel delivered/failed counts.
 */
export interface IChannelDeliveryResult {
    /** How many recipients the channel delivered to. */
    delivered: number;
    /** How many deliveries failed at the transport layer (optional). */
    failed?: number;
    /**
     * Set when the channel structurally matched the content (the content router's
     * `accepts ⊆ present` floor) but cannot render it faithfully — e.g. a toast
     * handed content with neither a title nor a body. `delivered` must be 0;
     * dispatch records the refusal in the audit so the loss is observable rather
     * than a silent skip. This is the fidelity guard that replaced the channel's
     * capability-ceiling exclusion when matching moved to the content router (the
     * router matches on a minimum floor, so a channel can now be a candidate for
     * content it cannot meaningfully render, and refuses here instead).
     */
    refused?: boolean;
}

/**
 * A delivery transport. Toast is the only channel today; email and push are
 * future implementations of the same interface, so adding one is a new column
 * in the preference matrix rather than a new concept. The dispatcher hands each
 * channel only the recipients that survived policy and preference gating.
 */
export interface INotificationChannel {
    /** Stable channel id (e.g. `'toast'`, later `'email'`, `'push'`). */
    id: string;
    /** Human-readable label for preference/admin UIs. */
    label: string;
    /**
     * The content features this channel can render. Dispatch delivers to the
     * channel only when this set covers every feature the resolved descriptor
     * carries, so the channel never receives content it cannot represent. A
     * toast accepts `['title', 'body']`; a future rich channel might add
     * `'media'` and `'details'`.
     */
    accepts: NotificationContentFeature[];
    /**
     * The exposure delivering through this channel causes, in the governed
     * content-router classification vocabulary. A delivery channel is one outlet
     * of the notifications *delivery sink family*, so it declares its `reach` the
     * way any content sink does — the router's classification gate reads it
     * (`reach ≤ ceiling`) to decide whether a class of content may be delivered
     * through this channel. Toast is `{ egress: 'user', audience: 'user' }`: an
     * in-platform surface shown to a signed-in user. Data the gate reads, never a
     * branch the channel runs.
     */
    reach: IContentClassification;
    /**
     * Deliver a rendered notification to the resolved recipients.
     *
     * @param recipients - Recipients that passed policy + preference gating for this channel.
     * @param message - The rendered notification: envelope plus the content descriptor.
     * @returns Delivery counts for the audit record.
     */
    deliver(recipients: INotificationRecipient[], message: IRenderedNotification): Promise<IChannelDeliveryResult>;
}

/**
 * A request to fire a notification. The category supplies audience and policy;
 * the content arrives by reference — a registered content type id plus an opaque
 * `ref` the type resolves through `describe()` — exactly as a curation effect is
 * held. The originator names what to render, not how or where; dispatch resolves
 * the descriptor and routes by channel capability.
 */
export interface INotificationRequest {
    /** Id of a registered category. Unknown categories are rejected. */
    category: string;
    /** Id of a content type registered on the central content registry. Unknown types are rejected. */
    typeId: string;
    /** Opaque pointer the content type resolves into a descriptor via `describe(ref)`. */
    ref: Record<string, unknown>;
    /** Severity; defaults to `'info'`. */
    severity?: NotificationSeverity;
    /** Optional structured payload carried to the client and audit. */
    data?: Record<string, unknown>;
    /** Optional audience replacing the category default for this call. */
    audienceOverride?: INotificationAudience;
    /** Optional human-readable attribution of what fired this (e.g. a prompt id). */
    firedBy?: string;
}

/**
 * Per-channel delivery tally for one blast, surfaced on the receipt and stored
 * in the audit record.
 */
export interface INotificationChannelTally {
    /** Channel id. */
    channelId: string;
    /** Recipients delivered to. */
    delivered: number;
    /** Recipients suppressed by policy or preference for this channel. */
    suppressed: number;
    /**
     * Set when the channel refused to render this blast's content (see
     * {@link IChannelDeliveryResult.refused}). The channel's gated recipients
     * received nothing — neither delivered nor opt-out-suppressed — so the flag
     * records an otherwise invisible non-delivery the migration made observable.
     */
    refused?: boolean;
}

/**
 * Synchronous result of a {@link INotificationService.notify} call. Lets the
 * caller log/observe delivery without querying the audit collection.
 */
export interface INotificationReceipt {
    /** Audit record id for this blast. */
    auditId: string;
    /** Total recipients resolved from the audience. */
    recipientCount: number;
    /** Total (recipient × channel) deliveries made. */
    delivered: number;
    /** Total (recipient × channel) deliveries suppressed by policy/preference. */
    suppressed: number;
    /** Per-channel breakdown. */
    channels: INotificationChannelTally[];
}

/**
 * Lightweight channel descriptor for listing in preference/admin UIs without
 * exposing the transport.
 */
export interface INotificationChannelInfo {
    /** Channel id. */
    id: string;
    /** Human-readable label. */
    label: string;
}

/**
 * The registry-published notification service. Its public surface is
 * deliberately small: sources only ever *declare* categories/channels and
 * *fire*. Preference, policy, and audit administration are internal to the
 * module and reached through its own admin REST surface, not this contract.
 */
export interface INotificationService {
    /**
     * Register a category a source owns. Idempotent per id within a process;
     * re-registering the same id replaces the descriptor (supports hot reload).
     *
     * @param category - The category descriptor.
     * @returns A disposer that unregisters the category (call from plugin `disable()`).
     */
    registerCategory(category: INotificationCategory): NotificationDisposer;

    /**
     * Register a delivery channel transport. Toast is registered by the module
     * itself; a plugin providing email/push registers here.
     *
     * @param channel - The channel transport.
     * @returns A disposer that unregisters the channel.
     */
    registerChannel(channel: INotificationChannel): NotificationDisposer;

    /**
     * Fire a notification for a registered category.
     *
     * @param request - Category id, content, and optional audience override.
     * @returns A receipt with the audit id and delivered/suppressed counts.
     */
    notify(request: INotificationRequest): Promise<INotificationReceipt>;

    /** List all registered categories — backs the preference and admin UIs. */
    listCategories(): INotificationCategory[];

    /** List all registered channels — backs the preference and admin UIs. */
    listChannels(): INotificationChannelInfo[];
}
