'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../lib/cn';
import styles from './ToastProvider.module.scss';

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
    /**
     * Optional destination the title links to, so a toast announcing an event
     * can send the reader to the page that shows it in full.
     *
     * The title stays a plain string and this stays a plain path because the
     * anchor belongs to the toast rather than to the caller. A caller passing
     * its own markup would style its title independently, and toast titles
     * across the application would stop matching each other. Leave it unset
     * for a toast with nowhere useful to go.
     */
    titleHref?: string;
    /**
     * Optional secondary description.
     *
     * Accepts any renderable content rather than only a string, because a
     * description often needs the same component the rest of the application
     * uses to present a value — a copyable address chip, for instance.
     * Rewriting such a value as bare text inside a toast drops the affordances
     * that component carries and lets its presentation drift from every other
     * place the value appears.
     */
    description?: ReactNode;
    /**
     * Auto-dismiss duration in milliseconds (0 = no auto-dismiss). The
     * countdown pauses while a mouse pointer is over the toast and resumes
     * with the time it had left, so a reader using a control inside the toast
     * does not lose it partway through.
     */
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
    /** Stops a toast's auto-dismiss countdown while the pointer is over it */
    pauseDismissal: (id: string) => void;
    /** Restarts a paused countdown with the time that was left when it paused */
    resumeDismissal: (id: string) => void;
    /** Array of currently displayed toast payloads */
    toasts: ToastPayload[];
}

/**
 * Auto-dismiss countdown for one toast.
 *
 * A plain timeout id is not enough once a countdown can be paused, because
 * resuming needs to know how much of the duration was still left. `remaining`
 * holds that figure and `startedAt` records when the current run began, so a
 * pause can subtract the time already spent. `timeoutId` is null while paused.
 */
interface IDismissTimer {
    /** Pending browser timeout, or null while the countdown is paused */
    timeoutId: number | null;
    /** Milliseconds left on the countdown at the start of the current run */
    remaining: number;
    /** `Date.now()` when the current run started, used to measure elapsed time on pause */
    startedAt: number;
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
 * internally and cleared on unmount to prevent memory leaks. Each toast's timer pauses
 * while the pointer is over that toast and resumes with its remaining time afterwards.
 *
 * This component supplies the context only. The toasts themselves are drawn by
 * `<ToastViewport />`, which `providers.tsx` mounts as a descendant of every
 * global provider. Keeping the two apart is what lets a toast body use the
 * other providers: a portal renders from the position of the component that
 * calls it, so drawing the toasts here would place them above `ModalProvider`
 * and a toast that renders `TronAddress` — which calls `useModal` — would throw.
 *
 * @example
 * ```tsx
 * <ToastProvider>
 *   <App />
 *   <ToastViewport />
 * </ToastProvider>
 * ```
 *
 * @param props.children - React children to wrap with toast context
 * @returns Provider component supplying the toast context
 */
export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastPayload[]>([]);
    const defaultId = useId();
    const timers = useRef<Record<string, IDismissTimer>>({});
    // Ids of toasts the pointer is over right now. Kept apart from `timers`
    // because the pointer can reach a toast before its countdown exists:
    // `push` schedules the countdown one animation frame after the toast is
    // added, and a toast that slides in under a resting cursor is hovered
    // from its first frame.
    const paused = useRef<Set<string>>(new Set());

    useEffect(() => {
        return () => {
            const { current } = timers;
            Object.values(current).forEach(timer => {
                if (timer.timeoutId !== null) {
                    window.clearTimeout(timer.timeoutId);
                }
            });
            timers.current = {};
            paused.current.clear();
        };
    }, []);

    /**
     * Cancels and forgets a toast's countdown, so a dismissed or replaced
     * toast cannot be closed later by a timeout left over from before.
     *
     * @param id - Toast whose countdown should be removed
     */
    const clearTimer = useCallback((id: string) => {
        const timer = timers.current[id];
        if (timer && timer.timeoutId !== null) {
            window.clearTimeout(timer.timeoutId);
        }
        delete timers.current[id];
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
        clearTimer(id);
        paused.current.delete(id);
    }, [clearTimer]);

