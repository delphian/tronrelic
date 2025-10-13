'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../../store/hooks';
import {
    clearBookmarks,
    setBookmarkError,
    setBookmarks,
    setBookmarkStatus
} from '../../bookmarkSlice';
import {
    deleteWalletBookmark,
    getWalletBookmarks,
    type BookmarkRecord,
    type BookmarkMutationPayload,
    upsertWalletBookmark
} from '../../../../lib/api';
import { useWallet } from '../../hooks/useWallet';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Badge } from '../../../../components/ui/Badge';
import styles from './BookmarkPanel.module.css';

/**
 * Properties for the BookmarkPanel component.
 */
interface BookmarkPanelProps {
    /** Optional target wallet address to add as a bookmark */
    targetWallet?: string;
}

/**
 * BookmarkPanel - Manages wallet bookmarks with signature-based authentication
 *
 * Provides a user interface for:
 * - Connecting a wallet via TronLink/WalletConnect
 * - Adding bookmarks for target wallets with optional labels
 * - Viewing saved bookmarks with labels and addresses
 * - Removing bookmarks with signature verification
 *
 * All bookmark mutations require a signed message from the owner wallet
 * to prevent unauthorized modifications. The signature includes a timestamp
 * to prevent replay attacks.
 *
 * Bookmarks are stored per-wallet, allowing different users to maintain
 * separate watchlists of important addresses.
 *
 * @param props - Component properties with optional target wallet
 * @returns A card containing bookmark management interface
 */
