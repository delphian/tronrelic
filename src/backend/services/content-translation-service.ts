/**
 * @fileoverview Translations of managed content — the workflow every
 * translatable content type shares, reached as `IContentService.translations()`.
 *
 * Why it exists: core runs the translation workflow — the stale check, the AI
 * Suggest request, the editor, and the list of translated addresses — once for
 * every type whose registration sets `translation`, so no content type needs
 * its own copy.
 *
 * Storage is split the same way it is for the items themselves. Core keeps the
 * state of each translation — published, the fingerprint of the English text
 * it was written against, who changed it and when, and soft deletion — in its
 * own `content_translations` collection. The content type keeps the translated
 * text in its own collection and reads and writes it through its
 * `ITranslatableContentType` methods. Core never writes the type's collection
 * and never stores the type's text.
 *
 * A curator's save is not reviewed: it is live at once. Anyone else may only
 * propose a translation, which is held in the curation queue under the
 * `core:content-translation` binding until a curator approves it. Core keeps
 * each proposal's review state in `content_translation_proposals`, and the
 * proposed text waits beside the served text in the type's own collection.
 * Every write runs the `content.before*` veto hooks with `language` set, so a
 * rule over all content covers translations too.
 *
 * @see ../../../docs/system/system-content.md — the translations section.
 * @module backend/services/content-translation-service
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
    ContentCurationState,
    HookDescriptor,
    IContent,
    IContentActor,
    IContentChangeSet,
    IContentDescriptor,
    IContentService,
    IContentTranslation,
    IContentTranslationContext,
    IContentTranslationOverview,
    IContentTranslationProposal,
    IContentTranslationProposalInput,
    IContentTranslationProposalOutcome,
    IContentTranslationService,
    IContentTranslationSettings,
    IContentTranslationStatus,
    IContentTranslationSuggestion,
    IContentTranslationWrite,
    IContentWriteContext,
    ICurationItem,
    ICurationService,
    IDatabaseService,
    IHookRegistry,
    IManagedContentType,
    IPublicLocalizedRoute,
    IServedContentTranslation,
    ISystemLogService,
    ITranslatableContentType,
    ITranslatableField,
    ITranslationProposals,
    ITranslationValueRecord,
    ITranslationValueStore,
    TranslationValues
} from '@/types';
import { DEFAULT_LANGUAGE, LANGUAGE_CODE_PATTERN, MAX_TRANSLATION_STATUS_IDS } from '@/types';
import { HOOKS } from '../hooks/registry.js';
import { buildContentChangeSet } from './buildContentChangeSet.js';
import { ContentError } from './content-error.js';
import { runContentVeto } from './content-veto.js';
import { ContentTranslationStore } from './content-translation-store.js';
import type { ContentTranslationSettingsService } from './content-translation-settings.js';
import type { ContentTranslationSuggestionService } from './content-translation-suggestion.js';
import { CONTENT_TRANSLATION_CURATION_TYPE_ID } from './content-translation-curation.js';
import { ContentTranslationInputError } from './content-translation-errors.js';
import { findTranslationMismatches } from './findTranslationMismatches.js';

/** Core collection holding the state of every translation. */
export const CONTENT_TRANSLATIONS_COLLECTION = 'content_translations';

/** Core collection holding the review state of every proposed translation. */
export const CONTENT_TRANSLATION_PROPOSALS_COLLECTION = 'content_translation_proposals';

/**
 * Decider recorded when a newer proposal replaces an older one and the older
 * one's queue item is closed, so History separates it from a curator's reject.
 */
const SUPERSEDED_DECIDER = 'system:translation-superseded';

/**
 * Characters that make a path a route pattern in the localization snapshot.
 * A path holding one of them would cover addresses the item is not served at.
 */
const ROUTE_PATTERN_CHARACTERS = /[:*\s]/;

/**
 * Read one translated value as display text, joining a list with commas, so
 * the curation preview can show any field kind as a line of text.
 */
function fieldText(values: TranslationValues, name: string): string {
    const value = values[name];

    return Array.isArray(value) ? value.join(', ') : (value ?? '');
}

/** A registered managed type together with its translation side. */
interface ITranslatableEntry {
    type: IManagedContentType<IContent, unknown, unknown>;
    translation: ITranslatableContentType<IContent>;
}

/**
 * The state core keeps for one translation. The translated text is not here;
 * the content type stores it.
 */
export interface IContentTranslationStateDocument {
    /** Core content id of the translated item. */
    contentId: string;
    /** The managed content type of the item. */
    typeId: string;
    /** Language code of the translation. */
    language: string;
    /** Whether visitors are served the translation. */
    published: boolean;
    /** Fingerprint of the English text the translation was last saved against. */
    sourceHash: string;
    /** When the translation was first saved. */
    createdAt: Date;
    /** Who first saved it. */
    createdBy: string;
    /** When it was last changed. */
    updatedAt: Date;
    /** Who last changed it. */
    updatedBy: string;
    /** Soft-delete marker; absent while the translation is live. */
    deletedAt?: Date;
    /** Who deleted it; absent while it is live. */
    deletedBy?: string;
}

/**
 * The review state core keeps for one proposed translation. The proposed text
 * is not here; the content type holds it beside the served text.
 */
export interface IContentTranslationProposalDocument {
    /** Core content id of the translated item. */
    contentId: string;
    /** The managed content type of the item. */
    typeId: string;
    /** Language code of the proposal. */
    language: string;
    /**
     * The current hold. Copied into the queue item's ref, so only the queue
     * item opened for this proposal can decide it.
     */
    holdId: string;
    /** The open curation queue item, once the hold recorded one. */
    curationItemId?: string;
    /** Fingerprint of the English text the proposal translates. */
    sourceHash: string;
    /** Who proposed it. */
    proposedBy: string;
    /** What produced it, such as an AI tool name. */
    source?: string;
    /** When it was proposed. */
    proposedAt: Date;
}

