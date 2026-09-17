/**
 * @fileoverview Address Origins tool page.
 *
 * Traces one or more TRON wallets back through their chain of activator accounts
 * toward a final originator, streaming each parent into the UI the moment it
 * resolves rather than blocking on the whole climb. Anonymous visitors get a
 * single wallet and its immediate parent; signing in unlocks the full ladder and
 * a multi-wallet comparison that highlights ancestors shared across wallets
 * (strong evidence the wallets belong to one operator).
 *
 * Purely client-driven: results arrive over Server-Sent Events after the user
 * acts, so there is no SSR data and loading/streaming states are appropriate.
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { GitBranch, Plus, X, CornerRightUp, Loader2, Flag, AlertTriangle, Users, Lock, Cpu, Info, Key } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
// Direct import (not the modules/user barrel) keeps that component's CSS out of the bundle.
import { useAuthSession } from '../../../user/components/SessionProvider';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { TronAddress } from '../../../../components/ui/TronAddress';
import { TronTransactionId } from '../../../../components/ui/TronTransactionId';
import { AddressSelector } from '../../../../components/ui/AddressSelector';
import { isValidTronAddress } from '../../../../lib/tronAddress';
import { createAddressOriginsStream } from '../../api/client';
import type { IOriginHop, IOriginLadder, OriginHopCaveat, OriginStopReason } from '../../types';
import styles from './AddressOrigins.module.scss';

/** Registered-user cap on wallets per query; mirrors the server-side limit. */
const MAX_ADDRESSES = 10;

/**
 * How each rung-level qualification is worded for the reader.
 *
 * Why the full sentence lives here rather than in a help page: the reason a rung
 * is weak has to be readable at the rung, at the moment someone is about to draw
 * a conclusion from it. A ladder of identical-looking rows invites the reader to
 * treat "a person sent this account 1 TRX" and "some contract's balance paid for
 * it and we followed whoever signed the call" as the same finding, and they are
 * not. `tone` selects the chip colour: a warning where the rung may mislead, and
 * neutral where it is merely a detail worth knowing.
 */
const CAVEAT_COPY: Record<OriginHopCaveat, { label: string; tone: 'warn' | 'info'; icon: LucideIcon; explanation: string }> = {
    'internal-transfer': {
        label: 'via contract',
        tone: 'info',
        icon: Cpu,
        explanation: 'The activating TRX came out of a contract\'s balance. A contract is code — it cannot own this account, and it may have been passing on value that arrived from someone else in the same transaction.'
    },
    'climbed-caller': {
        label: 'signer followed',
        tone: 'info',
        icon: Info,
        explanation: 'This rung is the account that signed the contract call, not the contract the value came from. The signer paid for the execution, which is not the same as funding the account — it may be a service or a relayer acting for someone else.'
    },
    'caller-unresolved': {
        label: 'signer unknown',
        tone: 'warn',
        icon: AlertTriangle,
        explanation: 'The signing account could not be read, so the ladder continues from the contract itself. Anything above this rung describes that contract\'s own history rather than this account\'s.'
    },
    'creation-time-unverified': {
        label: 'timing unverified',
        tone: 'warn',
        icon: AlertTriangle,
        explanation: 'This account carries no on-chain creation time, so the attribution rests on the transaction type alone. That is weaker than a match confirmed against the account\'s own record.'
    }
};

/**
 * What each rung's role chip means, shown on hover.
 *
 * The three roles are genuinely different claims about the same kind of event,
 * and the chip alone cannot carry that, so the sentence behind it spells out what
 * the account did and — for the two contract cases — what it did not do.
 */
const ROLE_EXPLANATION: Record<'funder' | 'signer' | 'contract', string> = {
    funder: 'This account signed the transaction that brought the account below into existence and paid its creation fee.',
    signer: 'This account signed the contract call whose execution created the account below. It paid for that execution; the value itself came out of the contract shown beside it.',
    contract: 'This is the contract whose balance created the account below. A contract is code and owns nothing, and the account that signed the call could not be read — so this rung names a mechanism, not a party.'
};

/**
 * Address Origins tool.
 *
 * Manages the input rows (gated by auth), opens one SSE climb per submit, folds
 * incoming hops into per-address ladders, and derives which activators are shared
 * across wallets for highlighting.
 */
