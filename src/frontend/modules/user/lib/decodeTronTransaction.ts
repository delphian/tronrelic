/**
 * @fileoverview Turn a raw TRON transaction into plain-language feed copy.
 *
 * A stored transaction is a contract type plus addresses and amounts — opaque to
 * a user reading their own history. The single consistently-praised feature of
 * the leading wallets (Rabby, DeBank, Zapper) is decoding that into a sentence:
 * "Sent 250 USDT", "Delegated energy". This helper centralises that mapping for
 * TRON's specific contract types — including the energy/bandwidth operations no
 * generic EVM tracker models — so the feed and any other consumer render the same
 * language from one source of truth.
 */

import type { IBlockTransaction } from '@/types';
import { formatTokenAmount, formatTrxFromSun } from './walletFormat';

/**
 * Which way value moved relative to the wallet being viewed. `self` is a wallet
 * paying itself (or a contract call it signed to itself); `none` covers rows
 * where the wallet is neither party (rare, defensive).
 */
export type TransactionDirection = 'in' | 'out' | 'self' | 'none';

/**
 * The decoded, render-ready view of one transaction.
 */
export interface IDecodedTransaction {
    /** Plain-language action, e.g. `"Sent USDT"` or `"Delegated resources"`. */
    label: string;
    /** Value movement relative to the viewed wallet, for colour/iconography. */
    direction: TransactionDirection;
    /** Formatted primary amount (`"250 USDT"`, `"1,000 TRX"`), or empty when the type carries none. */
    amount: string;
}

/**
 * Determine value direction relative to the viewed wallet from the transfer's
 * endpoints.
 *
 * @param tx - The transaction.
 * @param wallet - The base58 address being viewed.
 * @returns The movement direction.
 */
function resolveDirection(tx: IBlockTransaction, wallet: string): TransactionDirection {
    const isFrom = tx.from?.address === wallet;
    const isTo = tx.to?.address === wallet;
    if (isFrom && isTo) {
        return 'self';
    }
    if (isFrom) {
        return 'out';
    }
    if (isTo) {
        return 'in';
    }
    return 'none';
}

/**
 * Format a SUN amount for display, or an empty string when the type carries none.
 *
 * @param amountSun - The transaction's `amountSun` field, if the contract type populates it.
 * @returns The formatted TRX amount, or `''` when `amountSun` is absent.
 */
function formatSunAmount(amountSun: number | undefined): string {
    return typeof amountSun === 'number' ? formatTrxFromSun(amountSun) : '';
}

/**
 * Decode a transaction into feed-ready copy. Branches on TRON's contract type and
 * (for token transfers) the decoded token symbol carried in `contract.parameters`.
 *
 * @param tx - The transaction to decode.
 * @param wallet - The base58 address being viewed, to phrase send vs receive.
 * @returns The decoded label, direction, and formatted amount.
 */
export function decodeTronTransaction(tx: IBlockTransaction, wallet: string): IDecodedTransaction {
    const direction = resolveDirection(tx, wallet);
    const sent = direction === 'out';
    const token = tx.contract?.parameters;

    switch (tx.type) {
        case 'TransferContract':
            return { label: sent ? 'Sent TRX' : 'Received TRX', direction, amount: formatSunAmount(tx.amountSun) };
        case 'TriggerSmartContract': {
            // A decoded token transfer carries a symbol in the open parameters bag
            // (typed `unknown`, so narrow it); otherwise it is a bare contract call
            // (swap, approval, mint) we cannot name precisely.
            const symbol = typeof token?.symbol === 'string' ? token.symbol : undefined;
            const rawValue = token?.value;
            if (symbol && rawValue !== undefined) {
                const decimals = typeof token?.decimals === 'number' ? token.decimals : 0;
                const amount = formatTokenAmount(Number(rawValue), decimals, symbol);
                return { label: sent ? `Sent ${symbol}` : `Received ${symbol}`, direction, amount };
            }
            return { label: 'Contract call', direction, amount: '' };
        }
        case 'FreezeBalanceV2Contract':
            return { label: 'Staked TRX', direction, amount: formatSunAmount(tx.amountSun) };
        case 'UnfreezeBalanceV2Contract':
            return { label: 'Unstaked TRX', direction, amount: '' };
        case 'DelegateResourceContract':
            return { label: 'Delegated resources', direction, amount: formatSunAmount(tx.amountSun) };
        case 'UnDelegateResourceContract':
            return { label: 'Reclaimed resources', direction, amount: '' };
        case 'WithdrawExpireUnfreezeContract':
            return { label: 'Withdrew unstaked TRX', direction, amount: '' };
        case 'WithdrawBalanceContract':
            return { label: 'Withdraw Balance', direction, amount: formatSunAmount(tx.amountSun) };
        default: {
            // Humanize an unmapped contract type: strip the trailing "Contract"
            // and space the PascalCase so it still reads, rather than dumping the
            // raw identifier.
            const label = tx.type.replace(/Contract$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
            return { label: label || 'Transaction', direction, amount: '' };
        }
    }
}