/** Collaborators the translation service needs, wired by the content service. */
export interface IContentTranslationServiceDependencies {
    /** Core database holding `content_translations`. */
    database: IDatabaseService;
    /** Runs the `content.before*` veto hooks. */
    hookRegistry: IHookRegistry;
    /** Reads items at the version an admin or a visitor sees. */
    reader: Pick<IContentService, 'readAdmin' | 'readPublic'>;
    /** Looks up a registered managed type by id. */
    getType: (typeId: string) => IManagedContentType<IContent, unknown, unknown> | undefined;
    /** Lists every registered managed type. */
    listTypes: () => ReadonlyArray<IManagedContentType<IContent, unknown, unknown>>;
    /** Runs the AI Suggest request. */
    suggestions: Pick<ContentTranslationSuggestionService, 'suggest'>;
    /** Reads and writes the AI settings. */
    settings: Pick<ContentTranslationSettingsService, 'getSettings' | 'updateSettings'>;
    /**
     * Resolves the curation queue proposals are held in, per call, because
     * curation starts after this service is built.
     */
    getCuration: () => ICurationService | undefined;
    /**
     * Whether visitors can reach a language. Proposals are refused for a
     * language that is not enabled, so approved drafts do not pile up unseen
     * and all go live the day it is switched on.
     */
    isLanguageEnabled: (code: string) => Promise<boolean>;
    /**
     * Called after a change that can alter which addresses are served in which
     * language, so the localization snapshot is rebuilt.
     */
    onRoutesChanged: () => void;
    /** Scoped logger. */
    logger: ISystemLogService;
}

/**
 * Implements `IContentTranslationService` for every translatable managed type.
 */
export class ContentTranslationService implements IContentTranslationService {
    /**
     * @param deps - Collaborators wired by the content service.
     */
    constructor(private readonly deps: IContentTranslationServiceDependencies) {}

    /**
     * Create the indexes the state collection relies on. Called once at
     * bootstrap with the content service's own indexes.
     *
     * @returns Resolves when every index exists.
     */
    async ensureIndexes(): Promise<void> {
        await this.deps.database.createIndex(CONTENT_TRANSLATIONS_COLLECTION, { contentId: 1, language: 1 }, { unique: true });
        await this.deps.database.createIndex(CONTENT_TRANSLATIONS_COLLECTION, { typeId: 1, published: 1, deletedAt: 1 });
        await this.deps.database.createIndex(CONTENT_TRANSLATIONS_COLLECTION, { typeId: 1, language: 1, published: 1 });
        await this.deps.database.createIndex(CONTENT_TRANSLATION_PROPOSALS_COLLECTION, { contentId: 1, language: 1 }, { unique: true });

        return;
    }

    // ------------------------------------------------------------------ admin

    /**
     * Load an item's English source and every translation of it.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @returns The source and the translations, ordered by language code.
     */
    async getOverview(typeId: string, id: string): Promise<IContentTranslationOverview> {
        const entry = this.requireTranslatable(typeId);
        const [latest] = await this.deps.reader.readAdmin(typeId, [id]);
        if (!latest) {
            throw new ContentError('not-found', `No ${entry.type.label} with id ${id}`);
        }
        const [served] = await this.deps.reader.readPublic(typeId, [id]);
        const english = entry.translation.extractTranslatable(served ?? latest);
        const englishHash = this.hashValues(entry.translation.translatableFields, english);
        const latestHash = this.hashValues(entry.translation.translatableFields, entry.translation.extractTranslatable(latest));

        const states = await this.collection().find({ contentId: id }).sort({ language: 1 }).toArray();
        const records = states.length > 0
            ? await entry.translation.readTranslations(states.map((state) => ({ id, language: state.language })))
            : [];

        return {
            source: {
                typeId,
                contentId: id,
                fields: [...entry.translation.translatableFields],
                values: english,
                pendingEdit: latest.curation === 'pending' && latestHash !== englishHash
            },
            translations: states.map((state) => this.toTranslation(state, records, englishHash)),
            proposals: await this.listProposals(entry, id, englishHash)
        };
    }

    /**
     * Summarize the translations of a batch of items for an admin list. The
     * state rows come from core's own collection in one query; the English
     * text is read only for items that have translations, so the stale flag
     * can be worked out, and the translated text is never read.
     *
     * @param typeId - The managed content type.
     * @param ids - Core content ids of the listed items; at most
     *   `MAX_TRANSLATION_STATUS_IDS` are summarized.
     * @returns Each translated item's statuses, keyed by content id, ordered by language.
     */
    async summarizeTranslations(
        typeId: string,
        ids: ReadonlyArray<string>
    ): Promise<Record<string, IContentTranslationStatus[]>> {
        const entry = this.requireTranslatable(typeId);
        const wanted = Array.from(new Set(ids.map((id) => String(id)))).slice(0, MAX_TRANSLATION_STATUS_IDS);
        const states = wanted.length > 0
            ? await this.collection().find({ contentId: { $in: wanted } }).sort({ language: 1 }).toArray()
            : [];
        const proposals = wanted.length > 0
            ? await this.proposalCollection().find({ contentId: { $in: wanted } }, { projection: { contentId: 1, language: 1 } }).toArray()
            : [];
        const proposed = new Set(proposals.map((proposal) => `${proposal.contentId}\u0000${proposal.language}`));
        const translatedIds = Array.from(new Set(states.map((state) => state.contentId)));
        const englishHashes = await this.englishHashes(entry, translatedIds);

        const summary: Record<string, IContentTranslationStatus[]> = {};
        const saved = new Set<string>();
        for (const state of states) {
            const key = `${state.contentId}\u0000${state.language}`;
            saved.add(key);
            const statuses = summary[state.contentId] ?? [];
            statuses.push({
                language: state.language,
                published: state.published,
                stale: state.sourceHash !== englishHashes.get(state.contentId),
                deleted: Boolean(state.deletedAt),
                saved: true,
                proposalPending: proposed.has(key)
            });
            summary[state.contentId] = statuses;
        }
        // A proposal into a language with no saved translation still belongs
        // in the list, so an operator sees there is something to review.
        for (const proposal of proposals) {
            if (!saved.has(`${proposal.contentId}\u0000${proposal.language}`)) {
                const statuses = summary[proposal.contentId] ?? [];
                statuses.push({
                    language: proposal.language,
                    published: false,
                    stale: false,
                    deleted: false,
                    saved: false,
                    proposalPending: true
                });
                summary[proposal.contentId] = statuses.sort((a, b) => a.language.localeCompare(b.language));
            }
        }

        return summary;
    }

