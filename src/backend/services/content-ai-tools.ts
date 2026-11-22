/**
 * @fileoverview AI tools over translations of managed content: one read and
 * one proposal that is always held for curator review.
 *
 * Pages and blog posts can be served in other languages through translations
 * that core keeps for every translatable content type. These tools let an
 * agent correct or write one:
 *
 * - `content-get-translation`: the English visitors read, its fingerprint, and
 *   the translation visitors read in one language, if any.
 * - `content-propose-translation`: hold a new or corrected translation in the
 *   curation queue. Nothing visitors see changes until a curator approves it.
 *
 * Both work for every translatable type, so they are owned by the core
 * content service rather than by pages or the blog. The read returns only what
 * a visitor can already read, which is what lets it declare `public`
 * sensitivity. The proposal declares `forcesCuratorReview` bound to the
 * `core:content-translation` curation type, so the governor relaxes its review
 * gate only while that binding is registered.
 *
 * @module backend/services/content-ai-tools
 */

import type {
    IAiTool,
    IAiToolCapability,
    IAiToolRegistry,
    IContentActor,
    IContentTranslationService,
    IServiceRegistry,
    ISystemLogService,
    IToolEndUserPrincipal,
    ServiceWatchDisposer,
    TranslationValues
} from '@/types';
import { DEFAULT_LANGUAGE, LANGUAGE_CODE_PATTERN } from '@/types';
import { CONTENT_TRANSLATION_CURATION_TYPE_ID } from './content-translation-curation.js';
import { isContentError } from './content-error.js';
import { ContentTranslationInputError } from './content-translation-errors.js';

/** Provider id passed to `registerTool`, so the admin page groups these under the content service. */
const PROVIDER_ID = 'content';

/**
 * Every tool's name, led by the content service's registry name. Spelled once
 * so the `name` fields, the cross-references inside descriptions, and the log
 * context cannot drift apart. Renaming a shipped tool drops its stored enabled
 * state and policy overrides and breaks any saved prompt naming it.
 */
export const CONTENT_AI_TOOL_NAMES = {
    getTranslation: 'content-get-translation',
    proposeTranslation: 'content-propose-translation'
} as const;

/**
 * Read-only, free, and `public`: the context holds only the served English and
 * the served translation. Not `surfacesUntrustedContent`, because every served
 * version was written or approved by a curator.
 */
const READ_CAPABILITY: IAiToolCapability = {
    sideEffect: 'read',
    reversible: true,
    sensitivity: 'public'
};

/**
 * External and irreversible because an approved translation changes what
 * visitors read in that language. Every proposal is held in the curation
 * queue under `core:content-translation`, which the binding lets the governor
 * check instead of trusting.
 */
const PROPOSE_CAPABILITY: IAiToolCapability = {
    sideEffect: 'external',
    reversible: false,
    sensitivity: 'public',
    forcesCuratorReview: true,
    curationTypeId: CONTENT_TRANSLATION_CURATION_TYPE_ID
};

/**
 * Content service refusals the model caused or can act on, so their message is
 * returned to it as an input error rather than hidden.
 */
const INPUT_CONTENT_ERROR_CODES: ReadonlySet<string> = new Set([
    'unknown-type', 'not-found', 'deleted', 'vetoed', 'forbidden', 'source-changed', 'superseded'
]);

/** Shape of a core content id, which `crypto.randomUUID()` issues. */
const CONTENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape of a managed content type id, `<provider>:<name>`. */
const TYPE_ID_PATTERN = /^[a-z0-9-]{1,40}:[a-z0-9-]{1,40}$/;

/** Shape of a SHA-256 hex fingerprint. */
const SOURCE_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Most characters of English plus translated text one read returns. Stored
 * content is bounded by each type's own limits, so this only stops a single
 * unusually long item from filling the model's context.
 */
const MAX_CONTEXT_CHARACTERS = 80_000;

/**
 * Most proposals the tool holds in any rolling 24 hours, across every caller.
 * Each one opens a curation queue item and notifies admins, and decided items
 * are kept forever, so a looping or misled model must not flood the queue.
 */
const MAX_PROPOSALS_PER_DAY = 200;

