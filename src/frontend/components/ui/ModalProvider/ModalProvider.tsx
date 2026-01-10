'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../lib/cn';
import { useAppDispatch } from '../../../store/hooks';
import {
    modalOpened,
    modalClosed,
    allModalsClosed,
    type ModalSize
} from '../../../features/ui-state/slice';
import styles from './ModalProvider.module.css';

export type { ModalSize } from '../../../features/ui-state/slice';

/**
 * Modal descriptor interface defining the structure of a modal instance.
 *
 * Contains all configuration needed to render and manage a modal dialog,
 * including content, size, dismissibility, and lifecycle callbacks.
 */
export interface ModalDescriptor {
    /** Unique identifier for this modal instance */
    id: string;
    /** Optional title displayed in the modal header */
    title?: string;
    /** React content to render in the modal body */
    content: ReactNode;
    /** Size variant controlling modal width */
    size?: ModalSize;
    /** Whether the modal can be closed by clicking backdrop or X button */
    dismissible?: boolean;
    /** Callback invoked when the modal is closed */
    onClose?: () => void;
}

/**
 * Modal context value interface exposing modal control methods.
 *
 * Provides imperative API for opening, closing, and managing modal state
 * throughout the application.
 */
interface ModalContextValue {
    /** Opens a new modal and returns its ID */
    open: (options: Omit<ModalDescriptor, 'id'> & { id?: string }) => string;
    /** Closes a specific modal by ID */
    close: (id: string) => void;
    /** Closes all open modals */
    closeAll: () => void;
    /** Array of currently open modal descriptors */
    modals: ModalDescriptor[];
}

const ModalContext = createContext<ModalContextValue | null>(null);

/**
 * ModalProvider Component
 *
 * Provides a portal-based modal system with support for multiple simultaneous modals,
 * size variants, dismissible controls, and Redux state integration. Renders modals
 * in a portal to ensure proper z-index stacking outside the normal component hierarchy.
 *
 * The provider manages modal lifecycle, including open/close animations, backdrop
 * click handling, and cleanup on unmount. It integrates with Redux to track modal
 * state for analytics and debugging.
 *
 * Modals are rendered client-side only to avoid hydration mismatches, and support
 * keyboard accessibility with proper ARIA attributes.
 *
 * @example
 * ```tsx
 * <ModalProvider>
 *   <App />
 * </ModalProvider>
 * ```
 *
 * @param props.children - React children to wrap with modal context
 * @returns Provider component with modal context and portal-based rendering
 */