    /**
     * Create or replace a translation. The values are checked against the
     * type's field list before the veto hooks run, so a hook sees exactly what
     * will be stored. A proposal waiting for review in the same language is
     * closed, because the curator's save replaces what it proposed.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @param input - The translated values and the published switch.
     * @param actor - Who is saving; must be a curator.
     * @returns The saved translation.
     */
    async saveTranslation(
        typeId: string,
        id: string,
        language: string,
        input: IContentTranslationWrite,
        actor: IContentActor
    ): Promise<IContentTranslation> {
        const entry = this.requireTranslatable(typeId);
        this.requireCurator(actor, entry);
        this.requireLanguage(language);
        await this.requireLiveItem(entry, id);
        const existing = await this.findState(id, language);
        if (existing?.deletedAt) {
            throw new ContentError('deleted', `The "${language}" translation is deleted; restore it before changing it`);
        }
        const values = this.validateValues(entry.translation.translatableFields, input?.values);
        const write: IContentTranslationWrite = { values, published: input?.published === true };
        await this.runVeto(HOOKS.content.beforeUpdate, { operation: 'update', typeId, id, actor, input: write, language });

        const englishHash = await this.englishHash(entry, id);
        await entry.translation.writeTranslation(id, language, values);
        const now = new Date();
        await this.collection().updateOne(
            { contentId: id, language },
            {
                $set: { typeId, published: write.published, sourceHash: englishHash, updatedAt: now, updatedBy: actor.id },
                $setOnInsert: { createdAt: now, createdBy: actor.id }
            },
            { upsert: true }
        );
        await this.supersedeProposal(entry, id, language, actor);
        await this.notifyChanged(entry, id, language);
        this.deps.logger.info({ typeId, id, language, actor: actor.id, published: write.published }, 'Content translation saved');

        return this.readOne(entry, id, language, englishHash);
    }

    /**
     * Soft-delete a translation. The stored values stay for a restore. A
     * proposal waiting for review in the same language is closed, so it
     * cannot bring the deleted translation back when approved.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @param actor - Who is deleting it; must be a curator.
     */
    async deleteTranslation(typeId: string, id: string, language: string, actor: IContentActor): Promise<void> {
        const entry = this.requireTranslatable(typeId);
        this.requireCurator(actor, entry);
        const state = await this.requireState(id, language);
        if (state.deletedAt) {
            throw new ContentError('deleted', `The "${language}" translation is already deleted`);
        }
        await this.runVeto(HOOKS.content.beforeDelete, { operation: 'delete', typeId, id, actor, language });

        const now = new Date();
        await this.collection().updateOne(
            { contentId: id, language },
            { $set: { deletedAt: now, deletedBy: actor.id, updatedAt: now, updatedBy: actor.id } }
        );
        await this.supersedeProposal(entry, id, language, actor);
        await this.notifyChanged(entry, id, language);
        this.deps.logger.info({ typeId, id, language, actor: actor.id }, 'Content translation soft-deleted');

        return;
    }

    /**
     * Bring back a soft-deleted translation.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @param actor - Who is restoring it; must be a curator.
     * @returns The restored translation.
     */
    async restoreTranslation(typeId: string, id: string, language: string, actor: IContentActor): Promise<IContentTranslation> {
        const entry = this.requireTranslatable(typeId);
        this.requireCurator(actor, entry);
        const state = await this.requireState(id, language);
        if (!state.deletedAt) {
            throw new ContentError('not-deleted', `The "${language}" translation is not deleted`);
        }
        await this.runVeto(HOOKS.content.beforeRestore, { operation: 'restore', typeId, id, actor, language });

        await this.collection().updateOne(
            { contentId: id, language },
            { $set: { updatedAt: new Date(), updatedBy: actor.id }, $unset: { deletedAt: '', deletedBy: '' } }
        );
        await this.notifyChanged(entry, id, language);
        this.deps.logger.info({ typeId, id, language, actor: actor.id }, 'Content translation restored');

        return this.readOne(entry, id, language, await this.englishHash(entry, id));
    }

    /**
     * Ask an AI model to translate an item. The existing translation is sent
     * along only when it is stale, so the model updates it instead of
     * starting over.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Target language code.
     * @param actor - Who asked, for the log.
     * @returns The suggested values, the model's notes, and the cost.
     */
    async suggestTranslation(
        typeId: string,
        id: string,
        language: string,
        actor: IContentActor
    ): Promise<IContentTranslationSuggestion> {
        const entry = this.requireTranslatable(typeId);
        await this.requireLiveItem(entry, id);
        const fields = entry.translation.translatableFields;
        const english = entry.translation.extractTranslatable(await this.loadEnglish(entry, id));
        const state = await this.findState(id, language);
        const live = state && !state.deletedAt ? state : null;
        const [record] = live ? await entry.translation.readTranslations([{ id, language }]) : [];
        const existing = record?.values ?? null;
        const stale = live !== null && live.sourceHash !== this.hashValues(fields, english);

        return this.deps.suggestions.suggest(
            { typeId, id, language },
            { fields, english, previous: stale ? existing : null, existing },
            actor.id
        );
    }

    // -------------------------------------------------------------- proposals

