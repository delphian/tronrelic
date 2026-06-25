/**
 * @file social-post.ts
 *
 * The provider-neutral social-posting primitive: one core content type
 * (`core:social-post`) and one AI tool (`propose-social-post`) that together let
 * a model draft a destination-agnostic post and a curator fan it out to whatever
 * publish sinks an operator selects (X, Telegram, a future Mastodon). This is the
 * deliberate inversion of the old per-destination model — where each transport
 * plugin owned its own send tool and single-destination curation type — into
 * "core owns the noun and the proposing verb; plugins are pure transport
 * adapters registering publish sinks on the content router."
 *
 * The type sets `publishesToDestinations: true`, so approval is not a single
 * baked-in effect but the curator's mandated-subset selection: core computes the
 * eligible publish sinks for the draft's descriptor (within the type's
 * `classification` ceiling), the curator ticks the destinations, and routed
 * delivery runs through syndication before `onApprove`. The tool never names a
 * destination — destination choice is the human's, at the gate — which is both
 * the safer egress posture and what lets a new transport appear with zero tool
 * or model change.
 */

import type {
    IAiTool,
    IAiToolCapability,
    IContentDescriptor,
    ICurationService,
    ICurationType,
    ISystemLogService
} from '@/types';
import type { ISocialPostDraft, SocialPostStore } from './services/social-post-store.js';

/**
 * Namespaced id of the core social-post content type. The proposing tool binds
 * to it via `capability.curationTypeId`, and the AI Tools module registers the
 * type below on the `'curation'` service, so the governor's binding check rests
 * on a live registration rather than the tool's word.
 */
export const SOCIAL_POST_CURATION_TYPE_ID = 'core:social-post';

/**
 * Recommended upper bound on body length surfaced to the model. Not a hard limit
 * — each destination enforces its own ceiling at delivery via an
 * `IContentSinkRefusal` (a tweet's 280, Telegram's 4096) — but steering the
 * model toward short copy keeps a single body usable across every destination.
 */
const RECOMMENDED_BODY_LIMIT = 280;

/**
 * Build the `core:social-post` curation type bound to the draft store.
 *
 * The type is destination-neutral on purpose: `describe()` flattens a draft into
 * the generic descriptor every publish sink renders, and because the type
 * publishes to destinations, the approve-time fan-out is lifted out of
 * `onApprove` — routed delivery to the curator-selected sinks runs first, so
 * `onApprove` is left with only the draft's own bookkeeping (mark it published).
 * The `classification` of `{ external, public }` is what makes the external X
 * and Telegram publish sinks eligible in the picker; a lower ceiling would hide
 * them, so it is set explicitly rather than relying on the restrictive default.
 *
 * @param store - The draft store the opaque `{ postId }` ref resolves against.
 * @param logger - Scoped logger for decision diagnostics.
 * @returns The curation type to register on the core `'curation'` service.
 */
export function createSocialPostCurationType(store: SocialPostStore, logger: ISystemLogService): ICurationType {
    return {
        typeId: SOCIAL_POST_CURATION_TYPE_ID,
        label: 'Social Post',
        publishesToDestinations: true,
        classification: { egress: 'external', audience: 'public' },

        describe: async (ref): Promise<IContentDescriptor> => {
            const postId = String(ref.postId ?? '');
            const draft = await store.getById(postId);
            if (!draft) {
                return { title: 'Social Post (unavailable)', body: 'The underlying draft no longer exists.' };
            }
            return {
                title: draft.title ?? 'Social Post',
                body: draft.body,
                media: draft.mediaUrl ? [{ url: draft.mediaUrl, kind: 'image', alt: 'Attached image' }] : undefined,
                editable: true
            };
        },

        onApprove: async (item): Promise<void> => {
            const postId = String(item.ref.postId ?? '');
            // Routed delivery to the curator-selected sinks has already run by the
            // time core invokes this, so the publish itself is not at stake here —
            // this is the draft's own bookkeeping. A false return (draft gone or
            // already decided) is therefore a benign no-op the contract permits,
            // logged rather than thrown, so a stale-bookkeeping warning never reads
            // as a failed publish to the curator.
            const marked = await store.markPublished(postId);
            if (!marked) {
                logger.warn({ postId }, 'Social post approve bookkeeping no-op: draft missing or already decided');
                return;
            }
            logger.info({ postId }, 'Curation approve → social post draft marked published');
        },

        onReject: async (item): Promise<void> => {
            const postId = String(item.ref.postId ?? '');
            const marked = await store.markRejected(postId);
            if (!marked) {
                logger.warn({ postId }, 'Social post reject bookkeeping no-op: draft missing or already decided');
                return;
            }
            logger.info({ postId }, 'Curation reject → social post draft marked rejected');
        },

        applyEdit: async (ref, patch): Promise<void> => {
            if (typeof patch.body === 'string') {
                const postId = String(ref.postId ?? '');
                // editBody throws on an empty/oversized body and returns false when
                // the draft is gone or no longer pending; throw so the queue shows
                // the edit did not apply.
                const updated = await store.editBody(postId, patch.body);
                if (!updated) {
                    throw new Error('Failed to edit social post: draft not found or no longer pending');
                }
                logger.info({ postId }, 'Curation edit → social post draft body updated');
            }
        }
    };
}

/** Dependencies the `propose-social-post` tool closes over. */
export interface ISocialPostToolDependencies {
    /** The draft store the tool writes a pending post into. */
    store: SocialPostStore;
    /**
     * Lazily resolve the central curation service. Read at call time (not
     * captured) so the tool tolerates curation registering after the AI Tools
     * module and an operator disabling/re-enabling it.
     */
    getCuration: () => ICurationService | undefined;
    /** Scoped logger for diagnostics. */
    logger: ISystemLogService;
}

