'use client';

/**
 * @fileoverview Sources panel for /system/address-tags: per-source ingestion
 * status, manual runs, and the on-demand Chainalysis screen control.
 *
 * The status table is the reason this tab exists — without it a silently
 * failing feed looks identical to a clean one, which for sanctions data is
 * the worst failure mode available. Each row shows the last successful run,
 * the last error, the stored cursor, and the counts from the most recent
 * reconcile, all straight off the requireAdmin status endpoint.
 *
 * Like the other /system managers this panel fetches on mount over the
 * cookie-authenticated admin API rather than SSR-seeding: the SSR + Live
 * Updates mandate covers public-facing content, and admin surfaces are exempt
 * by the /system dashboard convention.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { Play, Settings, ShieldQuestion } from 'lucide-react';
import { Stack } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import { Button } from '../../../../../../components/ui/Button';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { Panel } from '../../../../../../components/ui/Panel';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
import { AddressSelector } from '../../../../../../components/ui/AddressSelector';
import { useToast } from '../../../../../../components/ui/ToastProvider';
import {
    getTagSources,
    runTagSource,
    screenAddress,
    invalidateAddressTags,
    type ITagSourceStatusView,
    type ITagSyncResultView
} from '../../../../../../modules/address-tags';
import styles from './page.module.scss';

/**
 * Human labels for the registered source ids, so the table reads as the feeds
 * an operator knows rather than internal identifiers.
 */
const SOURCE_LABELS: Record<string, string> = {
    'ofac-sdn': 'OFAC SDN list',
    'usdt-blacklist': 'Tether USDT blacklist',
    chainalysis: 'Chainalysis screening'
};

/** The id the Chainalysis lookup source registers under. */
const CHAINALYSIS_SOURCE_ID = 'chainalysis';

/**
 * Compress a reconcile's counts into one readable line for the table.
 *
 * @param result - The counts to summarize.
 * @returns e.g. "3 added, 120 refreshed, 1 withdrawn".
 */
function summarizeResult(result: ITagSyncResultView | null | undefined): string {
    if (!result) {
        return '—';
    }
    const parts = [
        `${result.added} added`,
        `${result.refreshed} refreshed`,
        `${result.withdrawn} withdrawn`
    ];
    if (result.rejected > 0) {
        parts.push(`${result.rejected} rejected`);
    }
    return parts.join(', ');
}

/**
 * Props for the Sources panel.
 */
interface ISourcesTabProps {
    /**
     * Switch the page to its Settings tab. The screening card offers this when
     * screening cannot run yet, because the switch and the key it needs are
     * both on that tab.
     */
    onOpenSettings: () => void;
}

/**
 * The Sources panel: status table, per-source run buttons, and the screening
 * control.
 *
 * @param props - The callback that opens the Settings tab.
 * @returns The tab.
 */
