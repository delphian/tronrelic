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
    IManagedContentType,
    ITranslatableField
} from '@/types';
import { HookAbortError } from '@/types';
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
            onTranslationChanged: async () => undefined
        }
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
            { language: 'es', published: false, stale: false, deleted: false },
            { language: 'zh', published: true, stale: true, deleted: false }
        ]);
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
