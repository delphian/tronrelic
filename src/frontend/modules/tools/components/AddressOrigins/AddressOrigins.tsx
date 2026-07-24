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
import { GitBranch, Plus, X, CornerRightUp, Loader2, Flag, AlertTriangle, Users, ExternalLink, Lock } from 'lucide-react';
// Direct import (not the modules/user barrel) keeps that component's CSS out of the bundle.
import { useAuthSession } from '../../../user/components/SessionProvider';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { createAddressOriginsStream } from '../../api/client';
import type { IOriginHop, IOriginLadder } from '../../types';
import styles from './AddressOrigins.module.scss';

/** Registered-user cap on wallets per query; mirrors the server-side limit. */
const MAX_ADDRESSES = 10;

/** Strict TRON base58check address, used only to enable the submit button. */
const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

const TRONSCAN_ADDRESS_URL = 'https://tronscan.org/#/address/';
const TRONSCAN_TX_URL = 'https://tronscan.org/#/transaction/';

/**
 * Shorten an address to `Tabcd…wxyz` so ladders stay compact.
 *
 * @param address - Full base58 address.
 * @returns The shortened label.
 */
function truncateAddress(address: string): string {
    return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

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
        const forwarded = searchParams.get('address');
        if (forwarded) setAddresses([forwarded]);
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
            if (TRON_ADDRESS_PATTERN.test(address) && !seen.has(address)) {
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
                initial[index] = { sourceIndex: index, address, hops: [], status: 'climbing', originReached: false, truncated: false };
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
            const data = JSON.parse((event as MessageEvent).data) as { sourceIndex: number; originReached: boolean; truncated: boolean };
            setLadders(prev => {
                const ladder = prev[data.sourceIndex];
                if (!ladder) {
                    return prev;
                }
                return { ...prev, [data.sourceIndex]: { ...ladder, status: 'done', originReached: data.originReached, truncated: data.truncated } };
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
                        <label className={styles.label} htmlFor="origin-address-0">
                            {isLoggedIn ? 'TRON wallet addresses' : 'TRON wallet address'}
                        </label>

                        {(isLoggedIn ? addresses : addresses.slice(0, 1)).map((value, index) => (
                            <div key={index} className={styles.input_row}>
                                <Input
                                    id={`origin-address-${index}`}
                                    value={value}
                                    onChange={e => updateAddress(index, e.target.value)}
                                    placeholder="T..."
                                    onKeyDown={e => e.key === 'Enter' && canSubmit && handleTrace()}
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
                                        <a className={styles.addr} href={`${TRONSCAN_ADDRESS_URL}${ladder.address}`} target="_blank" rel="noopener noreferrer" title={ladder.address}>
                                            {truncateAddress(ladder.address)}
                                        </a>
                                    </li>

                                    {ladder.hops.map((hop, index) => {
                                        const isShared = commonActivators.has(hop.activatorAddress);
                                        return (
                                            <li key={`${hop.txId}-${index}`} className={`${styles.node} ${isShared ? styles.node_shared : ''}`}>
                                                <CornerRightUp size={14} className={styles.node_arrow} aria-hidden="true" />
                                                <a className={styles.addr} href={`${TRONSCAN_ADDRESS_URL}${hop.activatorAddress}`} target="_blank" rel="noopener noreferrer" title={hop.activatorAddress}>
                                                    {truncateAddress(hop.activatorAddress)}
                                                </a>
                                                {isShared && (
                                                    <span className={styles.shared_badge} title="Shared across wallets">
                                                        <Users size={14} /> shared
                                                    </span>
                                                )}
                                                <span className={styles.contract_type}>{hop.contractType}</span>
                                                <a className={styles.tx_link} href={`${TRONSCAN_TX_URL}${hop.txId}`} target="_blank" rel="noopener noreferrer" aria-label="View activating transaction on TronScan">
                                                    <ExternalLink size={14} />
                                                </a>
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
                                    {ladder.status === 'done' && ladder.originReached && ladder.hops.length > 0 && (
                                        <span className={styles.status_origin}><Flag size={14} aria-hidden="true" /> Origin reached — no earlier activator found.</span>
                                    )}
                                    {ladder.status === 'done' && ladder.originReached && ladder.hops.length === 0 && (
                                        <span className={styles.status_warn}><AlertTriangle size={14} aria-hidden="true" /> Activator could not be resolved — this wallet may have been created by an internal contract transfer.</span>
                                    )}
                                    {ladder.status === 'done' && ladder.truncated && (
                                        <span className={styles.status_warn}><AlertTriangle size={14} aria-hidden="true" /> Stopped at the depth cap — a limit, not a true origin.</span>
                                    )}
                                    {ladder.status === 'done' && !ladder.originReached && !ladder.truncated && (
                                        <span className={styles.status_warn}><AlertTriangle size={14} aria-hidden="true" /> Tracing interrupted before an origin was found — please retry.</span>
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
