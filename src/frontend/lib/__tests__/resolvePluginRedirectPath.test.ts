/**
 * Plugin page redirect target tests.
 *
 * A plugin's redirect target can come from stored data, so these lock in that
 * the catch-all route follows only a path on this site and never one that
 * leaves the site or points back at the page being rendered.
 */
import { describe, it, expect } from 'vitest';
import { resolvePluginRedirectPath } from '../resolvePluginRedirectPath';

describe('resolvePluginRedirectPath', () => {
    it('accepts an on-site path and trims it', () => {
        expect(resolvePluginRedirectPath('/blog/new-slug', '/blog/old-slug')).toBe('/blog/new-slug');
        expect(resolvePluginRedirectPath('  /blog/new-slug ', '/blog/old-slug')).toBe('/blog/new-slug');
    });

    it('refuses targets a browser would read as another host', () => {
        expect(resolvePluginRedirectPath('//evil.example/x', '/blog/a')).toBeNull();
        expect(resolvePluginRedirectPath('/\\evil.example/x', '/blog/a')).toBeNull();
        expect(resolvePluginRedirectPath('https://evil.example/x', '/blog/a')).toBeNull();
        expect(resolvePluginRedirectPath('blog/relative', '/blog/a')).toBeNull();
    });

    it('refuses whitespace or control characters inside the path', () => {
        expect(resolvePluginRedirectPath('/blog/a b', '/blog/x')).toBeNull();
        expect(resolvePluginRedirectPath('/\t/evil.example', '/blog/x')).toBeNull();
    });

    it('refuses a redirect to the page being rendered, with or without a trailing slash', () => {
        expect(resolvePluginRedirectPath('/blog/a', '/blog/a')).toBeNull();
        expect(resolvePluginRedirectPath('/blog/a/', '/blog/a')).toBeNull();
    });

    it('refuses anything that is not a non-empty string', () => {
        expect(resolvePluginRedirectPath(undefined, '/blog/a')).toBeNull();
        expect(resolvePluginRedirectPath('', '/blog/a')).toBeNull();
        expect(resolvePluginRedirectPath({ path: '/blog/b' }, '/blog/a')).toBeNull();
    });
});
