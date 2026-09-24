/**
 * Unit tests for the shared transaction-parse module. These pure functions are
 * the single source of truth for turning a TronGrid contract bag into
 * normalized on-chain fields, consumed by both the sync pipeline and the
 * transaction-detail service — so their behavior is pinned here.
 */
import { describe, it, expect } from 'vitest';
import {
    normalizeContractType,
    resolveOwnerAddress,
    resolveRecipient,
    resolveAmounts,
    describeContract
} from '../transaction-parse.js';

/** A real TRON address in TronGrid hex form (the USDT TRC20 contract). */
const HEX_ADDRESS = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';
const BASE58 = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

describe('normalizeContractType', () => {
    it('passes through known contract types', () => {
        expect(normalizeContractType('TransferContract')).toBe('TransferContract');
        expect(normalizeContractType('TriggerSmartContract')).toBe('TriggerSmartContract');
    });

    it('maps unknown or missing types to Unknown', () => {
        expect(normalizeContractType('NotAType')).toBe('Unknown');
        expect(normalizeContractType(undefined)).toBe('Unknown');
    });
});

describe('resolveOwnerAddress', () => {
    it('converts a valid owner_address to base58', () => {
        expect(resolveOwnerAddress({ owner_address: HEX_ADDRESS })).toMatch(BASE58);
    });

    it('falls back to "unknown" when absent or undecodable', () => {
        expect(resolveOwnerAddress({})).toBe('unknown');
    });
});

describe('resolveRecipient', () => {
    it('reads to_address for a transfer', () => {
        const to = resolveRecipient('TransferContract', { to_address: HEX_ADDRESS }, 'fallback');
        expect(to).toMatch(BASE58);
    });

    it('reads contract_address for a smart-contract call', () => {
        const to = resolveRecipient('TriggerSmartContract', { contract_address: HEX_ADDRESS }, 'fallback');
        expect(to).toMatch(BASE58);
    });

    it('returns the fallback when no recipient field resolves', () => {
        expect(resolveRecipient('TransferContract', {}, 'sender')).toBe('sender');
    });
});

describe('resolveAmounts', () => {
    it('reads the native amount for a transfer (sun and TRX)', () => {
        expect(resolveAmounts('TransferContract', { amount: 1_500_000 })).toEqual({
            rawAmountSun: 1_500_000,
            amountTRX: 1.5
        });
    });

    it('reads call_value for a smart-contract call and parses string values', () => {
        expect(resolveAmounts('TriggerSmartContract', { call_value: '2000000' })).toEqual({
            rawAmountSun: 2_000_000,
            amountTRX: 2
        });
    });

    it('is zero for types that carry no native value', () => {
        expect(resolveAmounts('TriggerSmartContract', {})).toEqual({ rawAmountSun: 0, amountTRX: 0 });
    });
});

describe('describeContract', () => {
    it('describes a transfer with the transfer method', () => {
        const contract = describeContract('TransferContract', { to_address: HEX_ADDRESS, amount: 1_000_000 });
        expect(contract.method).toBe('transfer');
        expect(contract.address).toMatch(BASE58);
    });

    it('decodes the 4-byte selector for a smart-contract call', () => {
        const contract = describeContract('TriggerSmartContract', {
            contract_address: HEX_ADDRESS,
            data: 'a9059cbb0000000000000000000000000000000000000000000000000000000000000001'
        });
        expect(contract.method).toBe('0xa9059cbb');
    });

    it('passes every integer in a raw contract bag through as a decimal string, nested ones included', () => {
        // One type per field at every size. A field that was a number when
        // small and a string when large would break arithmetic only on the
        // rare large value.
        const contract = describeContract('VoteWitnessContract', {
            owner_address: HEX_ADDRESS,
            votes: [{ vote_address: HEX_ADDRESS, vote_count: 12 }],
            support: true
        });
        expect(contract.parameters).toEqual({
            owner_address: HEX_ADDRESS,
            votes: [{ vote_address: HEX_ADDRESS, vote_count: '12' }],
            support: true
        });
    });

    it('keeps a large integer the exact parser already returned as text', () => {
        const contract = describeContract('TransferAssetContract', {
            asset_name: '31303032303030',
            amount: '9223372036854775807'
        });
        expect(contract.parameters?.amount).toBe('9223372036854775807');
    });

    it('gives a TRC-10 total supply and a freeze duration as text', () => {
        expect(describeContract('AssetIssueContract', { total_supply: 1_000_000 }).parameters?.totalSupply).toBe('1000000');
        expect(describeContract('FreezeBalanceContract', { frozen_duration: 3 }).parameters?.duration).toBe('3');
    });

    it('passes a delegation\'s lock and lock period through to observers', () => {
        // Rental trackers read these to tell a locked rental from an open
        // delegation. Dropping them recorded every delegation as unlocked.
        const locked = describeContract('DelegateResourceContract', {
            receiver_address: HEX_ADDRESS,
            resource: 'ENERGY',
            balance: 1_000_000,
            lock: true,
            lock_period: 28_800
        });
        expect(locked.parameters).toEqual({
            resource: 'ENERGY',
            balanceTRX: 1,
            lock: true,
            lock_period: '28800'
        });

        const open = describeContract('DelegateResourceContract', { receiver_address: HEX_ADDRESS, balance: 1_000_000 });
        expect(open.parameters?.lock).toBe(false);
        expect(open.parameters?.lock_period).toBeUndefined();
    });

    it('keeps amounts it derives as decimal numbers', () => {
        const contract = describeContract('TransferContract', { to_address: HEX_ADDRESS, amount: 1_500_000 });
        expect(contract.parameters).toEqual({ amountTRX: 1.5 });
    });
});
