/**
 * Tests for summarizeUserAgent, which shortens a stored User-Agent to
 * "browser · system" for the user detail panel. The order in which browsers
 * are tested is what makes the summary correct, because Edge and Opera carry
 * a Chrome token and Chrome carries a Safari token, so these cases guard
 * that order as well as the fallbacks.
 */
import { describe, expect, it } from 'vitest';
import { summarizeUserAgent } from '../summarizeUserAgent';

describe('summarizeUserAgent', () => {
    it('names Safari on macOS from its Version token', () => {
        const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
        expect(summarizeUserAgent(userAgent)).toBe('Safari 19 · macOS');
    });

    it('names Chrome on Windows rather than the Safari token Chrome carries', () => {
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
        expect(summarizeUserAgent(userAgent)).toBe('Chrome 142 · Windows');
    });

    it('names Edge rather than the Chrome token Edge carries', () => {
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.3595.53';
        expect(summarizeUserAgent(userAgent)).toBe('Edge 142 · Windows');
    });

    it('names iOS rather than macOS for an iPhone, whose User-Agent also says Mac OS X', () => {
        const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.46 Mobile/15E148 Safari/604.1';
        expect(summarizeUserAgent(userAgent)).toBe('Chrome 142 · iOS');
    });

    it('names Android rather than the Linux token Android carries', () => {
        const userAgent = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
        expect(summarizeUserAgent(userAgent)).toBe('Chrome 142 · Android');
    });

    it('names a wallet app with its two-part version', () => {
        const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TronLink/4.12.3';
        expect(summarizeUserAgent(userAgent)).toBe('TronLink 4.12 · iOS');
    });

    it('does not call a webview Safari when it has a Version token but no Safari token', () => {
        const userAgent = 'Mozilla/5.0 (Linux; U; Android 4.4) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile';
        expect(summarizeUserAgent(userAgent)).toBe('Android');
    });

    it('falls back to the first product token for a script', () => {
        expect(summarizeUserAgent('curl/8.4.0')).toBe('curl 8.4.0');
    });

    it('returns null when there is no User-Agent', () => {
        expect(summarizeUserAgent(null)).toBeNull();
        expect(summarizeUserAgent(undefined)).toBeNull();
        expect(summarizeUserAgent('   ')).toBeNull();
    });

    it('reads no more than the clamped length of a very long value', () => {
        const summary = summarizeUserAgent('a'.repeat(10_000));
        expect(summary?.length).toBe(512);
    });
});
