/**
 * @fileoverview Selection-logic tests for TronGridClient.getActivatingTransaction.
 *
 * Why these exist: the activator edge decides every hop of the Address Origins
 * ladder and of plugin provenance tooling, and it is resolved from two feeds
 * whose failure modes look identical from the outside. A contract-created
 * account's real activation is invisible to the top-level feed, so a wrong
 * selection here does not throw — it silently reports a false activator or a
 * false origin, which no downstream check can detect. The cases below pin the
 * behaviours that distinguish them: create_time rejection of a late top-level
 * transfer, the internal-transactions fallback that then names the contract,
 * and the filters that keep outbound, reverted, and zero-value internal rows
 * from being mistaken for an activation.
 *
 * The three network methods are stubbed on the singleton rather than at the HTTP
 * layer so each test states exactly what the two feeds return.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import TronWeb from 'tronweb';
import { TronGridClient } from '../tron-grid.client.js';

/** Base58 address under test; the account whose activator is being resolved. */
const SUBJECT = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
/** Base58 activator used for top-level (EOA-funded) expectations. */
const FUNDER = 'TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9';
/** Base58 contract used for internal-activation expectations. */
const CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** Fixed epoch-ms creation stamp; every timestamp below is relative to it. */
const CREATE_TIME = 1_700_000_000_000;

/**
 * Convert base58 back to the 41-hex wire form, why: the client converts hex to
 * base58 internally, so fixtures must supply hex or the address filters compare
 * mismatched formats and every row is discarded for the wrong reason.
 *
 * @param base58 - Address to encode.
 * @returns 41-prefixed hex string.
 */
function toHex(base58: string): string {
    return TronWeb.address.toHex(base58);
}

/**
 * Build a top-level transactions response carrying one transaction owned by
 * `owner`, why: every top-level case differs only in that owner and the block
 * timestamp, so the envelope shape is factored out rather than repeated.
 *
 * @param ownerHex - Hex `owner_address` of the transaction's first contract.
 * @param blockTimestamp - Confirmation time, which the create_time guard compares.
 * @returns The `/v1/accounts/{addr}/transactions` envelope.
 */
function topLevelResponse(ownerHex: string, blockTimestamp: number) {
    return {
        data: [{
            txID: 'toplevel-tx',
            block_timestamp: blockTimestamp,
            raw_data: { contract: [{ type: 'TransferContract', parameter: { value: { owner_address: ownerHex } } }] }
        }]
    };
}

/**
 * Build one internal-transactions row, why: the fallback's filters each need a
 * row that differs in exactly one field, and spelling the full envelope out per
 * case would bury which field is under test.
 *
 * @param overrides - Fields to change on an otherwise-valid inbound activation.
 * @returns One row for the `/v1/accounts/{addr}/internal-transactions` envelope.
 */
function internalRow(overrides: Record<string, unknown> = {}) {
    return {
        internal_tx_id: 'internal-hash',
        tx_id: 'parent-tx',
        block_timestamp: CREATE_TIME + 3_000,
        from_address: toHex(CONTRACT),
        to_address: toHex(SUBJECT),
        data: { note: 'call', rejected: false, call_value: { _: 1_100_000 } },
        ...overrides
    };
}

/** Base58 account used as the signer of a contract call in the internal cases. */
const CALLER = 'TAUN6FwrnwwmaEqYcckffC7wYmbaS6cBiX';

