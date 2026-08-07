'use client';

/**
 * @fileoverview Shared surface for the System page's single-section tabs.
 *
 * Configuration, WebSockets, and ClickHouse each own a tab whose whole body is
 * one subsystem section. Those sections render bare — they were written to sit
 * inside a wrapper that supplied the surface, so none carries a card of its own.
 * Rather than repeat the same `Stack` + `Card` wrapper across near-identical tab
 * components, they share this one, keeping the panels visually identical to the
 * Overview cards and to each other.
 *
 * MongoDB is the exception and no longer uses this panel: its health readout,
 * collection browser, and migration log are independent surfaces that each earn
 * a card, so `MongoSection` builds its own stack.
 */

import type { ReactNode } from 'react';
import { Stack } from '../../../../../components/layout';
import { Card } from '../../../../../components/ui/Card';

/**
 * Props for the shared single-section tab surface.
 */
interface ISectionPanelProps {
    /** The subsystem section rendered as the tab's entire body. */
    children: ReactNode;
}

/**
 * Wrap a subsystem section in the standard System page panel surface.
 *
 * The section renders expanded rather than behind a collapsed row: the admin
 * already chose this subsystem by selecting its tab, so a second click to reveal
 * the content would be pure friction. Mounting is still deferred — the page shell
 * renders a panel only while its tab is active — so each section's fetch fires on
 * arrival rather than on page load.
 *
 * @param props - The section to render as the tab body.
 * @returns The section on the page's standard card surface.
 */
export function SectionPanel({ children }: ISectionPanelProps) {
    return (
        <Stack gap="lg">
            <Card padding="sm" noBackgroundImage>
                {children}
            </Card>
        </Stack>
    );
}