    /**
     * Hold a proposed translation for curator review. The checks run in the
     * order that refuses a bad proposal before anything is stored: the type
     * must accept proposals, the language must be enabled, the item must be
     * served, the English must not have changed, and the values must pass the
     * field list, the type's own rules, and the comparison of links, TRON
     * addresses, and numbers with the English. Only then are the values held
     * and a queue item opened. A proposal already open for the language is
     * replaced, and its queue item is closed as superseded.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @param input - The proposed values and the English fingerprint they follow.
     * @param actor - Who is proposing; recorded on the proposal.
     * @returns Whether the proposal waits for review, and its queue item.
     */
    async proposeTranslation(
        typeId: string,
        id: string,
        language: string,
        input: IContentTranslationProposalInput,
        actor: IContentActor
    ): Promise<IContentTranslationProposalOutcome> {
        const entry = this.requireTranslatable(typeId);
        const proposals = this.requireProposals(entry);
        this.requireLanguage(language);
        await this.requireEnabledLanguage(language);
        const [served] = await this.deps.reader.readPublic(typeId, [id]);
        if (!served) {
            throw new ContentError('not-found', `No ${entry.type.label} with id ${id} is served to visitors, so it cannot be translated by proposal`);
        }
        const fields = entry.translation.translatableFields;
        const english = entry.translation.extractTranslatable(served);
        const englishHash = this.hashValues(fields, english);
        if (input?.sourceHash !== englishHash) {
            throw new ContentError('source-changed', `The English text of this ${entry.type.label} has changed since it was read; read it again and translate the current text`);
        }
        const state = await this.findState(id, language);
        if (state?.deletedAt) {
            throw new ContentError('deleted', `The "${language}" translation is deleted; a curator must restore it before it can change`);
        }
        const [saved] = state ? await entry.translation.readTranslations([{ id, language }]) : [];
        const values = this.buildProposalValues(fields, input?.values, saved?.values);
        try {
            await proposals.validate(values);
        } catch (error) {
            // The contract asks a type to refuse values with a descriptive
            // Error, so its message is what the proposer needs to fix them.
            throw new ContentTranslationInputError(error instanceof Error ? error.message : String(error));
        }
        const mismatches = findTranslationMismatches(fields, english, values);
        if (mismatches.length > 0) {
            throw new ContentTranslationInputError(`The translation must keep every link, TRON address, and number exactly as the English has it. ${mismatches.join(' ')}`);
        }
        await this.runVeto(HOOKS.content.beforeUpdate, {
            operation: 'update',
            typeId,
            id,
            actor,
            input: { values, published: state?.published === true },
            language
        });
        const curation = this.requireCuration();

        const previous = await this.findProposal(id, language);
        await proposals.write(id, language, values);
        const holdId = randomUUID();
        const source = typeof input.source === 'string' && input.source.trim() !== '' ? input.source.trim() : undefined;
        await this.proposalCollection().updateOne(
            { contentId: id, language },
            {
                $set: { typeId, holdId, sourceHash: englishHash, proposedBy: actor.id, proposedAt: new Date(), ...(source ? { source } : {}) },
                $unset: source ? { curationItemId: '' } : { curationItemId: '', source: '' }
            },
            { upsert: true }
        );
        if (previous?.curationItemId) {
            await this.closeQueueItem(curation, previous.curationItemId, SUPERSEDED_DECIDER);
        }

        let item: ICurationItem;
        try {
            item = await curation.hold({
                typeId: CONTENT_TRANSLATION_CURATION_TYPE_ID,
                ref: { typeId, id, language, holdId },
                source: source ?? actor.id
            });
        } catch (error) {
            await this.discardProposal(entry, id, language, holdId);
            throw error;
        }
        // A policy bypass may approve the item inside hold(), which has then
        // already applied the decision and removed the proposal, so the
        // filter below matches nothing and the outcome reports it as decided.
        const recorded = item.status === 'pending'
            ? (await this.proposalCollection().updateOne({ contentId: id, language, holdId }, { $set: { curationItemId: item.id } })).matchedCount > 0
            : false;
        this.deps.logger.info({ typeId, id, language, actor: actor.id, curationItemId: item.id, status: item.status }, 'Content translation proposed');

        return {
            typeId,
            contentId: id,
            language,
            pendingReview: recorded,
            ...(recorded ? { curationItemId: item.id } : {})
        };
    }

    /**
     * Read the served English and served translation a proposer works from.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @returns The context, or null when the item is not served to visitors.
     */
    async getTranslationContext(typeId: string, id: string, language: string): Promise<IContentTranslationContext | null> {
        const entry = this.requireTranslatable(typeId);
        this.requireLanguage(language);
        const [served] = await this.deps.reader.readPublic(typeId, [id]);
        let context: IContentTranslationContext | null = null;
        if (served) {
            const fields = entry.translation.translatableFields;
            const source = entry.translation.extractTranslatable(served);
            const sourceHash = this.hashValues(fields, source);
            const state = await this.findState(id, language);
            const live = state && state.published && !state.deletedAt ? state : null;
            const [record] = live ? await entry.translation.readTranslations([{ id, language }]) : [];
            context = {
                typeId,
                contentId: id,
                language,
                fields: [...fields],
                source,
                sourceHash,
                translation: live && record
                    ? { values: record.values, stale: live.sourceHash !== sourceHash, updatedAt: live.updatedAt }
                    : null,
                proposalPending: (await this.findProposal(id, language)) !== null
            };
        }

        return context;
    }

    /**
     * Record a curator's decision on a proposed translation. Called by the
     * `core:content-translation` curation binding when the queue commits a
     * decision.
     *
     * A decision is applied only when the queue item's `holdId` matches the
     * proposal's, so a queue item left open for an older proposal can never
     * approve the newer text in its place. Approving a stale one throws
     * `superseded`; rejecting one changes nothing.
     *
     * An approval is refused when the item or the translation was deleted
     * since, or the English changed since the proposal was made. The queue
     * has already recorded the decision by then, so the proposal is dropped
     * in every refused case rather than left with no queue item to decide it.
     *
     * @param ref - The queue item's ref, `{ typeId, id, language, holdId }`.
     * @param decision - The curator's decision.
     * @throws ContentError `superseded`, `deleted`, or `source-changed` when an
     *   approval cannot be applied.
     */
    async applyProposalDecision(ref: Record<string, unknown>, decision: Exclude<ContentCurationState, 'pending'>): Promise<void> {
        const { typeId, id, language, holdId } = this.parseProposalRef(ref);
        const entry = this.requireTranslatable(typeId);
        const proposal = await this.findProposal(id, language);
        if (!proposal || proposal.holdId !== holdId) {
            this.deps.logger.warn({ typeId, id, language, decision, holdId }, 'Translation proposal decision on a superseded hold ignored');
            if (decision === 'approved') {
                throw new ContentError('superseded', `This review item no longer holds the current proposed "${language}" translation; nothing was changed`);
            }
        } else if (decision === 'approved') {
            try {
                await this.approveProposal(entry, proposal);
            } catch (error) {
                await this.discardProposal(entry, id, language, holdId);
                throw error;
            }
            this.deps.logger.info({ typeId, id, language }, 'Translation proposal approved');
        } else {
            await this.discardProposal(entry, id, language, holdId);
            this.deps.logger.info({ typeId, id, language }, 'Translation proposal rejected');
        }

        return;
    }

