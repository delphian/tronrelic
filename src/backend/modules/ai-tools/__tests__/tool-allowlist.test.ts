/**
 * @file tool-allowlist.test.ts
 *
 * Covers the shared allowlist vocabulary from `@/types` that lets one array name
 * both governed registry tools and provider-hosted ones.
 *
 * The helper lives in the types package because every layer needs it — the
 * provider building a request, the controller scoping a trifecta preview, and
 * the admin picker writing entries — but the types package has no test target of
 * its own, so its coverage sits here with the module that owns the vocabulary.
 *
 * The case worth protecting is the one that makes the whole scheme safe to
 * deploy: an allowlist written before the prefix existed must split into "these
 * registry tools, no hosted tools", because that is what turns an upgrade into a
 * default-deny for hosted tools rather than a silent grant.
 */

import { describe, it, expect } from 'vitest';
import { HOSTED_TOOL_PREFIX, hostedToolEntry, isHostedToolEntry, splitToolAllowlist } from '@/types';

describe('tool allowlist vocabulary', () => {
    describe('hostedToolEntry', () => {
        it('writes the prefix so no caller spells it by hand', () => {
            expect(hostedToolEntry('web_search')).toBe(`${HOSTED_TOOL_PREFIX}web_search`);
        });
    });

    describe('isHostedToolEntry', () => {
        it('separates a hosted grant from a registry tool name', () => {
            expect(isHostedToolEntry('hosted:web_search')).toBe(true);
            expect(isHostedToolEntry('tronrelic-get-transaction')).toBe(false);
        });
    });

    describe('splitToolAllowlist', () => {
        it('partitions a mixed list into its two halves', () => {
            const split = splitToolAllowlist(['tronrelic-get-transaction', 'hosted:web_search', 'blog-propose-post']);

            expect(split.registry).toEqual(['tronrelic-get-transaction', 'blog-propose-post']);
            expect(split.hosted).toEqual(['web_search']);
        });

        it('reads a pre-prefix allowlist as granting no hosted tools', () => {
            // The deployment-safety property: every allowlist stored before the
            // prefix existed lands here, and none of them grants a hosted tool.
            const split = splitToolAllowlist(['tronrelic-get-transaction']);

            expect(split.hosted).toEqual([]);
        });

        it('returns two empty halves for an absent allowlist', () => {
            // Callers must decide "no restriction" before calling; this only
            // reports that there is nothing named either way.
            expect(splitToolAllowlist(undefined)).toEqual({ registry: [], hosted: [] });
        });

        it('drops a bare prefix rather than yielding an empty hosted name', () => {
            // No provider can report a tool with an empty name, so keeping the
            // entry would make a grant look larger than it is.
            expect(splitToolAllowlist([HOSTED_TOOL_PREFIX]).hosted).toEqual([]);
        });
    });
});