export function BookmarkPanel({ targetWallet }: BookmarkPanelProps) {
    const dispatch = useAppDispatch();
    const bookmarksState = useAppSelector(state => state.bookmarks);
    const { address: wallet, connect, signMessage, status, error } = useWallet();
    const [label, setLabel] = useState('');
    const [submitting, setSubmitting] = useState(false);

    /**
     * Loads bookmarks when wallet connects, clears them on disconnect.
     * Fetches from API and updates Redux store with results.
     */
    useEffect(() => {
        if (!wallet) {
            dispatch(clearBookmarks());
            return;
        }

        dispatch(setBookmarkStatus('loading'));
        getWalletBookmarks(wallet)
            .then(bookmarks => {
                dispatch(setBookmarks(bookmarks));
            })
            .catch(fetchError => {
                console.error(fetchError);
                dispatch(setBookmarkError('Unable to load bookmarks.'));
            });
    }, [dispatch, wallet]);

    /**
     * Checks if the current target wallet is already bookmarked.
     * Memoized to avoid recalculating on every render.
     */
    const isTargetBookmarked = useMemo(() => {
        if (!targetWallet) {
            return false;
        }
        return bookmarksState.items.some(bookmark => bookmark.targetWallet === targetWallet);
    }, [bookmarksState.items, targetWallet]);

    /**
     * Creates a signed bookmark mutation payload.
     *
     * Generates a timestamped message, requests wallet signature,
     * and returns the complete payload for API submission.
     *
     * @param customMessage - Action description (e.g., "Bookmark", "Remove bookmark")
     * @param labelOverride - Optional label override for the bookmark
     * @returns Signed mutation payload ready for API submission
     * @throws Error if wallet is not connected or target wallet is missing
     */
    const mutationPayload = async (customMessage: string, labelOverride?: string | null): Promise<BookmarkMutationPayload> => {
        if (!wallet || !targetWallet) {
            throw new Error('Wallet connection required');
        }
        const message = `${customMessage} ${targetWallet} @ ${new Date().toISOString()}`;
        const signature = await signMessage(message);
        return {
            ownerWallet: wallet,
            targetWallet,
            label: labelOverride ?? null,
            message,
            signature
        };
    };

    /**
     * Toggles bookmark status for the target wallet.
     *
     * If target is bookmarked: removes it
     * If target is not bookmarked: adds it with optional label
     *
     * Triggers wallet connection if not already connected.
     */
    const toggleBookmark = async () => {
        if (!wallet) {
            await connect();
            return;
        }
        if (!targetWallet) {
            return;
        }

        setSubmitting(true);
        dispatch(setBookmarkStatus('loading'));

        try {
            const payload = await mutationPayload(isTargetBookmarked ? 'Remove bookmark' : 'Bookmark');
            const bookmarks = isTargetBookmarked
                ? await deleteWalletBookmark(payload)
                : await upsertWalletBookmark({ ...payload, label: label.trim() || null });
            dispatch(setBookmarks(bookmarks));
            if (!isTargetBookmarked) {
                setLabel('');
            }
        } catch (mutationError) {
            console.error(mutationError);
            const message = mutationError instanceof Error ? mutationError.message : 'Bookmark update failed';
            dispatch(setBookmarkError(message));
        } finally {
            setSubmitting(false);
        }
    };

    /**
     * Removes a specific bookmark from the user's saved list.
     *
     * Requires signature verification to prevent unauthorized deletions.
     * Updates Redux store with the new bookmark list on success.
     *
     * @param bookmark - Bookmark record to remove
     */
    const removeBookmark = async (bookmark: BookmarkRecord) => {
        if (!wallet) {
            await connect();
            return;
        }

        setSubmitting(true);
        dispatch(setBookmarkStatus('loading'));

        try {
            const message = `Remove bookmark ${bookmark.targetWallet} @ ${new Date().toISOString()}`;
            const signature = await signMessage(message);
            const payload: BookmarkMutationPayload = {
                ownerWallet: wallet,
                targetWallet: bookmark.targetWallet,
                label: bookmark.label ?? null,
                message,
                signature
            };
            const bookmarks = await deleteWalletBookmark(payload);
            dispatch(setBookmarks(bookmarks));
        } catch (mutationError) {
            console.error(mutationError);
            const message = mutationError instanceof Error ? mutationError.message : 'Failed to remove bookmark';
            dispatch(setBookmarkError(message));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card>
            <div className="stack">
                <header className={styles.header}>
                    <div className={styles.header__row}>
                        <div>
                            <h2 className={styles.header__title}>Wallet bookmarks</h2>
                            <p className={styles.header__description}>
                                Save wallets for one-click access across dashboards and alerts.
                            </p>
                        </div>
                        {wallet ? (
                            <Badge tone="neutral">Connected as {wallet.slice(0, 6)}…{wallet.slice(-4)}</Badge>
                        ) : (
                            <Button size="sm" variant="secondary" onClick={connect} disabled={status === 'connecting'}>
                                {status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
                            </Button>
                        )}
                    </div>
                </header>

                {targetWallet && (
                    <div className={styles.add_bookmark}>
                        <Input
                            placeholder="Optional label (e.g. Treasury, Cold wallet)"
                            value={label}
                            onChange={event => setLabel(event.target.value)}
                            disabled={!wallet || submitting}
                        />
                        <div className={styles.add_bookmark__actions}>
                            <p className={styles.add_bookmark__target}>
                                Target wallet: <strong>{targetWallet}</strong>
                            </p>
                            <Button
                                onClick={toggleBookmark}
                                loading={submitting && bookmarksState.status === 'loading'}
                                disabled={!wallet}
                                variant={isTargetBookmarked ? 'ghost' : 'primary'}
                            >
                                {isTargetBookmarked ? 'Remove bookmark' : 'Save wallet'}
                            </Button>
                        </div>
                    </div>
                )}

                <div className="divider" />

                <section className={styles.bookmark_list}>
                    <h3 className={styles.bookmark_list__title}>Saved wallets</h3>
                    {bookmarksState.status === 'loading' && (
                        <p className={styles.bookmark_list__empty}>Loading bookmarks…</p>
                    )}
                    {!wallet && (
                        <p className={styles.bookmark_list__empty}>Connect a wallet to manage bookmarks.</p>
                    )}
                    {wallet && !bookmarksState.items.length && bookmarksState.status !== 'loading' && (
                        <p className={styles.bookmark_list__empty}>
                            No bookmarks yet. Add wallets to build your watchlist.
                        </p>
                    )}
                    <div className={styles.bookmarks}>
                        {bookmarksState.items.map(bookmark => (
                            <article key={bookmark.targetWallet} className={styles.bookmark_item}>
                                <div className={styles.bookmark_item__content}>
                                    <div className={styles.bookmark_item__info}>
                                        <strong className={styles.bookmark_item__label}>
                                            {bookmark.label ?? bookmark.targetWallet}
                                        </strong>
                                        {bookmark.label && (
                                            <span className={styles.bookmark_item__address}>
                                                {bookmark.targetWallet}
                                            </span>
                                        )}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeBookmark(bookmark)}
                                        disabled={submitting}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            </article>
                        ))}
                    </div>
                </section>

                {(bookmarksState.error || error) && (
                    <p className={styles.error_message}>{bookmarksState.error ?? error}</p>
                )}
            </div>
        </Card>
    );
}
