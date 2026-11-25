/**
 * @fileoverview Shared address chip behind TronAddress and TronContractAddress.
 *
 * A wallet address and a smart contract address are the same base58 string, so
 * they share one chip: the truncated display, the tag underline and warning
 * marker, and the wrench menu. What differs between them is configuration —
 * which page the explorer entry opens (the site's own address page for a
 * wallet, Tronscan's contract page for a contract), which tool pages the menu
 * offers, and the wording of the menu entries. Each public component passes an
 * {@link IAddressChipKind} describing that, so a fix to the chip lands in both
 * at once instead of drifting between two copies.
 *
 * Every chip shows exactly one icon after the address: the wrench from the
 * shared `ChipToolsMenu`. Copying the address and opening its page are the
 * first two entries of its menu, followed by the tool pages and, for
 * admins, the tag editor. Three icons per address buried the surrounding data
 * in dense rows, and callers turning icons off to save space left the same
 * address with different abilities on different pages. The wrench is not
 * optional, so every address everywhere offers the same actions.
 *
 * The chip renders synchronously from its `address` prop (no async, no data
 * fetch), so it is SSR-first by construction: the truncated text is in the
 * server HTML and only the menu is user-triggered after hydration.
 *
 * This component is internal to `components/ui/`. Callers render
 * `<TronAddress>` or `<TronContractAddress>`, never the chip directly.
 */
'use client';

