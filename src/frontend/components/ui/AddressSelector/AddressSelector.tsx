'use client';

/**
 * AddressSelector — the shared control for choosing one TRON wallet address.
 *
 * Exposed to plugins as `context.ui.AddressSelector` so any surface needing an
 * address (a watchlist form, a lookup page, a sink target) gets the same
 * behaviour instead of hand-rolling an input plus its own base58 validation.
 * Self-contained like `AccountPicker`: it queries the address-tags suggest
 * endpoint itself, so a consumer binds `value`/`onChange` and nothing else.
 *
 * Two ways in, one way out. Paste or type a complete address and it commits on
 * sight; type partial text and the dropdown offers every tracked address whose
 * own text or whose *tags* match, each rendered with its tags so the operator
 * can tell "TR7N…Lj6t" from "TEkx…rdz8" by what they are rather than by
 * base58 noise. `onChange` only ever emits a validated address (or null), so
 * consumers never re-validate.
 *
 * Suggestions are an enhancement, never a requirement. The suggest endpoint is
 * `requireLogin`, so an anonymous visitor's lookup simply returns nothing and
 * the control degrades to a plain input that still validates and accepts a
 * pasted address. A failed lookup is swallowed for the same reason — a dead
 * dropdown must not block someone who already knows the address they want.
 *
 * This is a user-triggered search control, so its transient "Searching…" state
 * is a permitted loading case under the SSR rules, not primary page content.
 *
 * The suggestion dropdown renders in a `<body>` portal with viewport-fixed
 * coordinates. Anchoring it absolutely inside the control left it at the mercy
 * of whatever hosted the control: any ancestor with `overflow` clipped it, and
 * any ancestor forming a stacking context trapped its z-index, so the list
 * disappeared behind neighbouring cards, sticky headers, and dialogs. A portal
 * takes it out of that tree entirely, which is the same fix `TronAddress` uses
 * for its tools menu.
 */

import {
    useState,
    useEffect,
    useLayoutEffect,
    useCallback,
    useId,
    useRef,
    type KeyboardEvent
} from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { Input } from '../Input';
import { TronAddress } from '../TronAddress';
import { suggestAddresses, type IAddressTagGroupView } from '../../../modules/address-tags';
import { isValidTronAddress } from '../../../lib/tronAddress';
import styles from './AddressSelector.module.scss';

/** Debounce (ms) before a lookup fires as the user types — matches `AccountPicker`. */
const SEARCH_DEBOUNCE_MS = 300;

/** Minimum term length before searching, so the dropdown doesn't flash on one keystroke. */
const MIN_QUERY_LENGTH = 2;

/** Default ceiling on offered addresses; enough to scan, short enough not to scroll forever. */
const MAX_SUGGESTIONS = 10;

/**
 * Gap (px) kept between the dropdown and both its input and the viewport edge.
 * Matches the visual separation the old `margin` gave it when it was in flow.
 */
const DROPDOWN_GAP_PX = 4;

/**
 * Floor (px) on the dropdown's height for the case where neither side of the
 * input can offer more. It binds only when the whole window is short — both
 * sides have to be cramped at once, which takes a viewport under roughly 290px
 * — because an input merely sitting near a viewport edge is handled by flipping
 * to the roomier side, not by this floor. In that narrow case the dropdown
 * keeps a couple of scrollable rows rather than a useless sliver, and the
 * clamp below is what stops those rows leaving the screen.
 */
const MIN_DROPDOWN_HEIGHT_PX = 120;

/**
 * Viewport-fixed geometry for the portaled dropdown, resolved from the search
 * row's live bounding rect. Held in state rather than derived during render
 * because measuring needs the DOM; `null` means "not yet measured", which keeps
 * the list hidden instead of flashing at the viewport origin.
 */
interface IDropdownPosition {
    /** Distance from the viewport top, already flipped above the input if needed and clamped inside the viewport. */
    top: number;

    /** Distance from the viewport left; tracks the input so the two stay aligned. */
    left: number;