    /**
     * Starts a countdown run that dismisses the toast when it reaches zero.
     * Shared by the first schedule and by every resume, so both record the
     * start time the same way and a later pause measures elapsed time correctly.
     *
     * @param id - Toast the countdown belongs to
     * @param ms - Milliseconds until the toast is dismissed
     */
    const startTimer = useCallback((id: string, ms: number) => {
        timers.current[id] = {
            timeoutId: window.setTimeout(() => dismiss(id), ms),
            remaining: ms,
            startedAt: Date.now()
        };
    }, [dismiss]);

    /**
     * Schedules automatic dismissal for a toast based on its duration.
     *
     * Any countdown already held under the same id is cleared first. Without
     * that, pushing a replacement toast with a reused id left the old timeout
     * running, and it closed the replacement early. When the pointer is
     * already over the toast, the countdown is stored paused with its full
     * duration, and it starts when the pointer leaves. Duration of 0 or
     * negative values disables auto-dismissal.
     *
     * @param toast - Toast payload with duration property
     */
    const scheduleDismissal = useCallback((toast: ToastPayload) => {
        const duration = toast.duration ?? 6000;
        clearTimer(toast.id);
        if (duration > 0) {
            if (paused.current.has(toast.id)) {
                timers.current[toast.id] = { timeoutId: null, remaining: duration, startedAt: 0 };
            } else {
                startTimer(toast.id, duration);
            }
        }
    }, [clearTimer, startTimer]);

    /**
     * Pauses a toast's countdown so it is not dismissed while the reader is
     * still looking at it or using a control inside it. The time already
     * spent is subtracted, so resuming continues the countdown rather than
     * restarting it. The id is recorded even when no countdown exists yet, so
     * a countdown scheduled afterwards starts out paused.
     *
     * @param id - Toast the pointer has moved onto
     */
    const pauseDismissal = useCallback((id: string) => {
        paused.current.add(id);
        const timer = timers.current[id];
        if (timer && timer.timeoutId !== null) {
            window.clearTimeout(timer.timeoutId);
            timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
            timer.timeoutId = null;
        }
    }, []);

    /**
     * Resumes a paused countdown with the time it had left, once the pointer
     * has moved off the toast.
     *
     * @param id - Toast the pointer has left
     */
    const resumeDismissal = useCallback((id: string) => {
        paused.current.delete(id);
        const timer = timers.current[id];
        if (timer && timer.timeoutId === null) {
            startTimer(id, timer.remaining);
        }
    }, [startTimer]);

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
        pauseDismissal,
        resumeDismissal,
        toasts
    }), [dismiss, pauseDismissal, push, resumeDismissal, toasts]);

    return (
        <ToastContext.Provider value={value}>
            {children}
        </ToastContext.Provider>
    );
}

/**
 * ToastViewport Component
 *
 * Draws the stack of open toasts into a portal on `document.body`. It is a
 * separate component from the provider so that the markup can be mounted lower
 * in the tree than the context it reads. A React portal renders its children
 * from the tree position of the component that created it, not from the DOM
 * node it targets, so a toast drawn by `ToastProvider` itself would only ever
 * see the providers above `ToastProvider`. Mounting this component as the last
 * child of the provider stack instead gives every toast body the same context
 * an ordinary page component has, including `useModal` and `useAuthSession`.
 *
 * Rendering waits for the first effect because `document` does not exist during
 * server-side rendering, and the server and the client must agree on the first
 * paint or hydration fails.
 *
 * @returns The portal holding the current toasts, or null before mount
 */
