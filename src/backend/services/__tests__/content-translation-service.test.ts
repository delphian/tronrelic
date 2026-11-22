/// <reference types="vitest" />

/**
 * @fileoverview Tests for the core content translation service against a
 * minimal translatable type, so the rules are checked without any one content
 * owner's behaviour: registration checks on the field list, the veto hooks
 * seeing the language, and the address list refusing paths that would act as
 * route patterns. The pages module's own tests cover the same service through
 * a real content type.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
    ContentPayload,
    IContent,
    IContentActor,
    IContentReadRequest,
    IContentWriteContext,
    ICurationType,
    IManagedContentType,
    ITranslatableField
} from '@/types';
import { HookAbortError, createValueStoreProposals } from '@/types';
import { ContentService } from '../content-service.js';
import { ContentTranslationStore } from '../content-translation-store.js';
import { HookRegistry } from '../../hooks/hook-registry.js';
import { HOOKS } from '../../hooks/registry.js';
import { createMockDatabaseService } from '../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../tests/vitest/mocks/service-registry.js';

const silentLogger: any = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => silentLogger
};

/** A curator, the only actor who may change translations. */
const curator: IContentActor = { id: 'user-admin', kind: 'user', isCurator: true };

/** An item of the test type: a note served at the paths it lists. */
interface INote extends IContent {
    text: string;
    paths: string[];
}

/** The note's translatable field. */
const noteFields: ITranslatableField[] = [{ name: 'text', label: 'Text', kind: 'text', required: true }];

/**
 * Build a never-reviewed managed type that keeps notes in memory and stores
 * translations in a real store against the mock database.
 *
 * @param database - The mock database the translation store writes to.
 * @param fields - The translatable fields to declare.
 * @returns The type.
 */
function noteType(
    database: ReturnType<typeof createMockDatabaseService>,
    fields: ITranslatableField[] = noteFields
): IManagedContentType<INote, { text: string; paths: string[] }, { text: string }> {
    const notes = new Map<string, { text: string; paths: string[]; deletedAt: Date | null }>();
    const store = new ContentTranslationStore(database, 'test_note_translations');

    return {
        typeId: 'test:note',
        label: 'Note',
        classification: { egress: 'user', audience: 'public' },
        reviewedFields: [],
        describe: async () => ({ title: 'Note', body: '' }),
        create: async (id, input) => { notes.set(id, { ...input, deletedAt: null }); },
        discardCreate: async (id) => { notes.delete(id); },
        read: async (requests: ReadonlyArray<IContentReadRequest>) => {
            const result: Record<string, ContentPayload<INote>> = {};
            for (const request of requests) {
                const note = notes.get(request.id);
                if (note) {
                    result[request.id] = { text: note.text, paths: note.paths };
                }
            }
            return result;
        },
        update: async (id, patch) => { notes.set(id, { ...notes.get(id)!, text: patch.text }); },
        delete: async () => undefined,
        restore: async () => undefined,
        approve: async () => undefined,
        translation: {
            translatableFields: fields,
            extractTranslatable: (note) => ({ text: note.text }),
            listPublicPaths: (note) => note.paths,
            readTranslations: (keys) => store.read(keys),
            writeTranslation: (id, language, values) => store.write(id, language, values),
            onTranslationChanged: async () => undefined,
            proposals: createValueStoreProposals(store)
        }
    };
}

/** One queue item the fake curation service holds. */
interface IFakeCurationItem {
    id: string;
    typeId: string;
    ref: Record<string, unknown>;
    status: 'pending' | 'approved' | 'rejected';
}

/**
 * Build a curation service that keeps items in memory and commits each
 * decision through the registered binding's `applyEdit`, the way the real
 * queue does, so the proposal path runs end to end.
 *
 * @returns The fake, with its items exposed for assertions.
 */
