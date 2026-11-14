/**
 * @fileoverview Tests for how a charged group's limits become the budget the
 * governor counts: which counters are shared across groups, which are scoped
 * to one group, and what an unset limit means.
 */

import { describe, it, expect } from 'vitest';
import { buildCallerBudget } from '../services/mcp-server.factory.js';
import { defaultGroupPolicy } from '../services/McpGroupPolicyService.js';
import type { IMcpCaller } from '../services/IMcpCaller.js';

/** An anonymous caller from one network. */
const ANONYMOUS: IMcpCaller = { endpoint: 'public', principalKind: 'anonymous', principalId: 'net-a', groups: ['anonymous'] };

/** A signed-in caller. */
const USER: IMcpCaller = { endpoint: 'oauth', principalKind: 'user', principalId: 'user-1', groups: ['mcp-users', 'pro'] };

describe('buildCallerBudget', () => {
    it('sends every anonymous limit, with the day window scoped to the group and the pool shared by it', () => {
        const budget = buildCallerBudget(ANONYMOUS, defaultGroupPolicy('anonymous'));
        expect(budget).toMatchObject({
            callerKey: 'mcp:anonymous:net-a',
            callsPerMinute: 10,
            dayKey: 'mcp:anonymous:net-a:group:anonymous',
            callsPerDay: 200,
            poolKey: 'mcp-pool:anonymous',
            poolCallsPerDay: 5_000
        });
    });

    it('sends only the platform minute ceiling for a group with no limits of its own', () => {
        const budget = buildCallerBudget(USER, defaultGroupPolicy('pro'));
        expect(budget).toEqual({ callerKey: 'mcp:user:user-1', callsPerMinute: 60, callsPerMinutePerTool: 30 });
    });

    it('keys the minute windows by caller alone, so they hold across every group the caller reaches', () => {
        const viaPro = buildCallerBudget(USER, defaultGroupPolicy('pro'));
        const viaUsers = buildCallerBudget(USER, { ...defaultGroupPolicy('mcp-users'), limits: { callsPerMinutePerCaller: 5, callsPerDayPerCaller: 50, callsPerDayGroup: null } });
        expect(viaPro.callerKey).toBe(viaUsers.callerKey);
        expect(viaUsers.dayKey).toBe('mcp:user:user-1:group:mcp-users');
    });
});
