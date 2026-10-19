'use client';

/**
 * BotNetworks Settings Panel
 *
 * Manages the operator's list of automated networks. Some browser fleets send
 * a stock Chrome User-Agent, run JavaScript, and hide the automation flag, so
 * every per-request check labels them human. The network they run on, given as
 * an autonomous system number (ASN), is the one thing they cannot hide, because
 * Cloudflare reports it. Traffic from a listed network is labeled `bot_other`
 * when it is recorded.
 *
 * Listing a network changes only the analytics label. Visitors from it are
 * still served every page, and rows recorded before the network was added keep
 * the label they were recorded with.
 *
 * Admin-only panel — no SSR data fetching; admin pages fetch client-side after
 * auth, so the initial load state here is the permitted admin case.
 */

import { useState, useEffect, useCallback, useId, type FormEvent } from 'react';
import { isAxiosError } from 'axios';
import { Network, Plus, X } from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Field } from '../../../../../components/ui/Field';
import { Panel } from '../../../../../components/ui/Panel';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { AboutDetails } from '../AboutDetails';
import { adminGetBotNetworks, adminAddBotNetwork, adminRemoveBotNetwork } from '../../../api/client';
import type { IBotNetwork } from '../../../api/client';
import styles from './BotNetworks.module.scss';

/** Largest value an ASN can take; ASNs are unsigned 32-bit integers. */
const MAX_ASN = 4_294_967_295;

/** Longest note the server stores, mirrored here so the field stops at the same length. */
const MAX_NOTE_LENGTH = 200;

/**
 * Extract a human-readable message from a failed request, preferring the
 * server's structured error so the operator sees why an add or remove failed.
 *
 * @param err - The thrown value from an api client call.
 * @param fallback - Default message when nothing more specific is available.
 * @returns The best available message.
 */
function messageFrom(err: unknown, fallback: string): string {
    if (isAxiosError<{ message?: string; error?: string }>(err)) {
        return err.response?.data?.message || err.response?.data?.error || fallback;
    }
    return err instanceof Error ? err.message : fallback;
}

/**
 * Turn what the operator typed into the bare number the server stores. Lookup
 * sites and registries write ASNs as "AS139341", so that prefix is accepted
 * and stripped rather than rejected.
 *
 * @param raw - The ASN field's current text.
 * @returns The digits to send, or null when the text is not a valid ASN.
 */
function normalizeAsn(raw: string): string | null {
    const digits = raw.trim().replace(/^as/i, '');
    let result: string | null = null;
    if (/^\d{1,10}$/.test(digits)) {
        const value = Number(digits);
        if (value > 0 && value <= MAX_ASN) {
            result = String(value);
        }
    }
    return result;
}

/**
 * Admin panel to view and edit the automated-network list. Adds a network by
 * ASN with an optional note, and lists current entries with a one-click remove.
 *
 * @returns The rendered automated-network settings card.
 */
