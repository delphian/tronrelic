/// <reference types="vitest" />

/**
 * @fileoverview Pins the SQL that provisions a managed ClickHouse account.
 *
 * These statements are the whole of the account's protection: a missing
 * `MIN 1` lets a caller switch a limit off by setting it to 0, a password in
 * plain text leaks into logs, and a grant applied before the revoke lets a
 * hand-added privilege survive. Each of those would fail silently, so each is
 * asserted.
 */

import { describe, it, expect } from 'vitest';
import type { IClickHouseAccountDefinition } from '@/types';
import { AI_AGENT_ACCOUNT_ID, buildAccountDefinitions } from '../services/buildAccountDefinitions.js';
import {
    accountObjectNames,
    buildApplyStatements,
    buildLimitStatements,
    buildProfileSettings
} from '../services/buildAccountSql.js';

const HASH = 'a'.repeat(64);

/**
 * The declared AI agent account, used as the fixture for every test.
 *
 * @returns The agent definition as the module declares it.
 */
function agentDefinition(): IClickHouseAccountDefinition {
    return buildAccountDefinitions('default').find(definition => definition.id === AI_AGENT_ACCOUNT_ID)!;
}

describe('buildAccountSql', () => {
    it('names the profile and quota after the user', () => {
        expect(accountObjectNames(agentDefinition())).toEqual({
            user: 'tronrelic_ai_agent',
            profile: 'tronrelic_ai_agent_profile',
            quota: 'tronrelic_ai_agent_quota'
        });
    });

    it('bounds every numeric limit with MIN 1 so a caller cannot switch it off with 0', () => {
        const settings = buildProfileSettings(agentDefinition().policy!.defaultLimits);
        for (const name of ['max_execution_time', 'max_rows_to_read', 'max_bytes_to_read', 'max_memory_usage', 'max_threads', 'max_result_rows']) {
            expect(settings).toMatch(new RegExp(`${name} = (\\d+) MIN 1 MAX \\1`));
        }
    });

    it('fixes read-only mode and the overflow modes as constants', () => {
        const settings = buildProfileSettings(agentDefinition().policy!.defaultLimits);
        expect(settings).toContain('readonly = 2 CONST');
        expect(settings).toContain("timeout_overflow_mode = 'throw' CONST");
        expect(settings).toContain("read_overflow_mode = 'throw' CONST");
        expect(settings).toContain("result_overflow_mode = 'throw' CONST");
        expect(settings).toContain('cancel_http_readonly_queries_on_client_close = 1 CONST');
    });

    it('identifies the user by password hash only', () => {
        const statements = buildApplyStatements(agentDefinition(), agentDefinition().policy!.defaultLimits, HASH);
        const identified = statements.filter(statement => statement.includes('IDENTIFIED'));
        expect(identified).toHaveLength(2);
        for (const statement of identified) {
            expect(statement).toContain(`IDENTIFIED WITH sha256_hash BY '${HASH}'`);
        }
    });

    it('creates the profile before the user, revokes before granting, and assigns the quota last', () => {
        const statements = buildApplyStatements(agentDefinition(), agentDefinition().policy!.defaultLimits, HASH);
        const index = (prefix: string) => statements.findIndex(statement => statement.startsWith(prefix));
        expect(index('CREATE SETTINGS PROFILE')).toBeLessThan(index('CREATE USER'));
        expect(index('REVOKE ALL')).toBeLessThan(index('GRANT SELECT'));
        expect(index('GRANT SELECT')).toBeLessThan(index('CREATE QUOTA'));
        expect(statements).toContain('GRANT SELECT ON `tron`.* TO `tronrelic_ai_agent`');
    });

    it('keys the quota by client key, falling back to the user name', () => {
        const [, quota] = buildLimitStatements(agentDefinition(), agentDefinition().policy!.defaultLimits);
        expect(quota).toContain('KEYED BY client_key, user_name FOR INTERVAL 1 hour');
    });

    it('limit statements touch only the profile and quota', () => {
        const statements = buildLimitStatements(agentDefinition(), agentDefinition().policy!.defaultLimits);
        expect(statements).toHaveLength(2);
        expect(statements[0].startsWith('ALTER SETTINGS PROFILE `tronrelic_ai_agent_profile`')).toBe(true);
        expect(statements[1].startsWith('ALTER QUOTA `tronrelic_ai_agent_quota`')).toBe(true);
    });

    it('refuses a zero, fractional, or oversized limit', () => {
        const limits = agentDefinition().policy!.defaultLimits;
        expect(() => buildProfileSettings({ ...limits, maxRowsToRead: 0 })).toThrow();
        expect(() => buildProfileSettings({ ...limits, maxThreads: 1.5 })).toThrow();
        expect(() => buildProfileSettings({ ...limits, maxBytesToRead: Number.MAX_VALUE })).toThrow();
    });

    it('refuses an unsafe user name, grant, or hash', () => {
        const definition = agentDefinition();
        expect(() => accountObjectNames({ ...definition, clickhouseUser: 'bad`name' })).toThrow();
        expect(() => buildApplyStatements(
            { ...definition, policy: { ...definition.policy!, grants: ['tron.*; DROP TABLE x'] } },
            definition.policy!.defaultLimits,
            HASH
        )).toThrow();
        expect(() => buildApplyStatements(definition, definition.policy!.defaultLimits, "x' OR '1")).toThrow();
    });

    it('refuses to build statements for an observed account', () => {
        const observed = buildAccountDefinitions('default').find(definition => !definition.policy)!;
        expect(() => buildApplyStatements(observed, agentDefinition().policy!.defaultLimits, HASH)).toThrow();
    });
});
