/**
 * @fileoverview Tests for the comparison behind the `/system/mcp` warning that
 * the server's description no longer matches what anonymous callers are
 * served. The rule lives in `@/types` because the admin page recomputes it
 * after each toggle; it is tested here beside the module that reports it.
 */

import { describe, it, expect } from 'vitest';
import type { IMcpToolExposure } from '@/types';
import { buildMcpServerDescriptionStatus } from '@/types';

/** The description the tests report. */
const DESCRIPTION = 'TRON energy rental prices from TronRelic.';

/**
 * Build a tool row with one grant per listed group.
 *
 * @param name - The tool name.
 * @param grants - Each grant's group and whether it is served.
 * @returns The row, with only the fields the comparison reads filled in.
 */
function tool(name: string, grants: Array<{ groupId: string; served: boolean }>): Pick<IMcpToolExposure, 'name' | 'grants'> {
    return {
        name,
        grants: grants.map(grant => ({ ...grant, approvedAt: '2026-11-14T00:00:00.000Z', stale: false }))
    };
}

describe('buildMcpServerDescriptionStatus', () => {
    it('matches when anonymous callers are served exactly the described tools, in any order', () => {
        const status = buildMcpServerDescriptionStatus(DESCRIPTION, '1.2.0', ['prices', 'activity'], [
            tool('activity', [{ groupId: 'anonymous', served: true }]),
            tool('prices', [{ groupId: 'anonymous', served: true }, { groupId: 'mcp-users', served: true }]),
            tool('pages-get', [{ groupId: 'mcp-users', served: true }])
        ]);
        expect(status).toEqual({
            description: DESCRIPTION,
            version: '1.2.0',
            describedAnonymousTools: ['activity', 'prices'],
            servedAnonymousTools: ['activity', 'prices'],
            matchesAnonymousGrants: true
        });
    });

    it('stops matching when a tool is granted to anonymous callers that the description does not name', () => {
        const status = buildMcpServerDescriptionStatus(DESCRIPTION, '1.2.0', ['prices'], [
            tool('prices', [{ groupId: 'anonymous', served: true }]),
            tool('screen-address', [{ groupId: 'anonymous', served: true }])
        ]);
        expect(status.matchesAnonymousGrants).toBe(false);
        expect(status.servedAnonymousTools).toEqual(['prices', 'screen-address']);
    });

    /**
     * A grant that is not served, because the tool's capability changed or the
     * group is switched off, reaches no caller, so the description should not
     * be held to it.
     */
    it('counts only served anonymous grants, so a stale or switched-off grant reads as withdrawn', () => {
        const status = buildMcpServerDescriptionStatus(DESCRIPTION, '1.2.0', ['prices', 'activity'], [
            tool('activity', [{ groupId: 'anonymous', served: false }]),
            tool('prices', [{ groupId: 'anonymous', served: true }])
        ]);
        expect(status.servedAnonymousTools).toEqual(['prices']);
        expect(status.matchesAnonymousGrants).toBe(false);
    });
});
