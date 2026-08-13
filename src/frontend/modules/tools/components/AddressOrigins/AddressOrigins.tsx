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
import { GitBranch, Plus, X, CornerRightUp, Loader2, Flag, AlertTriangle, Users, Lock } from 'lucide-react';
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
import type { IOriginHop, IOriginLadder, OriginStopReason } from '../../types';
import styles from './AddressOrigins.module.scss';

/** Registered-user cap on wallets per query; mirrors the server-side limit. */
const MAX_ADDRESSES = 10;

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
     * Map each activator address to the set of input wallets whose ladder passed
     * through it. Any activator reached by two or more wallets is a shared
     * ancestor — the signal the multi-wallet mode exists to surface.
     */
    const commonActivators = useMemo(() => {
        const bySource = new Map<string, Set<number>>();
        for (const ladder of Object.values(ladders)) {
            for (const hop of ladder.hops) {
                const set = bySource.get(hop.activatorAddress) ?? new Set<number>();
                set.add(ladder.sourceIndex);
                bySource.set(hop.activatorAddress, set);
            }
        }
        const shared = new Set<string>();
        for (const [activator, sources] of bySource) {
            if (sources.size >= 2) {
                shared.add(activator);
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

    /** Open a fresh climb: reset state, then fold SSE events into ladders. */
    const handleTrace = () => {
        const targets = effectiveAddresses();
        if (targets.length === 0) {
            setError('Enter at least one valid TRON address (starts with T).');
            return;
        }

        stopStream();
        setError(null);
        setLadders({});
        setLimited(false);
        setStreaming(true);
        completedRef.current = false;

        const source = createAddressOriginsStream(targets);
        sourceRef.current = source;

        source.addEventListener('start', event => {
            const data = JSON.parse((event as MessageEvent).data) as { addresses: string[]; limited: boolean };
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

        // EventSource fires 'error' both on a genuine failure and on the normal
        // end-of-stream close. completedRef tells them apart so a finished climb
        // does not flash an error or auto-reconnect.
        source.onerror = () => {
            if (!completedRef.current) {
                setError('Connection lost while tracing. Please retry.');
            }
            stopStream();
            setStreaming(false);
        };
    };

    const orderedLadders = Object.values(ladders).sort((a, b) => a.sourceIndex - b.sourceIndex);
    const hasSharedAncestors = commonActivators.size > 0;

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

                {hasSharedAncestors && (
                    <div className={styles.legend}>
                        <Users size={16} />
                        <span>Highlighted accounts activated more than one of your wallets — a likely shared operator.</span>
                    </div>
                )}

                {orderedLadders.length > 0 && (
                    <div className={styles.ladders}>
                        {orderedLadders.map(ladder => (
                            <Card key={ladder.sourceIndex} className={styles.ladder_card}>
                                <ol className={styles.ladder}>
                                    <li className={styles.node}>
                                        <span className={styles.tag}>wallet</span>
                                        <TronAddress address={ladder.address} />
                                    </li>

                                    {ladder.hops.map((hop, index) => {
                                        const isShared = commonActivators.has(hop.activatorAddress);
                                        return (
                                            <li key={`${hop.txId}-${index}`} className={`${styles.node} ${isShared ? styles.node_shared : ''}`}>
                                                <CornerRightUp size={14} className={styles.node_arrow} aria-hidden="true" />
                                                <TronAddress address={hop.activatorAddress} />
                                                {isShared && (
                                                    <span className={styles.shared_badge} title="Shared across wallets">
                                                        <Users size={14} /> shared
                                                    </span>
                                                )}
                                                <span className={styles.contract_type}>{hop.contractType}</span>
                                                {/*
                                                  * The activating transaction is the evidence for this rung of
                                                  * the ladder, so the shared chip names it rather than hiding it
                                                  * behind a bare out-arrow: a reader tracing an operator wants to
                                                  * identify that transaction, copy it, and compare it against an
                                                  * explorer tab — none of which an unlabelled icon allowed.
                                                  */}
                                                <TronTransactionId txId={hop.txId} />
                                            </li>
                                        );
                                    })}
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
                                    {ladder.status === 'done' && ladder.stopReason === 'depth-cap' && (
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
