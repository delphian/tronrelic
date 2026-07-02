/**
 * @fileoverview Tests for value-transfer derivation — the source-independent
 * `IValueTransfer` legs that back the proposed account value ledger.
 *
 * Three surfaces: the pure `toValueTransfers` deriver (native, fee, and reward
 * legs — token legs are sourced from events, not transactions), the provider's internal-transfer
 * mapping (TVM value moves the transaction endpoints omit), and the provider's
 * token-leg sourcing from the per-transaction events endpoint. The discriminating
 * properties are that only genuine native-TRX contract types produce a TRX leg —
 * TRC10 and staking/delegation rows, whose `amount_sun` is not TRX, produce nothing;
 * that an internal call's protocol hash becomes the leg key so legs sharing a parent
 * never collide; and that a token leg's `log_index` (the event index) is its leg key,
 * so two distinct same-token transfers in one transaction stay distinct.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IBlockTransaction } from '@/types';
import { TronGridClient } from '../../blockchain/tron-grid.client.js';
import { TronGridAccountHistoryProvider, toValueTransfers } from '../providers/trongrid-account-history.provider.js';

/**
 * Build a minimal top-level transaction.
 *
 * @param overrides - Fields to set on top of the SUCCESS/empty defaults.
 * @returns An IBlockTransaction.
 */
function tx(overrides: Partial<IBlockTransaction>): IBlockTransaction {
    return {
        txId: 'tx',
        blockNumber: 1,
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        type: 'TransferContract',
        status: 'SUCCESS',
        from: { address: 'Tfrom' },
        to: { address: 'Tto' },
        ...overrides
    };
}

describe('toValueTransfers', () => {
    it('derives a native TRX leg from a TransferContract amount', () => {
        const legs = toValueTransfers(tx({ type: 'TransferContract', amountSun: 1_000_000 }));
        expect(legs).toEqual([
            expect.objectContaining({ origin: 'native', assetType: 'TRX', assetId: '', amountRaw: '1000000', legKey: '' })
        ]);
    });

    it('derives a native TRX leg from a TriggerSmartContract call-value', () => {
        const legs = toValueTransfers(tx({ type: 'TriggerSmartContract', amountSun: 250_000 }));
        expect(legs).toHaveLength(1);
        expect(legs[0]).toMatchObject({ origin: 'native', assetType: 'TRX', amountRaw: '250000' });
    });

    it('does NOT derive a token leg from a decoded transfer (token legs come from events)', () => {
        // Token legs are sourced from the per-transaction events endpoint (which
        // carries log_index), never from the transaction itself — deriving one here
        // could only use an empty leg key and would collapse distinct same-token legs.
        const legs = toValueTransfers(
            tx({
                type: 'TriggerSmartContract',
                contract: { address: 'Tusdt', method: 'transfer', parameters: { value: '500', decimals: 6 } }
            })
        );
        expect(legs).toEqual([]);
    });

    it('excludes TRC10 TransferAssetContract (amount_sun is a token count, not TRX)', () => {
        expect(toValueTransfers(tx({ type: 'TransferAssetContract', amountSun: 31_364_900_000 }))).toEqual([]);
    });

    it('excludes staking and delegation rows whose amount_sun is not a transfer', () => {
        expect(toValueTransfers(tx({ type: 'DelegateResourceContract', amountSun: 11_585_300_000 }))).toEqual([]);
        expect(toValueTransfers(tx({ type: 'FreezeBalanceV2Contract', amountSun: 5_000_000 }))).toEqual([]);
    });

    it('derives a fee leg (payer → burn) whenever the transaction burned TRX', () => {
        // The fee is a genuine total-balance reduction even for non-value contract
        // types, so it must appear alongside — or without — a native leg.
        const legs = toValueTransfers(tx({ type: 'TransferContract', amountSun: 1_000_000, feeSun: 267_000 }));
        expect(legs).toHaveLength(2);
        expect(legs[1]).toMatchObject({ origin: 'fee', assetType: 'TRX', from: 'Tfrom', to: '', amountRaw: '267000', legKey: '' });

        const feeOnly = toValueTransfers(tx({ type: 'FreezeBalanceV2Contract', amountSun: 5_000_000, feeSun: 1_100 }));
        expect(feeOnly).toEqual([expect.objectContaining({ origin: 'fee', amountRaw: '1100' })]);
    });

    it('derives a reward leg (protocol → claimer) from a WithdrawBalanceContract claim', () => {
        // The claim's amount is overlaid from the transaction info's withdraw_amount
        // upstream; here the deriver must book it as income entering the claimer.
        const legs = toValueTransfers(tx({ type: 'WithdrawBalanceContract', amountSun: 42_000_000, to: { address: 'Tfrom' } }));
        expect(legs).toEqual([
            expect.objectContaining({ origin: 'reward', assetType: 'TRX', from: '', to: 'Tfrom', amountRaw: '42000000', legKey: '' })
        ]);
    });

    it('derives no reward or native leg from an amount-less claim', () => {
        expect(toValueTransfers(tx({ type: 'WithdrawBalanceContract' }))).toEqual([]);
    });
});

