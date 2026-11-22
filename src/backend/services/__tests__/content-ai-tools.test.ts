/// <reference types="vitest" />

/**
 * @fileoverview Tests for the translation AI tools: the capability each one
 * declares, the input checks they run before reaching the translation service,
 * the daily proposal allowance, and how a failure is reported to the model.
 * The translation service is replaced by a stub, because its own rules are
 * covered by its own tests.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IContentTranslationService } from '@/types';
import { buildContentAiTools, CONTENT_AI_TOOL_NAMES, ProposalQuota } from '../content-ai-tools.js';
import { ContentError } from '../content-error.js';
import { ContentTranslationInputError } from '../content-translation-errors.js';

const silentLogger: any = { info: () => undefined, warn: () => undefined, error: vi.fn(), debug: () => undefined, child: () => silentLogger };

const ID = '3f2b8c1e-9d4a-4e7b-8a1c-5d6e7f809a1b';
const HASH = 'a'.repeat(64);

/**
 * Build the tools over a stubbed translation service.
 *
 * @param overrides - The service methods a test needs.
 * @param quota - The proposal allowance, when a test needs a small one.
 * @returns The read tool and the proposal tool.
 */
function tools(overrides: Partial<IContentTranslationService>, quota?: ProposalQuota) {
    const [read, propose] = buildContentAiTools(overrides as IContentTranslationService, silentLogger, quota);
    return { read, propose };
}

describe('content translation AI tools', () => {
    it('binds the proposal tool to the translation curation type and keeps the read public', () => {
        const { read, propose } = tools({});

        expect(read.name).toBe(CONTENT_AI_TOOL_NAMES.getTranslation);
        expect(read.capability).toMatchObject({ sideEffect: 'read', sensitivity: 'public' });
        expect(propose.capability).toMatchObject({
            sideEffect: 'external',
            forcesCuratorReview: true,
            curationTypeId: 'core:content-translation'
        });
    });

    it('refuses a malformed fingerprint before calling the service', async () => {
        const proposeTranslation = vi.fn();
        const { propose } = tools({ proposeTranslation });

        const result = await propose.handler({ typeId: 'core:page', id: ID, language: 'zh', sourceHash: 'abc', values: {} });

        expect(result).toMatchObject({ success: false, errorKind: 'input' });
        expect(proposeTranslation).not.toHaveBeenCalled();
    });

    it('records a signed-in caller as a non-curator proposer', async () => {
        const proposeTranslation = vi.fn(async () => ({ typeId: 'core:page', contentId: ID, language: 'zh', pendingReview: true }));
        const { propose } = tools({ proposeTranslation });

        await propose.handler({ typeId: 'core:page', id: ID, language: 'zh', sourceHash: HASH, values: { title: '标题' } }, { userId: 'user-7' });

        expect(proposeTranslation).toHaveBeenCalledWith(
            'core:page', ID, 'zh',
            expect.objectContaining({ sourceHash: HASH, source: 'ai-tool:content-propose-translation' }),
            { id: 'user-7', kind: 'user', isCurator: false }
        );
    });

    it('returns a fixable refusal to the model and hides an unexpected failure', async () => {
        const fixable = tools({ proposeTranslation: vi.fn(async () => { throw new ContentTranslationInputError('Title is required'); }) });
        const changed = tools({ proposeTranslation: vi.fn(async () => { throw new ContentError('source-changed', 'English changed'); }) });
        const broken = tools({ proposeTranslation: vi.fn(async () => { throw new Error('connection reset by mongo-0'); }) });
        const input = { typeId: 'core:page', id: ID, language: 'zh', sourceHash: HASH, values: {} };

        expect(await fixable.propose.handler(input)).toMatchObject({ success: false, errorKind: 'input', error: 'Title is required' });
        expect(await changed.propose.handler(input)).toMatchObject({ success: false, errorKind: 'input', code: 'source-changed' });
        const hidden = await broken.propose.handler(input) as { error: string; errorKind: string };
        expect(hidden.errorKind).toBe('failed');
        expect(hidden.error).not.toContain('mongo');
    });

    it('stops proposing once the daily allowance is spent', async () => {
        const proposeTranslation = vi.fn(async () => ({ typeId: 'core:page', contentId: ID, language: 'zh', pendingReview: true }));
        const { propose } = tools({ proposeTranslation }, new ProposalQuota(1));
        const input = { typeId: 'core:page', id: ID, language: 'zh', sourceHash: HASH, values: { title: '标题' } };

        expect(await propose.handler(input)).toMatchObject({ success: true });
        expect(await propose.handler(input)).toMatchObject({ success: false, errorKind: 'input' });
        expect(proposeTranslation).toHaveBeenCalledTimes(1);
    });

    it('reports an item that is not served as not found rather than an error', async () => {
        const { read } = tools({ getTranslationContext: vi.fn(async () => null) });

        expect(await read.handler({ typeId: 'core:page', id: ID, language: 'zh' })).toEqual({ success: true, found: false });
    });
});