export function AddressOrigins() {
    const { isLoggedIn } = useAuthSession();
    const searchParams = useSearchParams();
    const [addresses, setAddresses] = useState<string[]>(['']);
    const [ladders, setLadders] = useState<Record<number, IOriginLadder>>({});
    const [streaming, setStreaming] = useState(false);
    const [limited, setLimited] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sourceRef = useRef<EventSource | null>(null);
    const completedRef = useRef(false);
    // Whether the server accepted this trace and opened the stream. EventSource
    // surfaces every failure as the same bare `error` with no status attached, so
    // this flag is the only way to tell a refused request — a rate limit, most
    // often — from a stream that dropped mid-climb, and to word each honestly.
    const startedRef = useRef(false);

    /** Close any open stream. Idempotent; safe to call on unmount or re-submit. */
    const stopStream = () => {
        sourceRef.current?.close();
        sourceRef.current = null;
    };

    // Tear the stream down if the component unmounts mid-climb.
    useEffect(() => stopStream, []);

    /**
     * Seed the first wallet row from a forwarded `?address=` param on mount,
     * why: the shared TronAddress chip forwards a full address here via that
     * param. Only the first row is seeded (anonymous users get a single row
     * anyway); mount-only so it never clobbers rows the user edits afterward.
     */
    useEffect(() => {
        const forwarded = searchParams.get('address')?.trim();
        if (forwarded && isValidTronAddress(forwarded)) setAddresses([forwarded]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * Map every account named anywhere in the results to the set of input wallets
     * whose ladder named it. Any account reached from two or more wallets is a
     * shared ancestor — the signal the multi-wallet mode exists to surface.
     *
     * Both parties of a hop count, not just the followed one: two wallets created
     * by the same sweeper contract share that contract even though neither ladder
     * climbs through it, and hiding that would lose the strongest pattern the tool
     * can show. What it cannot show is how many *other* accounts the shared party
     * also created, which is why the legend refuses to call this proof.
     */
    const sharedParties = useMemo(() => {
        const bySource = new Map<string, Set<number>>();
        for (const ladder of Object.values(ladders)) {
            for (const hop of ladder.hops) {
                for (const party of [hop.climbedAddress, hop.activatorAddress]) {
                    const set = bySource.get(party) ?? new Set<number>();
                    set.add(ladder.sourceIndex);
                    bySource.set(party, set);
                }
            }
        }
        const shared = new Set<string>();
        for (const [party, sources] of bySource) {
            if (sources.size >= 2) {
                shared.add(party);
            }
        }
        return shared;
    }, [ladders]);

    /** The wallets that will actually be submitted, after trim/dedupe/auth caps. */
    const effectiveAddresses = (): string[] => {
        const seen = new Set<string>();
        const valid: string[] = [];
        for (const raw of addresses) {
            const address = raw.trim();
            if (isValidTronAddress(address) && !seen.has(address)) {
                seen.add(address);
                valid.push(address);
            }
        }
        return isLoggedIn ? valid.slice(0, MAX_ADDRESSES) : valid.slice(0, 1);
    };

    const canSubmit = effectiveAddresses().length > 0 && !streaming;

    /** Update one input row by index. */
    const updateAddress = (index: number, value: string) => {
        setAddresses(prev => prev.map((entry, i) => (i === index ? value : entry)));
    };

    /** Append an empty input row, up to the multi-wallet cap. */
    const addAddressRow = () => {
        setAddresses(prev => (prev.length < MAX_ADDRESSES ? [...prev, ''] : prev));
    };

    /** Remove one input row (never the last remaining row). */
    const removeAddressRow = (index: number) => {
        setAddresses(prev => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
    };

    /**
     * Open a fresh climb over exactly these wallets and fold the SSE events into
     * ladders.
     *
     * Takes its targets as an argument rather than reading the input state,
     * because a fork started from a rung has to trace an address in the same tick
     * it is added to the inputs, and a state update is not visible until the next
     * render.
     *
     * @param targets - Validated wallets to climb, already capped for the tier.
     */
    const startTrace = (targets: string[]) => {
        stopStream();
        setError(null);
        setLadders({});
        setLimited(false);
        setStreaming(true);
        completedRef.current = false;
        startedRef.current = false;

        const source = createAddressOriginsStream(targets);
        sourceRef.current = source;

        source.addEventListener('start', event => {
            const data = JSON.parse((event as MessageEvent).data) as { addresses: string[]; limited: boolean };
            startedRef.current = true;
            setLimited(data.limited);
            const initial: Record<number, IOriginLadder> = {};
            data.addresses.forEach((address, index) => {
                initial[index] = { sourceIndex: index, address, hops: [], status: 'climbing' };
            });
            setLadders(initial);
        });

        source.addEventListener('hop', event => {
            const hop = JSON.parse((event as MessageEvent).data) as IOriginHop;
            setLadders(prev => {
                const ladder = prev[hop.sourceIndex];
                if (!ladder) {
                    return prev;
                }
                return { ...prev, [hop.sourceIndex]: { ...ladder, hops: [...ladder.hops, hop] } };
            });
        });

        source.addEventListener('address-done', event => {
            const data = JSON.parse((event as MessageEvent).data) as { sourceIndex: number; stopReason: OriginStopReason };
            setLadders(prev => {
                const ladder = prev[data.sourceIndex];
                if (!ladder) {
                    return prev;
                }
                return { ...prev, [data.sourceIndex]: { ...ladder, status: 'done', stopReason: data.stopReason } };
            });
        });

        source.addEventListener('address-error', event => {
            const data = JSON.parse((event as MessageEvent).data) as { sourceIndex: number; message: string };
            setLadders(prev => {
                const ladder = prev[data.sourceIndex];
                if (!ladder) {
                    return prev;
                }
                return { ...prev, [data.sourceIndex]: { ...ladder, status: 'error', errorMessage: data.message } };
            });
        });

        source.addEventListener('complete', () => {
            completedRef.current = true;
            stopStream();
            setStreaming(false);
        });

        // EventSource fires 'error' for three different situations and describes
        // none of them: the normal end-of-stream close, a request the server
        // refused before opening the stream, and a connection that dropped
        // part-way through. completedRef rules out the first, and startedRef
        // separates the other two so the user is not told their network failed
        // when they were actually rate limited.
        source.onerror = () => {
            if (!completedRef.current) {
                setError(startedRef.current
                    ? 'Connection lost while tracing. Please retry.'
                    : 'The trace could not be started. This tool allows a few traces per minute — wait a moment and retry.');
            }
            stopStream();
            setStreaming(false);
        };
    };

    /** Validate the current inputs and trace them, or explain why none qualify. */
    const handleTrace = () => {
        const targets = effectiveAddresses();
        if (targets.length === 0) {
            setError('Enter at least one valid TRON address (starts with T).');
            return;
        }
        startTrace(targets);
    };

    /**
     * Follow a lead offered on a rung — the contract a ladder did not climb, or a
     * key that co-controls one of its accounts.
     *
     * Why the tool needs this at all: every rung is one attribution among several
     * the same transaction supports, and a single ladder presented as the answer
     * hides the others. Letting the reader pivot to a party the climb passed over
     * turns a verdict into an investigation.
     *
     * A signed-in reader gets the lead added as another wallet, so the new ladder
     * sits beside the original and any shared ancestor between them is highlighted
     * immediately. An anonymous reader has one slot, so the lead replaces it.
     *
     * @param address - The account to trace from, taken from a rendered rung.
     */
    const forkTrace = (address: string) => {
        const existing = effectiveAddresses();
        const targets = isLoggedIn && !existing.includes(address)
            ? [...existing, address].slice(0, MAX_ADDRESSES)
            : [address];
        setAddresses(targets);
        startTrace(targets);
    };

    const orderedLadders = Object.values(ladders).sort((a, b) => a.sourceIndex - b.sourceIndex);
    const hasSharedAncestors = sharedParties.size > 0;

    return (
        <Page>
            <PageHeader title="Address Origins" subtitle="Trace a TRON wallet back through its activation chain to the account that created it." />

            <div className={styles.container}>
                <Card>
                    <Stack gap="md">
                        {/* A span, not a <label>: each row is an AddressSelector
                            that owns its own input and names it via aria-label,
                            so a `htmlFor` pointing at an id this component no
                            longer renders would be a dangling association. */}
                        <span className={styles.label}>
                            {isLoggedIn ? 'TRON wallet addresses' : 'TRON wallet address'}
                        </span>

                        {(isLoggedIn ? addresses : addresses.slice(0, 1)).map((value, index) => (
                            <div key={index} className={styles.input_row}>
                                <AddressSelector
                                    value={value || null}
                                    onChange={next => updateAddress(index, next ?? '')}
                                    aria-label={`TRON wallet address ${index + 1}`}
                                />
                                {isLoggedIn && addresses.length > 1 && (
                                    <Button variant="ghost" size="sm" onClick={() => removeAddressRow(index)} aria-label={`Remove address ${index + 1}`}>
                                        <X size={16} />
                                    </Button>
                                )}
                            </div>
                        ))}

                        <div className={styles.actions}>
                            {isLoggedIn && addresses.length < MAX_ADDRESSES && (
                                <Button variant="secondary" size="sm" onClick={addAddressRow}>
                                    <Plus size={16} />
                                    Add wallet
                                </Button>
                            )}
                            <Button variant="primary" onClick={handleTrace} disabled={!canSubmit} loading={streaming}>
                                <GitBranch size={18} />
                                Trace origins
                            </Button>
                        </div>

                        {error && <p className={styles.error}>{error}</p>}

                        {!isLoggedIn && (
                            <div className={styles.upsell}>
                                <Lock size={16} />
                                <p>
                                    You are seeing the <strong>immediate parent only</strong>. Sign in to climb the full
                                    chain to its origin and compare up to {MAX_ADDRESSES} wallets to reveal shared ancestors.
                                </p>
                            </div>
                        )}
                    </Stack>
                </Card>

                {/*
                  * The reading guide is always available, not only once a result
                  * arrives, because the conclusions it warns against are the ones
                  * a reader forms while the ladders are still filling in. Closed
                  * by default so it never buries the tool itself.
                  */}
                <details className={styles.guide}>
                    <summary className={styles.guide_summary}>
                        <Info size={16} aria-hidden="true" />
                        How to read this — what an activation chain does and does not show
                    </summary>
                    <ul className={styles.guide_list}>
                        <li><strong>&ldquo;Activated by&rdquo; is a payment, not ownership.</strong> It means that account paid the roughly 1 TRX fee to bring this address into existence. Paid-activation services do this for strangers, and an exchange does it for every withdrawal to a new address.</li>
                        <li><strong>A shared ancestor is only as meaningful as it is rare.</strong> Exchanges, faucets, wallet-onboarding flows and airdrop contracts have each activated millions of unrelated addresses. This tool does not yet measure how many accounts an ancestor created, so treat a shared account as a lead to check, never as proof of one operator.</li>
                        <li><strong>The rungs are not all the same kind of claim.</strong> Some name the account that signed a transfer; some name a contract, which is code and owns nothing; some name whoever signed a call to that contract. Each rung says which it is.</li>
                        <li><strong>A chain that ends has run out of what the provider indexes</strong> — that is not the same as reaching a true origin, and the closing line on each ladder says so.</li>
                        <li><strong>One address is not always one actor.</strong> An account can be controlled by keys held elsewhere; where we can see that, the other controllers are offered as leads.</li>
                    </ul>
                </details>

                {hasSharedAncestors && (
                    <div className={styles.legend}>
                        <Users size={16} />
                        <span>
                            Highlighted accounts appear in more than one of these ladders. That is a lead worth
                            checking, not proof of a shared operator — a single exchange or onboarding service
                            activates millions of unrelated wallets.
                        </span>
                    </div>
                )}

                {orderedLadders.length > 0 && (
                    <div className={styles.ladders}>
                        {orderedLadders.map(ladder => (
                            <Card key={ladder.sourceIndex} className={styles.ladder_card}>
                                <ol className={styles.ladder}>
                                    <li className={styles.node}>
                                        <div className={styles.node_main}>
                                            <span className={styles.tag}>wallet</span>
                                            <TronAddress address={ladder.address} />
                                        </div>
                                        {/* The wallet's own co-controllers are learned by the
                                            first hop's lookup, since that hop is the one that
                                            reads the wallet's account record. */}
                                        <LeadList
                                            controllers={ladder.hops[0]?.subjectControllers ?? []}
                                            onFollow={forkTrace}
                                        />
                                    </li>

                                    {ladder.hops.map((hop, index) => (
                                        <HopRung
                                            key={`${hop.txId}-${index}`}
                                            hop={hop}
                                            shared={sharedParties}
                                            /* Each hop reads the account record of the rung it
                                               climbed *from*, so a rung's own controllers arrive
                                               with the hop above it — absent for the last rung,
                                               where the climb stopped before looking. */
                                            controllers={ladder.hops[index + 1]?.subjectControllers ?? []}
                                            onFollow={forkTrace}
                                        />
                                    ))}
                                </ol>

                                <p className={styles.status}>
                                    {ladder.status === 'climbing' && (
                                        <span className={styles.climbing}><Loader2 size={14} className={styles.spin} aria-hidden="true" /> Climbing…</span>
                                    )}
                                    {ladder.status === 'error' && (
                                        <span className={styles.status_error}><AlertTriangle size={14} aria-hidden="true" /> {ladder.errorMessage ?? 'Interrupted — please retry.'}</span>
                                    )}
                                    {ladder.status === 'done' && ladder.stopReason === 'unresolved' && ladder.hops.length > 0 && (
                                        <span className={styles.status_origin}><Flag size={14} aria-hidden="true" /> Chain ends here — the last account has no activator we can attribute. It may be a true origin, or its funding may not be traceable.</span>
                                    )}
                                    {ladder.status === 'done' && ladder.stopReason === 'unresolved' && ladder.hops.length === 0 && (
                                        <span className={styles.status_warn}><AlertTriangle size={14} aria-hidden="true" /> No activator could be attributed for this wallet — its funding transfer is not traceable to a sender.</span>
                                    )}
                                    {/* An anonymous trace always stops at its one-hop tier cap, so the
                                        generic depth-cap warning would fire on every successful trace and
                                        say nothing the sign-in line below does not say better. */}
                                    {isLoggedIn && ladder.status === 'done' && ladder.stopReason === 'depth-cap' && (
                                        <span className={styles.status_warn}><AlertTriangle size={14} aria-hidden="true" /> Stopped at the depth cap — a limit, not the end of the chain.</span>
                                    )}
                                    {ladder.status === 'done' && ladder.stopReason === 'cycle' && (
                                        <span className={styles.status_warn}><AlertTriangle size={14} aria-hidden="true" /> Stopped — the chain repeated an account it had already passed through.</span>
                                    )}
                                    {ladder.status === 'done' && ladder.stopReason === 'provider-error' && (
                                        <span className={styles.status_warn}><AlertTriangle size={14} aria-hidden="true" /> Tracing interrupted before the chain ended — please retry.</span>
                                    )}
                                </p>

                                {!isLoggedIn && ladder.status === 'done' && ladder.hops.length > 0 && (
                                    <p className={styles.node_upsell}>Sign in to climb past the immediate parent.</p>
                                )}
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </Page>
    );
}

/**
 * Props for {@link HopRung}.
 */
interface IHopRungProps {
    /** The hop to render, carrying both parties and its own qualifications. */
    hop: IOriginHop;
    /** Accounts named by more than one ladder, for the shared-ancestor highlight. */
    shared: Set<string>;
    /** Co-controllers of this rung's account, learned by the hop above it. */
    controllers: string[];
    /** Start a new trace from a lead the reader chose to follow. */
    onFollow: (address: string) => void;
}

/**
 * One rung of a ladder: the account the climb followed, what role it played in
 * the activation, what qualifies the attribution, and any lead the climb passed
 * over.
 *
 * Why a rung is this involved: an activation can name two parties, and the
 * reader's conclusion depends on knowing which one they are looking at. The
 * followed account is the rung, the other party sits beside it as a lead, and the
 * caveat chips say what the pair does not prove.
 *
 * @param props - {@link IHopRungProps}.
 * @returns The rendered list item for this rung.
 */
function HopRung({ hop, shared, controllers, onFollow }: IHopRungProps) {
    const isShared = shared.has(hop.climbedAddress);
    const contractParty = hop.callerAddress ? hop.activatorAddress : null;
    // A backend that gains a new caveat code reaches a browser still running the
    // previous bundle, and rendering an unknown code would throw on the missing
    // copy entry and take the whole ladder down. Dropping it loses one chip.
    const caveats = hop.caveats.filter(caveat => caveat in CAVEAT_COPY);
    const role = hop.callerAddress
        ? 'signer'
        : hop.contractType === 'InternalTransaction' ? 'contract' : 'funder';

    return (
        <li className={`${styles.node} ${isShared ? styles.node_shared : ''}`}>
            <div className={styles.node_main}>
                <CornerRightUp size={14} className={styles.node_arrow} aria-hidden="true" />
                <TronAddress address={hop.climbedAddress} />
                <span className={styles.tag} title={ROLE_EXPLANATION[role]}>{role}</span>
                {isShared && (
                    <span className={styles.shared_badge} title="Named by more than one ladder — a lead, not proof">
                        <Users size={14} /> shared
                    </span>
                )}
            </div>

            <div className={styles.node_meta}>
                <span className={styles.contract_type}>{hop.contractType}</span>
                {/*
                  * The activating transaction is the evidence for this rung of the
                  * ladder, so the chip names it rather than hiding it behind a bare
                  * out-arrow: a reader tracing an operator wants to identify that
                  * transaction, copy it, and compare it against an explorer tab.
                  *
                  * Guarded because an edge read from the internal-transaction feed
                  * can arrive without any transaction hash, and the chip would then
                  * render an empty label over a link to the explorer's transaction
                  * route with no transaction in it.
                  */}
                {hop.txId && <TronTransactionId txId={hop.txId} />}
            </div>

            {caveats.length > 0 && (
                <div className={styles.caveats}>
                    {caveats.map(caveat => {
                        const { label, tone, icon: CaveatIcon, explanation } = CAVEAT_COPY[caveat];
                        return (
                            <span
                                key={caveat}
                                className={`${styles.caveat} ${tone === 'warn' ? styles.caveat_warn : styles.caveat_info}`}
                                title={explanation}
                            >
                                <CaveatIcon size={12} aria-hidden="true" />
                                {label}
                            </span>
                        );
                    })}
                </div>
            )}

            <LeadList contractParty={contractParty} controllers={controllers} onFollow={onFollow} />
        </li>
    );
}

/**
 * Props for {@link LeadList}.
 */
interface ILeadListProps {
    /** The contract whose balance funded the activation, when the climb followed the signer instead. */
    contractParty?: string | null;
    /** Accounts that co-control the rung's own account. */
    controllers: string[];
    /** Start a new trace from the chosen lead. */
    onFollow: (address: string) => void;
}

/**
 * The alternative accounts a reader can trace from this rung.
 *
 * Why offer them: each rung is one reading of a transaction that supports
 * several, and the climb has to pick one to continue from. Showing what it passed
 * over — the contract it did not walk into, the keys that can also act for this
 * account — lets the reader test the other reading instead of trusting the single
 * path the tool chose.
 *
 * @param props - {@link ILeadListProps}.
 * @returns The leads row, or null when this rung has nothing further to offer.
 */
function LeadList({ contractParty, controllers, onFollow }: ILeadListProps) {
    const leads: Array<{ address: string; label: string; hint: string }> = [];
    if (contractParty) {
        leads.push({
            address: contractParty,
            label: 'contract',
            hint: 'Trace the contract whose balance funded this account. Its own ancestry leads to whoever deployed it, which is a different question from who funded this wallet.'
        });
    }
    for (const controller of controllers) {
        leads.push({
            address: controller,
            label: 'controller',
            hint: 'This key can authorise transactions for the account on this rung. Its ancestry is a separate lead that the single ladder above does not cover.'
        });
    }

    return leads.length === 0 ? null : (
        <div className={styles.leads}>
            {leads.map(lead => (
                <button
                    key={`${lead.label}-${lead.address}`}
                    type="button"
                    className={styles.lead}
                    onClick={() => onFollow(lead.address)}
                    title={lead.hint}
                >
                    {lead.label === 'contract' ? <Cpu size={12} aria-hidden="true" /> : <Key size={12} aria-hidden="true" />}
                    trace {lead.label}
                </button>
            ))}
        </div>
    );
}