describe('TronGridClient.getActivatingTransaction', () => {
    let client: TronGridClient;
    let topLevel: ReturnType<typeof vi.fn>;
    let internal: ReturnType<typeof vi.fn>;
    let account: ReturnType<typeof vi.fn>;
    let transaction: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        client = TronGridClient.getInstance();
        topLevel = vi.fn();
        internal = vi.fn();
        account = vi.fn().mockResolvedValue({ create_time: CREATE_TIME });
        transaction = vi.fn().mockResolvedValue({
            txID: 'parent-tx',
            raw_data: { contract: [{ type: 'TriggerSmartContract', parameter: { value: { owner_address: toHex(CALLER) } } }] }
        });
        vi.spyOn(client, 'getAccountTransactions').mockImplementation(topLevel as never);
        vi.spyOn(client, 'getAccountInternalTransactions').mockImplementation(internal as never);
        vi.spyOn(client, 'getAccount').mockImplementation(account as never);
        vi.spyOn(client, 'getTransactionById').mockImplementation(transaction as never);
    });

    it('accepts a top-level transfer whose timestamp sits within block skew of create_time', async () => {
        topLevel.mockResolvedValue(topLevelResponse(toHex(FUNDER), CREATE_TIME + 3_000));

        const edge = await client.getActivatingTransaction(SUBJECT);

        expect(edge).toMatchObject({ activatorAddress: FUNDER, txId: 'toplevel-tx', contractType: 'TransferContract' });
        expect(internal).not.toHaveBeenCalled();
    });

    it('falls back to the internal feed when the oldest visible transfer post-dates creation', async () => {
        topLevel.mockResolvedValue(topLevelResponse(toHex(FUNDER), CREATE_TIME + 86_400_000));
        internal.mockResolvedValue({ data: [internalRow()] });

        const edge = await client.getActivatingTransaction(SUBJECT);

        expect(edge).toMatchObject({
            activatorAddress: CONTRACT,
            txId: 'parent-tx',
            contractType: 'InternalTransaction'
        });
    });

    it('falls back to the internal feed when the account has no top-level transactions', async () => {
        topLevel.mockResolvedValue({ data: [] });
        internal.mockResolvedValue({ data: [internalRow()] });

        const edge = await client.getActivatingTransaction(SUBJECT);

        expect(edge?.activatorAddress).toBe(CONTRACT);
        // create_time was not resolved on the top-level path here, so the fallback
        // must fetch it itself rather than skipping the proximity test.
        expect(account).toHaveBeenCalledTimes(1);
    });

    it('resolves create_time once when both paths need it', async () => {
        topLevel.mockResolvedValue(topLevelResponse(toHex(FUNDER), CREATE_TIME + 86_400_000));
        internal.mockResolvedValue({ data: [internalRow()] });

        await client.getActivatingTransaction(SUBJECT);

        expect(account).toHaveBeenCalledTimes(1);
    });

    it('skips reverted, outbound, and zero-value internal rows before the activation', async () => {
        topLevel.mockResolvedValue({ data: [] });
        internal.mockResolvedValue({
            data: [
                internalRow({ data: { rejected: true, call_value: { _: 1_100_000 } } }),
                internalRow({ from_address: toHex(SUBJECT), to_address: toHex(CONTRACT) }),
                internalRow({ data: { rejected: false, call_value: {} } }),
                internalRow()
            ]
        });

        const edge = await client.getActivatingTransaction(SUBJECT);

        expect(edge?.activatorAddress).toBe(CONTRACT);
    });

    it('returns null when the oldest qualifying internal transfer post-dates creation', async () => {
        topLevel.mockResolvedValue({ data: [] });
        internal.mockResolvedValue({ data: [internalRow({ block_timestamp: CREATE_TIME + 86_400_000 })] });

        const edge = await client.getActivatingTransaction(SUBJECT);

        expect(edge).toBeNull();
    });

    it('returns null when neither feed yields a usable row', async () => {
        topLevel.mockResolvedValue({ data: [] });
        internal.mockResolvedValue({ data: [] });

        const edge = await client.getActivatingTransaction(SUBJECT);

        expect(edge).toBeNull();
    });

    it('accepts an internal edge when TronGrid omits create_time', async () => {
        account.mockResolvedValue({});
        topLevel.mockResolvedValue({ data: [] });
        internal.mockResolvedValue({ data: [internalRow({ block_timestamp: CREATE_TIME + 86_400_000 })] });

        const edge = await client.getActivatingTransaction(SUBJECT);

        expect(edge?.activatorAddress).toBe(CONTRACT);
    });

    it('rejects a top-level transfer that post-dates creation by more than the block-skew window', async () => {
        // Four blocks late. The old minute-wide tolerance accepted this, which is
        // how a transfer arriving seconds after a contract-created account was
        // born got reported as the account's activator.
        topLevel.mockResolvedValue(topLevelResponse(toHex(FUNDER), CREATE_TIME + 12_000));
        internal.mockResolvedValue({ data: [internalRow()] });

        const edge = await client.getActivatingTransaction(SUBJECT);

        expect(edge?.activatorAddress).toBe(CONTRACT);
    });

    it('refuses a delegation as the activator even when it lands inside the creation window', async () => {
        // Taken from a real mainnet account activated by an internal transfer:
        // its oldest visible transaction is a third party's resource delegation
        // three blocks after creation. That is inside any sane skew window, so a
        // timestamp test on its own attributes the delegator. java-tron rejects a
        // delegation to an account that does not exist, so it cannot be an
        // activation, and only the contract-type test can see that.
        topLevel.mockResolvedValue({
            data: [{
                txID: 'delegate-tx',
                block_timestamp: CREATE_TIME + 9_000,
                raw_data: { contract: [{ type: 'DelegateResourceContract', parameter: { value: { owner_address: toHex(FUNDER) } } }] }
            }]
        });
        internal.mockResolvedValue({ data: [internalRow()] });

        const edge = await client.getActivatingTransaction(SUBJECT);

        expect(edge).toMatchObject({ activatorAddress: CONTRACT, contractType: 'InternalTransaction' });
    });

    it('throws rather than attributing an unverified activator when the account lookup fails', async () => {
        // getAccount answers null on a transport failure. Treating that as "this
        // account has no create_time" disabled the guard entirely and published
        // whoever the oldest visible transaction belonged to as the activator.
        account.mockResolvedValue(null);
        topLevel.mockResolvedValue(topLevelResponse(toHex(FUNDER), CREATE_TIME + 3_000));

        await expect(client.getActivatingTransaction(SUBJECT)).rejects.toThrow(/account lookup failed/i);
        expect(internal).not.toHaveBeenCalled();
    });

    it('refuses a non-creating contract type as the activator when create_time is unavailable', async () => {
        // The shape of mainnet's burn address: no create_time, and an unrelated
        // third party's contract call as the oldest visible transaction.
        account.mockResolvedValue({});
        topLevel.mockResolvedValue({
            data: [{
                txID: 'toplevel-tx',
                block_timestamp: CREATE_TIME,
                raw_data: { contract: [{ type: 'TriggerSmartContract', parameter: { value: { owner_address: toHex(FUNDER) } } }] }
            }]
        });
        internal.mockResolvedValue({ data: [] });

        const edge = await client.getActivatingTransaction(SUBJECT);

        expect(edge).toBeNull();
    });

    it('still attributes a deployer when create_time is unavailable and the transaction created an account', async () => {
        account.mockResolvedValue({});
        topLevel.mockResolvedValue({
            data: [{
                txID: 'deploy-tx',
                block_timestamp: CREATE_TIME,
                raw_data: { contract: [{ type: 'CreateSmartContract', parameter: { value: { owner_address: toHex(FUNDER) } } }] }
            }]
        });

        const edge = await client.getActivatingTransaction(SUBJECT);

        expect(edge).toMatchObject({ activatorAddress: FUNDER, contractType: 'CreateSmartContract' });
        expect(internal).not.toHaveBeenCalled();
    });

    it('records the contract and the signer as separate parties on an internal edge', async () => {
        topLevel.mockResolvedValue({ data: [] });
        internal.mockResolvedValue({ data: [internalRow()] });

        const edge = await client.getActivatingTransaction(SUBJECT);

        // The contract's balance moved the value; the signer ran the code. Both
        // are true and neither is "the creator", so collapsing them into one
        // field is what this asserts against.
        expect(edge).toMatchObject({
            subjectAddress: SUBJECT,
            activatorAddress: CONTRACT,
            callerAddress: CALLER,
            creationTimeVerified: true
        });
    });

    it('leaves the signer absent when the parent transaction cannot be read', async () => {
        topLevel.mockResolvedValue({ data: [] });
        internal.mockResolvedValue({ data: [internalRow()] });
        transaction.mockResolvedValue(null);

        const edge = await client.getActivatingTransaction(SUBJECT);

        // The edge still stands on the internal row alone; only the extra lead is
        // lost, and a climb then continues from the contract.
        expect(edge?.activatorAddress).toBe(CONTRACT);
        expect(edge?.callerAddress).toBeUndefined();
    });

    it('reports co-controllers of the subject and excludes the subject itself', async () => {
        account.mockResolvedValue({
            create_time: CREATE_TIME,
            owner_permission: { keys: [{ address: SUBJECT, weight: 1 }] },
            active_permission: [{ id: 2, keys: [{ address: SUBJECT, weight: 1 }, { address: CALLER, weight: 1 }] }]
        });
        topLevel.mockResolvedValue(topLevelResponse(toHex(FUNDER), CREATE_TIME + 3_000));

        const edge = await client.getActivatingTransaction(SUBJECT);

        // Every account lists itself in its own permissions, so only a genuinely
        // shared key should survive the filter.
        expect(edge?.subjectControllers).toEqual([CALLER]);
    });

    it('marks an edge unverified when the subject carries no creation stamp', async () => {
        account.mockResolvedValue({});
        topLevel.mockResolvedValue({
            data: [{
                txID: 'deploy-tx',
                block_timestamp: CREATE_TIME,
                raw_data: { contract: [{ type: 'CreateSmartContract', parameter: { value: { owner_address: toHex(FUNDER) } } }] }
            }]
        });

        const edge = await client.getActivatingTransaction(SUBJECT);

        expect(edge?.creationTimeVerified).toBe(false);
    });

    it('asks the internal feed for inbound rows only', async () => {
        topLevel.mockResolvedValue({ data: [] });
        internal.mockResolvedValue({ data: [internalRow()] });

        await client.getActivatingTransaction(SUBJECT);

        // Without only_to the account's own outbound transfers share the page and
        // can push the activating row past the scan limit, which reads as "no
        // activator" for a contract-created account.
        expect(internal).toHaveBeenCalledWith(SUBJECT, expect.objectContaining({ only_to: true, order_by: 'block_timestamp,asc' }));
    });
});
