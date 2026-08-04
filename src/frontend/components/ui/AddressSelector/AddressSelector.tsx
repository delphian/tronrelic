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
 */

import { useState, useEffect, useCallback, useId, useRef } from 'react';
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
    const listId = useId();
    const containerRef = useRef<HTMLDivElement>(null);

    // Dismiss the floating dropdown on an outside click, so a stale
    // absolutely-positioned overlay cannot linger over — and swallow clicks
    // meant for — the form controls beneath it.
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent): void => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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
        <div className={styles.search} ref={containerRef}>
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
                the very role that tells assistive tech the item is activatable —
                and listbox semantics would promise arrow-key navigation this
                control does not implement. Announcing a real button inside a
                list matches what the component actually does. */}
            {isOpen && query.trim().length >= MIN_QUERY_LENGTH && (
                <ul className={styles.results} id={listId} aria-label="Address suggestions">
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
                </ul>
            )}
        </div>
    );
}
