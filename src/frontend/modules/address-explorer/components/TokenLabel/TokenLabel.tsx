'use client';

/**
 * @fileoverview Names the token a row of the address page is about.
 *
 * Rows carry only a token key. TRX is named as is; a TRC-20 token is shown as
 * a contract chip labelled with its symbol, because the symbol alone proves
 * nothing (anyone can deploy a contract calling itself USDT) and the chip lets
 * the reader check the contract; a TRC-10 token is named by its symbol or id.
 */

import type { IAddressExplorerToken } from '@/types';
import { TronContractAddress } from '../../../../components/ui/TronContractAddress';
import { useTranslation } from '../../../localization/hooks/useTranslation';

/** Props for {@link TokenLabel}. */
export interface ITokenLabelProps {
    /** The token key: `TRX`, a TRC-10 id, or a TRC-20 contract address. */
    tokenKey: string;
    /** The section's metadata for the key, when it has any. */
    token?: IAddressExplorerToken;
}

/**
 * Render the name of one token key.
 *
 * @param props - {@link ITokenLabelProps}.
 * @returns The token's name, or a contract chip for a TRC-20 token.
 */
export function TokenLabel({ tokenKey, token }: ITokenLabelProps) {
    const { t } = useTranslation();
    const assetType = token?.assetType ?? (tokenKey === 'TRX' ? 'trx' : tokenKey.startsWith('T') ? 'trc20' : 'trc10');
    let label;
    if (assetType === 'trx') {
        label = <span>TRX</span>;
    } else if (assetType === 'trc20') {
        label = <TronContractAddress address={tokenKey} label={token?.symbol ?? undefined} />;
    } else {
        label = <span>{t('addressExplorer.token.trc10', 'TRC-10 {name}', { name: token?.symbol ?? tokenKey })}</span>;
    }
    return label;
}
