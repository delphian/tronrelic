'use client';

/**
 * @fileoverview Shared surface for the System page's single-section tabs.
 *
 * Configuration and WebSockets each own a tab whose whole body is one subsystem
 * section. Those sections render bare — they were written to sit inside a
 * wrapper that supplied the surface, so neither carries a card of its own.
 * They share this wrapper rather than repeat the same `Stack` + `Card`, keeping
 * the panels visually identical to the Overview cards and to each other.
 *
 * MongoDB and ClickHouse are exceptions and no longer use this panel: each tab
 * holds several independent surfaces that each earn a card, so `MongoSection`
 * and `ClickHouseSection` build their own stacks.
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
