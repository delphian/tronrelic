/**
 * @fileoverview Tests for the secret scrubber applied to MCP results of
 * groups that ask for it: known values, credential patterns, secret field
 * names, and the things it must leave alone.
 */

import { describe, it, expect } from 'vitest';
import { REDACTION_MARKER, SecretScrubber } from '../services/SecretScrubber.js';

/** A stand-in for the deployment's admin token. */
const ADMIN_TOKEN = 'f3a9c2e81b7d4c06a5e2';

describe('SecretScrubber', () => {
    const scrubber = new SecretScrubber([ADMIN_TOKEN, 'mongodb://app:hunter2hunter2@db:27017/tronrelic', 'short', '']);

    it('replaces a known secret value wherever it appears', () => {
        expect(scrubber.scrubText(`token=${ADMIN_TOKEN};`)).toBe(`token=${REDACTION_MARKER};`);
    });

    it('ignores known values too short to match safely', () => {
        expect(scrubber.scrubText('a short note')).toBe('a short note');
    });

    it('removes the password from a connection URL but keeps the scheme', () => {
        expect(scrubber.scrubText('connect redis://default:s3cretpass@cache:6379')).toBe(`connect redis://${REDACTION_MARKER}@cache:6379`);
    });

    it('removes bearer tokens, JWTs, private keys, and prefixed API keys', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
        const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----';
        const text = `Authorization: Bearer abcdefghijklmnop1234 ${jwt} ${pem} sk-ant-api03-abcdefghijklmnopqrstuv`;
        const scrubbed = scrubber.scrubText(text);
        expect(scrubbed).toContain(`Bearer ${REDACTION_MARKER}`);
        expect(scrubbed).not.toContain(jwt);
        expect(scrubbed).not.toContain('MIIEvQIBADANBg');
        expect(scrubbed).not.toContain('sk-ant-api03');
    });

    it('removes Telegram bot tokens, including inside a Bot API URL, and botToken fields', () => {
        const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1';
        expect(scrubber.scrubText(`https://api.telegram.org/bot${token}/sendMessage`)).toBe(`https://api.telegram.org/bot${REDACTION_MARKER}/sendMessage`);
        expect(scrubber.scrub({ botToken: 'anything', webhookSecret: 'anything' })).toEqual({ botToken: REDACTION_MARKER, webhookSecret: REDACTION_MARKER });
    });

    it('replaces string values under secret field names and walks nested data', () => {
        const result = scrubber.scrub({ entries: [{ context: { password: 'pw', note: `uses ${ADMIN_TOKEN}` } }] });
        expect(result).toEqual({ entries: [{ context: { password: REDACTION_MARKER, note: `uses ${REDACTION_MARKER}` } }] });
    });

    it('leaves TRON addresses, token fields, and numbers alone', () => {
        const value = { tokenAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: 150000000, txId: 'a'.repeat(64) };
        expect(scrubber.scrub(value)).toEqual(value);
    });

    it('does not modify its input', () => {
        const input = { password: 'pw' };
        scrubber.scrub(input);
        expect(input.password).toBe('pw');
    });
});