    /**
     * Render a proposed translation for the curation queue. The body is the
     * proposed text of the type's Markdown field, and the details name the
     * language, the English title, who proposed it, and whether the English
     * has changed since, so a curator can judge it without opening the editor.
     *
     * @param ref - The queue item's ref, `{ typeId, id, language, holdId }`.
     * @returns A read-only descriptor.
     */
    async describeProposal(ref: Record<string, unknown>): Promise<IContentDescriptor> {
        const { typeId, id, language } = this.parseProposalRef(ref);
        const entry = this.requireTranslatable(typeId);
        const fields = entry.translation.translatableFields;
        const [proposed] = entry.translation.proposals ? await entry.translation.proposals.read([{ id, language }]) : [];
        const proposal = await this.findProposal(id, language);
        const [served] = await this.deps.reader.readPublic(typeId, [id]);
        const english = served ? entry.translation.extractTranslatable(served) : {};
        const values = proposed?.values ?? {};
        const markdownField = fields.find((field) => field.kind === 'markdown') ?? fields.find((field) => field.kind === 'multiline');
        const englishTitle = fieldText(english, 'title');
        const details = [
            { label: 'Language', value: language },
            { label: 'Content type', value: entry.type.label },
            { label: 'English title', value: englishTitle || id },
            ...(proposal ? [{ label: 'Proposed by', value: proposal.proposedBy }] : []),
            ...(proposal?.source ? [{ label: 'Source', value: proposal.source }] : []),
            ...(proposal && served && proposal.sourceHash !== this.hashValues(fields, english)
                ? [{ label: 'Warning', value: 'The English changed after this was proposed; approving it will be refused.' }]
                : [])
        ];
        for (const field of fields) {
            if (field.kind !== 'url' && field.name !== markdownField?.name && fieldText(values, field.name) !== '') {
                details.push({ label: field.label, value: fieldText(values, field.name) });
            }
        }

        return {
            title: `${entry.type.label} translation (${language}): ${fieldText(values, 'title') || englishTitle || id}`,
            summary: `A proposed ${language} translation of "${englishTitle || id}". Approving it ${(await this.findState(id, language))?.published ? 'replaces the translation visitors read' : 'saves it as a draft that a curator publishes from the translation editor'}.`,
            ...(markdownField ? { body: fieldText(values, markdownField.name) } : {}),
            details,
            editable: false
        };
    }

    /**
     * Compare a proposed translation with the translation visitors are served
     * in that language, over every field a translator writes. A language with
     * no served translation has nothing to compare against and gets the
     * `none` baseline, and the curator reads the proposal in full instead.
     *
     * @param ref - The queue item's ref, `{ typeId, id, language, holdId }`.
     * @returns The change set.
     */
    async describeProposalChanges(ref: Record<string, unknown>): Promise<IContentChangeSet> {
        const { typeId, id, language } = this.parseProposalRef(ref);
        const entry = this.requireTranslatable(typeId);
        const fields = entry.translation.translatableFields
            .filter((field) => field.kind !== 'url')
            .map((field) => ({ name: field.name, label: field.label }));
        const [proposed] = entry.translation.proposals ? await entry.translation.proposals.read([{ id, language }]) : [];
        const state = await this.findState(id, language);
        const [saved] = state?.published && !state.deletedAt ? await entry.translation.readTranslations([{ id, language }]) : [];

        return proposed && saved
            ? buildContentChangeSet(fields, saved.values, proposed.values)
            : { baseline: 'none', changes: [], unchangedFields: [] };
    }

    // ----------------------------------------------------------------- public

    /**
     * Read the translation a visitor is served, or null when the item is not
     * visible or the translation is not live and published.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code requested.
     * @returns The served item and translated values, or null.
     */
    async readPublicTranslation<T extends IContent>(
        typeId: string,
        id: string,
        language: string
    ): Promise<IServedContentTranslation<T> | null> {
        const entry = this.requireTranslatable(typeId);
        let served: IServedContentTranslation<T> | null = null;
        const state = LANGUAGE_CODE_PATTERN.test(language) && language !== DEFAULT_LANGUAGE
            ? await this.collection().findOne({ contentId: id, language, published: true, deletedAt: { $exists: false } })
            : null;
        if (state) {
            const [item] = await this.deps.reader.readPublic<T>(typeId, [id]);
            const [record] = item ? await entry.translation.readTranslations([{ id, language }]) : [];
            if (item && record) {
                served = { item, language, values: record.values, createdAt: state.createdAt, updatedAt: state.updatedAt };
            }
        }

        return served;
    }

    /**
     * List the items of one type with a published, live translation into a
     * language, for a translated index page.
     *
     * @param typeId - The managed content type.
     * @param language - Language code.
     * @returns Core content ids, in no particular order.
     */
    async listPublishedTranslationIds(typeId: string, language: string): Promise<string[]> {
        this.requireTranslatable(typeId);
        let ids: string[] = [];
        if (LANGUAGE_CODE_PATTERN.test(language) && language !== DEFAULT_LANGUAGE) {
            const states = await this.collection()
                .find(
                    { typeId, language, published: true, deletedAt: { $exists: false } },
                    { projection: { contentId: 1 } }
                )
                .toArray();
            ids = states.map((state) => state.contentId);
        }

        return ids;
    }

    /**
     * List every address with a published, live translation, across all
     * translatable types.
     *
     * @returns One route per address, sorted by path.
     */
    async listLocalizedRoutes(): Promise<IPublicLocalizedRoute[]> {
        const routes = new Map<string, Set<string>>();
        for (const type of this.deps.listTypes()) {
            if (!type.translation) {
                continue;
            }
            const states = await this.collection()
                .find(
                    { typeId: type.typeId, published: true, deletedAt: { $exists: false } },
                    { projection: { contentId: 1, language: 1 } }
                )
                .toArray();
            const languagesById = new Map<string, Set<string>>();
            for (const state of states) {
                const languages = languagesById.get(state.contentId) ?? new Set<string>();
                languages.add(state.language);
                languagesById.set(state.contentId, languages);
            }
            const items = languagesById.size > 0
                ? await this.deps.reader.readPublic(type.typeId, [...languagesById.keys()])
                : [];
            for (const item of items) {
                const languages = languagesById.get(item.id) ?? new Set<string>();
                const paths = type.translation.listPublicPaths(item)
                    .filter((path) => path.startsWith('/') && !ROUTE_PATTERN_CHARACTERS.test(path));
                for (const path of paths) {
                    const merged = routes.get(path) ?? new Set<string>();
                    languages.forEach((language) => merged.add(language));
                    routes.set(path, merged);
                }
            }
        }

        return [...routes.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([pattern, languages]) => ({ pattern, languages: [...languages].sort() }));
    }

    // --------------------------------------------------------------- settings

    /**
     * Read the AI settings for translation suggestions.
     *
     * @returns The settings.
     */
    async getSettings(): Promise<IContentTranslationSettings> {
        return this.deps.settings.getSettings();
    }

    /**
     * Change the AI settings for translation suggestions.
     *
     * @param updates - The fields to change.
     * @returns The settings after the change.
     */
    async updateSettings(
        updates: Partial<Omit<IContentTranslationSettings, 'updatedAt'>>
    ): Promise<IContentTranslationSettings> {
        return this.deps.settings.updateSettings(updates);
    }

