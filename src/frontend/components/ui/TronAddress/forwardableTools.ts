/**
 * @fileoverview Forward targets for the TronAddress tools dropdown.
 *
 * The address chip lets a user hand an address off to a public tool page that
 * can act on it. Only tools that actually consume a single address belong here
 * (converting it, checking its approvals, tracing its origin, verifying a
 * signature by it) — calculators and the timestamp converter take no address
 * and are deliberately excluded, so the menu never offers a dead end.
 *
 * The list is co-located with the component rather than pulled from the tools
 * module because a `components/ui/` primitive must not depend upward on a
 * domain module, and there is no iterable tool registry to read (the tools'
 * `IToolDescriptor` is unused dead code). These routes are stable platform
 * paths; adding a new address-consuming tool means adding one row here plus the
 * `?address=` pre-fill on that tool's page.
 */

/**
 * The query parameter every forwardable tool reads to pre-fill an incoming
 * address. Standardized here so the chip and the receiving pages share one
 * contract; a receiver that reads a different name (signature-verifier's
 * historical `?wallet=`) accepts this as an alias.
 */
export const TOOL_ADDRESS_PARAM = 'address';

/**
 * One selectable forward target.
 */
export interface IForwardableTool {
    /** URL slug under `/tools/`. */
    slug: string;
    /** Menu label shown to the user. */
    label: string;
}

/**
 * Address-consuming public tool pages, in menu order. Kept small and explicit
 * on purpose — see the file overview for why calculators are excluded.
 */
export const FORWARDABLE_TOOLS: readonly IForwardableTool[] = [
    { slug: 'address-converter', label: 'Address Converter' },
    { slug: 'address-origins', label: 'Address Origins' },
    { slug: 'approval-checker', label: 'Approval Checker' },
    { slug: 'signature-verifier', label: 'Signature Verifier' }
] as const;

/**
 * Build the deep link that opens a tool page with the address pre-filled, why:
 * the chip should not know how each tool spells its route — it only knows the
 * shared `?address=` contract. Encoding guards against any unexpected
 * characters in the value.
 *
 * @param slug - Target tool slug from {@link FORWARDABLE_TOOLS}.
 * @param address - Full address to forward; becomes the `?address=` value.
 * @returns The relative URL (`/tools/<slug>?address=<encoded>`).
 */
export function buildToolForwardUrl(slug: string, address: string): string {
    return `/tools/${slug}?${TOOL_ADDRESS_PARAM}=${encodeURIComponent(address)}`;
}
