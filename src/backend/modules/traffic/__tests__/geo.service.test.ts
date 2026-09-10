/**
 * @fileoverview Contract tests for `getClientIP`.
 *
 * The resolved address feeds analytics country lookup, the `ip_hash` and
 * `subnet_hash` source hashes, and admin audit-log entries. These tests pin
 * where it comes from: Cloudflare's CF-Connecting-IP when CF-Ray attests
 * the hop, otherwise the Express-resolved `req.ip`. The raw
 * X-Forwarded-For header is never read, because its left-most entry is
 * whatever the client sent.
 */
import { describe, it, expect } from 'vitest';
import { getClientIP } from '../services/geo.service.js';

describe('getClientIP', () => {
    it('returns req.ip when no Cloudflare headers are present', () => {
        expect(getClientIP({ ip: '203.0.113.7', headers: {} })).toBe('203.0.113.7');
    });

    it('ignores a client-written X-Forwarded-For and returns req.ip', () => {
        // A client can put any address at the head of this header; Express
        // has already resolved req.ip from the trusted end of the chain.
        const headers = { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' };
        expect(getClientIP({ ip: '203.0.113.7', headers })).toBe('203.0.113.7');
    });

    it('prefers CF-Connecting-IP when CF-Ray is present', () => {
        const headers = { 'cf-connecting-ip': '198.51.100.9', 'cf-ray': '8a1b2c3d4e5f-SJC' };
        expect(getClientIP({ ip: '172.18.0.4', headers })).toBe('198.51.100.9');
    });

    it('ignores CF-Connecting-IP without CF-Ray', () => {
        const headers = { 'cf-connecting-ip': '198.51.100.9' };
        expect(getClientIP({ ip: '203.0.113.7', headers })).toBe('203.0.113.7');
    });

    it('takes the first entry of a comma-joined or repeated CF-Connecting-IP', () => {
        const joined = { 'cf-connecting-ip': '198.51.100.9, 10.0.0.1', 'cf-ray': 'r' };
        const repeated = { 'cf-connecting-ip': ['198.51.100.9', '10.0.0.1'], 'cf-ray': 'r' };
        expect(getClientIP({ ip: '172.18.0.4', headers: joined })).toBe('198.51.100.9');
        expect(getClientIP({ ip: '172.18.0.4', headers: repeated })).toBe('198.51.100.9');
    });

    it('returns undefined when the request carries no address', () => {
        expect(getClientIP({ headers: { 'x-forwarded-for': '1.2.3.4' } })).toBeUndefined();
    });
});
