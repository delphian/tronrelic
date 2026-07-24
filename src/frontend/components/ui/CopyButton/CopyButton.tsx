'use client';

import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from '../Button';
import { useCopyToClipboard } from '../../../lib/hooks/useCopyToClipboard';

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
    'aria-label'?: string;
}

/**
 * CopyButton writes its `value` to the system clipboard on click and swaps
 * its icon/label to a confirmation state for a brief window. The clipboard
 * write, its non-secure-context fallback, and the confirmation timer live in
 * `useCopyToClipboard`, shared with the icon-only `<TrCopyIcon>`.
 *
 * Reach for this when the affordance carries (or may carry) a visible label;
 * for a bare icon among other bare icons use `<TrCopyIcon>`, which renders on
 * the `IconButton` primitive instead of a full `<Button>`.
 */
export function CopyButton({
    value,
    label,
    copiedLabel = 'Copied',
    resetMs,
    'aria-label': ariaLabel = 'Copy to clipboard',
    variant = 'ghost',
    size = 'sm',
    ...rest
}: CopyButtonProps) {
    const { copied, copy: handleCopy } = useCopyToClipboard(value, resetMs);

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