/**
 * Capability for `propose-social-post`: external because an approved post leaves
 * the platform, irreversible because a published post cannot be unsent, and
 * `forcesCuratorReview: true` bound to `core:social-post` — every effect is held
 * in the central curation queue, so the governor adds no second approval gate and
 * treats autonomous (scheduled) runs as safe (an unattended call can do no more
 * than draft into the queue). The verifiable `curationTypeId` binding means that
 * relaxation holds only while the AI Tools module's type registration is live.
 * `sensitivity: 'public'` keeps the proposed text in the audit; this is the
 * trifecta's exfiltration leg.
 */
const PROPOSE_SOCIAL_POST_CAPABILITY: IAiToolCapability = {
    sideEffect: 'external',
    reversible: false,
    sensitivity: 'public',
    forcesCuratorReview: true,
    curationTypeId: SOCIAL_POST_CURATION_TYPE_ID
};

/**
 * Build the provider-neutral `propose-social-post` AI tool.
 *
 * The tool drafts a destination-agnostic post and holds it in the central
 * curation queue; it never publishes and never picks a destination — the curator
 * selects which publish sinks (X, Telegram) fire at approval. Replaces the
 * per-destination `x-post-tweet` / `telegram-send-message` / `telegram-send-photo`
 * tools with one verb, so the model learns a single posting capability and a new
 * transport needs no new tool.
 *
 * @param deps - The draft store, a lazy curation-service resolver, and a logger.
 * @returns The tool to register on the core `'ai-tools'` registry.
 */
export function createSocialPostTool(deps: ISocialPostToolDependencies): IAiTool {
    const { store, getCuration, logger } = deps;
    return {
        name: 'propose-social-post',
        description:
            'Propose a social media post for human review. The post is NOT published immediately and is NOT ' +
            'tied to a specific network: it is held in the central curation queue, where an admin reviews it and ' +
            'chooses which connected channels (e.g. X/Twitter, Telegram) to publish it to — or rejects it. ' +
            'Use when asked to draft, share, or announce something on social media. ' +
            'The "body" parameter is required and is the post text; keep it under ' +
            `${RECOMMENDED_BODY_LIMIT} characters so it fits every destination (longer text may be refused by ` +
            'shorter-limit channels at delivery). Optionally pass "title" for an internal heading and "imageUrl" ' +
            '(a public http/https image URL) for channels that render media — text-only channels ignore it. ' +
            'Returns a pending-review confirmation with a postId, never a published link. ' +
            'Never use this to answer the user or relay findings — write those as normal text in the conversation.',
        capability: PROPOSE_SOCIAL_POST_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The social post draft to hold for curator review.',
            properties: {
                body: { type: 'string', description: `Post text (required). Keep under ${RECOMMENDED_BODY_LIMIT} characters to fit every destination.` },
                title: { type: 'string', description: 'Optional internal heading shown in the review queue.' },
                imageUrl: { type: 'string', description: 'Optional public http/https image URL for channels that render media.' }
            },
            required: ['body'],
            additionalProperties: false
        },
        handler: async (input) => {
            // The schema is a hint to the model, not a guarantee — re-validate.
            const payload = input as { body?: unknown; title?: unknown; imageUrl?: unknown };
            const body = typeof payload.body === 'string' ? payload.body.trim() : '';
            if (!body) {
                return { success: false, error: 'body is required and must be a non-empty string' };
            }

            const title = typeof payload.title === 'string' ? payload.title.trim() : undefined;

            // The tool stores the URL; the media-rendering sink (X) is the actual
            // egress point and re-checks the resolved address for SSRF when it
            // downloads. Here we only reject a non-http(s) scheme early so an
            // obviously bad URL fails at proposal time with a correctable error.
            let mediaUrl: string | undefined;
            if (typeof payload.imageUrl === 'string' && payload.imageUrl.trim()) {
                const raw = payload.imageUrl.trim();
                let parsed: URL;
                try {
                    parsed = new URL(raw);
                } catch {
                    return { success: false, error: 'imageUrl must be a valid URL' };
                }
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                    return { success: false, error: 'imageUrl must be an http or https URL' };
                }
                mediaUrl = raw;
            }

            const curation = getCuration();
            if (!curation) {
                return { success: false, error: 'Curation service unavailable; cannot hold the post for review' };
            }

            // Persist the draft first, then hold its opaque ref in the queue. If
            // the hold fails the draft is left orphaned as `pending` and harmless
            // (it just never surfaces for review) — surface the error to the model.
            // The governor already catches a thrown handler, but the store re-asserts
            // its own body invariants (empty/oversized) by throwing, so catch that
            // here too and return the uniform `{ success: false, error }` shape every
            // other branch uses rather than letting the raw message reach the model.
            let draft: ISocialPostDraft;
            try {
                draft = await store.create({ body, title, mediaUrl, source: 'ai-tool:propose-social-post' });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn({ error: message }, 'Failed to persist proposed social post draft');
                return { success: false, error: `Failed to save the post draft: ${message}` };
            }
            try {
                const held = await curation.hold({
                    typeId: SOCIAL_POST_CURATION_TYPE_ID,
                    ref: { postId: draft.id },
                    source: 'ai-tool:propose-social-post'
                });
                logger.info({ postId: draft.id, curationId: held.id }, 'Social post proposed and held for curation');
                return { success: true, pendingReview: true, postId: draft.id };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn({ error: message, postId: draft.id }, 'Failed to hold proposed social post in curation queue');
                return { success: false, error: `Failed to queue the post for review: ${message}` };
            }
        }
    };
}