describe('TronGridAccountHistoryProvider.fetchInternalTransfersPage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Stub the shared client so the provider reads canned internal-transaction
     * items. Address conversion (`toBase58Address`) stays real so the hex→base58
     * step is exercised end to end.
     *
     * @param data - Raw internal-transaction items to return.
     * @param fingerprint - The page's continuation cursor.
     */
    function stubClient(data: unknown[], fingerprint?: string): void {
        vi.spyOn(TronGridClient, 'getInstance').mockReturnValue({
            getAccountInternalTransactions: vi.fn(async () => ({ data, meta: { fingerprint } }))
        } as unknown as TronGridClient);
    }

    it('maps an inline TRX call-value to an internal leg keyed by the protocol hash', async () => {
        stubClient(
            [
                {
                    internal_tx_id: 'hash1',
                    tx_id: 'parent1',
                    block_timestamp: 1_700_000_000_000,
                    from_address: '419f0792b59281ac67a31010bc151ebe8d367a4fbb',
                    to_address: '411af9228d09cd636d8ad53864b495648360218624',
                    data: { note: 'call', rejected: false, call_value: { _: 100000 } }
                }
            ],
            'fp1'
        );

        const result = await new TronGridAccountHistoryProvider().fetchInternalTransfersPage('Taddr', { limit: 50 });

        expect(result.nextFingerprint).toBe('fp1');
        expect(result.transfers).toHaveLength(1);
        expect(result.transfers[0]).toMatchObject({
            txId: 'parent1',
            origin: 'internal',
            legKey: 'hash1',
            assetType: 'TRX',
            assetId: '',
            amountRaw: '100000'
        });
        // Hex addresses are converted to base58.
        expect(result.transfers[0].from).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
        expect(result.transfers[0].to).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    });

    it('drops a rejected internal transfer (it moved no value)', async () => {
        stubClient([
            {
                internal_tx_id: 'hash2',
                tx_id: 'parent2',
                from_address: '419f0792b59281ac67a31010bc151ebe8d367a4fbb',
                to_address: '411af9228d09cd636d8ad53864b495648360218624',
                data: { rejected: true, call_value: { _: 999 } }
            }
        ]);

        const result = await new TronGridAccountHistoryProvider().fetchInternalTransfersPage('Taddr', { limit: 50 });
        expect(result.transfers).toEqual([]);
    });

    it('splits a multi-asset call-value into one leg per asset, sharing the leg key', async () => {
        stubClient([
            {
                internal_tx_id: 'hash3',
                tx_id: 'parent3',
                from_address: '419f0792b59281ac67a31010bc151ebe8d367a4fbb',
                to_address: '411af9228d09cd636d8ad53864b495648360218624',
                data: { rejected: false, call_value: { _: 100, '1002000': 500 } }
            }
        ]);

        const result = await new TronGridAccountHistoryProvider().fetchInternalTransfersPage('Taddr', { limit: 50 });
        expect(result.transfers).toHaveLength(2);
        const trx = result.transfers.find((t) => t.assetType === 'TRX');
        const trc10 = result.transfers.find((t) => t.assetType === 'TRC10');
        expect(trx).toMatchObject({ legKey: 'hash3', assetId: '', amountRaw: '100' });
        expect(trc10).toMatchObject({ legKey: 'hash3', assetId: '1002000', amountRaw: '500' });
    });
});

