/**
 * @fileoverview Icon-only copy affordance — the standard bare copy control.
 *
 * `<CopyButton>` renders a full `<Button>`, so its chrome (padding, border,
 * hover fill) is right next to a label but visually dominates a dense row of
 * bare icons: in the TronAddress chip it sat beside a bare wrench and a bare
 * out-link and read as the odd one out. This is the same behaviour on the
 * `<IconButton>` primitive the other inline row actions already use, so a copy
 * icon matches its neighbours everywhere instead of each caller re-styling
 * `<CopyButton>` back down to bare.
 *
 * Use `<CopyButton>` when the affordance carries a visible label; use this when
 * it is an icon among icons.
 *
 * The `Tr` prefix is deliberate and load-bearing: lucide-react exports
 * `CopyIcon` as an alias of `Copy` (as it does `LinkIcon`, `WrenchIcon`, and
 * every other glyph), so an unprefixed `CopyIcon` would collide in any file
 * importing the glyph alongside this control. Name future icon affordances the
 * same way — `TrLinkIcon`, `TrToolsIcon`.
 */
'use client';

import { Check, Copy } from 'lucide-react';
import { IconButton, type IconButtonProps } from '../IconButton';
import { useCopyToClipboard } from '../../../lib/hooks/useCopyToClipboard';

/**
 * Icon pixel size per tap-target size. `IconButton` deliberately leaves icon
 * sizing to its caller, but a copy icon has no reason to vary per call site —
 * pinning it here is what keeps every copy control identical, and it matches
 * the 14/16/18px inline-icon scale the UI system documents.
 */
const ICON_SIZE: Record<NonNullable<IconButtonProps['size']>, number> = {
    xs: 14,
    sm: 16,
    md: 16,
    lg: 18
};

/**
 * Props for {@link TrCopyIcon}.
 */
export interface ITrCopyIconProps
    extends Omit<IconButtonProps, 'children' | 'onClick' | 'aria-label'> {
    /** The string placed on the system clipboard when clicked. */
    value: string;
    /**
     * Accessible label describing what is copied. Defaulted rather than
     * required because the affordance is self-evident, but callers should name
     * the value ("Copy address") wherever a screen reader would otherwise hear
     * the same label on several controls in one row.
     * @default 'Copy to clipboard'
     */
    'aria-label'?: string;
    /**
     * Accessible label announced during the confirmation window, so assistive
     * technology hears the state change the checkmark shows sighted users.
     * @default 'Copied'
     */
    copiedLabel?: string;
    /**
     * How long the confirmation state persists before reverting, in ms.
     * @default 1500
     */
    resetMs?: number;
}

/**
 * Copy a value to the clipboard from a bare icon, swapping to a checkmark for a
 * brief confirmation window.
 *
 * @param props - {@link ITrCopyIconProps}; only `value` is required. The
 *        `primary` hover tone is the default because `IconButton` already
 *        assigns copy to that tone; pass `variant` to match a differently-toned
 *        row.
 * @returns The icon-only copy control.
 */
export function TrCopyIcon({
    value,
    'aria-label': ariaLabel = 'Copy to clipboard',
    copiedLabel = 'Copied',
    resetMs,
    variant = 'primary',
    size = 'md',
    ...rest
}: ITrCopyIconProps) {
    const { copied, copy } = useCopyToClipboard(value, resetMs);

    return (
        <IconButton
            variant={variant}
            size={size}
            aria-label={copied ? copiedLabel : ariaLabel}
            onClick={copy}
            {...rest}
        >
            {copied ? <Check size={ICON_SIZE[size]} /> : <Copy size={ICON_SIZE[size]} />}
        </IconButton>
    );
}
