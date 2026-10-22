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
import { normalizeAiSystemPrompt } from '../../../services/normalizeAiSystemPrompt.js';
import { normalizeAiId } from '../../../services/normalizeAiId.js';

/** Longest system prompt accepted. Long enough for a sizeable glossary. */
export const MAX_SYSTEM_PROMPT_LENGTH = 8000;

/**
 * Build the validation error a bad settings value throws, which the
 * controller answers with 400.
 *
 * @param message - Explanation shown to the administrator.
 * @returns The error to throw.
 */
const invalidSetting = (message: string): Error => new LocalizationValidationError(message);

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
            next.systemPrompt = normalizeAiSystemPrompt(patch.systemPrompt, MAX_SYSTEM_PROMPT_LENGTH, invalidSetting);
        }
        if (patch.providerId !== undefined) {
            next.providerId = normalizeAiId(patch.providerId, 'provider', invalidSetting);
            if (patch.model === undefined && next.providerId !== current.providerId) {
                next.model = null;
            }
        }
        if (patch.model !== undefined) {
            next.model = normalizeAiId(patch.model, 'model', invalidSetting);
        }

        await this.collection().updateOne({ key: 'settings' }, { $set: next }, { upsert: true });
        this.logger.info(
            { actor, providerId: next.providerId, model: next.model, systemPromptLength: next.systemPrompt.length },
            'Localization settings saved'
        );
        return this.getSettings();
    }

    /** @returns The settings collection. */
    private collection() {
        return this.database.getCollection<ILocalizationSettingsDocument>(SETTINGS_COLLECTION);
    }
}