/** Length of the rolling window `MAX_PROPOSALS_PER_DAY` counts over. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The rule shared by both descriptions for picking the right type id. */
const TYPE_GUIDANCE =
    'typeId names the kind of content: "core:page" for a site page (ids come from the pages tools) or "blog:post" for a blog post ' +
    '(ids come from the blog tools, when the blog is available). ';

/** A refusal written for the model, carried as a thrown error so validation can stay in small helpers. */
class ContentToolInputError extends Error {}

/**
 * Counts proposals in a rolling 24-hour window, so the proposal tool can
 * refuse once the daily allowance is spent. Kept in memory: a restart resets
 * it, which only ever allows more, and the governor's per-minute limit still
 * applies on top.
 */
export class ProposalQuota {
    private readonly timestamps: number[] = [];

    /**
     * @param limit - Proposals allowed per rolling window.
     * @param windowMs - Length of the window.
     * @param now - Clock, injected so tests can move time.
     */
    constructor(
        private readonly limit: number = MAX_PROPOSALS_PER_DAY,
        private readonly windowMs: number = DAY_MS,
        private readonly now: () => number = Date.now
    ) {}

    /**
     * Use one proposal from the allowance.
     *
     * @returns True when a proposal may go ahead, false when the allowance is spent.
     */
    tryConsume(): boolean {
        const cutoff = this.now() - this.windowMs;
        while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
            this.timestamps.shift();
        }
        const allowed = this.timestamps.length < this.limit;
        if (allowed) {
            this.timestamps.push(this.now());
        }

        return allowed;
    }
}

/**
 * Read and check the item address every tool takes.
 *
 * @param input - The tool input.
 * @returns The type id, content id, and language.
 * @throws ContentToolInputError naming the first malformed field.
 */
function readTarget(input: Record<string, unknown>): { typeId: string; id: string; language: string } {
    const typeId = typeof input.typeId === 'string' ? input.typeId.trim() : '';
    const id = typeof input.id === 'string' ? input.id.trim().toLowerCase() : '';
    const language = typeof input.language === 'string' ? input.language.trim().toLowerCase() : '';
    if (!TYPE_ID_PATTERN.test(typeId)) {
        throw new ContentToolInputError('typeId must be a content type id such as "core:page" or "blog:post".');
    }
    if (!CONTENT_ID_PATTERN.test(id)) {
        throw new ContentToolInputError('id must be a content id (a UUID) as the pages or blog tools return it.');
    }
    if (!LANGUAGE_CODE_PATTERN.test(language) || language === DEFAULT_LANGUAGE) {
        throw new ContentToolInputError(`language must be a language code such as "zh" or "vi", and not "${DEFAULT_LANGUAGE}", which is the original.`);
    }

    return { typeId, id, language };
}

/** Count the characters of every text value, so a read can refuse an item too long for one call. */
function countCharacters(values: TranslationValues | undefined): number {
    let total = 0;
    for (const value of Object.values(values ?? {})) {
        total += Array.isArray(value) ? value.join('').length : value.length;
    }

    return total;
}

/**
 * Build the actor a proposal is recorded under. Never a curator, so core holds
 * the proposal for review. A signed-in caller is recorded by user id, so the
 * queue shows who asked for the change.
 *
 * @param principal - The end user the governor resolved, when there is one.
 * @returns A non-curator actor.
 */
function proposalActor(principal: IToolEndUserPrincipal | undefined): IContentActor {
    const userId = principal?.userId?.trim();

    return userId
        ? { id: userId, kind: 'user', isCurator: false }
        : { id: `system:ai-tool:${CONTENT_AI_TOOL_NAMES.proposeTranslation}`, kind: 'system', isCurator: false };
}

/**
 * Run one tool call, turning an input refusal into an answer the model can act
 * on and any other failure into a generic one that is logged in full.
 *
 * @param logger - Where unexpected failures are recorded.
 * @param toolName - The tool's name, for the log line.
 * @param body - The tool's work.
 * @returns `{ success: true, ... }`, or `{ success: false, error, errorKind }`.
 */
