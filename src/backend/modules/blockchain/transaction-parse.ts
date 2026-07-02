/**
 * Pure parsing of TronGrid transaction `raw_data` into normalized on-chain
 * fields. Extracted from `BlockchainService.buildTransactionRecord` so the
 * sync pipeline and the lazy `TransactionDetailService` derive identical
 * field values from the same source — preventing the two paths from drifting
 * in how they interpret a contract's owner, recipient, amount, or method.
 *
 * Every function here is provider-shaped on input (it reads a TronGrid
 * contract `parameter.value` bag) but provider-neutral on output: addresses
 * are Base58, amounts are split into sun and TRX. Nothing here touches the
 * database, the network, or instance state.
 */
import type { TronTransactionType, ContractDetails } from '@/shared';
import { TronGridClient } from './tron-grid.client.js';

/**
 * Map a raw TronGrid contract type string to a normalized `TronTransactionType`,
 * defaulting to `'Unknown'` for anything outside the known set.
 *
 * @param rawType - Raw `raw_data.contract[].type` string from TronGrid.
 * @returns The normalized transaction type.
 */
export function normalizeContractType(rawType: string | undefined): TronTransactionType {
    const knownTypes: TronTransactionType[] = [
        'TransferContract',
        'TransferAssetContract',
        'TriggerSmartContract',
        'ParticipateAssetIssueContract',
        'FreezeBalanceContract',
        'FreezeBalanceV2Contract',
        'UnfreezeBalanceContract',
        'UnfreezeBalanceV2Contract',
        'WithdrawBalanceContract',
        'WithdrawExpireUnfreezeContract',
        'CancelAllUnfreezeV2Contract',
        'DelegateResourceContract',
        'UnDelegateResourceContract',
        'VoteWitnessContract',
        'AssetIssueContract',
        'CreateSmartContract',
        'Unknown'
    ];

    if (rawType && knownTypes.includes(rawType as TronTransactionType)) {
        return rawType as TronTransactionType;
    }

    return 'Unknown';
}

/**
 * Resolve the sender (owner) address of a contract to Base58, falling back to
 * `'unknown'` when the owner address is absent or undecodable.
 *
 * @param value - Contract `parameter.value` bag.
 * @returns Base58 owner address, or `'unknown'`.
 */
export function resolveOwnerAddress(value: Record<string, unknown>): string {
    return TronGridClient.toBase58Address(value.owner_address as string) ?? 'unknown';
}

/**
 * Resolve the recipient address for a contract to Base58. The recipient field
 * varies by contract type (`to_address`, `contract_address`, `receiver_address`),
 * so this normalizes that variation and falls back to the sender for
 * self-directed operations like staking.
 *
 * @param contractType - Normalized transaction type.
 * @param value - Contract `parameter.value` bag.
 * @param fallback - Address to return when no recipient field resolves.
 * @returns Base58 recipient address, or `fallback`.
 */
export function resolveRecipient(contractType: TronTransactionType, value: Record<string, unknown>, fallback: string): string {
    const candidates: Array<string | null | undefined> = [];

    switch (contractType) {
        case 'TransferContract':
        case 'TransferAssetContract':
            candidates.push(value.to_address as string);
            break;
        case 'TriggerSmartContract':
            candidates.push(value.contract_address as string);
            break;
        case 'DelegateResourceContract':
        case 'UnDelegateResourceContract':
            candidates.push(value.receiver_address as string);
            break;
        case 'FreezeBalanceContract':
        case 'FreezeBalanceV2Contract':
        case 'UnfreezeBalanceContract':
            candidates.push(value.receiver_address as string);
            break;
        case 'UnfreezeBalanceV2Contract':
        case 'WithdrawBalanceContract':
        case 'WithdrawExpireUnfreezeContract':
        case 'CancelAllUnfreezeV2Contract':
            // Self-directed staking/reward operations carry no recipient field —
            // the value moves within (or into) the owner's own account, so the
            // caller's fallback (the owner) is the honest recipient.
            break;
        default:
            candidates.push(value.to_address as string);
    }

    for (const candidate of candidates) {
        const address = TronGridClient.toBase58Address(candidate ?? undefined);
        if (address) {
            return address;
        }
    }

    return fallback;
}

/**
 * Extract the native value moved by a transaction, in both sun and TRX. The
 * amount field varies by contract type (`amount`, `call_value`, `balance`,
 * `frozen_balance`); types without a native value resolve to zero.
 *
 * @param contractType - Normalized transaction type.
 * @param value - Contract `parameter.value` bag.
 * @returns `{ rawAmountSun, amountTRX }` (TRX is `rawAmountSun / 1e6`).
 */
