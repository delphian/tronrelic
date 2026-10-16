/**
 * @fileoverview Tests for the AI translation assist: the settings store, the
 * prompt builder and reply parser, and the service that calls the provider.
 *
 * The provider is a stub, so these tests cover what TronRelic controls — which
 * provider is chosen, what options the call carries, and how a reply is
 * matched back to keys — without calling a real model.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IAiProvider, IAiProviderRegistry, IAiQueryResult, ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { LocalizationSettingsService, DEFAULT_SYSTEM_PROMPT } from '../services/localization-settings.service.js';
import { TranslationSuggestionService } from '../services/translation-suggestion.service.js';
import { buildSuggestionPrompt, parseSuggestionReply, type ISuggestionItem } from '../services/translation-suggestion-prompt.js';
import {
    LocalizationProviderError,
    LocalizationUnavailableError,
    LocalizationValidationError
} from '../services/localization-errors.js';
import { KEYS_COLLECTION, LANGUAGES_COLLECTION, TRANSLATIONS_COLLECTION } from '../database/index.js';

/**
 * Build a logger whose methods are spies, so a test can run the services
 * without a backing log store.
 *
 * @returns A logger stub typed as the full service.
 */
function createLogger(): ISystemLogService {
    const logger = { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), child: vi.fn() };
    logger.child.mockReturnValue(logger);
    return logger as unknown as ISystemLogService;
}

/**
 * Build a suggestion item with sensible defaults, so each parser test states
 * only the field it is about.
 *
 * @param overrides - Fields to change.
 * @returns The item.
 */
function item(overrides: Partial<ISuggestionItem> = {}): ISuggestionItem {
    return { namespace: 'core', key: 'tools.title', source: 'Address Converter', currentTranslation: null, routes: ['/tools'], ...overrides };
}

/**
 * Build a provider stub that answers every query with the given reply.
 *
 * @param reply - Fields of the result to return.
 * @returns The stub, with `query` as a spy.
 */
function createProvider(reply: Partial<IAiQueryResult>): IAiProvider {
    return {
        query: vi.fn().mockResolvedValue({
            responseText: '',
            model: 'test-model',
            stopReason: 'end_turn',
            usage: { inputTokens: 100, outputTokens: 50 },
            costUsd: 0.0012,
            ...reply
        })
    } as unknown as IAiProvider;
}

/**
 * Build a registry stub holding one provider under the id `test-ai`.
 *
 * @param provider - The provider to return.
 * @param active - Whether that provider is the active one.
 * @returns The registry stub.
 */
function createRegistry(provider: IAiProvider, active = true): IAiProviderRegistry {
    return {
        listProviders: () => [{ id: 'test-ai', label: 'Test', active }],
        getActive: () => (active ? provider : null),
        getProvider: (id: string) => (id === 'test-ai' ? provider : null)
    } as unknown as IAiProviderRegistry;
}

