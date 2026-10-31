/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the bot rules service.
 *
 * Covers what the rest of the module relies on: a change made through the
 * service updates the in-memory set ingestion reads at once, only active and
 * enabled rules match, and a proposed rule stays inert until a curator decides
 * it, after which it runs in monitor mode only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { BOT_RULES_COLLECTION, BotRuleNotFoundError, BotRulesService } from '../services/bot-rules.service.js';
import { BotRuleValidationError, validateBotRuleInput } from '../services/bot-rule-validation.js';
import type { IBotRuleSignals } from '../services/bot-rule-matcher.js';

const INPUT = { name: 'AS45102', label: 'bot_other', mode: 'label', conditions: { asns: [45102] } };

/**
 * Signals for an anonymous page report from a given network.
 *
 * @param asn - The network number.
 * @returns Signals the matcher accepts.
 */
function from(asn: number): IBotRuleSignals {
    return { eventType: 'page', loggedIn: false, asn, country: 'SG', userAgent: 'Mozilla/5.0', path: '/', referrer: null, firstTouch: null, now: Date.now() };
}

describe('BotRulesService', () => {
    let database: ReturnType<typeof createMockDatabaseService>;
    let service: BotRulesService;

    beforeEach(() => {
        BotRulesService.resetInstance();
        database = createMockDatabaseService();
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ISystemLogService;
        BotRulesService.setDependencies(database, logger);
        service = BotRulesService.getInstance();
    });

    it('throws when getInstance() is called before setDependencies()', () => {
        BotRulesService.resetInstance();
        expect(() => BotRulesService.getInstance()).toThrow('setDependencies');
    });

    it('loads active rules already stored, so classification uses them from the first event', async () => {
        database.getCollectionData(BOT_RULES_COLLECTION).push({
            id: 'migrated-asn-45102', name: 'Network AS45102', note: null, conditions: { asns: [45102] },
            label: 'bot_other', mode: 'label', enabled: true, status: 'active', source: 'migration',
            evidence: null, expiresAt: null, createdAt: new Date(), updatedAt: new Date()
        });

        await service.load();

        expect(service.match(from(45102))?.ruleId).toBe('migrated-asn-45102');
        expect(service.match(from(9808))).toBeNull();
    });

    it('creates an active rule that matches at once', async () => {
        const rule = await service.create(INPUT);

        expect(rule.status).toBe('active');
        expect(rule.source).toBe('admin');
        expect(service.match(from(45102))).toEqual({ ruleId: rule.id, label: 'bot_other', mode: 'label' });
    });

    it('rejects invalid input without storing anything', async () => {
        await expect(service.create({ ...INPUT, conditions: {} })).rejects.toBeInstanceOf(BotRuleValidationError);
        expect(database.getCollectionData(BOT_RULES_COLLECTION)).toHaveLength(0);
    });

    it('stops matching a disabled rule', async () => {
        const rule = await service.create(INPUT);

        await service.update(rule.id, { ...INPUT, enabled: false });

        expect(service.match(from(45102))).toBeNull();
    });

    it('reports an update to an unknown rule as not found', async () => {
        await expect(service.update('missing', INPUT)).rejects.toBeInstanceOf(BotRuleNotFoundError);
    });

    it('removes a rule and stops matching it', async () => {
        const rule = await service.create(INPUT);

        expect(await service.remove(rule.id)).toBe(true);
        expect(service.match(from(45102))).toBeNull();
        expect(await service.remove(rule.id)).toBe(false);
    });

    it('reports the networks active rules cover', async () => {
        await service.create(INPUT);

        expect([...service.coveredAsns()]).toEqual([45102]);
    });

    describe('proposals', () => {
        it('stores a proposal in monitor mode that matches nothing until decided', async () => {
            const rule = await service.propose(validateBotRuleInput(INPUT), null);

            expect(rule.status).toBe('proposed');
            expect(rule.mode).toBe('monitor');
            expect(rule.source).toBe('ai-tool');
            expect(await service.countProposed()).toBe(1);
            expect(service.match(from(45102))).toBeNull();
        });

        it('activates an approved proposal in monitor mode', async () => {
            const rule = await service.propose(validateBotRuleInput(INPUT), null);

            expect(await service.decideProposal(rule.id, 'active')).toBe(true);

            expect(service.match(from(45102))).toEqual({ ruleId: rule.id, label: 'bot_other', mode: 'monitor' });
            expect((await service.get(rule.id))?.status).toBe('active');
        });

        it('keeps a rejected proposal inert', async () => {
            const rule = await service.propose(validateBotRuleInput(INPUT), null);

            await service.decideProposal(rule.id, 'rejected');

            expect(service.match(from(45102))).toBeNull();
            expect((await service.get(rule.id))?.status).toBe('rejected');
        });

        it('does not decide a rule that is no longer proposed', async () => {
            const rule = await service.create(INPUT);

            expect(await service.decideProposal(rule.id, 'rejected')).toBe(false);
            expect((await service.get(rule.id))?.status).toBe('active');
        });
    });
});
