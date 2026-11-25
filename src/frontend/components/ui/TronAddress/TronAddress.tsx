/**
 * @fileoverview Canonical TRON wallet address chip.
 *
 * Every surface that shows a wallet address — core pages, admin tables, plugin
 * UIs injected through `context.ui.TronAddress` — should render it through this
 * one component so truncation and the tools menu (copy, the address page link,
 * and tool forwarding) stay identical everywhere and only have to be fixed in
 * one place. Before this existed each caller hand-rolled its own
 * slice/tronscan link, drifting in format and affordances.
 *
 * The menu's "View address" entry opens the site's own address page,
 * `/a/<address>`, which shows the address's activity to signed-in visitors
 * and links to Tronscan for everyone.
 *
 * A smart contract address renders through `TronContractAddress` instead,
 * which links to Tronscan's contract page and offers only the tools that
 * accept a contract. Both are thin configurations of the shared
 * `AddressChip`, which holds the rendering, the tag signals, and the tools menu.
 */
'use client';

import { AddressChip, FORWARDABLE_TOOLS, type IAddressChipDisplayProps, type IAddressChipKind } from '../AddressChip';

/**
 * Wallet configuration for the shared chip. The explorer entry points at the
 * site's own address page rather than Tronscan, so a reader stays on the site;
 * that page carries the Tronscan link. Keeping the path in one constant means
 * a future change touches one line rather than every caller.
 */
const WALLET_CHIP: IAddressChipKind = {
    explorerBaseUrl: '/a/',
    explorerLabel: 'View address',
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
 * Render a TRON wallet address as a compact, monospace chip followed by one
 * wrench whose menu copies the address, opens its page on this site, and
 * forwards it to a tool page. See the file overview for why this is the single canonical
 * wallet address renderer.
 *
 * @param props - {@link ITronAddressProps}; `address` is required, and a
 *        pre-resolved `label` replaces the truncated display when supplied.
 * @returns The address chip element.
 */
export function TronAddress(props: ITronAddressProps) {
    return <AddressChip {...props} kind={WALLET_CHIP} />;
}