describe('LocalizationSettingsService', () => {
    let settings: LocalizationSettingsService;

    beforeEach(() => {
        settings = new LocalizationSettingsService({ database: createMockDatabaseService(), logger: createLogger() });
    });

    it('returns the default system prompt before anything is saved', async () => {
        const current = await settings.getSettings();
        expect(current.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
        expect(current.providerId).toBeNull();
        expect(current.model).toBeNull();
    });

    it('clears the model when the provider changes without naming one', async () => {
        // A model id belongs to the provider that offers it, so keeping it
        // after a provider change would send another vendor a meaningless id.
        await settings.updateSettings({ providerId: 'test-ai', model: 'model-a' }, 'admin');
        const updated = await settings.updateSettings({ providerId: 'other-ai' }, 'admin');
        expect(updated.providerId).toBe('other-ai');
        expect(updated.model).toBeNull();
    });

    it('refuses an empty system prompt', async () => {
        await expect(settings.updateSettings({ systemPrompt: '   ' }, 'admin')).rejects.toBeInstanceOf(LocalizationValidationError);
    });
});

describe('buildSuggestionPrompt / parseSuggestionReply', () => {
    it('includes a stale translation as context but not a missing one', () => {
        const prompt = buildSuggestionPrompt(
            { code: 'zh', name: 'Chinese', nativeName: '简体中文' },
            [item(), item({ key: 'tools.intro', source: 'Free tools', currentTranslation: '免费工具' })]
        );
        expect(prompt).toContain('"previousTranslation": "免费工具"');
        expect(prompt.match(/previousTranslation/g)?.length).toBe(2); // one rule line, one entry
    });

    it('reads JSON wrapped in a code fence and maps ids back to keys', () => {
        const reply = 'Here you go:\n```json\n{"translations":[{"id":"2","text":"免费工具","note":null},{"id":"1","text":"地址转换器","note":"Short form chosen"}],"notes":"Used 波场 for TRON"}\n```';
        const parsed = parseSuggestionReply(reply, [item(), item({ key: 'tools.intro', source: 'Free tools' })]);
        expect(parsed.suggestions.map(suggestion => [suggestion.key, suggestion.text])).toEqual([
            ['tools.title', '地址转换器'],
            ['tools.intro', '免费工具']
        ]);
        expect(parsed.suggestions[0].note).toBe('Short form chosen');
        expect(parsed.notes).toBe('Used 波场 for TRON');
        expect(parsed.unanswered).toEqual([]);
    });

    it('reports keys the reply skipped and notes a dropped placeholder', () => {
        const items = [item({ source: '{count} markets' }), item({ key: 'tools.intro' })];
        const parsed = parseSuggestionReply('{"translations":[{"id":"1","text":"个市场","note":null}],"notes":null}', items);
        expect(parsed.suggestions[0].note).toContain('{count}');
        expect(parsed.unanswered).toEqual([{ namespace: 'core', key: 'tools.intro' }]);
    });

    it('throws when the reply has no translations list', () => {
        expect(() => parseSuggestionReply('I cannot help with that.', [item()])).toThrow();
    });
});

describe('TranslationSuggestionService', () => {
    let db: ReturnType<typeof createMockDatabaseService>;
    let settings: LocalizationSettingsService;

    beforeEach(() => {
        db = createMockDatabaseService();
        settings = new LocalizationSettingsService({ database: db, logger: createLogger() });
        const now = new Date();
        db.getCollectionData(LANGUAGES_COLLECTION).push({
            code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文', direction: 'ltr', enabled: false, createdAt: now, updatedAt: now
        });
        db.getCollectionData(KEYS_COLLECTION).push({
            namespace: 'core', key: 'tools.title', source: 'Address Converter', routes: ['/tools'], origin: 'observed',
            firstSeenAt: now, lastSeenAt: now, sourceChangedAt: now
        });
    });

    /**
     * Build the service around a registry stub.
     *
     * @param registry - Registry to hand the service, or null for none installed.
     * @returns The service.
     */
    function createService(registry: IAiProviderRegistry | null): TranslationSuggestionService {
        return new TranslationSuggestionService({ database: db, settings, getProviderRegistry: () => registry, logger: createLogger() });
    }

    it('calls the active provider with no tools and no variable expansion, and returns the cost', async () => {
        const provider = createProvider({ responseText: '{"translations":[{"id":"1","text":"地址转换器","note":null}],"notes":null}' });
        const result = await createService(createRegistry(provider)).suggest(
            { language: 'zh', keys: [{ namespace: 'core', key: 'tools.title' }] },
            'admin'
        );

        expect(result.suggestions).toEqual([{ namespace: 'core', key: 'tools.title', text: '地址转换器', note: null }]);
        expect(result.costUsd).toBe(0.0012);
        expect(result.providerId).toBe('test-ai');
        expect(provider.query).toHaveBeenCalledWith(expect.objectContaining({
            toolAllowlist: [],
            expandVariables: false,
            systemPrompt: DEFAULT_SYSTEM_PROMPT
        }));
        // Nothing is saved: the administrator reviews the text first.
        expect(db.getCollectionData(TRANSLATIONS_COLLECTION)).toHaveLength(0);
    });

    it('uses the provider and model chosen on the Settings tab', async () => {
        const provider = createProvider({ responseText: '{"translations":[{"id":"1","text":"x","note":null}],"notes":null}' });
        await settings.updateSettings({ providerId: 'test-ai', model: 'model-b' }, 'admin');
        await createService(createRegistry(provider, false)).suggest(
            { language: 'zh', keys: [{ namespace: 'core', key: 'tools.title' }] },
            'admin'
        );
        expect(provider.query).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-b' }));
    });

    it('reports a missing provider as unavailable', async () => {
        await expect(createService(null).suggest({ language: 'zh', keys: [{ namespace: 'core', key: 'tools.title' }] }, 'admin'))
            .rejects.toBeInstanceOf(LocalizationUnavailableError);
    });

    it('reports a cut-off reply as a provider error', async () => {
        const provider = createProvider({ responseText: '{"translations":[', stopReason: 'max_tokens' });
        await expect(createService(createRegistry(provider)).suggest({ language: 'zh', keys: [{ namespace: 'core', key: 'tools.title' }] }, 'admin'))
            .rejects.toBeInstanceOf(LocalizationProviderError);
    });

    it('refuses a key that is not a plain string', async () => {
        const provider = createProvider({});
        await expect(createService(createRegistry(provider)).suggest(
            { language: 'zh', keys: [{ namespace: 'core', key: { $ne: '' } as unknown as string }] },
            'admin'
        )).rejects.toBeInstanceOf(LocalizationValidationError);
        expect(provider.query).not.toHaveBeenCalled();
    });
});
