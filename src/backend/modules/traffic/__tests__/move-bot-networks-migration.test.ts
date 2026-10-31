/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for migration 022, which moves the automated-network
 * list into bot rules.
 *
 * A network an operator had confirmed must keep being labeled after the
 * upgrade, the move must be safe to repeat, and a rule an operator edited
 * after a first run must not be overwritten by a second one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDatabaseService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { migration } from '../migrations/022_move_bot_networks_to_bot_rules.js';

describe('migration 022_move_bot_networks_to_bot_rules', () => {
    let database: ReturnType<typeof createMockDatabaseService>;
    let migrationDatabase: IDatabaseService;

    beforeEach(() => {
        database = createMockDatabaseService();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        // The shared mock has no `drop`, so the migration runs against a thin
        // wrapper whose collections gain one that empties their data. Wrapping
        // rather than spying, because the mock's getCollection is itself a spy.
        migrationDatabase = {
            ...database,
            getCollection: ((name: string) => Object.assign(database.getCollection(name), {
                drop: vi.fn(async () => {
                    database.getCollectionData(name).length = 0;
                    return true;
                })
            })) as IDatabaseService['getCollection']
        };
    });

    it('drops the legacy collection after moving its entries', async () => {
        database.getCollectionData('module_traffic_bot_networks').push({ asn: 139341, note: null });

        await migration.up({ database: migrationDatabase });

        expect(database.getCollectionData('module_traffic_bot_networks')).toEqual([]);
    });

    it('turns each listed network into an active label-mode rule', async () => {
        const addedAt = new Date('2026-10-19T00:00:00Z');
        database.getCollectionData('module_traffic_bot_networks').push({ asn: 139341, note: 'Tencent pool', addedAt });

        await migration.up({ database: migrationDatabase });

        expect(database.getCollectionData('module_traffic_bot_rules')).toEqual([
            expect.objectContaining({
                id: 'migrated-asn-139341',
                name: 'Network AS139341',
                note: 'Tencent pool',
                conditions: { asns: [139341] },
                label: 'bot_other',
                mode: 'label',
                enabled: true,
                status: 'active',
                source: 'migration',
                createdAt: addedAt
            })
        ]);
    });

    it('does not overwrite a migrated rule an operator has since edited', async () => {
        database.getCollectionData('module_traffic_bot_networks').push({ asn: 139341, note: null });
        await migration.up({ database: migrationDatabase });
        database.getCollectionData('module_traffic_bot_rules')[0].mode = 'monitor';

        database.getCollectionData('module_traffic_bot_networks').push({ asn: 139341, note: null });
        await migration.up({ database: migrationDatabase });

        const rows = database.getCollectionData('module_traffic_bot_rules');
        expect(rows).toHaveLength(1);
        expect(rows[0].mode).toBe('monitor');
    });

    it('does nothing when the legacy collection is absent', async () => {
        await migration.up({ database: migrationDatabase });

        expect(database.getCollectionData('module_traffic_bot_rules')).toEqual([]);
    });
});
