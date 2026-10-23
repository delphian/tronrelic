/// <reference types="vitest" />

/**
 * @fileoverview Tests for the content translation AI settings: the defaults
 * before the first save, the provider-change rule, and validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockDatabaseService } from '../../tests/vitest/mocks/database-service.js';
import { ContentTranslationSettingsService } from '../content-translation-settings.js';
import { DEFAULT_CONTENT_TRANSLATION_SYSTEM_PROMPT } from '../content-translation-prompt.js';

describe('ContentTranslationSettingsService', () => {
    let service: ContentTranslationSettingsService;

    beforeEach(() => {
        service = new ContentTranslationSettingsService(createMockDatabaseService());
    });

    it('returns the defaults until settings are saved', async () => {
        const settings = await service.getSettings();
        expect(settings.systemPrompt).toBe(DEFAULT_CONTENT_TRANSLATION_SYSTEM_PROMPT);
        expect(settings.providerId).toBeNull();
        expect(settings.model).toBeNull();
        expect(settings.updatedAt).toBeNull();
    });

    it('persists a saved prompt', async () => {
        await service.updateSettings({ systemPrompt: 'TRON is always 波场.' });
        const settings = await service.getSettings();
        expect(settings.systemPrompt).toBe('TRON is always 波场.');
        expect(settings.updatedAt).toBeInstanceOf(Date);
    });

    it('clears the model when the provider changes without naming one', async () => {
        await service.updateSettings({ providerId: 'p1', model: 'model-a' });
        const updated = await service.updateSettings({ providerId: 'p2' });
        expect(updated.providerId).toBe('p2');
        expect(updated.model).toBeNull();
    });

    it('refuses an empty system prompt', async () => {
        await expect(service.updateSettings({ systemPrompt: '   ' })).rejects.toThrow(/system prompt/);
    });
});