    /** Matches the input's width, so the dropdown reads as part of the same control. */
    width: number;

    /** Ceiling on height, so a long list scrolls rather than running off-screen. */
    maxHeight: number;
}

/**
 * Props for {@link AddressSelector}. Kept structurally identical to the
 * `context.ui.AddressSelector` contract in `IUIComponents` so the core
 * component and the plugin-facing type never drift.
 */
export interface AddressSelectorProps {
    /** Currently-selected address, or null when nothing is chosen. */
    value: string | null;

    /** Fired with the newly-selected address, or null when cleared. */
    onChange: (address: string | null) => void;

    /** Disables the control (e.g. while a parent form is saving). */
    disabled?: boolean;

    /** Placeholder for the search field; a sensible default is used when omitted. */
    placeholder?: string;

    /** Accessible name for the field, for forms where the visible label is elsewhere. */
    'aria-label'?: string;

    /** Maximum number of suggestions to offer. @default 10 */
    limit?: number;
}

/**
 * Decide whether typed text is already a complete, valid TRON address.
 *
 * Checksum-verified, not merely base58-shaped: a mistyped character usually
 * lands on another alphabet character, so a shape test would commit a typo as
 * a real address and every consumer downstream would trust it.
 *
 * @param text - Raw contents of the search field.
 * @returns True when the text can be committed as a selection as-is.
 */
function isCompleteAddress(text: string): boolean {
    return isValidTronAddress(text.trim());
}

/**
 * Searchable single-address selector. With a value set it shows the chosen
 * address as a `TronAddress` chip with a clear affordance; otherwise it shows a
 * debounced search box whose results commit an address on click.
 *
 * @param props - See {@link AddressSelectorProps}.
 * @returns The rendered selector.
 */
