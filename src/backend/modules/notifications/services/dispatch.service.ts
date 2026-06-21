/**
 * @fileoverview The dispatch pipeline — the heart of the module.
 *
 * For one `notify()` it resolves the audience to recipients, then applies an
 * ordered gate per (recipient, channel): admin category policy, admin channel
 * policy, the category's supported channels, the user's per-pairing opt-out,
 * and the user's global mute. Surviving pairs are grouped per channel and
 * handed to that channel's transport; an audit row records delivered and
 * suppressed counts so the History tab is meaningful.
 */

import type {
    INotificationRequest,
    INotificationReceipt,
    INotificationCategory,
    INotificationChannelTally,
    IRenderedNotification,
    INotificationPolicy,
    NotificationContentFeature,
    IContentRegistry,
    IContentDescriptor,
    ISystemLogService
} from '@/types';
import type { CategoryRegistry } from './category-registry.js';
import type { ChannelRegistry } from './channel-registry.js';
import type { PreferenceService } from './preference.service.js';
import type { PolicyService } from './policy.service.js';
import type { AuditService } from './audit.service.js';
import type { RecipientResolver } from './recipient-resolver.js';
import type { INotificationPreferencesDocument, INotificationAuditDocument } from '../database/index.js';

/**
 * Orchestrates resolution, gating, delivery, and audit for every blast. Plain
 * class; the module constructs one and the published service delegates to it.
 */
