'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../lib/cn';
import styles from './ToastProvider.module.css';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

/**
 * Toast options interface defining notification configuration.
 *
 * Controls content, appearance, duration, and optional action button
 * for temporary notification messages.
 */
export interface ToastOptions {
    /** Optional unique identifier (auto-generated if not provided) */
    id?: string;
    /** Visual tone variant */
    tone?: ToastTone;
    /** Primary message text */
    title: string;
    /** Optional secondary description text */
    description?: string;
    /** Auto-dismiss duration in milliseconds (0 = no auto-dismiss) */
    duration?: number;
    /** Optional action button label */
    actionLabel?: string;
    /** Optional callback invoked when action button is clicked */
    onAction?: () => void;
}

/**
 * Toast payload interface extending options with required runtime fields.
 *
 * Internal representation of a toast instance with guaranteed ID and timestamp.
 */
export interface ToastPayload extends ToastOptions {
    id: string;
    createdAt: number;
}

/**
 * Toast context value interface exposing notification control methods.
 *
 * Provides imperative API for displaying, dismissing, and tracking toast
 * notifications throughout the application.
 */
interface ToastContextValue {
    /** Displays a new toast notification and returns its ID */
    push: (toast: ToastOptions) => string;
    /** Dismisses a specific toast by ID */
    dismiss: (id: string) => void;
    /** Array of currently displayed toast payloads */
    toasts: ToastPayload[];
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * ToastProvider Component
 *
 * Provides a portal-based notification system with automatic dismissal, tone variants,
 * and optional action buttons. Renders toasts in a fixed viewport positioned at the
 * bottom-right of the screen with slide-in animations.
 *
 * Toast notifications support multiple tones (info, success, warning, danger), custom
 * durations, and action buttons for user interaction. Auto-dismissal timers are managed
 * internally and cleared on unmount to prevent memory leaks.
 *
 * @example
 * ```tsx
 * <ToastProvider>
 *   <App />
 * </ToastProvider>
 * ```
 *
 * @param props.children - React children to wrap with toast context
 * @returns Provider component with toast context and portal-based rendering
 */
export function ToastProvider({ children }: { children: ReactNode }) {
    const [mounted, setMounted] = useState(false);
    const [toasts, setToasts] = useState<ToastPayload[]>([]);
    const defaultId = useId();
    const timers = useRef<Record<string, number>>({});

    useEffect(() => {
        setMounted(true);
        return () => {
            const { current } = timers;
            Object.values(current).forEach(timer => {
                window.clearTimeout(timer);
            });
            timers.current = {};
        };
    }, []);

    /**
     * Dismisses a toast by ID and clears its auto-dismiss timer.
     *
     * Removes the toast from state and cancels any pending timeout. Safe to
     * call multiple times for the same ID.
     *
     * @param id - Unique toast identifier to dismiss
     */
    const dismiss = useCallback((id: string) => {
        setToasts(current => current.filter(toast => toast.id !== id));
        if (timers.current[id]) {
            window.clearTimeout(timers.current[id]);
            delete timers.current[id];
        }
    }, []);

    /**
     * Schedules automatic dismissal for a toast based on its duration.
     *
     * Creates a timeout that dismisses the toast after the specified duration.
     * Duration of 0 or negative values disables auto-dismissal.
     *
     * @param toast - Toast payload with duration property
     */
    const scheduleDismissal = useCallback((toast: ToastPayload) => {
        const duration = toast.duration ?? 6000;
        if (duration <= 0) {
            return;
        }
        timers.current[toast.id] = window.setTimeout(() => {
            dismiss(toast.id);
        }, duration);
    }, [dismiss]);

    /**
     * Displays a new toast notification with auto-dismissal scheduling.
     *
     * Generates a unique ID if not provided and adds the toast to state. If a
     * toast with the same ID already exists, it will be replaced. Schedules
     * auto-dismissal on the next animation frame.
     *
     * @param toast - Toast configuration options
     * @returns The ID of the displayed toast for programmatic dismissal
     */
    const push = useCallback((toast: ToastOptions) => {
        const id = toast.id ?? `${defaultId}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
        setToasts(current => {
            const next: ToastPayload = {
                ...toast,
                tone: toast.tone ?? 'info',
                id,
                createdAt: Date.now()
            };
            window.requestAnimationFrame(() => scheduleDismissal(next));
            return [...current.filter(item => item.id !== id), next];
        });
        return id;
    }, [defaultId, scheduleDismissal]);

    const value = useMemo<ToastContextValue>(() => ({
        push,
        dismiss,
        toasts
    }), [dismiss, push, toasts]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            {mounted && createPortal(
                <aside className={styles.viewport} role="status" aria-live="polite">
                    {toasts.map(toast => (
                        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
                    ))}
                </aside>,
                document.body
            )}
        </ToastContext.Provider>
    );
}

/**
 * useToastContext Hook
 *
 * Provides access to the toast context for displaying and dismissing notifications.
 * Must be used within a ToastProvider component tree.
 *
 * @returns Toast context value with push/dismiss methods and toast array
 * @throws Error if used outside ToastProvider
 */
export function useToastContext() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToastContext must be used within a ToastProvider');
    }
    return context;
}

/**
 * useToast Hook
 *
 * Convenience hook that extracts just the push and dismiss methods from toast context.
 * Commonly used for triggering notifications from components.
 *
 * @example
 * ```tsx
 * const { push } = useToast();
 * push({
 *   tone: 'success',
 *   title: 'Data saved',
 *   description: 'Your changes have been saved successfully'
 * });
 * ```
 *
 * @returns Object with push and dismiss methods
 * @throws Error if used outside ToastProvider
 */
export function useToast() {
    const { push, dismiss } = useToastContext();
    return { push, dismiss };
}

/**
 * Maps toast tone to CSS Module class names.
 *
 * Provides type-safe mapping between ToastTone values and their corresponding
 * border color classes.
 *
 * @param tone - Toast tone variant
 * @returns Combined class name string
 */
function toneClassName(tone: ToastTone) {
    switch (tone) {
        case 'success':
            return `${styles.item} ${styles['toast--success']}`;
        case 'warning':
            return `${styles.item} ${styles['toast--warning']}`;
        case 'danger':
            return `${styles.item} ${styles['toast--danger']}`;
        default:
            return `${styles.item} ${styles['toast--info']}`;
    }
}

/**
 * ToastItem Component
 *
 * Internal component responsible for rendering a single toast notification with
 * title, description, optional action button, and dismiss button.
 *
 * @param props.toast - Toast payload to render
 * @param props.onDismiss - Callback to invoke when toast is dismissed
 * @returns Rendered toast notification card
 */
function ToastItem({ toast, onDismiss }: { toast: ToastPayload; onDismiss: () => void }) {
    const { tone = 'info', title, description, actionLabel, onAction } = toast;
    return (
        <div className={cn(toneClassName(tone))}>
            <div className={styles.item__meta}>
                <strong>{title}</strong>
                {description && <p className="text-subtle" style={{ margin: 0 }}>{description}</p>}
            </div>
            <div className={styles.item__actions}>
                {actionLabel && (
                    <button
                        type="button"
                        className={styles.item__action}
                        onClick={() => {
                            onAction?.();
                            onDismiss();
                        }}
                    >
                        {actionLabel}
                    </button>
                )}
                <button type="button" className={styles.item__dismiss} onClick={onDismiss}>
                    ×
                </button>
            </div>
        </div>
    );
}