export function SourcesTab({ onOpenSettings }: ISourcesTabProps) {
    const [sources, setSources] = useState<ITagSourceStatusView[]>([]);
    const [loading, setLoading] = useState(true);
    const [runningId, setRunningId] = useState<string | null>(null);
    const [screenTarget, setScreenTarget] = useState<string | null>(null);
    const [screening, setScreening] = useState(false);
    const screenHintId = useId();
    const { push } = useToast();

    /**
     * Toast helper mapping a thrown error (or success text) onto the toast
     * provider's `{ tone, title, description }` shape.
     */
    const notify = useCallback((tone: 'success' | 'danger', title: string, error?: unknown) => {
        push({
            tone,
            title,
            description: error ? (error instanceof Error ? error.message : String(error)) : undefined
        });
    }, [push]);

    /**
     * Refresh the status table. Clearing `loading` in `finally` retires the
     * first-fetch placeholder even when the request fails, so a failed load
     * falls through to the empty state rather than spinning forever.
     */
    const load = useCallback(async () => {
        try {
            setSources(await getTagSources());
        } catch (error) {
            notify('danger', 'Failed to load source statuses', error);
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Run one source now and report the reconcile counts. The request awaits
     * the whole run — the OFAC download can take a minute — so the button
     * holds a busy state for its row until the counts come back.
     *
     * @param id - The source to run.
     */
    const handleRun = useCallback(async (id: string) => {
        setRunningId(id);
        try {
            const result = await runTagSource(id);
            notify('success', `${SOURCE_LABELS[id] ?? id}: ${summarizeResult(result)}`);
            await load();
        } catch (error) {
            notify('danger', `Failed to run ${SOURCE_LABELS[id] ?? id}`, error);
            await load();
        } finally {
            setRunningId(null);
        }
    }, [load, notify]);

    /**
     * Screen the selected address through Chainalysis and report the outcome.
     * The tag cache for that address is invalidated so every chip on the page
     * reflects a new flag without a reload.
     */
    const handleScreen = useCallback(async () => {
        const address = screenTarget;
        if (!address) {
            notify('danger', 'Select an address to screen');
            return;
        }
        setScreening(true);
        try {
            const result = await screenAddress(address);
            invalidateAddressTags(address);
            notify(
                'success',
                result.added > 0 || result.refreshed > 0
                    ? `Sanctions match: ${address} is now tagged chainalysis:sanctioned`
                    : `No sanctions identification for ${address}`
            );
            await load();
        } catch (error) {
            notify('danger', 'Failed to screen address', error);
        } finally {
            setScreening(false);
        }
    }, [load, notify, screenTarget]);

    // Screening refuses while its switch is off or no key is saved, so the
    // form is offered only when both hold. Showing it otherwise invites an
    // operator to fill it in and be refused.
    const chainalysis = sources.find((source) => source.id === CHAINALYSIS_SOURCE_ID);
    const screeningReady = chainalysis !== undefined && chainalysis.enabled && chainalysis.configured;

    return (
        <Stack gap="md">
            <Panel
                title="Ingestion sources"
                meta="Scheduled runs need ENABLE_SCHEDULER on; Run now ignores the switches on Settings"
            >
                {sources.length === 0 ? (
                    <div className={styles.placeholder}>
                        {loading ? 'Loading source statuses…' : 'No sources registered.'}
                    </div>
                ) : (
                    /* Source, Last success, Last result, and Actions keep their
                       content on one line at its own width, and State lets its
                       badges wrap, so Last error takes the spare width. Those
                       columns alone need about 900px, which leaves the error a
                       few dozen pixels of a tablet's 976px, so the rows stack
                       at tablet width rather than only on a phone. */
                    <Table flush stackAt="tablet">
                        <Thead>
                            <Tr>
                                <Th width="shrink">Source</Th>
                                <Th>State</Th>
                                <Th width="shrink">Last success</Th>
                                <Th width="shrink">Last result</Th>
                                <Th>Last error</Th>
                                <Th width="shrink">Actions</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {sources.map((source) => {
                                const hasError = Boolean(source.state.lastError || source.verifyState?.lastError);
                                return (
                                    <Tr key={source.id}>
                                        <Td>
                                            <div className={styles.source_name}>{SOURCE_LABELS[source.id] ?? source.id}</div>
                                            <div className={styles.source_meta}>
                                                {source.mode}
                                                {source.cron ? ` · ${source.cron}` : ' · on demand'}
                                            </div>
                                            {/* On a line of its own, because the
                                                column holds its lines unwrapped and
                                                a cursor appended to the line above
                                                would set the column's width. */}
                                            {source.cursor && (
                                                <div className={styles.source_meta}>cursor {source.cursor}</div>
                                            )}
                                        </Td>
                                        <Td label="State">
                                            <div className={styles.badge_row}>
                                                <Badge tone={source.enabled ? 'success' : 'neutral'}>
                                                    {source.enabled ? 'enabled' : 'disabled'}
                                                </Badge>
                                                {!source.configured && <Badge tone="warning">no key</Badge>}
                                                {source.running && <Badge tone="info">running</Badge>}
                                            </div>
                                        </Td>
                                        <Td label="Last success">
                                            {source.state.lastSuccessAt
                                                ? <ClientTime date={source.state.lastSuccessAt} format="relative" />
                                                : 'never'}
                                            {source.verifyState?.lastSuccessAt && (
                                                <div className={styles.source_meta}>
                                                    verified <ClientTime date={source.verifyState.lastSuccessAt} format="relative" />
                                                </div>
                                            )}
                                        </Td>
                                        {/* No stackSpan: the summary wraps to two
                                            lines in one column at most, and a
                                            wider field would push Run now onto
                                            a line of its own. */}
                                        <Td label="Last result">
                                            {summarizeResult(source.state.lastResult)}
                                            {source.verifyState?.lastResult && (
                                                <div className={styles.source_meta}>
                                                    verify: {summarizeResult(source.verifyState.lastResult)}
                                                </div>
                                            )}
                                        </Td>
                                        {/* The whole line only when there is an
                                            error to read; an empty one keeps a
                                            single column so it does not push
                                            Run now onto a line of its own. */}
                                        <Td label="Last error" stackSpan={hasError ? 'full' : undefined}>
                                            {source.state.lastError && (
                                                <div className={styles.error_text}>{source.state.lastError}</div>
                                            )}
                                            {source.verifyState?.lastError && (
                                                <div className={styles.error_text}>verify: {source.verifyState.lastError}</div>
                                            )}
                                            {!hasError && '—'}
                                        </Td>
                                        <Td>
                                            {source.mode !== 'lookup' && (
                                                <Button
                                                    variant="secondary"
                                                    icon={<Play size={14} />}
                                                    onClick={() => void handleRun(source.id)}
                                                    disabled={runningId !== null || source.running}
                                                    aria-label={`Run ${SOURCE_LABELS[source.id] ?? source.id} now`}
                                                >
                                                    {runningId === source.id ? 'Running…' : 'Run now'}
                                                </Button>
                                            )}
                                        </Td>
                                    </Tr>
                                );
                            })}
                        </Tbody>
                    </Table>
                )}
            </Panel>

            {/* While screening cannot run, the panel is its header alone: one
                line saying what is missing, with the button that opens the tab
                where both are set. */}
            {chainalysis && (
                <Panel
                    title="Screen one address"
                    meta={screeningReady
                        ? 'Direct sanctions matches through Chainalysis'
                        : 'Needs the Chainalysis switch on and an API key saved'}
                    actions={!screeningReady && (
                        <Button variant="secondary" icon={<Settings size={16} />} onClick={onOpenSettings}>
                            Open Settings
                        </Button>
                    )}
                >
                    {screeningReady && (
                        <>
                            <div className={styles.screen_form}>
                                <div className={styles.screen_input}>
                                    <AddressSelector
                                        value={screenTarget}
                                        onChange={setScreenTarget}
                                        disabled={screening}
                                        aria-label="TRON address to screen"
                                        aria-describedby={screenHintId}
                                    />
                                </div>
                                <Button
                                    variant="primary"
                                    icon={<ShieldQuestion size={16} />}
                                    onClick={() => void handleScreen()}
                                    disabled={screening}
                                >
                                    {screening ? 'Screening…' : 'Screen address'}
                                </Button>
                            </div>
                            <p id={screenHintId} className={styles.hint}>
                                A match tags the address <code>chainalysis:sanctioned</code> with the identification as its
                                citation, and a clean answer withdraws any earlier flag. It does not detect proximity to
                                sanctioned addresses.
                            </p>
                        </>
                    )}
                </Panel>
            )}
        </Stack>
    );
}