    /**
     * Build the store a content type keeps its translated values in.
     *
     * @param database - The content type's own database.
     * @param collectionName - The collection to keep values in.
     * @returns The store.
     */
    createValueStore(database: IDatabaseService, collectionName: string): ITranslationValueStore {
        return new ContentTranslationStore(database, collectionName);
    }

    // -------------------------------------------------------------- internals

    /** The typed handle on the `content_translations` state collection. */
    private collection() {
        return this.deps.database.getCollection<IContentTranslationStateDocument>(CONTENT_TRANSLATIONS_COLLECTION);
    }

    /** The typed handle on the `content_translation_proposals` review-state collection. */
    private proposalCollection() {
        return this.deps.database.getCollection<IContentTranslationProposalDocument>(CONTENT_TRANSLATION_PROPOSALS_COLLECTION);
    }

    /**
     * Resolve a type's proposal storage.
     *
     * @param entry - The translatable type.
     * @returns The type's proposal storage.
     * @throws ContentError `forbidden` when the type accepts no proposals.
     */
    private requireProposals(entry: ITranslatableEntry): ITranslationProposals {
        const proposals = entry.translation.proposals;
        if (!proposals) {
            throw new ContentError('forbidden', `Translations of a ${entry.type.label} cannot be proposed; only a curator can change them`);
        }

        return proposals;
    }

    /**
     * Refuse a proposal into a language visitors cannot reach yet.
     *
     * @param language - The language code, already checked for format.
     * @throws Error when the language is unknown or not enabled.
     */
    private async requireEnabledLanguage(language: string): Promise<void> {
        if (!(await this.deps.isLanguageEnabled(language))) {
            throw new ContentTranslationInputError(`"${language}" is not an enabled language on this site; translations can be proposed only into enabled languages`);
        }

        return;
    }

    /**
     * Resolve the curation queue a proposal is held in.
     *
     * @returns The live curation service.
     * @throws ContentError `curation-unavailable` when it is not running, so a
     *   proposal is refused rather than stored with nothing to decide it.
     */
    private requireCuration(): ICurationService {
        const curation = this.deps.getCuration();
        if (!curation) {
            throw new ContentError('curation-unavailable', 'A proposed translation needs curator review, but the curation service is not available.');
        }

        return curation;
    }

    /** Load a proposal's review state, or null when none is open for that language. */
    private async findProposal(id: string, language: string): Promise<IContentTranslationProposalDocument | null> {
        return this.proposalCollection().findOne({ contentId: id, language }, { projection: { _id: 0 } });
    }

    /**
     * Read the open proposals of one item for the translation editor.
     *
     * @param entry - The translatable type.
     * @param id - Core content id of the item.
     * @param englishHash - Fingerprint of the English as it is now, for the stale flag.
     * @returns The proposals, ordered by language code.
     */
    private async listProposals(entry: ITranslatableEntry, id: string, englishHash: string): Promise<IContentTranslationProposal[]> {
        const docs = await this.proposalCollection().find({ contentId: id }).sort({ language: 1 }).toArray();
        const records = docs.length > 0 && entry.translation.proposals
            ? await entry.translation.proposals.read(docs.map((doc) => ({ id, language: doc.language })))
            : [];

        return docs.map((doc) => ({
            language: doc.language,
            values: records.find((record) => record.language === doc.language)?.values ?? {},
            stale: doc.sourceHash !== englishHash,
            proposedBy: doc.proposedBy,
            ...(doc.source ? { source: doc.source } : {}),
            proposedAt: doc.proposedAt,
            ...(doc.curationItemId ? { curationItemId: doc.curationItemId } : {})
        }));
    }

    /**
     * Build the values a proposal holds: the caller's text for every field a
     * translator writes, checked against the field list, and the saved
     * translation's value for every `url` field, because links to images are
     * not proposable.
     *
     * @param fields - The type's translatable fields.
     * @param raw - The caller's values.
     * @param saved - The saved translation's values, when there is one.
     * @returns One value per declared field.
     */
    private buildProposalValues(
        fields: ReadonlyArray<ITranslatableField>,
        raw: unknown,
        saved: TranslationValues | undefined
    ): TranslationValues {
        const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        const text: Record<string, unknown> = {};
        for (const field of fields) {
            if (field.kind !== 'url') {
                text[field.name] = input[field.name];
            }
        }
        const values = this.validateValues(fields.filter((field) => field.kind !== 'url'), text);
        for (const field of fields) {
            if (field.kind === 'url') {
                const kept = saved?.[field.name];
                values[field.name] = typeof kept === 'string' ? kept : '';
            }
        }

        return values;
    }

    /**
     * Make an approved proposal the saved translation. The English must still
     * be the text it translated, and neither the item nor the translation may
     * have been deleted since. Approval keeps the translation's published
     * state, and saves a language with no translation yet as a draft.
     *
     * @param entry - The translatable type.
     * @param proposal - The proposal being approved.
     * @throws ContentError `deleted` or `source-changed` when it cannot be applied.
     */
    private async approveProposal(entry: ITranslatableEntry, proposal: IContentTranslationProposalDocument): Promise<void> {
        const { contentId: id, language } = proposal;
        const proposals = this.requireProposals(entry);
        await this.requireLiveItem(entry, id);
        const state = await this.findState(id, language);
        if (state?.deletedAt) {
            throw new ContentError('deleted', `The "${language}" translation was deleted after this was proposed; nothing was changed`);
        }
        if ((await this.englishHash(entry, id)) !== proposal.sourceHash) {
            throw new ContentError('source-changed', `The English text changed after this "${language}" translation was proposed; nothing was changed`);
        }
        const [record] = await proposals.read([{ id, language }]);
        if (!record) {
            throw new Error(`The proposed "${language}" translation of ${id} has no stored text`);
        }
        await entry.translation.writeTranslation(id, language, record.values);
        const now = new Date();
        await this.collection().updateOne(
            { contentId: id, language },
            {
                $set: { typeId: entry.type.typeId, sourceHash: proposal.sourceHash, updatedAt: now, updatedBy: proposal.proposedBy },
                $setOnInsert: { published: false, createdAt: now, createdBy: proposal.proposedBy }
            },
            { upsert: true }
        );
        await this.discardProposal(entry, id, language, proposal.holdId);
        await this.notifyChanged(entry, id, language);

        return;
    }

