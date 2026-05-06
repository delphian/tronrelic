'use client';

import { useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../Button';
import styles from './ConfirmDialog.module.scss';

/**
 * Props for the shared ConfirmDialog body.
 *
 * Mounts inside a `useModal()` modal. The dialog never closes itself —
 * callers wire that through the `onConfirm` / `onCancel` callbacks
 * (typically by capturing the `modalId` returned by `open()` and
 * calling `close(modalId)`).
 */
export interface ConfirmDialogProps {
    /** Subject of the confirmation — typically the name of the thing being acted on. */
    label: string;
    /**
     * Replace the default "Delete <label>?" message. Pass a string for
     * simple copy or a ReactNode for richer formatting.
     */
    message?: ReactNode;
    /** Label for the destructive action. @default 'Delete' */
    confirmLabel?: string;
    /** Label for the cancel action. @default 'Cancel' */
    cancelLabel?: string;
    /**
     * Invoked when the user confirms. Awaited so the dialog can keep
     * buttons disabled / spinner active until the action completes.
     */
    onConfirm: () => Promise<void> | void;
    /** Invoked when the user cancels. */
    onCancel: () => void;
}

/**
 * Shared confirmation dialog body for `useModal()` consumers. Pairs an
 * `AlertTriangle` icon with the message and a danger/ghost button pair.
 * Tracks its own `working` state across an async `onConfirm` so the
 * destructive action shows a spinner and both buttons disable until
 * resolution.
 */
export function ConfirmDialog({
    label,
    message,
    confirmLabel = 'Delete',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel
}: ConfirmDialogProps) {
    const [working, setWorking] = useState(false);

    const handleConfirm = async () => {
        setWorking(true);
        try {
            await onConfirm();
        } finally {
            setWorking(false);
        }
    };

    return (
        <div className={styles.confirm}>
            <div className={styles.confirm_message}>
                <AlertTriangle size={20} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
                <span>
                    {message ?? (
                        <>
                            Delete <strong>{label}</strong>? This action cannot be undone.
                        </>
                    )}
                </span>
            </div>
            <div className={styles.confirm_actions}>
                <Button variant="ghost" onClick={onCancel} disabled={working}>
                    {cancelLabel}
                </Button>
                <Button variant="danger" onClick={handleConfirm} loading={working}>
                    {confirmLabel}
                </Button>
            </div>
        </div>
    );
}
