/**
 * @fileoverview Address Origins tool page.
 *
 * Traces one or more TRON wallets back through their chain of activator accounts
 * toward a final originator, streaming each parent in the moment it resolves
 * rather than blocking on the whole climb. Anonymous visitors get a single wallet
 * and its immediate parent; signing in unlocks the full chain and a multi-wallet
 * comparison that names the accounts reached by more than one wallet.
 *
 * Purely client-driven: results arrive over Server-Sent Events after the reader
 * acts, so there is no SSR data and a progress state is appropriate here in a way
 * it would not be for a page whose content exists before the first interaction.
 *
 * This file is the shell only. It owns the input rows and the handlers, and
 * delegates the trace itself to `useOriginTrace` and every rendered surface to
 * the components beside it.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { GitBranch } from 'lucide-react';
import { Page, PageHeader } from '../../../../components/layout';
import { StatGrid, StatTile } from '../../../../components/ui/StatTile';
// Direct import (not the modules/user barrel) keeps that component's CSS out of the bundle.
import { useAuthSession } from '../../../user/components/SessionProvider';
import { isValidTronAddress } from '../../../../lib/tronAddress';
import { useOriginTrace } from '../../hooks/useOriginTrace';
import { collectSharedParties } from './lib/collectSharedParties';
import { summariseLadders } from './lib/summariseLadders';
import { MAX_ADDRESSES } from './lib/MAX_ADDRESSES';
import type { IWalletRow } from './lib/IWalletRow';
import { CommonGround } from './CommonGround';
import { OriginLadder } from './OriginLadder';
import { ReadingGuide } from './ReadingGuide';
import { TracePanel } from './TracePanel';
import styles from './AddressOrigins.module.scss';

/**
 * Address Origins tool.
 *
 * Manages the input rows, derives what converged across the current results, and
 * lays the whole thing out as a results column beside a rail that keeps the
 * interpretation aids in view while a long chain is scrolled.
 *
 * @returns The rendered tool page.
 */
