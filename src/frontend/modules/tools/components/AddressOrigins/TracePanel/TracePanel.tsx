/**
 * @fileoverview The wallet inputs and the control that starts a trace.
 */

'use client';

import { GitBranch, Lock, Plus, X } from 'lucide-react';
import { Stack } from '../../../../../components/layout';
import { AddressSelector } from '../../../../../components/ui/AddressSelector';
import { Button } from '../../../../../components/ui/Button';
import { Card } from '../../../../../components/ui/Card';
import { IconButton } from '../../../../../components/ui/IconButton';
import { MAX_ADDRESSES } from '../lib/MAX_ADDRESSES';
import type { IWalletRow } from '../lib/IWalletRow';
import styles from './TracePanel.module.scss';

/**
 * Props for {@link TracePanel}.
 */
export interface ITracePanelProps {
    /** The rows currently on screen, in the order they are shown. */
    rows: IWalletRow[];

    /** Whether the reader is signed in, which decides the tier and the row cap. */
    isLoggedIn: boolean;

    /** Whether a trace is running, so the control can show it is busy. */
    streaming: boolean;

    /** Whether the server trimmed the last request to fit the reader's tier. */
    limited: boolean;

    /** A problem with the request as a whole, shown above the tier note. */
    error: string | null;

    /** Whether there is at least one valid wallet to send. */
    canSubmit: boolean;

    /** Replace the address in one row. */
    onChange: (id: string, value: string) => void;

    /** Append an empty row. */
    onAdd: () => void;

    /** Drop one row. */
    onRemove: (id: string) => void;

    /** Send the current rows. */
    onSubmit: () => void;
}

/**
 * The panel a reader starts from.
 *
 * The rows are a `<fieldset>` with a `<legend>` rather than a single `<Field>`,
 * because `Field` labels one control and this is a group of interchangeable
 * ones. A `<legend>` names the whole group once, which is what a screen reader
 * needs here; repeating a visible label above ten identical inputs would not
 * help anyone.
 *
 * @param props - {@link ITracePanelProps}.
 * @returns The rendered input panel.
 */
export function TracePanel({
    rows,
    isLoggedIn,
    streaming,
    limited,
    error,
    canSubmit,
    onChange,
    onAdd,
    onRemove,
    onSubmit
}: ITracePanelProps) {
    // A signed-out reader gets one wallet, so extra rows are not offered and any
    // the reader had before signing out are not sent.
    const visibleRows = isLoggedIn ? rows : rows.slice(0, 1);

    return (
        <Card padding="md">
            {/* The container lives on a wrapper rather than on the fieldset, so
                the rule sizing the action row can see the panel's whole width. */}
            <div className={styles.panel}>
                <Stack gap="md">
                    <fieldset className={styles.fieldset}>
                        <legend className={styles.legend}>
                            {isLoggedIn ? 'Wallets to trace' : 'Wallet to trace'}
                        </legend>

                        <div className={styles.rows}>
                            {visibleRows.map((row, index) => (
                                <div key={row.id} className={styles.row}>
                                    <AddressSelector
                                        value={row.value || null}
                                        onChange={next => onChange(row.id, next ?? '')}
                                        aria-label={`TRON wallet address ${index + 1}`}
                                    />
                                    {isLoggedIn && visibleRows.length > 1 && (
                                        <IconButton
                                            variant="ghost"
                                            size="sm"
                                            aria-label={`Remove wallet ${index + 1}`}
                                            onClick={() => onRemove(row.id)}
                                        >
                                            <X size={16} />
                                        </IconButton>
                                    )}
                                </div>
                            ))}
                        </div>
                    </fieldset>

                    <div className={styles.actions}>
                        <Button
                            variant="primary"
                            onClick={onSubmit}
                            disabled={!canSubmit}
                            loading={streaming}
                            icon={<GitBranch size={18} />}
                        >
                            Trace origins
                        </Button>

                        {isLoggedIn && rows.length < MAX_ADDRESSES && (
                            <Button variant="secondary" onClick={onAdd} icon={<Plus size={16} />}>
                                Add a wallet
                            </Button>
                        )}
                    </div>

                    {error && <p className={styles.error} role="alert">{error}</p>}

                    {/*
                      * Reachable only when the server accepts fewer wallets than
                      * were sent. This panel already caps the rows to the tier, so
                      * the tier limits themselves never trip it — what does is the
                      * server rejecting an address this page thought was valid.
                      * Saying so beats a wallet quietly never appearing.
                      */}
                    {limited && (
                        <p className={styles.note} role="status">
                            Some of the wallets you entered were not traced, because the server did not
                            accept them as TRON addresses.
                        </p>
                    )}

                    {!isLoggedIn && (
                        <p className={styles.tier}>
                            <Lock size={14} aria-hidden="true" />
                            <span>
                                Signed out, a trace returns the immediate parent and stops there. Sign in to
                                climb the whole chain, and to compare up to {MAX_ADDRESSES} wallets at once —
                                which is how an account shared between them shows up.
                            </span>
                        </p>
                    )}
                </Stack>
            </div>
        </Card>
    );
}
