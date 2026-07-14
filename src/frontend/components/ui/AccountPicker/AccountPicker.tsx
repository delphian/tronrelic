'use client';

/**
 * AccountPicker — a reusable admin control for selecting one Better Auth
 * account by email/name.
 *
 * Exposed to plugins as `context.ui.AccountPicker` so any admin surface (e.g.
 * the forum's publish-sink author) can choose an account without reimplementing
 * account search. It is self-contained: it queries the admin-gated
 * `/admin/accounts/search` endpoint itself and traffics only in the account id
 * via `value`/`onChange`, so a consumer wires two props and nothing else.
 *
 * Admin-only by construction — the search endpoint is gated by `requireAdmin`,
 * and the same-origin session cookie authorizes the logged-in admin. This is a
 * user-triggered search control, so a transient "Searching…" state is the
 * permitted loading case (not primary page content), per the SSR rules.
 */

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { Search, X } from 'lucide-react';
import type { IAccountMatch } from '@/types';
import { Input } from '../Input';
import { adminSearchAccounts } from '../../../lib/api';
import styles from './AccountPicker.module.scss';

/** Debounce (ms) before a search fires as the admin types — matches the traffic ignore-list picker. */
const SEARCH_DEBOUNCE_MS = 300;

/** Minimum term length before searching, so the dropdown doesn't flash on one keystroke. */
const MIN_QUERY_LENGTH = 2;

/**
 * Props for {@link AccountPicker}. Kept structurally identical to the
 * `context.ui.AccountPicker` contract in `IUIComponents` so the core component
 * and the plugin-facing type never drift.
 */
export interface AccountPickerProps {
    /** Currently-selected account id, or null when nothing is chosen. */
    value: string | null;

    /** Fired with the newly-selected account id, or null when cleared. */
    onChange: (accountId: string | null) => void;

    /** Disables the control (e.g. while a parent form is saving). */
    disabled?: boolean;

    /** Placeholder for the search field; a sensible default is used when omitted. */
    placeholder?: string;
}

/**
 * Render the label for a resolved match: name when present, else email, else
 * the bare id (a deleted/unresolvable account still shows *something* stable).
 *
 * @param match - The resolved account, or a stub carrying only the id.
 * @returns A human-readable primary label.
 */
function primaryLabel(match: IAccountMatch): string {
    return match.name || match.email || match.id;
}

/**
 * Searchable single-account picker. When a value is set it shows the resolved
 * account with a clear affordance; otherwise it shows a debounced search box
 * whose results select an account on click.
 *
 * @param props - See {@link AccountPickerProps}.
 * @returns The rendered picker.
 */
export function AccountPicker({ value, onChange, disabled, placeholder }: AccountPickerProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<IAccountMatch[]>([]);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState<IAccountMatch | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const listId = useId();
    const containerRef = useRef<HTMLDivElement>(null);

    // Dismiss the floating results dropdown when the admin clicks outside the
    // picker, so a stale absolutely-positioned overlay can't linger over — and
    // swallow clicks meant for — the form controls beneath it.
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent): void => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Resolve a label for an externally-supplied value (e.g. a settings page
    // re-opened on a stored id). The exact-id search path returns the one
    // account; on miss we still stub the id so the selection stays visible and
    // clearable rather than silently blank.
    useEffect(() => {
        if (!value) {
            setSelected(null);
            return;
        }
        if (selected?.id === value) {
            return;
        }
        let active = true;
        adminSearchAccounts(value)
            .then((matches) => {
                if (active) {
                    setSelected(matches.find((m) => m.id === value) ?? { id: value, email: '', name: null });
                }
            })
            .catch(() => {
                if (active) {
                    setSelected({ id: value, email: '', name: null });
                }
            });
        return () => {
            active = false;
        };
    }, [value, selected?.id]);

    // Debounced account search. Clears results for a blank/short term so the
    // dropdown does not flash on a single keystroke. The per-run `active` guard
    // (cleared on every query change and on unmount) drops a stale in-flight
    // search so only the latest term's results land.
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
                const matches = await adminSearchAccounts(term);
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
    }, [query]);

    /**
     * Commit a chosen account: notify the parent, show it as selected, and reset
     * the search box so re-opening starts clean.
     *
     * @param match - The account the admin clicked.
     */
    const handleSelect = useCallback(
        (match: IAccountMatch): void => {
            onChange(match.id);
            setSelected(match);
            setQuery('');
            setResults([]);
        },
        [onChange]
    );

    /** Clear the selection, returning the control to its search state. */
    const handleClear = useCallback((): void => {
        onChange(null);
        setSelected(null);
        setQuery('');
        setResults([]);
    }, [onChange]);

    // Selected state: show the resolved account with a clear button.
    if (value && selected) {
        return (
            <div className={styles.selected}>
                <span className={styles.selected_main}>
                    <span className={styles.selected_label}>{primaryLabel(selected)}</span>
                    {selected.name && selected.email && (
                        <span className={styles.selected_sub}>{selected.email}</span>
                    )}
                </span>
                <button
                    type="button"
                    className={styles.clear}
                    onClick={handleClear}
                    disabled={disabled}
                    aria-label="Clear selected account"
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
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    placeholder={placeholder ?? 'Search accounts by email, name, or paste a user id'}
                    aria-label="Search accounts"
                    aria-controls={listId}
                    disabled={disabled}
                />
            </div>

            {isOpen && (results.length > 0 || searching) && (
                <ul className={styles.results} id={listId} role="listbox" aria-label="Account search results">
                    {searching && <li className={styles.results_note}>Searching…</li>}
                    {!searching &&
                        results.map((account) => (
                            <li key={account.id} role="option" aria-selected={false}>
                                <button
                                    type="button"
                                    className={styles.result}
                                    onClick={() => handleSelect(account)}
                                    disabled={disabled}
                                >
                                    <span className={styles.result_email}>{account.email || '(no email)'}</span>
                                    {account.name && <span className={styles.result_name}>{account.name}</span>}
                                </button>
                            </li>
                        ))}
                    {!searching && results.length === 0 && (
                        <li className={styles.results_note}>No matching accounts.</li>
                    )}
                </ul>
            )}
        </div>
    );
}
