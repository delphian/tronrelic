/**
 * Wildcard plugin-page path matching tests.
 *
 * Locks in the resolution semantics both registries depend on for hydration
 * safety: exact registrations beat wildcards, wildcards match only strictly
 * deeper paths, prefix boundaries are respected ('/blogx' never matches
 * '/blog/*'), and the longest wildcard prefix wins among overlaps.
 */
import { describe, it, expect } from 'vitest';
import {
    isWildcardPath,
    wildcardPrefix,
    matchPluginPagePath,
    sortWildcardEntries,
    type IWildcardPageEntry
} from '../pluginPagePathMatch';

describe('isWildcardPath', () => {
    it('accepts a path ending in /*', () => {
        expect(isWildcardPath('/blog/*')).toBe(true);
        expect(isWildcardPath('/a/b/*')).toBe(true);
    });

    it('rejects exact paths and degenerate wildcards', () => {
        expect(isWildcardPath('/blog')).toBe(false);
        expect(isWildcardPath('/blog/')).toBe(false);
        expect(isWildcardPath('/*')).toBe(false);
        expect(isWildcardPath('')).toBe(false);
    });
});

describe('wildcardPrefix', () => {
    it('strips the trailing /*', () => {
        expect(wildcardPrefix('/blog/*')).toBe('/blog');
        expect(wildcardPrefix('/a/b/*')).toBe('/a/b');
    });
});

describe('matchPluginPagePath', () => {
    const exact = new Map<string, string>([['/blog', 'list-page']]);
    const wildcards: Array<IWildcardPageEntry<string>> = sortWildcardEntries([
        { prefix: '/blog', value: 'post-page' },
        { prefix: '/blog/archive', value: 'archive-page' }
    ]);

    it('resolves an exact registration', () => {
        expect(matchPluginPagePath(exact, wildcards, '/blog')).toBe('list-page');
    });

    it('exact registration beats a wildcard covering the same path', () => {
        const exactOverlap = new Map<string, string>([['/blog/pinned', 'pinned-page']]);
        expect(matchPluginPagePath(exactOverlap, wildcards, '/blog/pinned')).toBe('pinned-page');
    });

    it('wildcard matches strictly deeper paths', () => {
        expect(matchPluginPagePath(new Map(), wildcards, '/blog/my-post')).toBe('post-page');
        expect(matchPluginPagePath(new Map(), wildcards, '/blog/2026/recap')).toBe('post-page');
    });

    it('wildcard does not match its own prefix', () => {
        expect(matchPluginPagePath(new Map(), wildcards, '/blog')).toBeNull();
    });

    it('wildcard does not match the prefix with a trailing slash only', () => {
        expect(matchPluginPagePath(new Map(), wildcards, '/blog/')).toBeNull();
    });

    it('respects prefix boundaries — /blogx never matches /blog/*', () => {
        expect(matchPluginPagePath(new Map(), wildcards, '/blogx')).toBeNull();
        expect(matchPluginPagePath(new Map(), wildcards, '/blogx/post')).toBeNull();
    });

    it('longest wildcard prefix wins among overlaps', () => {
        expect(matchPluginPagePath(new Map(), wildcards, '/blog/archive/2025')).toBe('archive-page');
        expect(matchPluginPagePath(new Map(), wildcards, '/blog/other')).toBe('post-page');
    });

    it('returns null when nothing matches', () => {
        expect(matchPluginPagePath(exact, wildcards, '/markets')).toBeNull();
    });
});

describe('sortWildcardEntries', () => {
    it('orders by prefix length descending without mutating the input', () => {
        const input: Array<IWildcardPageEntry<number>> = [
            { prefix: '/a', value: 1 },
            { prefix: '/a/b/c', value: 3 },
            { prefix: '/a/b', value: 2 }
        ];
        const sorted = sortWildcardEntries(input);
        expect(sorted.map(e => e.value)).toEqual([3, 2, 1]);
        expect(input.map(e => e.value)).toEqual([1, 3, 2]);
    });
});
