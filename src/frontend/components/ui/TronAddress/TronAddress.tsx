/**
 * @fileoverview Canonical TRON wallet address chip.
 *
 * Every surface that shows a wallet address — core pages, admin tables, plugin
 * UIs injected through `context.ui.TronAddress` — should render it through this
 * one component so truncation, copy, explorer linking, and tool-forwarding stay
 * identical everywhere and only have to be fixed in one place. Before this
 * existed each caller hand-rolled its own slice/tronscan link, drifting in
 * format and affordances.
 *
 * A smart contract address renders through `TronContractAddress` instead,
 * which links to Tronscan's contract page and offers only the tools that
 * accept a contract. Both are thin configurations of the shared
 * `AddressChip`, which holds the rendering, the tag signals, and the tools menu.
 */
'use client';

import { AddressChip, FORWARDABLE_TOOLS, type IAddressChipDisplayProps, type IAddressChipKind } from '../AddressChip';

/**
 * Wallet configuration for the shared chip. Tronscan is hardcoded because the
 * codebase has no configurable explorer provider today; keeping the URL in one
 * constant means a future switch changes one line rather than every caller.
 */
const WALLET_CHIP: IAddressChipKind = {
    explorerBaseUrl: 'https://tronscan.org/#/address/',
    explorerLabel: 'View address on Tronscan',
    copyLabel: 'Copy address',
    copiedLabel: 'Address copied',
    toolsLabel: 'Forward address to a tool',
    forwardTools: FORWARDABLE_TOOLS
};

/**
 * Props for {@link TronAddress}. The same display props every address chip
 * accepts; the wallet-specific behaviour is fixed by the component.
 */
export type ITronAddressProps = IAddressChipDisplayProps;

/**
 * Render a TRON wallet address as a compact, monospace chip with copy,
 * tool-forward, and explorer affordances. See the file overview for why this is
 * the single canonical wallet address renderer.
 *
 * @param props - {@link ITronAddressProps}; `address` is required, the three
 *        affordance booleans default on so the common case needs only the
 *        address, and callers trim affordances off for read-only contexts.
 * @returns The address chip element.
 */
export function TronAddress(props: ITronAddressProps) {
    return <AddressChip {...props} kind={WALLET_CHIP} />;
}
