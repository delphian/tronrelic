/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for ZoneCssValidator — the security boundary that
 * sanitizes operator-authored zone `customCss` before it is injected verbatim
 * into a public `<style>` tag. The validator is the primary defense against a
 * CSS-injection / `<style>`-breakout XSS, so these tests pin its guarantees:
 * the `</style` escape sequence is rejected, real syntax errors are caught,
 * selector and at-rule breakouts are refused, the conditional-group at-rule
 * allowlist is honored, and oversized input is capped. A regression here
 * re-opens the injection vector, so the coverage is deliberately exhaustive.
 *
 * @module backend/modules/widgets/__tests__/zone-css.validator.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { ZoneCssValidator, ZONE_CSS_MAX_LENGTH } from '../zones/zone-css.validator.js';

/**
 * Build a minimal `ISystemLogService` stub. The validator only calls `warn`
 * (on the parse-failure path), but the constructor demands the full interface,
 * so every other member is an inert spy; `warn` is asserted against directly.
 *
 * @returns A logger stub whose `warn` spy records parse-failure diagnostics.
 */
function buildLoggerStub(): ISystemLogService {
    return {
        level: 'info',
        fatal: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(function (this: ISystemLogService) { return this; }),
        initialize: vi.fn(async () => {}),
        saveLog: vi.fn(async () => {}),
        getLogs: vi.fn(async () => ({
            logs: [], total: 0, page: 1, limit: 50, totalPages: 0,
            hasNextPage: false, hasPrevPage: false
        })),
        markAsResolved: vi.fn(async () => {}),
        cleanup: vi.fn(async () => 0),
        getStatistics: vi.fn(async () => ({
            total: 0, byLevel: {} as any, byService: {}, unresolved: 0
        })),
        getLogById: vi.fn(async () => null),
        markAsUnresolved: vi.fn(async () => null),
        deleteAllLogs: vi.fn(async () => 0),
        getStats: vi.fn(async () => ({ total: 0, byLevel: {} as any, resolved: 0, unresolved: 0 })),
        waitUntilInitialized: vi.fn(async () => {})
    } as unknown as ISystemLogService;
}

describe('ZoneCssValidator.validate', () => {
    let logger: ISystemLogService;
    let validator: ZoneCssValidator;

    beforeEach(() => {
        logger = buildLoggerStub();
        validator = new ZoneCssValidator(logger);
    });

    it('accepts well-formed bare declarations', async () => {
        const result = await validator.validate('color: var(--color-text); gap: 1rem;');
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('rejects a real CSS syntax error and logs the failure', async () => {
        // An unclosed bracket forces a genuine PostCSS CssSyntaxError, exercising
        // the catch path (a stray `}` would instead parse into a breakout rule).
        const result = await validator.validate('color: rgb(255');
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('rejects the "</style" breakout sequence outright', async () => {
        const result = await validator.validate('color: red; </style><script>alert(1)</script>');
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(['CSS may not contain the sequence "</style".']);
    });

    it('rejects "</style" case-insensitively, even inside a comment', async () => {
        const result = await validator.validate('/* </STYLE> */ color: red;');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('</style');
    });

    it('rejects a selector that breaks out of the wrapper', async () => {
        const result = await validator.validate('} body { display: none;');
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('body'))).toBe(true);
    });

    it('rejects a disallowed at-rule (@import can pull remote CSS)', async () => {
        const result = await validator.validate("@import url('http://evil.example/x.css');");
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('@import'))).toBe(true);
    });

    it.each(['media', 'container', 'supports'])(
        'permits the @%s conditional-group at-rule',
        async (atRule) => {
            const result = await validator.validate(`@${atRule} (min-width: 600px) { gap: 2rem; }`);
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        }
    );

    it('rejects input longer than the max length', async () => {
        const oversized = 'a'.repeat(ZONE_CSS_MAX_LENGTH + 1);
        const result = await validator.validate(oversized);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain(String(ZONE_CSS_MAX_LENGTH));
    });

    it('accepts input exactly at the max-length boundary (cap is inclusive)', async () => {
        const base = 'color: red;';
        const padding = ZONE_CSS_MAX_LENGTH - base.length - '/**/'.length;
        const css = `${base}/*${'x'.repeat(padding)}*/`;
        expect(css.length).toBe(ZONE_CSS_MAX_LENGTH);
        const result = await validator.validate(css);
        expect(result.valid).toBe(true);
    });
});