import { useCallback, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { useModal } from '../ModalProvider';
import { ChipToolsMenu, type ChipToolsMenuEntry } from '../ChipToolsMenu';
// Deep imports rather than the module barrels: the address-tags barrel re-exports
// its editor, which imports core UI primitives, so pulling the barrel in here
// would close an import cycle through this file. The user barrel is skipped for
// the established reason that it drags component CSS into every bundle.
import { useAddressTags } from '../../../modules/address-tags/hooks/useAddressTags';
import { getAddressTagWarnings } from '../../../modules/address-tags/lib/tagSeverity';
import { AddressTagsEditor } from '../../../modules/address-tags/components/AddressTagsEditor/AddressTagsEditor';
import { useAuthSession } from '../../../modules/user/components/SessionProvider';
import { buildToolForwardUrl, type IForwardableTool } from './forwardableTools';
import styles from './AddressChip.module.scss';

/**
 * Group whose members may change tags. Address-tag reads are open to any
 * logged-in visitor, but every mutation route is `requireAdmin`, so the edit
 * affordance is gated on the same membership the backend enforces — offering it
 * more widely would only produce a 403 after the operator typed.
 */
const TAG_EDIT_GROUP = 'admin';

/**
 * Characters kept from each end when truncating. Four leading characters keep
 * the `T` prefix plus enough entropy to disambiguate at a glance; four
 * trailing characters mirror it. Addresses shorter than the combined length
 * render whole (nothing to hide).
 */
const HEAD_CHARS = 4;
const TAIL_CHARS = 4;

/**
 * What distinguishes one kind of address chip from another. Each public chip
 * component declares one of these as a module constant, so the shared chip
 * never branches on "is this a wallet" itself.
 */
export interface IAddressChipKind {
    /** URL the address is appended to: the site's `/a/` page, or a Tronscan page such as `/#/contract/`. */
    explorerBaseUrl: string;
    /** Text of the menu entry that opens that page. */
    explorerLabel: string;
    /** Open that page in the current tab, for the site's own page; an outside site opens in a new tab. */
    explorerInPlace: boolean;
    /** Text of the menu entry that copies the address. */
    copyLabel: string;
    /** Text the copy entry shows, and a screen reader announces, after a copy. */
    copiedLabel: string;
    /** Screen-reader label for the wrench that opens the tools menu. */
    toolsLabel: string;
    /** Tool pages the menu offers below copy and explorer, in menu order. May be empty. */
    forwardTools: readonly IForwardableTool[];
}

/**
 * Display props every address chip accepts. The public components expose
 * exactly these. There is deliberately no switch for the tools menu or its
 * entries: every address offers the same actions wherever it appears.
 */
export interface IAddressChipDisplayProps {
    /** Full base58check TRON address (`T…`). The value copied and linked. */
    address: string;
    /**
     * Pre-resolved human label. When supplied it displays in place of the
     * truncated address (the full address still shows in the tooltip), matching
     * the label-first convention. The chip does not look labels up itself —
     * callers pass one already resolved (e.g. from an SSR data fetcher).
     */
    label?: string;
    /** Extra class on the root wrapper for spacing in a host layout. */
    className?: string;
}

/**
 * Props for {@link AddressChip}: the display props plus the kind that
 * configures its explorer entry, tools, and labels.
 */
interface IAddressChipProps extends IAddressChipDisplayProps {
    /** The chip kind supplied by the public component wrapping this one. */
    kind: IAddressChipKind;
}

/**
 * Shorten a full address to `head…tail`, why: a full 34-char base58 address
 * dominates dense tables and buries the surrounding data. Short inputs pass
 * through untouched so we never render a `…` that hides nothing.
 *
 * @param address - Full address to shorten; supplied by the caller's data row.
 * @returns The truncated display string, or the input unchanged when it is
 *          already at or below the combined head+tail length.
 */
function truncateAddress(address: string): string {
    let result = address;
    if (address.length > HEAD_CHARS + TAIL_CHARS + 1) {
        result = `${address.slice(0, HEAD_CHARS)}…${address.slice(-TAIL_CHARS)}`;
    }
    return result;
}

/**
 * Render an address as a compact, monospace chip followed by a single wrench
 * that opens the tools menu configured by `kind`. See the file overview for why
 * the wallet and contract chips share this one implementation.
 *
 * @param props - {@link IAddressChipProps}; only `address` is needed in the
 *        common case, and `kind` comes from the public component rather than
 *        the caller.
 * @returns The address chip element.
 */
export function AddressChip({
    address,
    label,
    className,
    kind
}: IAddressChipProps) {
    const tags = useAddressTags(address);
    const { session } = useAuthSession();
    const modal = useModal();
    const canEditTags = session?.user?.groups?.includes(TAG_EDIT_GROUP) ?? false;

    /**
     * Open the freeform tag editor for this address in the shared core modal.
     *
     * The editor lives in the address-tags module and is handed the tags already
     * resolved for the chip, so it opens seeded rather than fetching again. The
     * modal is closed by id from inside the editor, which also invalidates the
     * shared read cache so every chip on the page picks the change up. Tags are
     * keyed by address alone, so a wallet chip and a contract chip for the same
     * string edit the same tags. The shared menu closes itself before calling
     * this, so focus is already back on the wrench when the modal opens.
     */
    const openTagEditor = useCallback((): void => {
        const id = `address-tags:${address}`;
        modal.open({
            id,
            title: 'Edit tags',
            size: 'sm',
            content: (
                <AddressTagsEditor
                    address={address}
                    initialTags={tags}
                    onClose={() => modal.close(id)}
                />
            )
        });
    }, [address, modal, tags]);

    /**
     * Build the address chip's own menu entries below copy and explorer, why:
     * those two are common to every chip, while the tool pages and the tag
     * editor belong to addresses alone. Lists the tool pages for this kind of
     * address, then the tag editor for an admin. Memoized so the menu does not
     * see a new list on every tooltip hover.
     *
     * @returns The entries the shared menu shows under its divider.
     */
    const entries = useMemo((): ChipToolsMenuEntry[] => {
        const list: ChipToolsMenuEntry[] = kind.forwardTools.map(tool => ({
            key: tool.slug,
            label: tool.label,
            href: buildToolForwardUrl(tool.slug, address)
        }));
        if (canEditTags) {
            list.push({ key: 'edit-tags', label: 'Edit tags', onSelect: openTagEditor });
        }
        return list;
    }, [address, canEditTags, kind.forwardTools, openTagEditor]);

    const display = label ?? truncateAddress(address);
    const isTagged = tags.length > 0;
    // Which of this address's tags are sanctions or freeze assertions. Memoized
    // on the resolved tag array rather than recomputed each render: the chip
    // re-renders on menu opens and tooltip hovers, none of which change the tags.
    const warnings = useMemo(() => getAddressTagWarnings(tags), [tags]);
    // Tags ride in the tooltip rather than beside the chip: they are context for
    // "which address is this", and a chip that grew inline chips would reflow
    // every dense table it sits in. A tagged address instead advertises itself
    // with a dotted underline (`styles.tagged`) so it is distinguishable at a
    // glance rather than only on hover. A text decoration costs no layout, so it
    // can appear when the tags resolve after hydration without shifting a single
    // row of the table around it.
    const tooltip = isTagged ? `${address} (${tags.join(', ')})` : address;
    // The warning icon's own tooltip and its screen-reader label are the same
    // string. Each entry's label is a plain phrase rather than the raw tag text,
    // because `usdt:frozen` tells a reader who already knows the vocabulary
    // nothing they could not guess and everyone else nothing at all. Joined with
    // a semicolon so an address carrying both a sanctions listing and a freeze
    // reads as two separate statements.
    const warningText = warnings.map(warning => warning.label).join('; ');
    const displayClassName = [label ? styles.label : styles.address, isTagged ? styles.tagged : null]
        .filter(Boolean)
        .join(' ');

    return (
        <span className={[styles.root, className].filter(Boolean).join(' ')}>
            {warnings.length > 0 && (
                // A sanctioned or frozen address is the one case where a tag has
                // to be readable before the operator hovers, and before they
                // decide to act on the address. The dotted underline below says
                // only "this address carries tags"; it cannot say which, and a
                // tag that means "do not transact" has to be distinguishable
                // from a tag that means "exchange hot wallet".
                //
                // This accepts a layout shift that the underline was chosen to
                // avoid. Tags resolve client-side after hydration, so an icon
                // appearing widens the chip a beat after the row painted. The
                // alternative — reserving the icon's width on every chip — taxes
                // every address on the site to spare the rare one, and warnings
                // are rare by construction: only three tags classify, and all
                // three come from sanctions or freeze feeds. A shift confined to
                // rows holding a flagged address is the cheaper of the two.
                //
                // The icon is not the only signal. Its shape, its danger colour,
                // and its label all carry the same meaning, so the warning
                // survives a monochrome display and a screen reader alike.
                <Tooltip content={warningText}>
                    <span className={styles.warning} role="img" aria-label={warningText}>
                        <AlertTriangle size={14} aria-hidden="true" />
                    </span>
                </Tooltip>
            )}

            <Tooltip content={tooltip}>
                <span
                    className={displayClassName}
                    data-testid="tron-address-display"
                    // Undefined rather than `false` so the attribute is absent
                    // entirely on an untagged address, letting tests and styles
                    // select on its presence.
                    data-tagged={isTagged || undefined}
                >
                    {display}
                </span>
            </Tooltip>

            <ChipToolsMenu
                value={address}
                triggerLabel={kind.toolsLabel}
                copyLabel={kind.copyLabel}
                copiedLabel={kind.copiedLabel}
                explorerHref={`${kind.explorerBaseUrl}${address}`}
                explorerLabel={kind.explorerLabel}
                explorerInPlace={kind.explorerInPlace}
                entries={entries}
            />
        </span>
    );
}
