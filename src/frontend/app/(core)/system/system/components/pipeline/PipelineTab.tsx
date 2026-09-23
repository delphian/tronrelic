'use client';

/**
 * @fileoverview The Pipeline tab: block ingestion at a glance, then in depth.
 *
 * Admins found the old Overview tab hard to use for monitoring ingestion: the
 * blockchain card sat below the server console, two lag figures meant nearly
 * the same thing, figures the backend computed were never shown, and a failed
 * request blanked a panel into "No observers registered." This tab is laid
 * out in the order an operator asks questions:
 *
 * 1. Is it healthy? — the status banner, with reasons.
 * 2. Where is it stuck? — the heights flow from chain head to committed.
 * 3. Which stage, and why? — one card per stage with its figures, timings,
 *    and the control that acts on it.
 * 4. What went wrong recently? — error history, backfill, recent blocks.
 * 5. Who is downstream? — the observer table.
 *
 * The payload is fetched on the server for the first render and refreshed
 * from the browser every few seconds. A failed refresh keeps the last good
 * payload on screen and says so in the banner, rather than replacing figures
 * with empty states.
 */

import { useCallback, useEffect, useState } from 'react';
import type { IPipelineStatus } from '@/types';
import { Stack } from '../../../../../../components/layout';
import { fetchPipelineStatus } from './pipeline-api';
import { PipelineHealthBanner } from './PipelineHealthBanner';
import { PipelineHeights } from './PipelineHeights';
import { FetchStage } from './FetchStage';
import { EnrichStage } from './EnrichStage';
import { BufferStage } from './BufferStage';
import { CommitStage } from './CommitStage';
import { PipelineErrors } from './PipelineErrors';
import { RecentBlocksTable } from './RecentBlocksTable';
import { ObserverTable } from './ObserverTable';
import styles from './PipelineTab.module.scss';

/**
 * How often the tab refreshes, in milliseconds.
 *
 * Faster than the old ten-second console because one request now replaces
 * four and never calls TronGrid; 12 requests a minute stays well inside the
 * 60-a-minute admin limit on the blockchain endpoints.
 */
export const PIPELINE_REFRESH_MS = 5000;

/** Inputs for the Pipeline tab. */
interface IPipelineTabProps {
    /**
     * The payload fetched on the server, or null when that fetch failed. With
     * null the tab explains that the status is unavailable and fills in from
     * the first successful browser refresh.
     */
    initialPipeline: IPipelineStatus | null;
    /** Switches to the Configuration tab, where the buffer settings live. */
    onOpenSettings: () => void;
}

/**
 * Render the Pipeline tab.
 *
 * @param props - The server-fetched payload and a way to reach the settings tab.
 * @returns The tab body.
 */
export function PipelineTab({ initialPipeline, onOpenSettings }: IPipelineTabProps) {
    const [pipeline, setPipeline] = useState<IPipelineStatus | null>(initialPipeline);
    const [refreshError, setRefreshError] = useState<string | null>(null);

    /**
     * Fetch a fresh payload, keeping the last good one when the fetch fails.
     *
     * Memoized with no dependencies so the polling effect below keeps one
     * interval for the life of the tab.
     */
    const refresh = useCallback(async () => {
        try {
            setPipeline(await fetchPipelineStatus());
            setRefreshError(null);
        } catch (error) {
            setRefreshError(error instanceof Error ? error.message : 'Pipeline status request failed');
        }
    }, []);

    /**
     * Poll for fresh figures after hydration.
     *
     * On a fresh page load the first render uses the server-fetched payload,
     * so no request fires on mount. The tab remounts when the operator returns
     * to it from another tab, still holding the payload from page load; in
     * that case, or when the server fetch failed, it refreshes at once instead
     * of showing old figures until the next poll. The interval is cleared on
     * unmount.
     */
    useEffect(() => {
        const stale = initialPipeline === null
            || Date.now() - Date.parse(initialPipeline.generatedAt) > PIPELINE_REFRESH_MS;
        if (stale) {
            void refresh();
        }

        const interval = setInterval(() => void refresh(), PIPELINE_REFRESH_MS);
        return () => clearInterval(interval);
    }, [initialPipeline, refresh]);

    /**
     * Refresh at once after a control changes something, instead of waiting
     * for the next poll.
     */
    const handleChanged = useCallback(() => {
        void refresh();
    }, [refresh]);

    return pipeline === null ? (
        <p className="alert" role="alert">
            Pipeline status is unavailable{refreshError ? `: ${refreshError}` : ''}. It will appear as soon as a refresh succeeds.
        </p>
    ) : (
        <div className={styles.tab}>
            <Stack gap="lg">
                <PipelineHealthBanner
                    health={pipeline.health}
                    generatedAt={pipeline.generatedAt}
                    refreshError={refreshError}
                />

                <PipelineHeights pipeline={pipeline} />

                <div className={styles.stages}>
                    <FetchStage pipeline={pipeline} onChanged={handleChanged} />
                    <EnrichStage pipeline={pipeline} onChanged={handleChanged} />
                    <BufferStage pipeline={pipeline} onOpenSettings={onOpenSettings} />
                    <CommitStage pipeline={pipeline} />
                </div>

                <PipelineErrors pipeline={pipeline} />
                <RecentBlocksTable pipeline={pipeline} />
                <ObserverTable observers={pipeline.observers} blockIntervalSeconds={pipeline.config.blockIntervalSeconds} />
            </Stack>
        </div>
    );
}