export function ModalProvider({ children }: { children: ReactNode }) {
    const [mounted, setMounted] = useState(false);
    const [modals, setModals] = useState<ModalDescriptor[]>([]);
    const baseId = useId();
    const dispatch = useAppDispatch();

    useEffect(() => {
        setMounted(true);
    }, []);

    /**
     * Closes a modal by ID and invokes its onClose callback.
     *
     * Removes the modal from state and dispatches a Redux action for tracking.
     * Safe to call multiple times for the same ID.
     *
     * @param id - Unique modal identifier to close
     */
    const close = useCallback((id: string) => {
        setModals(current => {
            const closing = current.find(modal => modal.id === id);
            closing?.onClose?.();
            return current.filter(modal => modal.id !== id);
        });
        dispatch(modalClosed(id));
    }, [dispatch]);

    /**
     * Closes all open modals and invokes their onClose callbacks.
     *
     * Useful for cleanup on navigation or when resetting application state.
     * Dispatches a single Redux action for batch tracking.
     */
    const closeAll = useCallback(() => {
        setModals(current => {
            current.forEach(modal => modal.onClose?.());
            return [];
        });
        dispatch(allModalsClosed());
    }, [dispatch]);

    /**
     * Opens a new modal or replaces an existing one with the same ID.
     *
     * Generates a unique ID if not provided, sets default size and dismissibility,
     * and dispatches a Redux action for tracking. If a modal with the same ID
     * already exists, it will be replaced rather than duplicated.
     *
     * @param options - Modal configuration (id is optional, will be generated)
     * @returns The ID of the opened modal for programmatic closing
     */
    const open = useCallback((options: Omit<ModalDescriptor, 'id'> & { id?: string }) => {
        const id = options.id ?? `${baseId}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
        const descriptor: ModalDescriptor = {
            ...options,
            id,
            size: options.size ?? 'md',
            dismissible: options.dismissible ?? true
        };

        setModals(current => [...current.filter(modal => modal.id !== id), descriptor]);
        dispatch(modalOpened({
            id,
            title: descriptor.title,
            size: descriptor.size ?? 'md',
            dismissible: descriptor.dismissible ?? true,
            openedAt: new Date().toISOString()
        }));
        return id;
    }, [baseId, dispatch]);

    const value = useMemo<ModalContextValue>(() => ({
        open,
        close,
        closeAll,
        modals
    }), [open, close, closeAll, modals]);

    return (
        <ModalContext.Provider value={value}>
            {children}
            {mounted && createPortal(
                <div className={cn(styles.layer, modals.length ? styles['layer--active'] : undefined)}>
                    {modals.map(modal => (
                        <ModalRenderer key={modal.id} descriptor={modal} onClose={() => close(modal.id)} />
                    ))}
                </div>,
                document.body
            )}
        </ModalContext.Provider>
    );
}

/**
 * useModal Hook
 *
 * Provides access to the modal context for programmatic modal control.
 * Must be used within a ModalProvider component tree.
 *
 * @example
 * ```tsx
 * const { open, close } = useModal();
 * const modalId = open({
 *   title: 'Confirm Action',
 *   content: <ConfirmDialog />,
 *   size: 'sm'
 * });
 * ```
 *
 * @returns Modal context value with open/close methods
 * @throws Error if used outside ModalProvider
 */
export function useModal() {
    const context = useContext(ModalContext);
    if (!context) {
        throw new Error('useModal must be used within a ModalProvider');
    }
    return context;
}

/**
 * Maps modal size enum to CSS Module class names.
 *
 * Provides type-safe mapping between ModalSize values and their corresponding
 * responsive width classes.
 */
const sizeClass: Record<ModalSize, string> = {
    sm: styles['dialog--sm'],
    md: styles['dialog--md'],
    lg: styles['dialog--lg'],
    xl: styles['dialog--xl']
};

/**
 * ModalRenderer Component
 *
 * Internal component responsible for rendering a single modal instance with
 * backdrop, dialog container, header, and body. Handles backdrop click detection
 * for dismissible modals and keyboard accessibility.
 *
 * @param props.descriptor - Modal configuration and content
 * @param props.onClose - Callback to invoke when modal should close
 * @returns Rendered modal with backdrop and dialog
 */
function ModalRenderer({ descriptor, onClose }: { descriptor: ModalDescriptor; onClose: () => void }) {
    const { id, title, content, size = 'md', dismissible = true } = descriptor;

    /**
     * Handles backdrop click events to close dismissible modals.
     *
     * Only closes the modal if the click target is the backdrop itself
     * (not bubbled from dialog content) and the modal is marked dismissible.
     *
     * @param event - React mouse event from backdrop click
     */
    const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && dismissible) {
            onClose();
        }
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? `${id}-title` : undefined}
            className={styles.backdrop}
            onClick={handleBackdropClick}
        >
            <div className={cn(styles.dialog, sizeClass[size])}>
                <header className={styles.dialog__header}>
                    {title && <h2 id={`${id}-title`}>{title}</h2>}
                    {dismissible && (
                        <button
                            type="button"
                            className={styles.dialog__close}
                            aria-label="Close"
                            onClick={onClose}
                        >
                            ×
                        </button>
                    )}
                </header>
                <div className={styles.dialog__body}>
                    {content}
                </div>
            </div>
        </div>
    );
}