    /**
     * Drop a proposal's review state and its held text. The text is cleared
     * only when this hold was still the current one, so a newer proposal that
     * replaced it in the meantime keeps its text.
     *
     * @param entry - The translatable type.
     * @param id - Core content id of the item.
     * @param language - Language code of the proposal.
     * @param holdId - The hold being dropped.
     */
    private async discardProposal(entry: ITranslatableEntry, id: string, language: string, holdId: string): Promise<void> {
        const removed = await this.proposalCollection().deleteOne({ contentId: id, language, holdId });
        if (removed.deletedCount > 0) {
            await entry.translation.proposals?.clear(id, language);
        }

        return;
    }

    /**
     * Close any proposal open for a language after a curator changed the
     * translation directly, so approving the older proposal later cannot
     * overwrite or undo what the curator did. Its queue item is rejected in
     * the curator's name. A failure to close the queue item is logged rather
     * than thrown, because the proposal itself is already gone and the queue
     * item can no longer decide anything.
     *
     * @param entry - The translatable type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @param actor - The curator whose change replaced the proposal.
     */
    private async supersedeProposal(entry: ITranslatableEntry, id: string, language: string, actor: IContentActor): Promise<void> {
        const proposal = await this.findProposal(id, language);
        if (proposal) {
            await this.discardProposal(entry, id, language, proposal.holdId);
            const curation = this.deps.getCuration();
            if (proposal.curationItemId && curation) {
                await this.closeQueueItem(curation, proposal.curationItemId, actor.id);
            }
            this.deps.logger.info({ typeId: entry.type.typeId, id, language, actor: actor.id }, 'Translation proposal closed by a curator change');
        }

        return;
    }

    /**
     * Reject a queue item whose proposal has already been replaced or
     * dropped. The rejection reaches `applyProposalDecision`, which finds no
     * matching hold and changes nothing, so this only closes the item.
     *
     * @param curation - The live curation service.
     * @param curationItemId - The queue item to close.
     * @param decidedBy - Recorded as the decider.
     */
    private async closeQueueItem(curation: ICurationService, curationItemId: string, decidedBy: string): Promise<void> {
        try {
            await curation.reject(curationItemId, decidedBy);
        } catch (error) {
            this.deps.logger.warn({ error, curationItemId }, 'Failed to close a superseded translation proposal in the curation queue');
        }

        return;
    }

    /**
     * Read the parts of a proposal's queue ref.
     *
     * @param ref - The queue item's ref.
     * @returns The type, item, language, and hold it names.
     */
    private parseProposalRef(ref: Record<string, unknown>): { typeId: string; id: string; language: string; holdId: string } {
        return {
            typeId: String(ref.typeId ?? ''),
            id: String(ref.id ?? ''),
            language: String(ref.language ?? ''),
            holdId: typeof ref.holdId === 'string' ? ref.holdId : ''
        };
    }

    /**
     * Resolve a registered type that takes part in translation.
     *
     * @param typeId - The managed content type id.
     * @returns The type and its translation side.
     * @throws ContentError `unknown-type` when the type is not registered or not translatable.
     */
    private requireTranslatable(typeId: string): ITranslatableEntry {
        const type = this.deps.getType(typeId);
        if (!type?.translation) {
            throw new ContentError('unknown-type', `No translatable managed content type registered for '${typeId}'`);
        }

        return { type, translation: type.translation };
    }

    /**
     * Refuse a translation write from anyone but a curator. Translations are
     * not reviewed, so letting anyone else write one would put unchecked text
     * in front of visitors.
     *
     * @param actor - Who is writing.
     * @param entry - The type, named in the refusal.
     * @throws ContentError `forbidden` for a non-curator.
     */
    private requireCurator(actor: IContentActor, entry: ITranslatableEntry): void {
        if (!actor.isCurator) {
            throw new ContentError('forbidden', `Only a curator may change translations of a ${entry.type.label}`);
        }

        return;
    }

    /**
     * Check a translation's language code. The item itself is the default
     * language, so a translation into it would compete with the item for the
     * same address.
     *
     * @param language - The caller's language code.
     * @throws Error when it is malformed or the default language.
     */
    private requireLanguage(language: string): void {
        if (!LANGUAGE_CODE_PATTERN.test(language)) {
            throw new ContentTranslationInputError(`"${language}" is not a valid language code`);
        }
        if (language === DEFAULT_LANGUAGE) {
            throw new ContentTranslationInputError(`The item itself is the "${DEFAULT_LANGUAGE}" version; a translation needs another language`);
        }

        return;
    }

    /**
     * Confirm an item exists and is not deleted before writing to it.
     *
     * @param entry - The managed type.
     * @param id - Core content id of the item.
     * @throws ContentError `not-found` or `deleted`.
     */
    private async requireLiveItem(entry: ITranslatableEntry, id: string): Promise<void> {
        const [item] = await this.deps.reader.readAdmin(entry.type.typeId, [id]);
        if (!item) {
            throw new ContentError('not-found', `No ${entry.type.label} with id ${id}`);
        }
        if (item.deletedAt) {
            throw new ContentError('deleted', `The ${entry.type.label} is deleted; restore it before translating it`);
        }

        return;
    }

    /** Load a translation's state, or null when the item has no translation into that language. */
    private async findState(id: string, language: string): Promise<IContentTranslationStateDocument | null> {
        return this.collection().findOne({ contentId: id, language }, { projection: { _id: 0 } });
    }

    /**
     * Load a translation's state that the caller expects to exist.
     *
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @returns The state.
     * @throws ContentError `not-found` when there is no such translation.
     */
    private async requireState(id: string, language: string): Promise<IContentTranslationStateDocument> {
        const state = await this.findState(id, language);
        if (!state) {
            throw new ContentError('not-found', `This item has no translation into "${language}"`);
        }

        return state;
    }

    /**
     * Load the English text translators work from: the version visitors are
     * served, or the latest edit when no version is served yet. The editor,
     * the Suggest request, and the stale check all use this, so a translator
     * works from the same text the stale check compares with.
     *
     * @param entry - The managed type.
     * @param id - Core content id of the item.
     * @returns The item at that version.
     * @throws ContentError `not-found` when no item has that id.
     */
    private async loadEnglish(entry: ITranslatableEntry, id: string): Promise<IContent> {
        const [served] = await this.deps.reader.readPublic(entry.type.typeId, [id]);
        const [latest] = served ? [served] : await this.deps.reader.readAdmin(entry.type.typeId, [id]);
        if (!latest) {
            throw new ContentError('not-found', `No ${entry.type.label} with id ${id}`);
        }

        return latest;
    }

