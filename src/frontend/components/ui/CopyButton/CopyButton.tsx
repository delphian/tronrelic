'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from '../Button';

interface CopyButtonProps extends Omit<ButtonProps, 'icon' | 'onClick' | 'children' | 'loading'> {
    /**
     * The string value placed on the system clipboard when clicked.
     */
    value: string;
    /**
     * Label shown next to the icon. When omitted, only the icon renders.
     */
    label?: string;
    /**
     * Label shown during the brief confirmation window after a successful copy.
     * @default 'Copied'
     */
    copiedLabel?: string;
    /**
     * How long the confirmation state persists before reverting, in milliseconds.
     * @default 1500
     */
    resetMs?: number;
    /**
     * Accessible label when no visible text is shown.
     * @default 'Copy to clipboard'
     */
    ariaLabel?: string;
}

/**
 * CopyButton writes its `value` to the system clipboard on click and swaps
 * its icon/label to a confirmation state for a brief window. Falls back to
 * a textarea-based execCommand path when the async clipboard API is
 * unavailable (older browsers / non-secure contexts).
 */
export function CopyButton({
    value,
    label,
    copiedLabel = 'Copied',
    resetMs = 1500,
    ariaLabel = 'Copy to clipboard',
    variant = 'ghost',
    size = 'sm',
    ...rest
}: CopyButtonProps) {
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }, []);

    const handleCopy = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = value;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'absolute';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            setCopied(true);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => setCopied(false), resetMs);
        } catch {
            setCopied(false);
        }
    }, [value, resetMs]);

    const iconSize = size === 'lg' ? 18 : 16;
    const icon = copied ? <Check size={iconSize} /> : <Copy size={iconSize} />;
    const visibleLabel = label !== undefined ? (copied ? copiedLabel : label) : undefined;
    const resolvedAriaLabel = label !== undefined ? undefined : (copied ? copiedLabel : ariaLabel);

    return (
        <Button
            variant={variant}
            size={size}
            icon={icon}
            onClick={handleCopy}
            aria-label={resolvedAriaLabel}
            {...rest}
        >
            {visibleLabel ?? ''}
        </Button>
    );
}