describe('TronGridAccountHistoryProvider.fetchTokenTransferLegs', () => {
    // The tracked account is the base58 of 0xa614f803b6fd780986a42c78ec9c7f77e6ded13c
    // (the USDT contract address, reused here purely as a known hex↔base58 pair).
    const ACCOUNT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const ACCOUNT_HEX = '0xa614f803b6fd780986a42c78ec9c7f77e6ded13c';
    const OTHER_HEX = '0x5d67810510c8f6b8f3a50503f0c92a09622748e8';
    const TOKEN = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Stub the shared client so the provider reads canned transaction events.
     * Address conversion stays real so the 20-byte EVM (`0x…`) → base58 step,
     * including the `41` prefix normalization, is exercised end to end.
     *
     * @param events - Raw transaction event logs to return.
     */
    function stubEvents(events: unknown[]): void {
        vi.spyOn(TronGridClient, 'getInstance').mockReturnValue({
            getTransactionEventsOrThrow: vi.fn(async () => events)
        } as unknown as TronGridClient);
    }

    /**
     * Build a minimal TRC20 Transfer event log.
     *
     * @param index - The event's log index within the transaction.
     * @param from - Sender (0x hex).
     * @param to - Recipient (0x hex).
     * @param value - Raw token amount.
     * @returns A raw event log object.
     */
    function transferEvent(index: number, from: string, to: string, value: string): Record<string, unknown> {
        return {
            event_name: 'Transfer',
            contract_address: TOKEN,
            event_index: index,
            block_number: 100,
            block_timestamp: 1_700_000_000_000,
            result: { from, to, value }
        };
    }

    it('builds a token_event leg keyed by log index, converting 0x addresses to base58', async () => {
        stubEvents([transferEvent(0, OTHER_HEX, ACCOUNT_HEX, '31000000')]);
        const legs = await new TronGridAccountHistoryProvider().fetchTokenTransferLegs(ACCOUNT, 'tx1');
        expect(legs).toHaveLength(1);
        expect(legs[0]).toMatchObject({
            txId: 'tx1',
            origin: 'token_event',
            legKey: '0',
            assetType: 'TRC20',
            assetId: TOKEN,
            to: ACCOUNT,
            amountRaw: '31000000',
            blockNumber: 100
        });
        expect(legs[0].from).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    });

    it('keeps distinct same-token legs apart by their log index (the collision fix)', async () => {
        stubEvents([
            transferEvent(0, OTHER_HEX, ACCOUNT_HEX, '10'),
            transferEvent(1, OTHER_HEX, ACCOUNT_HEX, '20')
        ]);
        const legs = await new TronGridAccountHistoryProvider().fetchTokenTransferLegs(ACCOUNT, 'tx1');
        expect(legs).toHaveLength(2);
        expect(legs.map((l) => l.legKey)).toEqual(['0', '1']);
        expect(legs.map((l) => l.amountRaw)).toEqual(['10', '20']);
    });

    it('drops a Transfer that does not involve the tracked account', async () => {
        stubEvents([transferEvent(0, OTHER_HEX, OTHER_HEX, '99')]);
        const legs = await new TronGridAccountHistoryProvider().fetchTokenTransferLegs(ACCOUNT, 'tx1');
        expect(legs).toEqual([]);
    });

    it('skips non-Transfer and value-less logs', async () => {
        stubEvents([
            { event_name: 'Approval', contract_address: TOKEN, event_index: 0, result: { from: OTHER_HEX, to: ACCOUNT_HEX, value: '5' } },
            { event_name: 'Transfer', contract_address: TOKEN, event_index: 1, result: { from: OTHER_HEX, to: ACCOUNT_HEX } }
        ]);
        const legs = await new TronGridAccountHistoryProvider().fetchTokenTransferLegs(ACCOUNT, 'tx1');
        expect(legs).toEqual([]);
    });
});
