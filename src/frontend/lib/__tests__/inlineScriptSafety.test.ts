/**
 * @fileoverview Tests for the two guards against script injection in page
 * markup: the JSON serializer used for inline `<script>` content, and the
 * Content-Security-Policy the middleware sends with every page.
 *
 * They are tested together because they cover the same risk from two sides.
 * The serializer stops stored text from breaking out of a script element, and
 * the policy stops a script that got into the page anyway from running.
 */

import { describe, it, expect } from 'vitest';
import { serializeInlineJson } from '@/types';
import { buildContentSecurityPolicy } from '../buildContentSecurityPolicy';

describe('serializeInlineJson', () => {
    // A page title is stored text. Written with JSON.stringify alone, this one
    // would end the JSON-LD script element and run the second script.
    it('leaves no "<" for stored text to close the script element with', () => {
        const title = '</script><script>alert(1)</script><!--';

        const json = serializeInlineJson({ headline: title });

        expect(json).not.toContain('<');
        expect(JSON.parse(json)).toEqual({ headline: title });
    });

    it('escapes the two line separators that end a string literal in older engines', () => {
        const text = 'line\u2028break\u2029end';

        const json = serializeInlineJson({ text });

        expect(json).not.toMatch(/[\u2028\u2029]/);
        expect(JSON.parse(json)).toEqual({ text });
    });

    it('writes null for a value JSON cannot represent, so the script stays valid', () => {
        expect(serializeInlineJson(undefined)).toBe('null');
    });
});

describe('buildContentSecurityPolicy', () => {
    it('allows scripts only by nonce, with no unsafe-inline or unsafe-eval in production', () => {
        const policy = buildContentSecurityPolicy('abc123', false);
        const scriptSrc = policy.split('; ').find(directive => directive.startsWith('script-src ')) ?? '';

        expect(scriptSrc).toContain("'nonce-abc123'");
        expect(scriptSrc).toContain("'strict-dynamic'");
        expect(scriptSrc).not.toContain("'unsafe-inline'");
        expect(scriptSrc).not.toContain("'unsafe-eval'");
    });

    // The middleware's header may be the only Content-Security-Policy a page
    // receives, so it has to carry the baseline directives itself.
    it('carries the baseline directives and allows framing only by the site itself', () => {
        const policy = buildContentSecurityPolicy('abc123', false);

        expect(policy).toContain("object-src 'none'");
        expect(policy).toContain("base-uri 'self'");
        expect(policy).toContain("frame-ancestors 'self'");
    });

    it('forbids framing entirely when asked, as the OAuth consent page requires', () => {
        const policy = buildContentSecurityPolicy('abc123', false, true);

        expect(policy).toContain("frame-ancestors 'none'");
        expect(policy).not.toContain("frame-ancestors 'self'");
    });
});