export function resolveAmounts(contractType: TronTransactionType, value: Record<string, unknown>): { rawAmountSun: number; amountTRX: number } {
    let rawAmountSun = 0;

    const extract = (field: string): number => {
        const val = value[field];
        if (typeof val === 'number') {
            return val;
        }
        if (typeof val === 'string') {
            const parsed = Number(val);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        return 0;
    };

    switch (contractType) {
        case 'TransferContract':
            rawAmountSun = extract('amount');
            break;
        case 'TriggerSmartContract':
            rawAmountSun = extract('call_value');
            break;
        case 'DelegateResourceContract':
        case 'UnDelegateResourceContract':
            rawAmountSun = extract('balance');
            break;
        case 'FreezeBalanceContract':
        case 'FreezeBalanceV2Contract':
        case 'UnfreezeBalanceContract':
            rawAmountSun = extract('frozen_balance') || extract('amount');
            break;
        case 'UnfreezeBalanceV2Contract':
            rawAmountSun = extract('unfreeze_balance');
            break;
        case 'WithdrawBalanceContract':
        case 'WithdrawExpireUnfreezeContract':
        case 'CancelAllUnfreezeV2Contract':
            // The claimed/withdrawn amount is not in the contract body — it lives
            // in the transaction *info* (`withdraw_amount` / `withdraw_expire_amount`),
            // which endpoint-specific mappers overlay after parsing.
            rawAmountSun = 0;
            break;
        default:
            rawAmountSun = extract('amount');
    }

    const amountTRX = rawAmountSun / 1_000_000;
    return { rawAmountSun, amountTRX };
}

/**
 * Build a structured contract description (address, method, relevant parameters)
 * for a transaction, normalizing the per-type differences so consumers don't
 * need transaction-specific parsing. For `TriggerSmartContract` the method is
 * the 4-byte selector decoded from calldata.
 *
 * @param contractType - Normalized transaction type.
 * @param value - Contract `parameter.value` bag.
 * @returns Normalized contract details.
 */
export function describeContract(contractType: TronTransactionType, value: Record<string, unknown>): ContractDetails {
    switch (contractType) {
        case 'TransferContract':
            return {
                address: TronGridClient.toBase58Address(value.to_address as string) ?? 'unknown',
                method: 'transfer',
                parameters: {
                    amountTRX: resolveAmounts(contractType, value).amountTRX
                }
            };
        case 'TriggerSmartContract': {
            const data = typeof value.data === 'string' ? value.data : '';
            const method = data?.length >= 8 ? `0x${data.slice(0, 8)}` : undefined;
            return {
                address: TronGridClient.toBase58Address(value.contract_address as string) ?? 'unknown',
                method,
                parameters: {
                    rawData: data,
                    callValueTRX: resolveAmounts(contractType, value).amountTRX
                }
            };
        }
        case 'DelegateResourceContract':
            return {
                address: TronGridClient.toBase58Address(value.receiver_address as string) ?? 'unknown',
                method: 'delegateResource',
                parameters: {
                    resource: value.resource,
                    balanceTRX: resolveAmounts(contractType, value).amountTRX
                }
            };
        case 'UnDelegateResourceContract':
            return {
                address: TronGridClient.toBase58Address(value.receiver_address as string) ?? 'unknown',
                method: 'undelegateResource',
                parameters: {
                    resource: value.resource,
                    balanceTRX: resolveAmounts(contractType, value).amountTRX
                }
            };
        case 'FreezeBalanceContract':
        case 'FreezeBalanceV2Contract':
            return {
                address: TronGridClient.toBase58Address(value.receiver_address as string) ?? 'unknown',
                method: 'freezeBalance',
                parameters: {
                    resource: value.resource,
                    duration: value.frozen_duration,
                    balanceTRX: resolveAmounts(contractType, value).amountTRX
                }
            };
        case 'UnfreezeBalanceContract':
            return {
                address: TronGridClient.toBase58Address(value.receiver_address as string) ?? 'unknown',
                method: 'unfreezeBalance',
                parameters: {
                    resource: value.resource
                }
            };
        case 'AssetIssueContract':
            return {
                address: TronGridClient.toBase58Address(value.owner_address as string) ?? 'unknown',
                method: 'assetIssue',
                parameters: {
                    name: value.name,
                    abbr: value.abbr,
                    totalSupply: value.total_supply
                }
            };
        default:
            return {
                address: TronGridClient.toBase58Address(value.contract_address as string) ?? 'unknown',
                method: contractType,
                parameters: value
            };
    }
}
