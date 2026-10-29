/// <reference types="vitest" />

/**
 * @fileoverview Tests for composing a translation request's system prompt from
 * the shared prompt and the target language's own guidance.
 */

import { describe, it, expect } from 'vitest';
import { composeTranslationSystemPrompt } from '../composeTranslationSystemPrompt.js';

describe('composeTranslationSystemPrompt', () => {
    it('returns the shared prompt unchanged when the language has no guidance', () => {
        expect(composeTranslationSystemPrompt('Shared rules.', { code: 'zh', name: 'Chinese', translationPrompt: '' })).toBe('Shared rules.');
        expect(composeTranslationSystemPrompt('Shared rules.', { code: 'zh', name: 'Chinese' })).toBe('Shared rules.');
        expect(composeTranslationSystemPrompt('Shared rules.', { code: 'zh', name: 'Chinese', translationPrompt: '   ' })).toBe('Shared rules.');
    });

    it('appends the guidance under a heading naming the language', () => {
        const composed = composeTranslationSystemPrompt('Shared rules.', {
            code: 'vi',
            name: 'Vietnamese',
            translationPrompt: '  Energy → Năng lượng.  '
        });

        expect(composed).toBe(
            'Shared rules.\n\nGuidance for translating into Vietnamese (vi). Where it differs from the instructions above, follow it:\nEnergy → Năng lượng.'
        );
    });
});
