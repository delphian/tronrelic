'use client';

/**
 * @fileoverview An amount, its token, and its dollar value in one table cell.
 *
 * The address page's tables used to give the amount, the token, and the
 * dollar value a column each. On a phone, where table rows stack into
 * labelled entries, that made every entry several lines taller than it needed
 * to be. One cell reads as "1,500 USDT" with "$1,500.00" under it instead.
 */

import type { IAddressExplorerAmount, IAddressExplorerToken, IAddressExplorerUsd } from '@/types';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { formatAmount } from '../../lib/formatAmount';
import { formatUsd } from '../../lib/formatUsd';
import { TokenLabel } from '../TokenLabel';
import styles from './TokenAmount.module.scss';

/** Props for {@link TokenAmount}. */
export interface ITokenAmountProps {
    /** The amount. */
    amount: IAddressExplorerAmount;
    /**
     * The token key: `TRX`, a TRC-10 id, or a TRC-20 contract address. Omit
     * it where the row already names the token, so it is not shown twice.
     */
    tokenKey?: string;
    /** The section's metadata for the key, when it has any. */
    token?: IAddressExplorerToken;
    /** The approximate dollar value, or null when no price is tracked; omit for amounts that never have one. */
    usd?: IAddressExplorerUsd | null;
}

/**
 * Render an amount with its token beside it and its dollar value beneath.
 *
 * @param props - {@link ITokenAmountProps}.
 * @returns The amount cell's content.
 */
export function TokenAmount({ amount, tokenKey, token, usd }: ITokenAmountProps) {
    const { t } = useTranslation();
    return (
        <span className={styles.amount}>
            <span className={styles.value}>
                {formatAmount(amount, t('addressExplorer.baseUnits', 'base units'))}
                {tokenKey && <TokenLabel tokenKey={tokenKey} token={token} />}
            </span>
            {usd && <span className={styles.usd}>{formatUsd(usd)}</span>}
        </span>
    );
}
