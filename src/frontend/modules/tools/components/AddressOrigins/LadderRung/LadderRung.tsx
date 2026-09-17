/**
 * @fileoverview One rung of an activation ladder — the traced wallet itself, or
 * an account above it.
 */

'use client';

import { Users, Wallet } from 'lucide-react';
import { cn } from '../../../../../lib/cn';
import { Badge } from '../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Tooltip } from '../../../../../components/ui/Tooltip';
import { TronAddress } from '../../../../../components/ui/TronAddress';
import { TronTransactionId } from '../../../../../components/ui/TronTransactionId';
import type { IOriginHop } from '../../../types';
import { CAVEAT_COPY } from '../lib/CAVEAT_COPY';
import { ROLE_COPY } from '../lib/ROLE_COPY';
import { resolveHopRole } from '../lib/resolveHopRole';
import { LeadList } from '../LeadList';
import styles from './LadderRung.module.scss';

/** What the shared marker claims, wherever it appears. */
const SHARED_EXPLANATION = 'More than one of the traces on screen reached this account. That is a lead worth checking, not proof of a shared operator — a single exchange or onboarding service activates millions of unrelated wallets.';

/**
 * Props for {@link LadderRung}.
 */
export interface ILadderRungProps {
    /** Steps up from the traced wallet, which is itself step 0. */
    step: number;

    /** The account this rung shows. */
    address: string;

    /**
     * The activation this rung explains. Absent on step 0, because no hop
     * explains the wallet the reader typed in — that is where the climb began.
     */
    hop?: IOriginHop;

    /** Whether more than one trace on screen reached this account. */
    isShared: boolean;

    /** Every shared account, so a lead can carry the marker as well as a rung. */
    sharedAddresses: Set<string>;

    /** Co-controllers of this rung's account, learned by the hop above it. */
    controllers: string[];

    /**
     * Whether this is the topmost rung, which truncates the spine so the chain
     * visibly ends rather than trailing off past its last account.
     */
    isLast: boolean;

    /** Start a new trace from a lead the reader chose to follow. */
    onFollow: (address: string) => void;
}

/**
 * One rung: the account, what part it played, the evidence, what qualifies the
 * attribution, and any lead the climb passed over.
 *
 * Why a rung carries this much: an activation can name two parties, and the
 * reader's conclusion depends on knowing which one they are looking at. The
 * followed account is the rung, the other party sits beneath it as a lead, and
 * the caveat chips say what the pair does not prove. The connector above the
 * account states the relationship in words, so a ladder reads as a sequence of
 * claims rather than as a stack of addresses the reader has to interpret.
 *
 * Each chip's explanation is rendered twice over: once in a `<Tooltip>` for
 * pointer and touch, and once as visually hidden text so assistive technology
 * reaches it without a tab stop on every chip. The `title` attribute this
 * replaces did neither reliably.
 *
 * @param props - {@link ILadderRungProps}.
 * @returns The rendered list item for this rung.
 */
export function LadderRung({
    step,
    address,
    hop,
    isShared,
    sharedAddresses,
    controllers,
    isLast,
    onFollow
}: ILadderRungProps) {
    const role = hop ? ROLE_COPY[resolveHopRole(hop)] : null;
    // The contract the climb stepped over, offered below as a lead. Present only
    // when the hop named two parties and the climb followed the signer.
    const contractParty = hop?.callerAddress ? hop.activatorAddress : null;
    // A backend that gains a new caveat code reaches a browser still running the
    // previous bundle, and rendering an unknown code would throw on the missing
    // copy entry and take the whole ladder down. Dropping it loses one chip.
    const caveats = hop ? hop.caveats.filter(caveat => caveat in CAVEAT_COPY) : [];

    return (
        <li className={cn(styles.rung, isShared && styles.rung_shared, isLast && styles.rung_last)}>
            {hop && (
                <p className={styles.connector}>
                    activated by, on <ClientTime date={new Date(hop.blockTimestamp)} format="date" />
                </p>
            )}

            <div className={styles.head}>
                <span className={cn(styles.disc, isShared && styles.disc_shared)} aria-hidden="true">
                    {step === 0 ? <Wallet size={12} /> : step}
                </span>

                <div className={styles.identity}>
                    <TronAddress address={address} />

                    {role ? (
                        <Tooltip content={role.explanation}>
                            <Badge tone="neutral" size="xs">
                                {role.label}
                                <span className={styles.sr_only}>. {role.explanation}</span>
                            </Badge>
                        </Tooltip>
                    ) : (
                        <Badge tone="neutral" size="xs">Traced wallet</Badge>
                    )}

                    {isShared && (
                        <Tooltip content={SHARED_EXPLANATION}>
                            <Badge tone="info" size="xs">
                                <Users size={11} aria-hidden="true" />
                                Shared
                                <span className={styles.sr_only}>. {SHARED_EXPLANATION}</span>
                            </Badge>
                        </Tooltip>
                    )}
                </div>
            </div>

            {hop && (
                <div className={styles.evidence}>
                    <span className={styles.contract_type}>{hop.contractType}</span>
                    {/*
                      * The activating transaction is the evidence for this rung, so
                      * the chip names it rather than hiding it behind a bare
                      * out-arrow: a reader tracing an operator wants to identify
                      * that transaction, copy it, and compare it against an
                      * explorer tab.
                      *
                      * Guarded because an edge read from the internal-transaction
                      * feed can arrive without any transaction hash, and the chip
                      * would then render an empty label over a link to the
                      * explorer's transaction route with no transaction in it.
                      */}
                    {hop.txId && <TronTransactionId txId={hop.txId} />}
                </div>
            )}

            {caveats.length > 0 && (
                <div className={styles.caveats}>
                    {caveats.map(caveat => {
                        const { label, tone, icon: CaveatIcon, explanation } = CAVEAT_COPY[caveat];
                        return (
                            <Tooltip key={caveat} content={explanation}>
                                <Badge tone={tone} size="xs">
                                    <CaveatIcon size={11} aria-hidden="true" />
                                    {label}
                                    <span className={styles.sr_only}>. {explanation}</span>
                                </Badge>
                            </Tooltip>
                        );
                    })}
                </div>
            )}

            <LeadList
                className={styles.leads}
                contractParty={contractParty}
                controllers={controllers}
                shared={sharedAddresses}
                onFollow={onFollow}
            />
        </li>
    );
}
