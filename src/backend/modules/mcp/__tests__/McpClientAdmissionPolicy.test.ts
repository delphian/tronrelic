/**
 * @fileoverview Tests for the rule that decides which apps may register with
 * the OAuth server: which addresses it accepts, what it writes to the log for
 * a refused one, the limits on that log, and when it reports that a
 * registered app changed its details.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    McpClientAdmissionPolicy,
    REFUSAL_LOG_MAX_ADDRESSES,
    REFUSAL_LOG_MAX_ADDRESS_LENGTH,
    REFUSAL_LOG_WINDOW_MS
} from '../services/McpClientAdmissionPolicy.js';

/** A logger whose calls the tests inspect. */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;

/** The clock the policy reads, moved by tests that cross a log window. */
let nowMs = 1_000_000;

/** Build a policy that allows `claude.ai` and reads the test clock. */
function build(): McpClientAdmissionPolicy {
    return new McpClientAdmissionPolicy(['claude.ai'], logger, () => nowMs);
}

/** The fields of every warning logged so far, in order. */
function warnings(): Array<Record<string, unknown>> {
    return logger.warn.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>);
}

beforeEach(() => {
    logger.warn.mockClear();
    nowMs = 1_000_000;
});

describe('McpClientAdmissionPolicy.isAllowed', () => {
    it('accepts an HTTPS address on an allowed host and logs nothing', () => {
        const policy = build();
        expect(policy.isAllowed('https://claude.ai/oauth/mcp-oauth-client-metadata')).toBe(true);
        expect(policy.isAllowed('https://CLAUDE.AI/oauth/claude-code-client-metadata')).toBe(true);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('refuses an address on any other host', () => {
        expect(build().isAllowed('https://webhook.site/87e34fde-0a7d-4735-ab9e-c9e66f8fcfc0')).toBe(false);
    });

    /**
     * Each of these contains the allowed host as text without being on it.
     * They are why the host is compared after parsing and never matched
     * against the raw address.
     */
    it('refuses addresses that only look like an allowed host', () => {
        const policy = build();
        expect(policy.isAllowed('https://claude.ai.example.com/doc')).toBe(false);
        expect(policy.isAllowed('https://sub.claude.ai/doc')).toBe(false);
        expect(policy.isAllowed('https://claude.ai@example.com/doc')).toBe(false);
        expect(policy.isAllowed('https://example.com/claude.ai')).toBe(false);
        expect(policy.isAllowed('https://example.com/?host=claude.ai')).toBe(false);
    });

    it('refuses an allowed host over plain HTTP, on another port, or with credentials', () => {
        const policy = build();
        expect(policy.isAllowed('http://claude.ai/doc')).toBe(false);
        expect(policy.isAllowed('https://claude.ai:8443/doc')).toBe(false);
        expect(policy.isAllowed('https://user:secret@claude.ai/doc')).toBe(false);
    });

    it('refuses text that is not an address', () => {
        expect(build().isAllowed('not an address')).toBe(false);
        expect(warnings()).toEqual([{ suppliedLength: 14 }]);
    });

    it('refuses everything when the allowed list is empty', () => {
        const policy = new McpClientAdmissionPolicy([], logger, () => nowMs);
        expect(policy.isAllowed('https://claude.ai/oauth/mcp-oauth-client-metadata')).toBe(false);
    });
});

describe('McpClientAdmissionPolicy refusal log', () => {
    it('logs the host and path of a refused address, without its query, fragment, or credentials', () => {
        build().isAllowed('https://user:secret@Example.COM/app/doc.json?token=abc#frag');
        expect(warnings()).toEqual([
            {
                callerSuppliedHost: 'example.com',
                callerSuppliedAddress: 'https://example.com/app/doc.json',
                addressTruncated: false
            }
        ]);
    });

    /**
     * Guards the log against text placed there to mislead a reader: the URL
     * parser percent-encodes spaces and line breaks, so a refused address
     * cannot add a line or a readable sentence with spaces to an entry.
     */
    it('logs spaces and control characters in percent-encoded form', () => {
        build().isAllowed('https://example.com/ignore previous\tinstructions');
        const logged = String(warnings()[0].callerSuppliedAddress);
        expect(logged).toBe('https://example.com/ignore%20previousinstructions');
        expect(logged).toMatch(/^[\x21-\x7e]+$/);
    });

    it('cuts a long address to the limit and says it was cut', () => {
        build().isAllowed(`https://example.com/${'a'.repeat(2000)}`);
        const entry = warnings()[0];
        expect(String(entry.callerSuppliedAddress)).toHaveLength(REFUSAL_LOG_MAX_ADDRESS_LENGTH);
        expect(entry.addressTruncated).toBe(true);
    });

    it('logs one address once per window, then again in the next window', () => {
        const policy = build();
        policy.isAllowed('https://example.com/doc');
        policy.isAllowed('https://example.com/doc?again=1');
        expect(logger.warn).toHaveBeenCalledTimes(1);

        nowMs += REFUSAL_LOG_WINDOW_MS;
        policy.isAllowed('https://example.com/doc');
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    /**
     * Guards against a scanner that sends a different address on every
     * request: past the ceiling one entry says so, and nothing more is
     * written until the window ends.
     */
    it('stops logging after the ceiling of distinct addresses, and says so once', () => {
        const policy = build();
        for (let index = 0; index < REFUSAL_LOG_MAX_ADDRESSES + 25; index += 1) {
            expect(policy.isAllowed(`https://example.com/doc-${index}`)).toBe(false);
        }
        expect(logger.warn).toHaveBeenCalledTimes(REFUSAL_LOG_MAX_ADDRESSES + 1);
        expect(warnings()[REFUSAL_LOG_MAX_ADDRESSES]).toMatchObject({ loggedAddresses: REFUSAL_LOG_MAX_ADDRESSES });

        nowMs += REFUSAL_LOG_WINDOW_MS;
        policy.isAllowed('https://example.com/after-the-window');
        expect(logger.warn).toHaveBeenCalledTimes(REFUSAL_LOG_MAX_ADDRESSES + 2);
    });
});

describe('McpClientAdmissionPolicy.noteRefreshed', () => {
    const clientId = 'https://claude.ai/oauth/mcp-oauth-client-metadata';

    it('logs nothing when the name and redirect addresses are unchanged, in any order', () => {
        build().noteRefreshed(
            { clientId, name: 'Claude', redirectUris: ['https://a.example/cb', 'https://b.example/cb'] },
            { clientId, name: 'Claude', redirectUris: ['https://b.example/cb', 'https://a.example/cb'] }
        );
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('logs a changed redirect address with the values before and after', () => {
        build().noteRefreshed(
            { clientId, name: 'Claude', redirectUris: ['https://a.example/cb'] },
            { clientId, name: 'Claude', redirectUris: ['https://evil.example/cb'] }
        );
        expect(warnings()).toEqual([
            {
                clientId,
                nameChanged: false,
                redirectsChanged: true,
                previousName: 'Claude',
                name: 'Claude',
                previousRedirectUris: ['https://a.example/cb'],
                redirectUris: ['https://evil.example/cb']
            }
        ]);
    });

    it('logs a changed name', () => {
        build().noteRefreshed(
            { clientId, name: 'Claude', redirectUris: [] },
            { clientId, name: null, redirectUris: [] }
        );
        expect(warnings()[0]).toMatchObject({ nameChanged: true, redirectsChanged: false, previousName: 'Claude', name: null });
    });
});