export function AddressOrigins() {
    const { isLoggedIn } = useAuthSession();
    const searchParams = useSearchParams();
    const { ladders, streaming, limited, error, trace, reportProblem } = useOriginTrace();

    // Row ids come from a counter rather than a random source so the server and
    // the client agree on the first row's key during hydration.
    const nextRowId = useRef(1);
    const [rows, setRows] = useState<IWalletRow[]>([{ id: 'w0', value: '' }]);

    /**
     * Wrap an address in a row with an id of its own, so React can follow the row
     * through insertions and deletions.
     *
     * @param value - The address the row starts with, empty for a blank row.
     * @returns The new row.
     */
    const makeRow = (value: string): IWalletRow => ({ id: `w${nextRowId.current++}`, value });

    /**
     * Seed the first wallet row from a forwarded `?address=` param on mount.
     * The shared TronAddress chip forwards a full address here through that
     * param. Mount-only, so it never clobbers rows the reader edits afterwards.
     */
    useEffect(() => {
        const forwarded = searchParams.get('address')?.trim();
        if (forwarded && isValidTronAddress(forwarded)) {
            setRows([{ id: 'w0', value: forwarded }]);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const sharedParties = useMemo(() => collectSharedParties(ladders), [ladders]);
    const sharedAddresses = useMemo(
        () => new Set(sharedParties.map(party => party.address)),
        [sharedParties]
    );
    const summary = useMemo(
        () => summariseLadders(ladders, sharedParties),
        [ladders, sharedParties]
    );

    /**
     * The wallets that will actually be sent, after trimming, de-duplicating and
     * capping for the reader's tier. Computed on demand rather than memoised
     * because it is read once per interaction, never during render.
     *
     * @returns The wallets to trace, in the order they appear on screen.
     */
    const effectiveAddresses = (): string[] => {
        const seen = new Set<string>();
        const valid: string[] = [];
        for (const row of rows) {
            const address = row.value.trim();
            if (isValidTronAddress(address) && !seen.has(address)) {
                seen.add(address);
                valid.push(address);
            }
        }
        return isLoggedIn ? valid.slice(0, MAX_ADDRESSES) : valid.slice(0, 1);
    };

    /** Replace the address in one row, leaving every other row untouched. */
    const updateRow = (id: string, value: string): void => {
        setRows(prev => prev.map(row => (row.id === id ? { ...row, value } : row)));
    };

    /**
     * Append an empty row, up to the multi-wallet cap. The row is built before
     * the updater runs, because an updater must be pure — React invokes it twice
     * under StrictMode, which would advance the id counter twice per click.
     */
    const addRow = (): void => {
        const row = makeRow('');
        setRows(prev => (prev.length < MAX_ADDRESSES ? [...prev, row] : prev));
    };

    /** Remove one row, never the last remaining one. */
    const removeRow = (id: string): void => {
        setRows(prev => (prev.length > 1 ? prev.filter(row => row.id !== id) : prev));
    };

    /** Validate the current rows and trace them, or explain why none qualify. */
    const handleTrace = (): void => {
        const targets = effectiveAddresses();
        if (targets.length === 0) {
            reportProblem('Enter at least one valid TRON address. They start with T.');
        } else {
            trace(targets);
        }
    };

    /**
     * Follow a lead offered on a rung or in the convergence panel — the contract
     * a chain did not climb, a key that co-controls one of its accounts, or an
     * account two chains have in common.
     *
     * Why the tool needs this at all: every rung is one attribution among several
     * the same transaction supports, and a single chain presented as the answer
     * hides the others. Letting the reader pivot to a party the climb passed over
     * turns a verdict into an investigation.
     *
     * A signed-in reader gets the lead added as another wallet, so the new chain
     * sits beside the original and anything they share is named immediately. When
     * the lead is already one of the compared wallets, that same comparison is
     * re-traced rather than collapsed down to the lead on its own, because a
     * click on one rung should never throw away the other wallets and their
     * results. At the wallet cap the lead could only be added by silently
     * dropping a wallet the reader entered, so the click is refused with a
     * message naming what to do instead. An anonymous reader has one slot, so the
     * lead replaces it.
     *
     * @param address - The account to trace from, taken from a rendered rung.
     */
    const forkTrace = (address: string): void => {
        const existing = effectiveAddresses();
        const alreadyComparing = existing.includes(address);

        if (isLoggedIn && !alreadyComparing && existing.length >= MAX_ADDRESSES) {
            reportProblem(`Already comparing ${MAX_ADDRESSES} wallets. Remove one to follow this lead.`);
        } else {
            const targets = isLoggedIn
                ? (alreadyComparing ? existing : [...existing, address])
                : [address];
            setRows(targets.map(makeRow));
            trace(targets);
        }
    };

    const hasResults = ladders.length > 0;

    return (
        <Page>
            <PageHeader
                title="Address Origins"
                subtitle="A TRON account only exists once another account pays to create it. Trace that chain back as far as the record goes."
            />

            <TracePanel
                rows={rows}
                isLoggedIn={isLoggedIn}
                streaming={streaming}
                limited={limited}
                error={error}
                canSubmit={effectiveAddresses().length > 0 && !streaming}
                onChange={updateRow}
                onAdd={addRow}
                onRemove={removeRow}
                onSubmit={handleTrace}
            />

            <div className={styles.container}>
                <div className={styles.results}>
                    <div className={styles.main}>
                        {hasResults ? (
                            <>
                                {/*
                                  * A quiet strip rather than a headline band. The
                                  * evidence below is what the reader came for, and
                                  * four figures set at page-band weight would
                                  * out-shout the chains they summarise.
                                  */}
                                <StatGrid size="sm">
                                    <StatTile size="sm" label="Wallets traced" value={summary.wallets} />
                                    <StatTile
                                        size="sm"
                                        label="Accounts found"
                                        value={summary.rungs}
                                        note="above the wallets you entered"
                                    />
                                    <StatTile
                                        size="sm"
                                        label="Shared accounts"
                                        value={summary.shared}
                                        tone={summary.shared > 0 ? 'primary' : 'neutral'}
                                        note="reached by two or more"
                                    />
                                    <StatTile
                                        size="sm"
                                        label="Longest chain"
                                        value={summary.deepest}
                                        note="steps above the wallet"
                                    />
                                </StatGrid>

                                <div className={styles.ladders}>
                                    {ladders.map(ladder => (
                                        <OriginLadder
                                            key={ladder.sourceIndex}
                                            ladder={ladder}
                                            sharedAddresses={sharedAddresses}
                                            isLoggedIn={isLoggedIn}
                                            onFollow={forkTrace}
                                        />
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className={styles.empty}>
                                <GitBranch size={24} aria-hidden="true" className={styles.empty_icon} />
                                <p className={styles.empty_title}>No trace yet.</p>
                                <p className={styles.empty_note}>
                                    Enter a wallet above and the chain appears here, one account at a
                                    time, each rung naming who paid to create the account below it and
                                    what that does and does not prove.
                                </p>
                            </div>
                        )}
                    </div>

                    <aside className={styles.rail} aria-label="Reading aids">
                        <CommonGround
                            parties={sharedParties}
                            walletCount={summary.wallets}
                            onFollow={forkTrace}
                        />
                        <ReadingGuide />
                    </aside>
                </div>
            </div>
        </Page>
    );
}