export function ToastViewport() {
    const { toasts, dismiss, pauseDismissal, resumeDismissal } = useToastContext();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    return mounted
        ? createPortal(
            <aside className={styles.viewport} role="status" aria-live="polite">
                {toasts.map(toast => (
                    <ToastItem
                        key={toast.id}
                        toast={toast}
                        onDismiss={() => dismiss(toast.id)}
                        onHoverStart={() => pauseDismissal(toast.id)}
                        onHoverEnd={() => resumeDismissal(toast.id)}
                    />
                ))}
            </aside>,
            document.body
        )
        : null;
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
 * The returned object is memoized because callers routinely place it in a
 * `useCallback` or `useEffect` dependency array. Returning a fresh literal made
 * every such dependency change on every render, so an effect that transitively
 * depended on a toast helper re-ran continuously — and when that effect fetched
 * and stored the response, the resulting state churn drove an unbounded request
 * loop until the browser ran out of sockets. `push` and `dismiss` are each
 * already stable, so only the wrapper object needed pinning.
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
 * @returns Referentially stable object with push and dismiss methods
 * @throws Error if used outside ToastProvider
 */
export function useToast() {
    const { push, dismiss } = useToastContext();

    return useMemo(() => ({ push, dismiss }), [push, dismiss]);
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
 * Reports when a mouse or pen pointer enters and leaves the card, so the
 * provider can hold the auto-dismiss countdown while the reader is over it.
 * Touch input is ignored, because a tap fires an enter event with no matching
 * leave until the user taps somewhere else, which would leave the toast paused
 * indefinitely.
 *
 * @param props.toast - Toast payload to render
 * @param props.onDismiss - Callback to invoke when toast is dismissed
 * @param props.onHoverStart - Called when the pointer moves onto the card, to pause its countdown
 * @param props.onHoverEnd - Called when the pointer leaves the card, to resume its countdown
 * @returns Rendered toast notification card
 */
function ToastItem({ toast, onDismiss, onHoverStart, onHoverEnd }: {
    toast: ToastPayload;
    onDismiss: () => void;
    onHoverStart: () => void;
    onHoverEnd: () => void;
}) {
    const { tone = 'info', title, titleHref, description, actionLabel, onAction } = toast;

    /**
     * Pauses the countdown when a hovering pointer enters, skipping touch for
     * the reason given on the component.
     *
     * @param event - Pointer event whose `pointerType` separates hover from a tap
     */
    function handlePointerEnter(event: PointerEvent<HTMLDivElement>) {
        if (event.pointerType !== 'touch') {
            onHoverStart();
        }
    }

    /**
     * Resumes the countdown when a hovering pointer leaves the card.
     *
     * @param event - Pointer event whose `pointerType` separates hover from a tap
     */
    function handlePointerLeave(event: PointerEvent<HTMLDivElement>) {
        if (event.pointerType !== 'touch') {
            onHoverEnd();
        }
    }

    return (
        <div
            className={cn(toneClassName(tone))}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
        >
            <div className={styles.item__meta}>
                {/* The anchor wraps the existing <strong> rather than replacing
                  * it, so a linked title keeps the same weight and size as an
                  * unlinked one and the two read as the same element. */}
                {titleHref
                    ? <a className={styles.item__title_link} href={titleHref}><strong>{title}</strong></a>
                    : <strong>{title}</strong>}
                {/* A div rather than a paragraph, because a description may now
                  * hold any component and several render a block element —
                  * TronAddress emits a div for its tools menu, which React
                  * refuses to nest inside a p. Guarded on the values that have
                  * genuinely nothing to show rather than on truthiness, because
                  * React draws the number 0, and a plain `&&` would let a bare
                  * unstyled "0" escape the container. Empty string and false
                  * stay suppressed: callers pass `err.message`, which can be
                  * empty, and the `cond && <Foo/>` idiom, which yields false. */}
                {description !== null && description !== undefined && description !== false && description !== ''
                    && <div className={styles.item__description}>{description}</div>}
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
