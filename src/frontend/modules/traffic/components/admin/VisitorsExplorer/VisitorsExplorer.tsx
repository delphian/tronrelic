/**
 * VisitorsExplorer Component
 *
 * The single entity-explorer surface for the Traffic admin's Visitors tab,
 * merging what were previously two separate tabs (Visitors + Pages) that both
 * rendered row-per-subject tables. A subject selector at the page level chooses
 * one of three views and this component renders exactly that one:
 *
 * - `new`        — new-visitor first touches (acquisition), bot-filterable.
 * - `anonymous`  — cookied (tid) per-page clickstream, one row per visitor.
 * - `registered` — signed-in (user_id) per-page clickstream, one row per account.
 *
 * Why one tab, not two: the old Visitors and Pages tabs were the same kind of
 * tool — a list of individual subjects with a drill-down — split awkwardly by
 * "new first-touch" vs "page activity", and "Pages" misleadingly labelled a
 * subject list (per-URL reporting lives on the Analytics tab). Collapsing them
 * behind one selector removes that redundancy and the mislabel. The aggregate
 * dashboard stays separate on the Analytics tab — aggregate reporting and
 * row-level exploration are distinct modes (the GA4 Reports vs Explore divide).
 *
 * The bot filter only reaches the `new` view — the activity views read `page`
 * events, which non-JS crawlers never emit, so the filter is inert there and
 * the page hides it for those views.
 */

'use client';

import React, { useMemo } from 'react';
import { VisitorAnalytics } from '../VisitorAnalytics/VisitorAnalytics';
import { PageActivityTable } from '../PageActivity/PageActivity';
import type { IActivityWindow } from '../PageActivity/PageActivity';
import type { AnalyticsPeriod, ICustomDateRange, VisitorPeriod } from '../../../api';

/** The three subject-scoped views the Visitors tab can show. */
export type VisitorsView = 'new' | 'anonymous' | 'registered';

interface IVisitorsExplorerProps {
    /** Which subject view to render, driven by the page-level selector. */
    view: VisitorsView;
    /** Selected lookback period from the page-level controls. */
    period: AnalyticsPeriod;
    /** Custom date range when `period === 'custom'`. */
    customRange?: ICustomDateRange;
    /** Whether classified bot rows are included (applies to the `new` view only). */
    includeBots: boolean;
}

/**
 * Render the selected subject view for the Visitors tab. Delegates entirely to
 * the existing per-subject tables so each view keeps its own fetch, pagination,
 * and drill-down; this component only routes and supplies the resolved window.
 *
 * @param props - The active view plus the page-level window and bot filter.
 * @returns The rendered subject table for the selected view.
 */
export function VisitorsExplorer({ view, period, customRange, includeBots }: IVisitorsExplorerProps) {
    // The activity tables take a resolved window object. Memoized so the
    // parent's live-counter re-renders don't churn a fresh identity and re-fire
    // the table's fetch effect.
    const window = useMemo<IActivityWindow>(() => (
        period === 'custom'
            ? { customRange }
            : { period: period as VisitorPeriod }
    ), [period, customRange]);

    if (view === 'new') {
        return <VisitorAnalytics period={period} customRange={customRange} includeBots={includeBots} />;
    }

    if (view === 'anonymous') {
        return (
            <PageActivityTable
                subject="tid"
                title="Anonymous Visitor Activity"
                subjectHeading="Traffic ID"
                description="Per-page navigation for cookied anonymous visitors, keyed on the traffic id. Expand a row to see every page they hit."
                window={window}
            />
        );
    }

    return (
        <PageActivityTable
            subject="user"
            title="Registered User Activity"
            subjectHeading="Account"
            description="Per-page navigation for signed-in accounts, keyed on the Better Auth user id. Expand a row to see every page they hit."
            window={window}
        />
    );
}
