/**
 * @fileoverview Reads and writes the localization module's settings: the
 * system prompt and the AI provider and model the translation buttons use.
 *
 * The settings live in one document so the Settings tab and the suggestion
 * service always agree on a single current value. Before anything is saved the
 * service returns built-in defaults, so the buttons work on a fresh install.
 */

import type { IDatabaseService, ILocalizationSettings, ISystemLogService } from '@/types';
import type { ILocalizationSettingsDocument } from '../database/index.js';
import { SETTINGS_COLLECTION } from '../database/index.js';
import { LocalizationValidationError } from './localization-errors.js';

/** Longest system prompt accepted. Long enough for a sizeable glossary. */
export const MAX_SYSTEM_PROMPT_LENGTH = 8000;

/** Longest provider or model id accepted. */
const MAX_ID_LENGTH = 200;

/**
 * System prompt used until an administrator writes their own. It sets the
 * translator's role and the rules that matter for interface text; the
 * administrator's glossary belongs in their own version of it.
 */
export const DEFAULT_SYSTEM_PROMPT = [
    'You are a professional translator localizing the interface of TronRelic, a TRON blockchain analytics website.',
    'Translate for readers who use cryptocurrency products. Use the terms established wallets and exchanges use in the target language rather than literal translations.',
    'Keep translations about as short as the English, because they appear in buttons, menus, table headers, and short descriptions.',
    'Leave product names, token tickers such as TRX and USDT, addresses, numbers, and URLs unchanged.'
].join(' ');

/** Fields an administrator may change. */
export interface ILocalizationSettingsPatch {
    /** New system prompt. */
    systemPrompt?: string;
    /** New provider id, or null for the active provider. */
    providerId?: string | null;
    /** New model id, or null for the provider's default. */
    model?: string | null;
}

/** Collaborators the settings service needs. */
export interface ILocalizationSettingsServiceDependencies {
    /** Core database service. */
    database: IDatabaseService;
    /** Module-scoped logger; every save is recorded with the actor. */
    logger: ISystemLogService;
}

/**
 * Settings storage for the AI translation assist.
 */
export class LocalizationSettingsService {
    private readonly database: IDatabaseService;
    private readonly logger: ISystemLogService;

    /**
     * @param deps - Collaborators wired by the module.
     */
    constructor(deps: ILocalizationSettingsServiceDependencies) {
        this.database = deps.database;
        this.logger = deps.logger;
    }

    /**
     * Read the current settings, falling back to the defaults for anything
     * never saved.
     *
     * @returns The settings in their wire form.
     */
    async getSettings(): Promise<ILocalizationSettings> {
        const document = await this.collection().findOne({ key: 'settings' });
        return {
            systemPrompt: document?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            providerId: document?.providerId ?? null,
            model: document?.model ?? null,
            updatedAt: document?.updatedAt ? document.updatedAt.toISOString() : null,
            updatedBy: document?.updatedBy ?? null
        };
    }

    /**
     * Change some or all of the settings.
     *
     * A provider and model are a pair: a model id only means something on the
     * provider that offers it. Changing the provider without naming a model
     * therefore clears the model, so a stale id from the old provider is
     * never sent to the new one.
     *
     * @param patch - Fields to change.
     * @param actor - Who made the change, recorded on the document and in the log.
     * @returns The settings after the change.
     * @throws LocalizationValidationError for a value outside its limits.
     */
    async updateSettings(patch: ILocalizationSettingsPatch, actor: string): Promise<ILocalizationSettings> {
        const current = await this.getSettings();
        const next: ILocalizationSettingsDocument = {
            key: 'settings',
            systemPrompt: current.systemPrompt,
            providerId: current.providerId,
            model: current.model,
            updatedAt: new Date(),
            updatedBy: actor
        };

        if (patch.systemPrompt !== undefined) {
            next.systemPrompt = this.requireSystemPrompt(patch.systemPrompt);
        }
        if (patch.providerId !== undefined) {
            next.providerId = this.optionalId(patch.providerId, 'provider');
            if (patch.model === undefined && next.providerId !== current.providerId) {
                next.model = null;
            }
        }
        if (patch.model !== undefined) {
            next.model = this.optionalId(patch.model, 'model');
        }

        await this.collection().updateOne({ key: 'settings' }, { $set: next }, { upsert: true });
        this.logger.info(
            { actor, providerId: next.providerId, model: next.model, systemPromptLength: next.systemPrompt.length },
            'Localization settings saved'
        );
        return this.getSettings();
    }

    /**
     * Validate a system prompt.
     *
     * @param value - Candidate prompt from the request.
     * @returns The trimmed prompt.
     */
    private requireSystemPrompt(value: unknown): string {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (trimmed === '' || trimmed.length > MAX_SYSTEM_PROMPT_LENGTH) {
            throw new LocalizationValidationError(`Invalid system prompt: must be 1–${MAX_SYSTEM_PROMPT_LENGTH} characters`);
        }
        return trimmed;
    }

    /**
     * Validate an optional provider or model id. An empty string means the
     * same as null, which is what an "automatic" choice in a select sends.
     *
     * @param value - Candidate id from the request.
     * @param label - Field name used in the error message.
     * @returns The trimmed id, or null.
     */
    private optionalId(value: unknown, label: string): string | null {
        let result: string | null = null;
        if (value !== null) {
            if (typeof value !== 'string' || value.trim().length > MAX_ID_LENGTH) {
                throw new LocalizationValidationError(`Invalid ${label}: expected an id of at most ${MAX_ID_LENGTH} characters`);
            }
            result = value.trim() === '' ? null : value.trim();
        }
        return result;
    }

    /** @returns The settings collection. */
    private collection() {
        return this.database.getCollection<ILocalizationSettingsDocument>(SETTINGS_COLLECTION);
    }
}
