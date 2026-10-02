/**
 * Unit tests for the chain query tools that look inside contract execution:
 * the single-transaction trace, a contract's payouts and call graph, and
 * contract deployments.
 *
 * They pin what each tool promises the model and the read patterns that keep
 * it cheap: the trace finds a transaction through the `tx_id` skip index and
 * so never reads with `FINAL`, payouts read the contract's own ledger rows,
 * and deployments join each direct deployment to its receipt's address.
 */
import { describe, it, expect } from 'vitest';
import { toHexAddress } from '../../../lib/tron-address.js';
import { buildContractCallGraphTool } from '../chain-query/tools/buildContractCallGraphTool.js';
import { buildContractDeploymentsTool } from '../chain-query/tools/buildContractDeploymentsTool.js';
import { buildContractPayoutsTool } from '../chain-query/tools/buildContractPayoutsTool.js';
import { buildTransactionTraceTool } from '../chain-query/tools/buildTransactionTraceTool.js';
import { buildToolkit, CONTEXT, OTHER, PEER, USDT, WALLET } from './chainQueryTestToolkit.js';

/** A transaction id in the stored form: 64 lowercase hex characters. */
const TX = 'ab'.repeat(32);

/**
 * The `tron.transaction` row of a USDT transfer call signed by WALLET.
 *
 * @returns The row as the lookup query returns it.
 */
function transferCallRow(): Record<string, unknown> {
    return {
        block_number: '29000',
        transaction_index: '4',
        block_timestamp: '2026-09-24 11:00:00.000',
        contract_type: 'TriggerSmartContract',
        contract_ret: 'SUCCESS',
        fee_limit: '100000000',
        permission_id: '0',
        signatures: '1',
        memo_hex: '',
        parameter: JSON.stringify({
            owner_address: toHexAddress(WALLET),
            contract_address: toHexAddress(USDT),
            data: `a9059cbb${'0'.repeat(128)}`,
            call_value: 0
        })
    };
}

describe('blockchain-transaction-trace', () => {
    it('reports found false for a transaction the stored data does not hold', async () => {
        const { toolkit, reads } = buildToolkit(() => []);

        const result = await buildTransactionTraceTool(toolkit).handler({ txId: `0x${TX.toUpperCase()}` }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: true, found: false, txId: TX }));
        const lookup = reads.find(entry => entry.sql.includes('tx_id = {txId'));
        expect(lookup?.params.txId).toBe(TX);
        expect(lookup?.sql).not.toContain('FINAL');
    });

    it('explains the call, its internal transactions, and its value movements without FINAL reads', async () => {
        const { toolkit, reads } = buildToolkit((sql) => {
            let rows: unknown[] = [];
            if (sql.includes('transaction_info')) {
                rows = [{
                    fee: '345000', result: 'SUCESS', res_message: '', contract_address: USDT,
                    receipt_energy_usage: '0', receipt_energy_fee: '345000', receipt_origin_energy_usage: '0',
                    receipt_energy_usage_total: '29631', receipt_net_usage: '345', receipt_net_fee: '0',
                    receipt_result: 'SUCCESS', receipt_energy_penalty_total: '0'
                }];
            } else if (sql.includes('internal_transaction')) {
                rows = [{
                    internal_index: '0', caller_address: USDT, transfer_to_address: PEER,
                    call_values: ['1000000'], token_ids: [''], note_text: 'call', rejected: 0, total: '1'
                }];
            } else if (sql.includes('_transfer')) {
                rows = [{
                    source: 'log', event_index: '0', from_address: WALLET, to_address: PEER,
                    asset_type: 'trc20', token: USDT, amount_text: '2500000', total: '1'
                }];
            } else if (sql.includes('tron.transaction')) {
                rows = [transferCallRow()];
            }
            return rows;
        });

        const result = await buildTransactionTraceTool(toolkit).handler({ txId: TX }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: true, found: true, status: 'SUCCESS', type: 'TriggerSmartContract' }));
        expect(result.call).toEqual(expect.objectContaining({
            signer: WALLET,
            contract: USDT,
            method: { selector: 'a9059cbb', signature: 'transfer(address,uint256)' }
        }));
        const internals = result.internalTransactions as { calls: Array<Record<string, unknown>> };
        expect(internals.calls[0]).toEqual(expect.objectContaining({
            from: USDT,
            to: PEER,
            note: 'call',
            movesValue: true,
            rejected: false,
            values: [{ token: 'TRX', amount: { raw: '1000000', value: '1' } }]
        }));
        const movements = result.valueMovements as { movements: Array<Record<string, unknown>> };
        expect(movements.movements[0]).toEqual(expect.objectContaining({ from: WALLET, to: PEER, token: USDT, amount: { raw: '2500000', value: '2.5' } }));
        expect(result).not.toHaveProperty('events');
        const ownReads = reads.filter(entry => !entry.sql.includes('tron.block FINAL') && !entry.sql.includes('tron._token'));
        expect(ownReads.length).toBeGreaterThan(0);
        for (const read of ownReads) {
            expect(read.sql).not.toContain('FINAL');
        }
    });

    it('refuses a txId that is not 64 hex characters', async () => {
        const { toolkit, reads } = buildToolkit(() => []);

        const result = await buildTransactionTraceTool(toolkit).handler({ txId: 'not-a-tx' }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
        expect(reads).toHaveLength(0);
    });
});