function fakeCuration() {
    const types = new Map<string, ICurationType>();
    const items = new Map<string, IFakeCurationItem>();
    let next = 0;

    /**
     * Record a decision on an item and commit it through its binding.
     *
     * @param id - The queue item.
     * @param status - The decision.
     * @returns The decided item, or null when it was not pending.
     */
    const decide = async (id: string, status: 'approved' | 'rejected'): Promise<IFakeCurationItem | null> => {
        const item = items.get(id);
        let decided: IFakeCurationItem | null = null;
        if (item && item.status === 'pending') {
            item.status = status;
            await types.get(item.typeId)!.applyEdit(item.ref, { status });
            decided = item;
        }
        return decided;
    };

    return {
        items,
        types,
        registerType: (type: ICurationType) => { types.set(type.typeId, type); },
        unregisterType: (typeId: string) => types.delete(typeId),
        hold: async (input: { typeId: string; ref: Record<string, unknown> }) => {
            const item: IFakeCurationItem = { id: `item-${++next}`, typeId: input.typeId, ref: input.ref, status: 'pending' };
            items.set(item.id, item);
            return item;
        },
        approve: (id: string) => decide(id, 'approved'),
        reject: (id: string) => decide(id, 'rejected')
    };
}

describe('ContentTranslationService', () => {
    let database: ReturnType<typeof createMockDatabaseService>;
    let hooks: HookRegistry;
    let service: ContentService;

    beforeEach(() => {
        ContentService.resetForTests();
        database = createMockDatabaseService();
        hooks = new HookRegistry(silentLogger);
        ContentService.setDependencies(database, hooks, createMockServiceRegistry(), silentLogger);
        service = ContentService.getInstance();
    });

    it('refuses to register a translatable type with a repeated field name', () => {
        const repeated = [...noteFields, { name: 'text', label: 'Again', kind: 'text' as const, required: false }];
        expect(() => service.registerType(noteType(database, repeated), 'test')).toThrow(/repeated translatable field/);
    });

    it('refuses to translate a type that is not translatable', async () => {
        const plain = noteType(database);
        delete plain.translation;
        service.registerType(plain, 'test');
        const note = await service.create<INote>('test:note', { text: 'Hi', paths: ['/hi'] }, curator);

        await expect(service.translations().getOverview('test:note', note.id)).rejects.toMatchObject({ code: 'unknown-type' });
    });

    it('runs the update veto hook with the language set, and stores nothing when it refuses', async () => {
        service.registerType(noteType(database), 'test');
        const note = await service.create<INote>('test:note', { text: 'Hi', paths: ['/hi'] }, curator);
        const seen: IContentWriteContext[] = [];
        hooks.register('core', HOOKS.content.beforeUpdate, async (context) => {
            seen.push(context);
            throw new HookAbortError('No translations today');
        });

        await expect(
            service.translations().saveTranslation('test:note', note.id, 'zh', { values: { text: '你好' }, published: true }, curator)
        ).rejects.toMatchObject({ code: 'vetoed' });
        expect(seen[0]).toMatchObject({ operation: 'update', typeId: 'test:note', id: note.id, language: 'zh' });
        expect((await service.translations().getOverview('test:note', note.id)).translations).toEqual([]);
    });

    it('lists exact paths only, dropping any that would act as a route pattern', async () => {
        service.registerType(noteType(database), 'test');
        const note = await service.create<INote>('test:note', { text: 'Hi', paths: ['/hi', '/blog/*', '/x/:id'] }, curator);
        await service.translations().saveTranslation('test:note', note.id, 'zh', { values: { text: '你好' }, published: true }, curator);

        expect(await service.translations().listLocalizedRoutes()).toEqual([{ pattern: '/hi', languages: ['zh'] }]);
    });

    it('serves a published translation with the item it translates', async () => {
        service.registerType(noteType(database), 'test');
        const note = await service.create<INote>('test:note', { text: 'Hi', paths: ['/hi'] }, curator);
        await service.translations().saveTranslation('test:note', note.id, 'zh', { values: { text: '你好' }, published: true }, curator);

        const served = await service.translations().readPublicTranslation<INote>('test:note', note.id, 'zh');
        expect(served?.item.text).toBe('Hi');
        expect(served?.values.text).toBe('你好');
    });

    it('summarizes translation state for a list, flags stale ones, and leaves untranslated items out', async () => {
        service.registerType(noteType(database), 'test');
        const translated = await service.create<INote>('test:note', { text: 'Hi', paths: ['/hi'] }, curator);
        const untranslated = await service.create<INote>('test:note', { text: 'Bye', paths: ['/bye'] }, curator);
        await service.translations().saveTranslation('test:note', translated.id, 'zh', { values: { text: '你好' }, published: true }, curator);
        await service.translations().saveTranslation('test:note', translated.id, 'es', { values: { text: 'Hola' }, published: false }, curator);
        await service.update('test:note', translated.id, { text: 'Hello' }, curator);
        await service.translations().saveTranslation('test:note', translated.id, 'es', { values: { text: 'Hola' }, published: false }, curator);

        const summary = await service.translations().summarizeTranslations('test:note', [translated.id, untranslated.id]);

        expect(summary[untranslated.id]).toBeUndefined();
        expect(summary[translated.id]).toEqual([
            { language: 'es', published: false, stale: false, custom: false, deleted: false, saved: true, proposalPending: false },
            { language: 'zh', published: true, stale: true, custom: false, deleted: false, saved: true, proposalPending: false }
        ]);
    });

    it('never flags a custom translation stale, but still reports that the English changed', async () => {
        service.registerType(noteType(database), 'test');
        const note = await service.create<INote>('test:note', { text: 'Hi', paths: ['/hi'] }, curator);
        await service.translations().saveTranslation('test:note', note.id, 'ru', { values: { text: 'Привет' }, published: true, custom: true }, curator);
        await service.update('test:note', note.id, { text: 'Hello' }, curator);

        const [translation] = (await service.translations().getOverview('test:note', note.id)).translations;
        expect(translation).toMatchObject({ custom: true, stale: false, englishChanged: true });
        expect((await service.translations().summarizeTranslations('test:note', [note.id]))[note.id][0])
            .toMatchObject({ custom: true, stale: false });
    });

    it('keeps the custom flag through a save that does not mention it', async () => {
        service.registerType(noteType(database), 'test');
        const note = await service.create<INote>('test:note', { text: 'Hi', paths: ['/hi'] }, curator);
        await service.translations().saveTranslation('test:note', note.id, 'ru', { values: { text: 'Привет' }, published: true, custom: true }, curator);

        const saved = await service.translations().saveTranslation('test:note', note.id, 'ru', { values: { text: 'Здравствуйте' }, published: true }, curator);
        expect(saved.custom).toBe(true);

        const cleared = await service.translations().saveTranslation('test:note', note.id, 'ru', { values: { text: 'Здравствуйте' }, published: true, custom: false }, curator);
        expect(cleared.custom).toBe(false);
    });

    it('lists only items with a published, live translation into the language', async () => {
        service.registerType(noteType(database), 'test');
        const published = await service.create<INote>('test:note', { text: 'A', paths: ['/a'] }, curator);
        const draft = await service.create<INote>('test:note', { text: 'B', paths: ['/b'] }, curator);
        const deleted = await service.create<INote>('test:note', { text: 'C', paths: ['/c'] }, curator);
        await service.translations().saveTranslation('test:note', published.id, 'zh', { values: { text: '甲' }, published: true }, curator);
        await service.translations().saveTranslation('test:note', draft.id, 'zh', { values: { text: '乙' }, published: false }, curator);
        await service.translations().saveTranslation('test:note', deleted.id, 'zh', { values: { text: '丙' }, published: true }, curator);
        await service.translations().deleteTranslation('test:note', deleted.id, 'zh', curator);

        expect(await service.translations().listPublishedTranslationIds('test:note', 'zh')).toEqual([published.id]);
        expect(await service.translations().listPublishedTranslationIds('test:note', 'en')).toEqual([]);
    });

    it('tells the content type when a translation changes', async () => {
        const type = noteType(database);
        const onChanged = vi.fn(async () => undefined);
        type.translation!.onTranslationChanged = onChanged;
        service.registerType(type, 'test');
        const note = await service.create<INote>('test:note', { text: 'Hi', paths: ['/hi'] }, curator);

        await service.translations().saveTranslation('test:note', note.id, 'zh', { values: { text: '你好' }, published: false }, curator);
        expect(onChanged).toHaveBeenCalledWith(note.id, 'zh');
    });
});