async function runContentTool(
    logger: ISystemLogService,
    toolName: string,
    body: () => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
    let response: Record<string, unknown>;
    try {
        response = { success: true, ...(await body()) };
    } catch (error) {
        if (error instanceof ContentToolInputError || error instanceof ContentTranslationInputError) {
            response = { success: false, error: error.message, errorKind: 'input' };
        } else if (isContentError(error) && INPUT_CONTENT_ERROR_CODES.has(error.code)) {
            response = { success: false, error: error.message, errorKind: 'input', code: error.code };
        } else if (isContentError(error) && error.code === 'curation-unavailable') {
            response = { success: false, error: 'The review queue is unavailable, so the proposal was not stored. Retrying later may work.', errorKind: 'failed' };
        } else {
            logger.error({ error, tool: toolName }, 'Content AI tool failed unexpectedly');
            response = { success: false, error: 'The translation tool failed. This is not caused by your input; retrying later may work.', errorKind: 'failed' };
        }
    }

    return response;
}

/**
 * Build the two translation tools against the translation service.
 *
 * @param translations - The core translation service. It owns every rule: what
 *   a visitor can read, what a proposal must pass, and holding it for review.
 * @param logger - Logger for unexpected failures.
 * @param quota - The daily proposal allowance, injected so tests can replace it.
 * @returns The tools, read first.
 */