describe('blockchain-contract-payouts', () => {
    it('refuses first-seen for a TRC-20 token, which cannot activate an account', async () => {
        const { toolkit, reads } = buildToolkit(() => []);

        const result = await buildContractPayoutsTool(toolkit).handler({ contract: WALLET, view: 'first-seen', token: USDT }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
        expect(reads).toHaveLength(0);
    });

    it('reads the contract\'s own ledger rows once and converts the summary totals', async () => {
        const { toolkit, reads } = buildToolkit((sql) => sql.includes('GROUP BY asset_type, token, source')
            ? [{
                asset_type: 'trc20', token: USDT, source: 'log', movements: '3', counterparties: '2',
                total_amount: '5000000', first_at: '2026-09-24 01:00:00.000', last_at: '2026-09-24 09:00:00.000',
                total_groups: '1', total_movements: '3', total_counterparties: '2'
            }]
            : []);

        const result = await buildContractPayoutsTool(toolkit).handler({ contract: WALLET }, undefined, CONTEXT) as Record<string, unknown>;

        const ledgerReads = reads.filter(entry => entry.sql.includes('_transfer'));
        expect(ledgerReads).toHaveLength(1);
        expect(ledgerReads[0].sql).toContain('uniqExactMerge(uniqExactState(counterparty)) OVER ()');
        expect(ledgerReads[0].sql).toContain('address = {contract:String}');
        expect(ledgerReads[0].params).toEqual(expect.objectContaining({ contract: WALLET, direction: 'out' }));
        expect(result).toEqual(expect.objectContaining({ success: true, movements: 3, counterparties: 2 }));
        expect((result.byToken as Array<Record<string, unknown>>)[0]).toEqual(expect.objectContaining({
            token: USDT,
            source: 'log',
            total: { raw: '5000000', value: '5' }
        }));
    });

    it('lists recipients whose first stored movement was the contract\'s payment', async () => {
        const { toolkit, reads } = buildToolkit((sql) => {
            let rows: unknown[] = [];
            if (sql.includes('AS recipients')) {
                rows = [{ recipients: '10' }];
            } else if (sql.includes('argMin(counterparty')) {
                rows = [{
                    recipient: PEER, first_at: '2026-09-24 10:00:00.000', first_tx: TX,
                    first_asset: 'trx', first_token: '', first_amount: '1000000', total_matches: '4'
                }];
            }
            return rows;
        });

        const result = await buildContractPayoutsTool(toolkit).handler({ contract: WALLET, view: 'first-seen', limit: 1 }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: true, recipientsChecked: 10, firstSeen: 4, returned: 1, truncated: true }));
        expect((result.recipients as Array<Record<string, unknown>>)[0]).toEqual(expect.objectContaining({ address: PEER, token: 'TRX', amount: { raw: '1000000', value: '1' } }));
        const read = reads.find(entry => entry.sql.includes('argMin(counterparty'));
        expect(read?.sql).toContain('WHERE address IN (');
        expect(read?.params).toEqual(expect.objectContaining({ contract: WALLET, retentionFrom: expect.any(String) }));
    });
});