export function AddressSelector({
    value,
    onChange,
    disabled,
    placeholder,
    'aria-label': ariaLabel,
    limit = MAX_SUGGESTIONS
}: AddressSelectorProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<IAddressTagGroupView[]>([]);
    const [searching, setSearching] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState<IDropdownPosition | null>(null);
    const listId = useId();
    const containerRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLUListElement>(null);

    // Dismiss the floating dropdown on an outside click, so a stale overlay
    // cannot linger over — and swallow clicks meant for — the form controls
    // beneath it. The dropdown is portaled to `<body>`, so it is not a
    // descendant of the search row: both nodes have to be tested, or the
    // mousedown that begins a click on a suggestion would close the list before
    // that suggestion's own click handler ever ran.
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent): void => {
            const target = event.target as Node;
            const inside = Boolean(containerRef.current?.contains(target))
                || Boolean(dropdownRef.current?.contains(target));
            if (!inside) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Debounced suggestion lookup. Short terms clear the list so the dropdown
    // does not flash on a single keystroke. The per-run `active` guard (cleared
    // on every query change and on unmount) drops a stale in-flight lookup so
    // only the latest term's results land. Failures fall back to an empty list
    // rather than an error: an anonymous visitor gets a 401 here by design.
    useEffect(() => {
        const term = query.trim();
        if (term.length < MIN_QUERY_LENGTH) {
            setResults([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        let active = true;
        const timer = setTimeout(async () => {
            try {
                const matches = await suggestAddresses(term, limit);
                if (active) {
                    setResults(matches);
                }
            } catch {
                if (active) {
                    setResults([]);
                }
            } finally {
                if (active) {
                    setSearching(false);
                }
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [limit, query]);

    // Whether the dropdown should currently be on screen. Derived rather than
    // stored so the open flag and the term stay a single source of truth.
    const dropdownVisible = isOpen && query.trim().length >= MIN_QUERY_LENGTH;

    /**
     * Place the portaled dropdown against its input, why: a `<body>` portal
     * escapes clipping and stacking, but it also gives up the automatic
     * alignment an absolutely-positioned child got for free — a fixed element
     * does not follow its anchor. This measures the search row and pins the
     * list directly beneath it, flipping above when the space below cannot hold
     * the list, capping the height so a long result set scrolls instead of
     * running off the bottom of the window, and clamping the final offset into
     * the viewport for the case where neither side can hold even the minimum
     * height.
     *
     * Runs as a layout effect so the coordinates are set before paint, which is
     * what keeps the list from flashing at the viewport origin. It re-measures
     * on scroll (captured, so scrolling an inner container counts, not just the
     * window) and on resize, and again whenever the content changes height —
     * the swap from "Searching…" to a ten-row list moves the flip decision.
     *
     * The direction test reads `scrollHeight`, the natural content height,
     * rather than the rendered height: the rendered height is already clamped
     * by the `maxHeight` this same effect applied, so feeding it back in would
     * let the dropdown flip direction on alternate measurements.
     */
    useLayoutEffect(() => {
        if (!dropdownVisible) {
            setPosition(null);
            return undefined;
        }
        function updatePosition(): void {
            const anchor = containerRef.current;
            const dropdown = dropdownRef.current;
            if (!anchor || !dropdown) return;
            const anchorRect = anchor.getBoundingClientRect();
            const viewportHeight = document.documentElement.clientHeight;
            // Width is pinned before the height is read, not just handed to
            // React afterwards: on the first pass the portaled list has no width
            // of its own and shrink-to-fits, so an address that will wrap at the
            // input's width might not wrap yet. Measuring then would decide the
            // flip and the above-anchor offset from a height the list never
            // actually has. React writes the same value on the next render.
            dropdown.style.width = `${anchorRect.width}px`;
            const naturalHeight = dropdown.scrollHeight;
            const spaceBelow = viewportHeight - anchorRect.bottom - DROPDOWN_GAP_PX * 2;
            const spaceAbove = anchorRect.top - DROPDOWN_GAP_PX * 2;
            const openAbove = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
            const maxHeight = Math.max(
                MIN_DROPDOWN_HEIGHT_PX,
                openAbove ? spaceAbove : spaceBelow
            );
            const height = Math.min(naturalHeight, maxHeight);
            // Pinning to the anchor is only the preference. `maxHeight` is
            // floored at MIN_DROPDOWN_HEIGHT_PX on purpose, so when neither
            // side has even that much room the preferred offset would push a
            // fixed element past a viewport edge, where no scroll can bring it
            // back. Clamping keeps the floored list on screen — biased to the
            // top edge when it is taller than the window, so the first
            // suggestions stay readable — at the cost of overlapping the input
            // in a viewport too short to hold both.
            const preferredTop = openAbove
                ? anchorRect.top - DROPDOWN_GAP_PX - height
                : anchorRect.bottom + DROPDOWN_GAP_PX;
            const top = Math.max(
                DROPDOWN_GAP_PX,
                Math.min(preferredTop, viewportHeight - height - DROPDOWN_GAP_PX)
            );
            setPosition({ top, left: anchorRect.left, width: anchorRect.width, maxHeight });
        }
        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [dropdownVisible, results, searching]);

    /**
     * Commit an address: notify the parent and reset the search box so
     * re-opening the control starts clean.
     *
     * @param address - The address chosen from the dropdown or typed in full.
     */
    const handleSelect = useCallback((address: string): void => {
        onChange(address);
        setQuery('');
        setResults([]);
        setIsOpen(false);
    }, [onChange]);

    /**
     * Track typing, and commit the moment the text becomes a complete address.
     * Auto-committing is what makes paste work without a second click, and a
     * hand-typed address reaching full length is unambiguous enough to treat
     * the same way.
     *
     * @param text - The field's new contents.
     */
    const handleQueryChange = useCallback((text: string): void => {
        if (isCompleteAddress(text)) {
            handleSelect(text.trim());
            return;
        }
        setQuery(text);
        setIsOpen(true);
    }, [handleSelect]);

    /** Clear the selection, returning the control to its search state. */
    const handleClear = useCallback((): void => {
        onChange(null);
        setQuery('');
        setResults([]);
    }, [onChange]);

    /**
     * Keyboard access to the portaled suggestions, why: the list used to sit in
     * the DOM directly after the input, so Tab reached the first suggestion for
     * free. Portaling it to `<body>` moves those buttons to the end of the tab
     * order, and inside a dialog they leave the focus scope entirely — the
     * modal trap only cycles descendants of the dialog — so without explicit
     * focus management the list becomes mouse-only. ArrowDown/ArrowUp therefore
     * rove across the suggestions, Enter activates the focused one natively
     * (they are real buttons), and Escape closes the list and returns the caret
     * to the field so focus is never stranded on a button React just unmounted.
     *
     * Bound to the search row rather than to each element because React bubbles
     * events out of a portal through the component tree, not the DOM tree, so
     * one handler covers both the input and the portaled buttons.
     *
     * @param event - Key event from the search field or from a suggestion button.
     */
    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Escape') {
            return;
        }
        event.preventDefault();
        if (event.key === 'Escape') {
            setIsOpen(false);
            containerRef.current?.querySelector('input')?.focus();
            return;
        }
        const buttons = dropdownRef.current
            ? Array.from(dropdownRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
            : [];
        if (buttons.length === 0) {
            return;
        }
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = current === -1
            ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
    }, []);

    // Selected state: the address chip plus a clear button.
    if (value) {
        return (
            <div className={styles.selected}>
                <TronAddress address={value} tools={false} className={styles.selected_address} />
                <button
                    type="button"
                    className={styles.clear}
                    onClick={handleClear}
                    disabled={disabled}
                    aria-label="Clear selected address"
                >
                    <X size={14} aria-hidden="true" />
                </button>
            </div>
        );
    }

    // Search state: debounced typeahead with a results dropdown.
    return (
        <div className={styles.search} ref={containerRef} onKeyDown={handleKeyDown}>
            <div className={styles.search_input}>
                <Search size={16} aria-hidden="true" className={styles.search_icon} />
                <Input
                    type="text"
                    className={styles.search_field}
                    value={query}
                    onChange={(event) => handleQueryChange(event.target.value)}
                    onFocus={() => setIsOpen(true)}
                    placeholder={placeholder ?? 'Paste a TRON address, or search by address or tag'}
                    aria-label={ariaLabel ?? 'TRON address'}
                    aria-controls={listId}
                    disabled={disabled}
                />
            </div>

            {/* A plain list of buttons, not a listbox. ARIA makes `option`'s
                children presentational, so wrapping a button in one suppresses
                the very role that tells assistive tech the item is activatable.
                Announcing a real button inside a list matches what the component
                actually does — the buttons are focusable in their own right and
                are reached by the arrow keys handled on the search row above,
                rather than through a listbox's roving-tabindex contract. */}
            {dropdownVisible && createPortal(
                <ul
                    ref={dropdownRef}
                    className={styles.results}
                    id={listId}
                    aria-label="Address suggestions"
                    // Hidden until measured so the first paint never shows the
                    // list parked at the viewport origin.
                    style={
                        position
                            ? {
                                top: position.top,
                                left: position.left,
                                width: position.width,
                                maxHeight: position.maxHeight
                            }
                            : { top: 0, left: 0, visibility: 'hidden' }
                    }
                >
                    {searching && <li className={styles.results_note}>Searching…</li>}
                    {!searching && results.map((group) => (
                        <li key={group.address}>
                            <button
                                type="button"
                                className={styles.result}
                                onClick={() => handleSelect(group.address)}
                                disabled={disabled}
                            >
                                <span className={styles.result_address}>{group.address}</span>
                                {group.tags.length > 0 && (
                                    <span className={styles.result_tags}>
                                        {group.tags.map((tag) => tag.tag).join(', ')}
                                    </span>
                                )}
                            </button>
                        </li>
                    ))}
                    {!searching && results.length === 0 && (
                        <li className={styles.results_note}>
                            No matching tagged addresses — paste a full address to use it anyway.
                        </li>
                    )}
                </ul>,
                document.body
            )}
        </div>
    );
}
