/**
 * @fileoverview One wallet's activation chain, from the wallet itself up to
 * wherever the climb stopped.
 */

'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '../../../../../lib/cn';
import type { IOriginLadder as IOriginLadderData } from '../../../types';
import { resolveClosingNote } from '../lib/resolveClosingNote';
import { LadderRung } from '../LadderRung';
import styles from './OriginLadder.module.scss';

/**
 * Props for {@link OriginLadder}.
 */
export interface IOriginLadderProps {
    /** The trace to render, at whatever state it has reached. */
    ladder: IOriginLadderData;

    /** Accounts reached by more than one trace, for the convergence marker. */
    sharedAddresses: Set<string>;

    /**
     * Whether the reader is signed in. Only used to word the ending: an
     * anonymous trace always stops one step up, and saying so as a tier prompt
     * is more use than reporting a depth cap the reader cannot raise.
     */
    isLoggedIn: boolean;

    /** Start a new trace from a lead the reader chose to follow. */
    onFollow: (address: string) => void;
}

/**
 * One trace, drawn as a chain.
 *
 * The surface is built from the card tokens rather than the `<Card>` component
 * because this needs to be an `<article>` carrying its own accessible name —
 * several of these sit side by side, and a reader moving between them by
 * landmark has nothing else to tell one from another.
 *
 * @param props - {@link IOriginLadderProps}.
 * @returns The rendered chain and its closing line.
 */
export function OriginLadder({ ladder, sharedAddresses, isLoggedIn, onFollow }: IOriginLadderProps) {
    const closing = resolveClosingNote(ladder, isLoggedIn);
    const isClimbing = ladder.status === 'climbing';
    // While hops are still arriving, the newest rung is not the chain's end, so
    // the spine keeps running down to the progress line instead of stopping
    // short and re-extending on every event.
    const lastRungIndex = isClimbing ? -1 : ladder.hops.length - 1;

    return (
        <article className={styles.card} aria-label={`Activation chain for ${ladder.address}`}>
            <ol className={styles.chain}>
                <LadderRung
                    step={0}
                    address={ladder.address}
                    isShared={sharedAddresses.has(ladder.address)}
                    sharedAddresses={sharedAddresses}
                    /* The wallet's own co-controllers are learned by the first
                       hop's lookup, since that hop is the one that reads the
                       wallet's account record. */
                    controllers={ladder.hops[0]?.subjectControllers ?? []}
                    isLast={!isClimbing && ladder.hops.length === 0}
                    onFollow={onFollow}
                />

                {ladder.hops.map((hop, index) => (
                    <LadderRung
                        key={`${hop.txId}-${index}`}
                        /* `depth` is 0-based on the wire and the wallet occupies
                           step 0 here, so the first ancestor is step 1. */
                        step={hop.depth + 1}
                        address={hop.climbedAddress}
                        hop={hop}
                        isShared={sharedAddresses.has(hop.climbedAddress)}
                        sharedAddresses={sharedAddresses}
                        /* Each hop reads the account record of the rung it
                           climbed *from*, so a rung's own controllers arrive with
                           the hop above it — absent for the last rung, where the
                           climb stopped before looking. */
                        controllers={ladder.hops[index + 1]?.subjectControllers ?? []}
                        isLast={index === lastRungIndex}
                        onFollow={onFollow}
                    />
                ))}
            </ol>

            <footer className={styles.footer}>
                {isClimbing && (
                    <p className={styles.progress}>
                        <Loader2 size={14} className={styles.spinner} aria-hidden="true" />
                        Climbing…
                    </p>
                )}

                {closing && (
                    <p className={cn(styles.closing, styles[`closing_${closing.tone}`])}>
                        <closing.icon size={14} aria-hidden="true" />
                        {closing.text}
                    </p>
                )}

                {/* Gated on the depth cap, not merely on being signed out: a chain
                    that genuinely ran out of history has already said so above, and
                    offering to climb further would contradict it. */}
                {!isLoggedIn && ladder.status === 'done' && ladder.stopReason === 'depth-cap' && ladder.hops.length > 0 && (
                    <p className={styles.tier}>Sign in to climb past the immediate parent.</p>
                )}
            </footer>
        </article>
    );
}