export class DispatchService {
    /**
     * @param categories - Category registry (descriptors + defaults).
     * @param channels - Channel registry (transports + capabilities).
     * @param content - Central content-type registry; resolves a request's typeId into a descriptor via `describe(ref)`.
     * @param preferences - Per-user preference store.
     * @param policy - Admin policy store.
     * @param audit - Audit store.
     * @param recipients - Audience → user-id resolver.
     * @param logger - Scoped logger.
     */
    constructor(
        private readonly categories: CategoryRegistry,
        private readonly channels: ChannelRegistry,
        private readonly content: IContentRegistry,
        private readonly preferences: PreferenceService,
        private readonly policy: PolicyService,
        private readonly audit: AuditService,
        private readonly recipients: RecipientResolver,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Resolve content, gate, deliver, and audit a notification. The request
     * names a content type and an opaque ref; this resolves the type through the
     * content registry, renders the descriptor, and routes to the channels whose
     * capabilities can render it.
     *
     * @param request - Category id, content type id + ref, and optional audience override.
     * @returns A receipt with the audit id and delivered/suppressed counts.
     * @throws If the category or the content type is not registered (a programming error in the source).
     */
    async notify(request: INotificationRequest): Promise<INotificationReceipt> {
        const category = this.categories.get(request.category);
        if (!category) {
            throw new Error(`Cannot notify: category "${request.category}" is not registered`);
        }

        const contentType = this.content.get(request.typeId);
        if (!contentType) {
            throw new Error(`Cannot notify: content type "${request.typeId}" is not registered`);
        }
        const descriptor = await contentType.describe(request.ref);
        const requiredFeatures = this.featuresOf(descriptor);

        const audience = request.audienceOverride ?? category.defaultAudience;
        const recipientIds = await this.recipients.resolve(audience);
        const severity = request.severity ?? 'info';

        const auditId = this.audit.nextId();
        const createdAt = new Date();
        const rendered: IRenderedNotification = {
            id: auditId.toHexString(),
            categoryId: category.id,
            categoryLabel: category.label,
            severity,
            content: descriptor,
            data: request.data,
            createdAt
        };

        const policySnapshot = await this.policy.get();
        const prefMap = await this.preferences.getForUsers(recipientIds);

        const categoryEnabled = this.policy.isCategoryEnabled(policySnapshot, category.id);
        const tallies: INotificationChannelTally[] = [];

        // Candidate channels are the registered channels that can render every
        // feature the resolved descriptor carries — capability routing replaces
        // the category naming its channels. A channel that cannot render the
        // content is not a candidate (and not a suppression); a candidate that is
        // policy-disabled or fully opted-out is tallied as suppressed so the audit
        // shows what was withheld, not only what was delivered.
        for (const info of this.channels.list()) {
            const channel = this.channels.get(info.id);
            if (!channel || !this.channelCanRender(channel.accepts, requiredFeatures)) {
                continue;
            }
            const channelId = channel.id;
            const channelEnabled = categoryEnabled && this.policy.isChannelEnabled(policySnapshot, channelId);

            if (!channelEnabled) {
                tallies.push({ channelId, delivered: 0, suppressed: recipientIds.length });
                continue;
            }

            const allowed = recipientIds.filter((userId) =>
                this.isAllowed(category, channelId, prefMap.get(userId))
            );
            const suppressed = recipientIds.length - allowed.length;

            if (allowed.length > 0) {
                try {
                    const result = await channel.deliver(allowed.map((userId) => ({ userId })), rendered);
                    tallies.push({ channelId, delivered: result.delivered, suppressed });
                } catch (error) {
                    this.logger.error({ error, channelId, categoryId: category.id }, 'Notification channel delivery failed');
                    tallies.push({ channelId, delivered: 0, suppressed: recipientIds.length });
                }
            } else {
                tallies.push({ channelId, delivered: 0, suppressed });
            }
        }

        const delivered = tallies.reduce((sum, t) => sum + t.delivered, 0);
        const suppressedTotal = tallies.reduce((sum, t) => sum + t.suppressed, 0);

        const auditDoc: INotificationAuditDocument = {
            _id: auditId,
            categoryId: category.id,
            categoryLabel: category.label,
            source: category.source,
            severity,
            title: descriptor.title ?? '',
            body: descriptor.body,
            audience,
            recipientCount: recipientIds.length,
            suppressedCount: suppressedTotal,
            channels: tallies,
            firedBy: request.firedBy,
            createdAt
        };
        await this.audit.record(auditDoc);

        this.logger.info(
            { categoryId: category.id, typeId: request.typeId, recipients: recipientIds.length, delivered, suppressed: suppressedTotal },
            'Notification dispatched'
        );

        return {
            auditId: auditId.toHexString(),
            recipientCount: recipientIds.length,
            delivered,
            suppressed: suppressedTotal,
            channels: tallies
        };
    }

    /**
     * The features a descriptor actually carries, so dispatch can match them
     * against each channel's `accepts`. A field counts only when populated — an
     * empty body or empty media array is not a feature the channel must support.
     *
     * @param descriptor - The resolved content descriptor.
     * @returns The present renderable features.
     */
    private featuresOf(descriptor: IContentDescriptor): NotificationContentFeature[] {
        const features: NotificationContentFeature[] = [];
        if (descriptor.title) features.push('title');
        if (descriptor.body) features.push('body');
        if (descriptor.media && descriptor.media.length > 0) features.push('media');
        if (descriptor.fields && descriptor.fields.length > 0) features.push('fields');
        return features;
    }

    /**
     * Whether a channel can render every feature the content carries. A channel
     * with no matching capability for a required feature is excluded from
     * delivery rather than handed content it would drop or mangle.
     *
     * @param accepts - The channel's declared renderable features.
     * @param required - The features the descriptor carries.
     * @returns True when `accepts` covers every required feature.
     */
    private channelCanRender(accepts: NotificationContentFeature[], required: NotificationContentFeature[]): boolean {
        return required.every((feature) => accepts.includes(feature));
    }

    /**
     * Per-(recipient, channel) preference gate. Evaluates the user's global
     * mute (when the category is mutable) and their per-pairing override, with
     * the category's channel default as the fallback. A non-user-configurable
     * category ignores per-pairing overrides — the user cannot opt out of it —
     * but a mutable one still respects the global mute.
     *
     * @param category - The firing category.
     * @param channelId - The channel under evaluation.
     * @param pref - The recipient's stored preferences, or undefined for none.
     * @returns True when this recipient should receive on this channel.
     */
    private isAllowed(
        category: INotificationCategory,
        channelId: string,
        pref: INotificationPreferencesDocument | undefined
    ): boolean {
        if (pref?.mutedAll && category.mutable !== false) {
            return false;
        }

        if (category.userConfigurable !== false) {
            const override = pref?.overrides?.[category.id]?.[channelId];
            if (override === false) {
                return false;
            }
            if (override === true) {
                return true;
            }
        }

        return category.channelDefaults[channelId] ?? false;
    }
}
