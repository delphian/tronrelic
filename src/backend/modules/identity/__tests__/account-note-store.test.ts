/**
 * Tests for AccountNoteStore: input validation, saving with the acting admin,
 * clearing by saving an empty note, and keeping the note text out of the log,
 * since a note may hold personal details about the account's owner.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ISystemLogService } from '@/types';
import { ACCOUNT_NOTE_MAX_LENGTH } from '@/types';
import { AccountNoteStore } from '../services/AccountNoteStore.js';

describe('AccountNoteStore', () => {
    let updateOne: ReturnType<typeof vi.fn>;
    let deleteOne: ReturnType<typeof vi.fn>;
    let info: ReturnType<typeof vi.fn>;
    let store: AccountNoteStore;

    beforeEach(() => {
        updateOne = vi.fn(async () => ({ upsertedCount: 1 }));
        deleteOne = vi.fn(async () => ({ deletedCount: 1 }));
        info = vi.fn();
        const logger = { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => logger } as unknown as ISystemLogService;
        const database = { getCollection: () => ({ updateOne, deleteOne }) } as any;
        store = new AccountNoteStore(database, logger);
    });

    it('trims a note and refuses one that is too long or not text', () => {
        expect(AccountNoteStore.validate('  watch this account  ')).toEqual({ ok: true, note: 'watch this account' });
        expect(AccountNoteStore.validate('x'.repeat(ACCOUNT_NOTE_MAX_LENGTH + 1)).ok).toBe(false);
        expect(AccountNoteStore.validate({ $set: 'x' }).ok).toBe(false);
        expect(AccountNoteStore.validate(undefined).ok).toBe(false);
    });

    it('saves a note with the admin who wrote it', async () => {
        const saved = await store.set('u1', 'Asked for a refund.', 'admin-1');

        expect(saved).toMatchObject({ userId: 'u1', note: 'Asked for a refund.', updatedBy: 'admin-1' });
        expect(updateOne).toHaveBeenCalledWith({ userId: 'u1' }, { $set: saved }, { upsert: true });
    });

    it('clears the note when saved empty, so "no note" has one form', async () => {
        const saved = await store.set('u1', '', 'admin-1');

        expect(saved).toBeNull();
        expect(deleteOne).toHaveBeenCalledWith({ userId: 'u1' });
        expect(updateOne).not.toHaveBeenCalled();
    });

    it('logs who changed the note but never the note text', async () => {
        await store.set('u1', 'Owner lives at 1 Example Street.', 'admin-1');

        expect(info).toHaveBeenCalled();
        expect(JSON.stringify(info.mock.calls)).not.toContain('Example Street');
    });
});