export function buildContentAiTools(
    translations: IContentTranslationService,
    logger: ISystemLogService,
    quota: ProposalQuota = new ProposalQuota()
): IAiTool[] {
    const getTranslation: IAiTool = {
        name: CONTENT_AI_TOOL_NAMES.getTranslation,
        title: 'Read a page or post translation',
        description:
            'Read what visitors see for one site page or blog post in one language: the English text, its sourceHash fingerprint, and the published translation into that language, if any. ' +
            `Use before ${CONTENT_AI_TOOL_NAMES.proposeTranslation}, to translate the current English and to see what the existing translation says. ` +
            TYPE_GUIDANCE +
            'Parameters: typeId (required), id (required, the content id, a UUID), language (required, a language code such as "zh", "vi", or "es"; never "en"). ' +
            'Returns { success, typeId, contentId, language, fields, source, sourceHash, translation, proposalPending }. ' +
            'fields lists each translatable field with its name, label, and kind; a field of kind "url" (a social image) cannot be proposed. ' +
            'source holds the English values by field name. translation is null when no published translation exists, otherwise { values, stale, custom, updatedAt }, where stale means the English changed after it was written. ' +
            'custom true means an admin keeps that language version deliberately different from the English, for its own readers or for search; edit it on its own terms rather than re-translating it from the English. ' +
            'proposalPending is true when a proposal for this language is already waiting for review; a new proposal replaces it. ' +
            'Returns { success: true, found: false } when the item is not served to visitors. ' +
            'Drafts, deleted translations, and edits waiting for review are never returned. Read-only; never changes anything.',
        capability: READ_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The item and the language to read.',
            properties: {
                typeId: { type: 'string', description: 'Content type id: "core:page" or "blog:post".' },
                id: { type: 'string', description: 'Content id (a UUID) from the pages or blog tools.' },
                language: { type: 'string', description: 'Language code such as "zh" or "vi". Not "en".' }
            },
            required: ['typeId', 'id', 'language'],
            additionalProperties: false
        },
        inputExamples: [
            { typeId: 'core:page', id: '3f2b8c1e-9d4a-4e7b-8a1c-5d6e7f809a1b', language: 'zh' },
            { typeId: 'blog:post', id: '9a1b5d6e-7f80-4e7b-8a1c-3f2b8c1e9d4a', language: 'vi' }
        ],
        /**
         * Validate the address and return the served context, refusing an
         * item too long for one call.
         *
         * @param input - The model's arguments.
         * @returns The context, or `found: false` when the item is not served.
         */
        handler: async (input) => runContentTool(logger, CONTENT_AI_TOOL_NAMES.getTranslation, async () => {
            const { typeId, id, language } = readTarget(input);
            const context = await translations.getTranslationContext(typeId, id, language);
            let result: Record<string, unknown> = { found: false };
            if (context) {
                const size = countCharacters(context.source) + countCharacters(context.translation?.values);
                if (size > MAX_CONTEXT_CHARACTERS) {
                    throw new ContentToolInputError('This item is too long to translate through this tool. Ask an admin to use the translation editor instead.');
                }
                result = {
                    found: true,
                    ...context,
                    translation: context.translation
                        ? { ...context.translation, updatedAt: context.translation.updatedAt.toISOString() }
                        : null
                };
            }
            return result;
        })
    };

    const proposeTranslation: IAiTool = {
        name: CONTENT_AI_TOOL_NAMES.proposeTranslation,
        title: 'Propose a translation',
        description:
            'Propose a new or corrected translation of one site page or blog post into one language, for human review. The translation is NOT applied immediately: ' +
            'it is held in the central curation queue, and visitors keep seeing the current version until an admin approves it. ' +
            'Approving it keeps the language version published if it already was; a language with no translation yet is saved as a draft that an admin publishes. ' +
            `Use when asked to fix or update a translated version of a page or post, or to translate one into an enabled language. To change the English, use the pages or blog edit tools instead. ` +
            `BEFORE proposing, call ${CONTENT_AI_TOOL_NAMES.getTranslation} for the same item and language and translate its source values. ` +
            TYPE_GUIDANCE +
            'Parameters: typeId, id, and language (required) as for the read tool. ' +
            `sourceHash (required) is the sourceHash ${CONTENT_AI_TOOL_NAMES.getTranslation} returned; the proposal is refused if the English changed since, and you must read it again. ` +
            'values (required) holds the complete translation keyed by field name: send every field that has English text, never only the changed ones, because the proposal replaces the whole translation. ' +
            'Use each field\'s kind: a string for text, multiline, and markdown fields, and a list of strings for string-list fields. Fields of kind "url" are ignored. ' +
            'A TRON address, or a link to another site (http, https, or a target starting with //), that the English does not contain is refused, and the error lists it. ' +
            'Numbers, links to pages on this site (paths starting with /), and addresses or links you leave out may differ from the English, ' +
            'and a language version may legitimately differ for its readers; write numbers in digits. Every difference is listed for the reviewer. ' +
            'custom (optional boolean) asks the reviewer to mark the language version custom (true), meaning it no longer tracks the English and is never flagged stale, ' +
            'or to return it to tracking the English (false). Omit it to keep the current setting. Set it only when asked to, or when the version deliberately departs from the English. ' +
            'Keep the Markdown structure (headings, lists, links) of the English unless the version is custom. ' +
            'If a proposal for the language is already waiting, yours replaces it. ' +
            'Returns { success, typeId, contentId, language, pendingReview, curationItemId, differences }. differences lists, one sentence each, how the numbers, links, and addresses differ from the English; check it for anything you changed by mistake, and propose again to fix it. Never report the translation as live. ' +
            'Never use this to answer the user or relay findings; write those as normal text in the conversation.',
        capability: PROPOSE_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The item, language, English fingerprint, and complete proposed translation.',
            properties: {
                typeId: { type: 'string', description: 'Content type id: "core:page" or "blog:post".' },
                id: { type: 'string', description: 'Content id (a UUID).' },
                language: { type: 'string', description: 'Language code such as "zh" or "vi". Not "en".' },
                sourceHash: { type: 'string', description: `The sourceHash ${CONTENT_AI_TOOL_NAMES.getTranslation} returned for this item.` },
                values: {
                    type: 'object',
                    description: 'The complete translation keyed by field name: strings, or lists of strings for string-list fields.',
                    additionalProperties: {
                        anyOf: [
                            { type: 'string' },
                            { type: 'array', items: { type: 'string' } }
                        ]
                    }
                },
                custom: {
                    type: 'boolean',
                    description: 'Optional. true asks to mark the language version custom (no longer tracks the English); false asks to return it to tracking the English. Omit to keep the current setting.'
                }
            },
            required: ['typeId', 'id', 'language', 'sourceHash', 'values'],
            additionalProperties: false
        },
        // A page translation with a keyword list, a custom Russian version
        // that links the Russian copy of a page, and a blog post translation
        // that leaves its optional search fields empty.
        inputExamples: [
            {
                typeId: 'core:page',
                id: '3f2b8c1e-9d4a-4e7b-8a1c-5d6e7f809a1b',
                language: 'zh',
                sourceHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
                values: {
                    title: '在 TRON 上租用能量',
                    description: '租用能量可以避免质押 TRX 的前期成本。',
                    keywords: ['能量', '租赁', 'tron'],
                    body: '# 在 TRON 上租用能量\n\n租用能量可以避免质押 TRX 的前期成本。请参阅 [能量市场](/resource-markets)。'
                }
            },
            {
                typeId: 'core:page',
                id: '5d6e7f80-9a1b-4e7b-8a1c-3f2b8c1e9d4a',
                language: 'ru',
                sourceHash: 'fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
                values: {
                    title: 'Калькулятор стейкинга TRON (трон)',
                    description: 'Сколько энергии вы получите за стейкинг TRX.',
                    keywords: ['стейкинг трон калькулятор', 'калькулятор стейкинга trx'],
                    body: '# Калькулятор стейкинга трон\n\nРазморозка TRX занимает 14 дней. Сравните с [арендой энергии](/ru/resource-markets).'
                },
                custom: true
            },
            {
                typeId: 'blog:post',
                id: '9a1b5d6e-7f80-4e7b-8a1c-3f2b8c1e9d4a',
                language: 'vi',
                sourceHash: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
                values: {
                    title: 'Giá năng lượng tuần này',
                    metaTitle: '',
                    description: '',
                    body: 'Giá thuê năng lượng giảm 12% so với tuần trước.',
                    imageAlt: ''
                }
            }
        ],
        /**
         * Validate the address, fingerprint, and optional custom request,
         * spend one proposal from the daily allowance, and hand the values to
         * the translation service.
         *
         * @param input - The model's arguments.
         * @param principal - The signed-in caller, recorded as the proposer.
         * @returns The proposal outcome.
         */
        handler: async (input, principal) => runContentTool(logger, CONTENT_AI_TOOL_NAMES.proposeTranslation, async () => {
            const { typeId, id, language } = readTarget(input);
            const sourceHash = typeof input.sourceHash === 'string' ? input.sourceHash.trim().toLowerCase() : '';
            if (!SOURCE_HASH_PATTERN.test(sourceHash)) {
                throw new ContentToolInputError(`sourceHash must be the 64-character fingerprint ${CONTENT_AI_TOOL_NAMES.getTranslation} returned.`);
            }
            const values = input.values;
            if (!values || typeof values !== 'object' || Array.isArray(values)) {
                throw new ContentToolInputError('values must be an object holding the translation keyed by field name.');
            }
            if (input.custom !== undefined && typeof input.custom !== 'boolean') {
                throw new ContentToolInputError('custom must be true, false, or left out.');
            }
            const custom = typeof input.custom === 'boolean' ? input.custom : undefined;
            if (!quota.tryConsume()) {
                throw new ContentToolInputError('The daily allowance of proposed translations is used up. Try again tomorrow, or ask an admin to use the translation editor.');
            }
            // Field rules, the anchor comparison, and the hold all belong to
            // the translation service; the raw values are forwarded.
            const outcome = await translations.proposeTranslation(
                typeId,
                id,
                language,
                {
                    values: values as TranslationValues,
                    sourceHash,
                    source: `ai-tool:${CONTENT_AI_TOOL_NAMES.proposeTranslation}`,
                    ...(custom !== undefined ? { custom } : {})
                },
                proposalActor(principal)
            );
            return { ...outcome };
        })
    };

    return [getTranslation, proposeTranslation];
}

