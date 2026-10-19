/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the automated-network list service.
 *
 * Covers the two things the rest of the module relies on: that an add or
 * remove changes the in-memory set the ingestion path reads on every event,
 * and that only a storable ASN reaches the collection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { BotNetworksService, BotNetworkValidationError } from '../services/bot-networks.service.js';

const COLLECTION = 'module_traffic_bot_networks';

describe('BotNetworksService', () => {
    let database: ReturnType<typeof createMockDatabaseService>;
    let service: BotNetworksService;

    beforeEach(() => {
        BotNetworksService.resetInstance();
        database = createMockDatabaseService();
        const logger = { info: vi.fn(), error: vi.fn() } as unknown as ISystemLogService;
        BotNetworksService.setDependencies(database, logger);
        service = BotNetworksService.getInstance();
    });

    it('throws when getInstance() is called before setDependencies()', () => {
        BotNetworksService.resetInstance();
        expect(() => BotNetworksService.getInstance()).toThrow('setDependencies');
    });

    it('starts with no network listed', () => {
        expect(service.isBotNetwork(139341)).toBe(false);
    });

    it('loads networks already stored so classification uses them from the first event', async () => {
        database.getCollectionData(COLLECTION).push({ asn: 139341, note: 'Tencent pool', addedAt: new Date() });

        await service.load();

        expect(service.isBotNetwork(139341)).toBe(true);
        expect(service.isBotNetwork(9808)).toBe(false);
    });

    it('adds a network and makes the check true at once', async () => {
        const stored = await service.add({ asn: '139341', note: '  Tencent pool  ' });

        expect(stored).toBe(139341);
        expect(service.isBotNetwork(139341)).toBe(true);
        expect(await service.list()).toEqual([
            expect.objectContaining({ asn: 139341, note: 'Tencent pool', addedAt: expect.any(Date) })
        ]);
    });

    it('accepts a numeric ASN as well as a string', async () => {
        await service.add({ asn: 139341 });

        expect(service.isBotNetwork(139341)).toBe(true);
    });

    it('stores a blank note as null', async () => {
        await service.add({ asn: 139341, note: '   ' });

        expect((await service.list())[0].note).toBeNull();
    });

    it('updates the note of a network already listed without adding it twice', async () => {
        await service.add({ asn: 139341, note: 'first' });
        await service.add({ asn: 139341, note: 'second' });

        const rows = await service.list();
        expect(rows).toHaveLength(1);
        expect(rows[0].note).toBe('second');
    });

    it.each([
        ['zero', '0'],
        ['a negative number', '-5'],
        ['a decimal', '13.5'],
        ['text', 'AS139341'],
        ['a value past 32 bits', '4294967296'],
        ['nothing', undefined]
    ])('rejects %s as an ASN', async (_label, asn) => {
        await expect(service.add({ asn })).rejects.toBeInstanceOf(BotNetworkValidationError);
        expect(database.getCollectionData(COLLECTION)).toHaveLength(0);
    });

    it('removes a network and makes the check false at once', async () => {
        await service.add({ asn: 139341 });

        await service.remove(139341);

        expect(service.isBotNetwork(139341)).toBe(false);
        expect(await service.list()).toEqual([]);
    });
});
