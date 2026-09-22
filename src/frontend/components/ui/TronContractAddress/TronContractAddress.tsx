/**
 * @fileoverview Canonical TRON smart contract address chip.
 *
 * A contract address is the same base58 string as a wallet address, but it
 * leads somewhere different. Tronscan's contract page shows the code, the ABI,
 * and the contract's calls, which its plain address page does not. Most of
 * the address tools do not apply either: a contract never signs a message, so
 * the Signature Verifier has nothing to check; it is created by a deployment
 * rather than an activating transfer, so Address Origins has no chain to
 * climb; and its own token approvals are not what anyone audits. Rendering a
 * contract through `TronAddress` therefore sent readers to the weaker page and
 * offered them tools that come back empty.
 *
 * This component is the contract counterpart. It is a thin configuration of
 * the shared `AddressChip`, so the truncation, the tag underline and warning
 * marker, the copy icon, the admin tag editor, and the portaled tools menu
 * behave exactly as they do on a wallet chip. Tags are keyed by address, so a
 * contract tagged here shows the same tags wherever it appears.
 */
'use client';

import {
    AddressChip,
    CONTRACT_FORWARDABLE_TOOLS,
    type IAddressChipDisplayProps,
    type IAddressChipKind
} from '../AddressChip';

/**
 * Contract configuration for the shared chip. The explorer points at
 * Tronscan's contract page rather than its address page, and the tools menu
 * offers only the tool pages that accept a contract.
 */
const CONTRACT_CHIP: IAddressChipKind = {
    explorerBaseUrl: 'https://tronscan.org/#/contract/',
    explorerLabel: 'View contract on Tronscan',
    copyLabel: 'Copy contract address',
    copiedLabel: 'Contract address copied',
    toolsLabel: 'Contract tools',
    forwardTools: CONTRACT_FORWARDABLE_TOOLS
};

/**
 * Props for {@link TronContractAddress}. The same display props as
 * `TronAddress`, so a caller switching a value from one chip to the other
 * changes only the component name.
 */
export type ITronContractAddressProps = IAddressChipDisplayProps;

/**
 * Render a smart contract address as a compact, monospace chip with copy,
 * contract tools (including the admin tag editor), and a Tronscan contract
 * link.
 *
 * @param props - {@link ITronContractAddressProps}; `address` is the contract's
 *        base58 address, `label` a pre-resolved name such as a token symbol,
 *        and the affordance booleans default on and can be switched off for a
 *        dense read-only table.
 * @returns The contract address chip element.
 */
export function TronContractAddress(props: ITronContractAddressProps) {
    return <AddressChip {...props} kind={CONTRACT_CHIP} />;
}