/**
 * Register the translation tools whenever the core `'ai-tools'` registry is
 * available. The AI tools module publishes the registry after bootstrap, so
 * the tools subscribe to its presence with `watch()`. Each tool is
 * unregistered before it is registered, so the registry coming back does not
 * trip the duplicate-name guard. A failure is logged rather than thrown,
 * because AI tooling is optional and must not stop content from being served.
 *
 * @param serviceRegistry - The registry to watch for `'ai-tools'`.
 * @param translations - The core translation service the tools go through.
 * @param logger - Logger for registration and unexpected failures.
 * @returns Disposer that removes the watch subscription.
 */
export function registerContentAiTools(
    serviceRegistry: IServiceRegistry,
    translations: IContentTranslationService,
    logger: ISystemLogService
): ServiceWatchDisposer {
    const tools = buildContentAiTools(translations, logger);

    return serviceRegistry.watch<IAiToolRegistry>('ai-tools', {
        /**
         * Register both tools on the registry that just became available.
         *
         * @param registry - The core AI tool registry.
         */
        onAvailable: (registry) => {
            for (const tool of tools) {
                try {
                    registry.unregisterTool(tool.name);
                    registry.registerTool(tool, PROVIDER_ID);
                } catch (error) {
                    logger.error({ error, tool: tool.name }, 'Failed to register a content AI tool');
                }
            }
            logger.info({ tools: tools.map((tool) => tool.name) }, 'Registered content translation AI tools');
        }
    });
}