export function BotNetworks() {
    const [networks, setNetworks] = useState<IBotNetwork[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyAsn, setBusyAsn] = useState<number | null>(null);

    const [asnText, setAsnText] = useState('');
    const [note, setNote] = useState('');
    const [adding, setAdding] = useState(false);
    const asnId = useId();
    const noteId = useId();

    useEffect(() => {
        let active = true;
        adminGetBotNetworks()
            .then(list => { if (active) setNetworks(list); })
            .catch(() => { if (active) setError('Failed to load the automated-network list'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const normalizedAsn = normalizeAsn(asnText);
    // Only complain once something has been typed, so an empty form is not
    // shown as an error before the operator starts.
    const asnError = asnText.trim() !== '' && normalizedAsn === null
        ? 'Enter a network number such as 139341 or AS139341'
        : undefined;

    /**
     * Add the network in the form, then clear the form. The server returns the
     * updated list so the panel needs no follow-up fetch.
     *
     * @param event - The form submit event, cancelled so the page does not reload.
     */
    const handleAdd = useCallback(async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (normalizedAsn !== null) {
            setError(null);
            setAdding(true);
            try {
                setNetworks(await adminAddBotNetwork(normalizedAsn, note));
                setAsnText('');
                setNote('');
            } catch (err) {
                setError(messageFrom(err, 'Failed to add the network'));
            } finally {
                setAdding(false);
            }
        }
    }, [normalizedAsn, note]);

    /**
     * Remove a network; traffic recorded from it from now on is classified
     * normally again.
     *
     * @param asn - The network to remove.
     */
    const handleRemove = useCallback(async (asn: number): Promise<void> => {
        setError(null);
        setBusyAsn(asn);
        try {
            setNetworks(await adminRemoveBotNetwork(asn));
        } catch (err) {
            setError(messageFrom(err, 'Failed to remove the network'));
        } finally {
            setBusyAsn(null);
        }
    }, []);

    const meta = loading
        ? 'Loading…'
        : `${networks.length.toLocaleString()} ${networks.length === 1 ? 'network' : 'networks'} labeled as bots`;

    return (
        <Panel title="Automated networks" meta={meta}>
            <div className={styles.body}>
                <AboutDetails summary="How network labeling works">
                    <p>
                        Traffic from a network on this list is labeled a bot when it is recorded, even when
                        the browser looks human. Use it for a network you have confirmed sends only automated
                        traffic, such as a cloud pool of remotely controlled browsers. Visitors from a listed
                        network are still served every page; only the stats change. Rows recorded before a
                        network is added keep their label, and a real visitor browsing through a listed
                        network, for example over a VPN, will be counted as a bot.
                    </p>
                </AboutDetails>

                {error && <div className={styles.error} role="alert">{error}</div>}

                <form className={styles.form} onSubmit={handleAdd}>
                    <Field label="Network (ASN)" htmlFor={asnId} error={asnError} className={styles.asn_field}>
                        <Input
                            id={asnId}
                            type="text"
                            size="sm"
                            inputMode="numeric"
                            value={asnText}
                            onChange={e => setAsnText(e.target.value)}
                            placeholder="139341"
                            invalid={asnError !== undefined}
                        />
                    </Field>
                    <Field label="Note" htmlFor={noteId} className={styles.note_field}>
                        <Input
                            id={noteId}
                            type="text"
                            size="sm"
                            value={note}
                            maxLength={MAX_NOTE_LENGTH}
                            onChange={e => setNote(e.target.value)}
                            placeholder="Who runs it, and why it is listed"
                        />
                    </Field>
                    <Button
                        type="submit"
                        size="sm"
                        variant="secondary"
                        loading={adding}
                        disabled={normalizedAsn === null}
                        className={styles.add_button}
                    >
                        <Plus size={16} aria-hidden="true" /> Add
                    </Button>
                </form>

                {loading ? (
                    <p className={styles.empty}>Loading the automated-network list…</p>
                ) : networks.length === 0 ? (
                    <p className={styles.empty}>No networks are listed. Traffic is classified by its browser alone.</p>
                ) : (
                    <ul className={styles.list}>
                        {networks.map(n => (
                            <li key={n.asn} className={styles.item}>
                                <span className={styles.item_icon}><Network size={16} aria-hidden="true" /></span>
                                <span className={styles.item_main}>
                                    <span className={styles.item_asn}>AS{n.asn}</span>
                                    {n.note && <span className={styles.item_note}>{n.note}</span>}
                                </span>
                                <span className={styles.item_added}>
                                    <ClientTime date={n.addedAt} format="date" />
                                </span>
                                <Button
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => handleRemove(n.asn)}
                                    loading={busyAsn === n.asn}
                                    aria-label={`Stop labeling AS${n.asn} as a bot network`}
                                >
                                    <X size={14} aria-hidden="true" /> Remove
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </Panel>
    );
}