describe('blockchain-contract-call-graph', () => {
    it('groups the contracts calling this one, filtering on the callee column without FINAL', async () => {
        const { toolkit, reads } = buildToolkit((sql) => sql.includes('internal_transaction')
            ? [{
                party: PEER, calls: '7', transactions: '5', rejected_calls: '1', kinds: ['call', 'create'],
                trx_moved: '3000000', first_at: '2026-09-24 01:00:00.000', last_at: '2026-09-24 09:00:00.000',
                sample_tx: TX, total_groups: '2', all_calls: '9'
            }]
            : []);

        const result = await buildContractCallGraphTool(toolkit).handler({ contract: WALLET, limit: 1 }, undefined, CONTEXT) as Record<string, unknown>;

        const read = reads.find(entry => entry.sql.includes('internal_transaction'));
        expect(read?.sql).toContain('PREWHERE transfer_to_address = {contract:String}');
        expect(read?.sql).not.toContain('FINAL');
        expect(read?.params).toEqual(expect.objectContaining({ contract: WALLET, limit: 1 }));
        expect(result).toEqual(expect.objectContaining({ success: true, view: 'callers', totalCalls: 9, totalParties: 2, truncated: true }));
        expect((result.parties as Array<Record<string, unknown>>)[0]).toEqual(expect.objectContaining({
            address: PEER,
            calls: 7,
            rejected: 1,
            kinds: ['call', 'create'],
            trxMoved: { raw: '3000000', value: '3' },
            sampleTxId: TX
        }));
    });

    it('filters on the caller column for the callees view', async () => {
        const { toolkit, reads } = buildToolkit(() => []);

        await buildContractCallGraphTool(toolkit).handler({ contract: WALLET, view: 'callees' }, undefined, CONTEXT);

        expect(reads.find(entry => entry.sql.includes('internal_transaction'))?.sql).toContain('PREWHERE caller_address = {contract:String}');
    });
});

describe('blockchain-contract-deployments', () => {
    it('joins each direct deployment to its receipt\'s contract address and filters by deployer', async () => {
        const { toolkit, reads } = buildToolkit((sql) => {
            let rows: unknown[] = [];
            if (sql.includes('CreateSmartContract')) {
                rows = [{
                    block_number: '29000', block_timestamp: '2026-09-24 11:00:00.000', tx_id: TX,
                    owner_hex: toHexAddress(WALLET), name: 'Token', contract_ret: 'SUCCESS', total_matches: '1'
                }];
            } else if (sql.includes('AS new_contract')) {
                rows = [{ tx_id: TX, new_contract: OTHER }];
            }
            return rows;
        });

        const result = await buildContractDeploymentsTool(toolkit).handler({ via: 'direct', deployer: WALLET }, undefined, CONTEXT) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: true, totals: { direct: 1, factory: null } }));
        expect((result.deployments as Array<Record<string, unknown>>)[0]).toEqual(expect.objectContaining({
            contract: OTHER,
            deployer: WALLET,
            via: 'direct',
            name: 'Token'
        }));
        const read = reads.find(entry => entry.sql.includes('CreateSmartContract'));
        expect(read?.params.deployerHex).toBe(toHexAddress(WALLET).toLowerCase());
        expect(reads.some(entry => entry.sql.includes('internal_transaction'))).toBe(false);
    });

    it('merges factory deployments, with the factory as deployer, newest first', async () => {
        const { toolkit, reads } = buildToolkit((sql) => {
            let rows: unknown[] = [];
            if (sql.includes('CreateSmartContract')) {
                rows = [{
                    block_number: '29000', block_timestamp: '2026-09-24 11:00:00.000', tx_id: TX,
                    owner_hex: toHexAddress(WALLET), name: '', contract_ret: 'SUCCESS', total_matches: '1'
                }];
            } else if (sql.includes('internal_transaction')) {
                rows = [{
                    block_number: '29600', block_timestamp: '2026-09-24 11:30:00.000', tx_id: 'cd'.repeat(32),
                    caller_address: PEER, transfer_to_address: OTHER, rejected: 0, total_matches: '1'
                }];
            }
            return rows;
        });

        const result = await buildContractDeploymentsTool(toolkit).handler({}, undefined, CONTEXT) as Record<string, unknown>;

        const deployments = result.deployments as Array<Record<string, unknown>>;
        expect(result.totals).toEqual({ direct: 1, factory: 1 });
        expect(deployments.map(row => row.via)).toEqual(['factory', 'direct']);
        expect(deployments[0]).toEqual(expect.objectContaining({ contract: OTHER, deployer: PEER, status: 'SUCCESS' }));
        expect(deployments[1]).toEqual(expect.objectContaining({ contract: null, name: null }));
        expect(reads.find(entry => entry.sql.includes('internal_transaction'))?.sql).toContain('unhex(note) = \'create\'');
    });
});