    /** Fingerprint (SHA-256 hex digest) the English text a translation is written against. */
    private async englishHash(entry: ITranslatableEntry, id: string): Promise<string> {
        const english = entry.translation.extractTranslatable(await this.loadEnglish(entry, id));

        return this.hashValues(entry.translation.translatableFields, english);
    }

    /**
     * Fingerprint the English text of a batch of items in two reads, the same
     * version rule `loadEnglish` applies one item at a time: the version
     * visitors are served, else the latest edit.
     *
     * @param entry - The managed type.
     * @param ids - Core content ids of the items.
     * @returns Each found item's fingerprint, keyed by content id.
     */
    private async englishHashes(entry: ITranslatableEntry, ids: ReadonlyArray<string>): Promise<Map<string, string>> {
        const hashes = new Map<string, string>();
        if (ids.length > 0) {
            const served = await this.deps.reader.readPublic(entry.type.typeId, ids);
            const servedIds = new Set(served.map((item) => item.id));
            const unserved = ids.filter((id) => !servedIds.has(id));
            const latest = unserved.length > 0 ? await this.deps.reader.readAdmin(entry.type.typeId, unserved) : [];
            for (const item of [...served, ...latest]) {
                hashes.set(item.id, this.hashValues(entry.translation.translatableFields, entry.translation.extractTranslatable(item)));
            }
        }

        return hashes;
    }

    /**
     * Fingerprint the translatable text, so two loads of the same English
     * always produce the same value and any change to it produces another.
     * `url` fields are left out: changing an image is not a change a
     * translator has to follow. The values are hashed as one object in field
     * order, so a type that appends a field changes every fingerprint once
     * and a type that keeps its fields keeps its fingerprints.
     *
     * @param fields - The type's translatable fields.
     * @param values - The values to fingerprint.
     * @returns A SHA-256 hex digest.
     */
    private hashValues(fields: ReadonlyArray<ITranslatableField>, values: TranslationValues): string {
        const text: TranslationValues = {};
        for (const field of fields) {
            if (field.kind !== 'url') {
                text[field.name] = values[field.name] ?? (field.kind === 'string-list' ? [] : '');
            }
        }

        return createHash('sha256').update(JSON.stringify(text)).digest('hex');
    }

    /**
     * Check a caller's values against the type's field list and reduce them
     * to exactly the declared fields. Single-line text and lists are trimmed;
     * Markdown and multi-line text keep their whitespace.
     *
     * @param fields - The type's translatable fields.
     * @param raw - The caller's values.
     * @returns One value per declared field.
     * @throws Error when a value has the wrong shape or a required one is empty.
     */
    private validateValues(fields: ReadonlyArray<ITranslatableField>, raw: unknown): TranslationValues {
        const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        const values: TranslationValues = {};
        for (const field of fields) {
            const value = input[field.name];
            let empty: boolean;
            if (field.kind === 'string-list') {
                if (value !== undefined && !(Array.isArray(value) && value.every((entry) => typeof entry === 'string'))) {
                    throw new ContentTranslationInputError(`${field.label} must be a list of text`);
                }
                const list = ((value as string[] | undefined) ?? []).map((entry) => entry.trim()).filter((entry) => entry !== '');
                values[field.name] = list;
                empty = list.length === 0;
            } else {
                if (value !== undefined && typeof value !== 'string') {
                    throw new ContentTranslationInputError(`${field.label} must be text`);
                }
                const text = typeof value === 'string' ? value : '';
                values[field.name] = field.kind === 'text' || field.kind === 'url' ? text.trim() : text;
                empty = text.trim() === '';
            }
            if (field.required && empty) {
                throw new ContentTranslationInputError(`${field.label} is required`);
            }
        }

        return values;
    }

    /**
     * Tell the content type and the localization snapshot that a translation
     * changed. A failure in the type's cache handling is logged, not thrown,
     * because the change itself is already stored.
     *
     * @param entry - The managed type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     */
    private async notifyChanged(entry: ITranslatableEntry, id: string, language: string): Promise<void> {
        try {
            await entry.translation.onTranslationChanged(id, language);
        } catch (error) {
            this.deps.logger.warn({ error, typeId: entry.type.typeId, id, language }, 'Content type failed to react to a translation change');
        }
        this.deps.onRoutesChanged();

        return;
    }

    /**
     * Load one translation for returning from a write.
     *
     * @param entry - The managed type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @param englishHash - Fingerprint of the English text as it is now.
     * @returns The translation.
     */
    private async readOne(
        entry: ITranslatableEntry,
        id: string,
        language: string,
        englishHash: string
    ): Promise<IContentTranslation> {
        const state = await this.requireState(id, language);
        const records = await entry.translation.readTranslations([{ id, language }]);

        return this.toTranslation(state, records, englishHash);
    }

    /**
     * Join a translation's state with its stored values.
     *
     * @param state - The state core keeps.
     * @param records - Values the content type returned; the matching one is used.
     * @param englishHash - Fingerprint of the English text as it is now.
     * @returns The translation, flagged stale when it was written against different English text.
     */
    private toTranslation(
        state: IContentTranslationStateDocument,
        records: ReadonlyArray<ITranslationValueRecord>,
        englishHash: string
    ): IContentTranslation {
        const record = records.find((candidate) => candidate.id === state.contentId && candidate.language === state.language);

        return {
            typeId: state.typeId,
            contentId: state.contentId,
            language: state.language,
            values: record?.values ?? {},
            published: state.published,
            stale: state.sourceHash !== englishHash,
            ...(state.deletedAt ? { deletedAt: state.deletedAt } : {}),
            createdAt: state.createdAt,
            createdBy: state.createdBy,
            updatedAt: state.updatedAt,
            updatedBy: state.updatedBy
        };
    }

    /**
     * Run one of the `content.before*` veto hooks for a translation write.
     *
     * @param descriptor - The hook to run.
     * @param context - What is about to happen, with `language` set.
     * @throws ContentError `vetoed` when a handler aborts.
     */
    private async runVeto(
        descriptor: HookDescriptor<IContentWriteContext, void, 'series'>,
        context: IContentWriteContext
    ): Promise<void> {
        await runContentVeto(this.deps.hookRegistry, descriptor, context);

        return;
    }
}
