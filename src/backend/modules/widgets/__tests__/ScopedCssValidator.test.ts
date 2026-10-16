/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for ScopedCssValidator — the security boundary that
 * checks operator-authored zone and placement `customCss` before it is
 * injected verbatim into a public `<style>` tag. The validator is the primary
 * defense against a `<style>`-breakout XSS, so these tests pin its guarantees
 * in both modes: the `</style` escape sequence is rejected, real syntax errors
 * are caught, rules that escape the wrapper are refused, the conditional-group
 * at-rule allowlist is honored, and oversized input is capped. The nested
 * mode used by placements additionally accepts rules inside the wrapper while
 * still refusing anything at the top level. A regression here re-opens the
 * injection vector, so the coverage is deliberately exhaustive.
 *
 * @module backend/modules/widgets/__tests__/ScopedCssValidator.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { ScopedCssValidator, SCOPED_CSS_MAX_LENGTH } from '../css/ScopedCssValidator.js';

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

describe.each([
    { mode: 'declarations-only (zones)', allowNestedRules: false },
    { mode: 'nested (placements)', allowNestedRules: true }
])('ScopedCssValidator.validate — guarantees shared by both modes, $mode', ({ allowNestedRules }) => {
    let logger: ISystemLogService;
    let validator: ScopedCssValidator;

    beforeEach(() => {
        logger = buildLoggerStub();
        validator = new ScopedCssValidator(logger, { allowNestedRules });
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

    it('rejects a rule that breaks out of the wrapper', async () => {
        const result = await validator.validate('} body { display: none;');
        expect(result.valid).toBe(false);
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
        const oversized = 'a'.repeat(SCOPED_CSS_MAX_LENGTH + 1);
        const result = await validator.validate(oversized);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain(String(SCOPED_CSS_MAX_LENGTH));
    });

    it('accepts input exactly at the max-length boundary (cap is inclusive)', async () => {
        const base = 'color: red;';
        const padding = SCOPED_CSS_MAX_LENGTH - base.length - '/**/'.length;
        const css = `${base}/*${'x'.repeat(padding)}*/`;
        expect(css.length).toBe(SCOPED_CSS_MAX_LENGTH);
        const result = await validator.validate(css);
        expect(result.valid).toBe(true);
    });
});

describe('ScopedCssValidator.validate — declarations-only mode', () => {
    let validator: ScopedCssValidator;

    beforeEach(() => {
        validator = new ScopedCssValidator(buildLoggerStub(), { allowNestedRules: false });
    });

    it('rejects a nested rule and names its selector', async () => {
        const result = await validator.validate('a { color: red; }');
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('"a"'))).toBe(true);
    });

    it('names the selector of a breakout rule', async () => {
        const result = await validator.validate('} body { display: none;');
        expect(result.errors.some(e => e.includes('body'))).toBe(true);
    });
});

describe('ScopedCssValidator.validate — nested mode', () => {
    let validator: ScopedCssValidator;

    beforeEach(() => {
        validator = new ScopedCssValidator(buildLoggerStub(), { allowNestedRules: true });
    });

    it('accepts nested rules alongside declarations', async () => {
        const css = 'gap: 1rem; a { padding: 12px 16px; } a:hover { color: var(--color-primary); }';
        const result = await validator.validate(css);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('accepts nesting-selector forms and rules inside an at-rule', async () => {
        const css = '&:hover { opacity: 0.9; } @container (max-width: 480px) { a svg { width: 16px; } }';
        const result = await validator.validate(css);
        expect(result.valid).toBe(true);
    });

    it('rejects a breakout that opens a second top-level rule', async () => {
        const result = await validator.validate('color: red; } body { display: none; } .x {');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('closes the scoped rule early');
    });

    it('rejects a breakout into a top-level at-rule', async () => {
        const result = await validator.validate('} @media screen { body { display: none; } } .x {');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('closes the scoped rule early');
    });

    it('rejects a disallowed at-rule nested inside a rule', async () => {
        const result = await validator.validate('a { @font-face { font-family: x; } }');
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('@font-face'))).toBe(true);
    });
});