describe('ContentTranslationService proposals', () => {
    /** The non-curator an AI tool proposes as. */
    const agent: IContentActor = { id: 'user-member', kind: 'user', isCurator: false };

    let database: ReturnType<typeof createMockDatabaseService>;
    let service: ContentService;
    let curation: ReturnType<typeof fakeCuration>;

    beforeEach(() => {
        ContentService.resetForTests();
        database = createMockDatabaseService();
        const registry = createMockServiceRegistry();
        curation = fakeCuration();
        registry.register('curation', curation);
        registry.register('localization', { getLanguage: async (code: string) => ({ code, enabled: code === 'zh' }) });
        ContentService.setDependencies(database, new HookRegistry(silentLogger), registry, silentLogger);
        service = ContentService.getInstance();
        service.registerType(noteType(database), 'test');
    });

    /**
     * Create a note and read the English fingerprint a proposer must send.
     *
     * @param text - The note's English text.
     * @returns The note's id and its source fingerprint.
     */
    async function noteWithHash(text: string): Promise<{ id: string; sourceHash: string }> {
        const note = await service.create<INote>('test:note', { text, paths: ['/n'] }, curator);
        const context = await service.translations().getTranslationContext('test:note', note.id, 'zh');
        return { id: note.id, sourceHash: context!.sourceHash };
    }

    it('holds a proposal for review and keeps serving the published translation until it is approved', async () => {
        const { id, sourceHash } = await noteWithHash('Rent energy for 30 TRX');
        await service.translations().saveTranslation('test:note', id, 'zh', { values: { text: '租用能量 30 TRX' }, published: true }, curator);

        const outcome = await service.translations().proposeTranslation('test:note', id, 'zh', { values: { text: '以 30 TRX 租用能量' }, sourceHash }, agent);

        expect(outcome).toMatchObject({ pendingReview: true, curationItemId: 'item-1' });
        expect((await service.translations().readPublicTranslation<INote>('test:note', id, 'zh'))?.values.text).toBe('租用能量 30 TRX');
        expect(curation.items.get('item-1')?.typeId).toBe('core:content-translation');

        await curation.approve('item-1');

        const served = await service.translations().readPublicTranslation<INote>('test:note', id, 'zh');
        expect(served?.values.text).toBe('以 30 TRX 租用能量');
        expect((await service.translations().getOverview('test:note', id)).proposals).toEqual([]);
    });

    it('saves an approved proposal into a new language as a draft, so only a curator publishes it', async () => {
        const { id, sourceHash } = await noteWithHash('Hello');
        await service.translations().proposeTranslation('test:note', id, 'zh', { values: { text: '你好' }, sourceHash }, agent);

        const [status] = (await service.translations().summarizeTranslations('test:note', [id]))[id];
        expect(status).toMatchObject({ language: 'zh', saved: false, proposalPending: true });

        await curation.approve('item-1');

        const [saved] = (await service.translations().getOverview('test:note', id)).translations;
        expect(saved).toMatchObject({ language: 'zh', published: false, values: { text: '你好' } });
    });

    it('refuses a proposal translated from English that has changed since', async () => {
        const { id, sourceHash } = await noteWithHash('Hello');
        await service.update('test:note', id, { text: 'Hello there' }, curator);

        await expect(
            service.translations().proposeTranslation('test:note', id, 'zh', { values: { text: '你好' }, sourceHash }, agent)
        ).rejects.toMatchObject({ code: 'source-changed' });
        expect(curation.items.size).toBe(0);
    });

    it('refuses a proposal that adds a TRON address the English does not contain', async () => {
        const { id, sourceHash } = await noteWithHash('Send 50 TRX to TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7');

        await expect(
            service.translations().proposeTranslation(
                'test:note', id, 'zh',
                { values: { text: '发送 50 TRX 到 TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf' }, sourceHash },
                agent
            )
        ).rejects.toThrow(/TRON addresses/);
        expect(curation.items.size).toBe(0);
    });

    it('holds a proposal whose numbers and site links differ, and lists the differences for the curator', async () => {
        const { id, sourceHash } = await noteWithHash('Stake 1,000 TRX');

        const outcome = await service.translations().proposeTranslation(
            'test:note', id, 'zh',
            { values: { text: '质押 5000 TRX，见 [市场](/resource-markets)' }, sourceHash },
            agent
        );

        expect(outcome.pendingReview).toBe(true);
        expect(outcome.differences.join(' ')).toContain('"1000"');
        expect(outcome.differences.join(' ')).toContain('"5000"');
        expect(outcome.differences.join(' ')).toContain('/resource-markets');
        const descriptor = await curation.types.get('core:content-translation')!.describe(curation.items.get('item-1')!.ref);
        expect(descriptor.details?.filter((detail) => detail.label === 'Differs from the English')).toHaveLength(3);
    });

    it('marks the translation custom when a curator approves a proposal asking for it, even after the English changed', async () => {
        const { id, sourceHash } = await noteWithHash('Hello');
        await service.translations().proposeTranslation('test:note', id, 'zh', { values: { text: '你好' }, sourceHash, custom: true }, agent);
        const descriptor = await curation.types.get('core:content-translation')!.describe(curation.items.get('item-1')!.ref);
        expect(descriptor.details?.some((detail) => detail.label === 'Custom version')).toBe(true);
        await service.update('test:note', id, { text: 'Hello there' }, curator);

        await curation.approve('item-1');

        const [saved] = (await service.translations().getOverview('test:note', id)).translations;
        expect(saved).toMatchObject({ values: { text: '你好' }, custom: true, stale: false, englishChanged: true });
    });

    it('refuses a proposal into a language that is not enabled', async () => {
        const { id, sourceHash } = await noteWithHash('Hello');

        await expect(
            service.translations().proposeTranslation('test:note', id, 'vi', { values: { text: 'Xin chào' }, sourceHash }, agent)
        ).rejects.toThrow(/not an enabled language/);
    });

    it('replaces an older proposal, so approving the older queue item changes nothing', async () => {
        const { id, sourceHash } = await noteWithHash('Hello');
        await service.translations().proposeTranslation('test:note', id, 'zh', { values: { text: '你好一' }, sourceHash }, agent);
        await service.translations().proposeTranslation('test:note', id, 'zh', { values: { text: '你好二' }, sourceHash }, agent);

        expect(curation.items.get('item-1')?.status).toBe('rejected');
        await curation.approve('item-2');

        const [saved] = (await service.translations().getOverview('test:note', id)).translations;
        expect(saved.values.text).toBe('你好二');
    });

    it('closes an open proposal when a curator saves the translation directly', async () => {
        const { id, sourceHash } = await noteWithHash('Hello');
        await service.translations().proposeTranslation('test:note', id, 'zh', { values: { text: '你好' }, sourceHash }, agent);

        await service.translations().saveTranslation('test:note', id, 'zh', { values: { text: '您好' }, published: true }, curator);

        expect(curation.items.get('item-1')?.status).toBe('rejected');
        expect((await service.translations().getOverview('test:note', id)).proposals).toEqual([]);
        expect((await service.translations().readPublicTranslation<INote>('test:note', id, 'zh'))?.values.text).toBe('您好');
    });

    it('refuses a proposal for a type that accepts none', async () => {
        ContentService.resetForTests();
        const registry = createMockServiceRegistry();
        registry.register('curation', curation);
        registry.register('localization', { getLanguage: async (code: string) => ({ code, enabled: true }) });
        ContentService.setDependencies(database, new HookRegistry(silentLogger), registry, silentLogger);
        service = ContentService.getInstance();
        const type = noteType(database);
        delete (type.translation as { proposals?: unknown }).proposals;
        service.registerType(type, 'test');
        const { id, sourceHash } = await noteWithHash('Hello');

        await expect(
            service.translations().proposeTranslation('test:note', id, 'zh', { values: { text: '你好' }, sourceHash }, agent)
        ).rejects.toMatchObject({ code: 'forbidden' });
    });
});
