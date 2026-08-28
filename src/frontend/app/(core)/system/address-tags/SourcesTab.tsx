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

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Play, ShieldQuestion } from 'lucide-react';
import { Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { AddressSelector } from '../../../../components/ui/AddressSelector';
import { useToast } from '../../../../components/ui/ToastProvider';
import {
    getTagSources,
    runTagSource,
    screenAddress,
    invalidateAddressTags,
    type ITagSourceStatusView,
    type ITagSyncResultView
} from '../../../../modules/address-tags';
import styles from './page.module.scss';

/**
 * Where an operator can ask Chainalysis about access to the screening API.
 *
 * The backend calls `https://public.chainalysis.com/api/v1/address/`, which
 * only works with a key Chainalysis issues. This URL is the one Chainalysis
 * still publishes for that request, in their own announcement of the sanctions
 * screening API, and there is no self-service signup anywhere else. It no
 * longer reaches a key-request form: it redirects to the commercial Address
 * Screening product page, whose only form is a sales enquiry. Do not describe
 * it to operators as a way to obtain a free key, because the destination page
 * offers no such thing, and re-check where it lands before changing the copy
 * below.
 */
const CHAINALYSIS_KEY_URL = 'https://go.chainalysis.com/crypto-sanctions-screening.html';

/**
 * Human labels for the registered source ids, so the table reads as the feeds
 * an operator knows rather than internal identifiers.
 */
const SOURCE_LABELS: Record<string, string> = {
    'ofac-sdn': 'OFAC SDN list',
    'usdt-blacklist': 'Tether USDT blacklist',
    chainalysis: 'Chainalysis screening'
};

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
 * The Sources panel: status table, per-source run buttons, and the screening
 * control.
 */
export function SourcesTab() {
    const [sources, setSources] = useState<ITagSourceStatusView[]>([]);
    const [loading, setLoading] = useState(true);
    const [runningId, setRunningId] = useState<string | null>(null);
    const [screenTarget, setScreenTarget] = useState<string | null>(null);
    const [screening, setScreening] = useState(false);
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

    return (
        <Stack gap="lg">
            <Card>
                <Stack gap="md">
                    <p className={styles.intro}>
                        Machine sources assert reserved-prefix tags (<code>ofac:sdn</code>, <code>usdt:frozen</code>,{' '}
                        <code>chainalysis:sanctioned</code>) with a citation behind every claim. Scheduled runs stop entirely when the
                        platform scheduler is off (<code>ENABLE_SCHEDULER=false</code>) — that is the ingestion kill switch — and each
                        source also has its own switch on the Settings tab. &ldquo;Run now&rdquo; works regardless of the switch, for
                        testing and recovery.
                    </p>

                    {sources.length === 0 ? (
                        <div className={styles.placeholder}>
                            {loading ? 'Loading source statuses…' : 'No sources registered.'}
                        </div>
                    ) : (
                        <Table className={styles.sources_table}>
                            <Thead>
                                <Tr>
                                    <Th>Source</Th>
                                    <Th>State</Th>
                                    <Th>Last success</Th>
                                    <Th>Last result</Th>
                                    <Th>Last error</Th>
                                    <Th>Actions</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {sources.map((source) => (
                                    <Tr key={source.id}>
                                        <Td data-label="Source">
                                            <div className={styles.source_name}>{SOURCE_LABELS[source.id] ?? source.id}</div>
                                            <div className={styles.source_meta}>
                                                {source.mode}
                                                {source.cron ? ` · ${source.cron}` : ' · on demand'}
                                                {source.cursor ? ` · cursor ${source.cursor}` : ''}
                                            </div>
                                        </Td>
                                        <Td data-label="State">
                                            <div className={styles.badge_row}>
                                                <Badge tone={source.enabled ? 'success' : 'neutral'}>
                                                    {source.enabled ? 'enabled' : 'disabled'}
                                                </Badge>
                                                {!source.configured && <Badge tone="warning">no key</Badge>}
                                                {source.running && <Badge tone="info">running</Badge>}
                                            </div>
                                        </Td>
                                        <Td data-label="Last success">
                                            {source.state.lastSuccessAt
                                                ? <ClientTime date={source.state.lastSuccessAt} format="relative" />
                                                : 'never'}
                                            {source.verifyState?.lastSuccessAt && (
                                                <div className={styles.source_meta}>
                                                    verified <ClientTime date={source.verifyState.lastSuccessAt} format="relative" />
                                                </div>
                                            )}
                                        </Td>
                                        <Td data-label="Last result">
                                            {summarizeResult(source.state.lastResult)}
                                            {source.verifyState?.lastResult && (
                                                <div className={styles.source_meta}>
                                                    verify: {summarizeResult(source.verifyState.lastResult)}
                                                </div>
                                            )}
                                        </Td>
                                        <Td data-label="Last error">
                                            {source.state.lastError && (
                                                <div className={styles.error_text}>{source.state.lastError}</div>
                                            )}
                                            {source.verifyState?.lastError && (
                                                <div className={styles.error_text}>verify: {source.verifyState.lastError}</div>
                                            )}
                                            {!source.state.lastError && !source.verifyState?.lastError && '—'}
                                        </Td>
                                        <Td data-label="Actions">
                                            {source.mode !== 'lookup' && (
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => void handleRun(source.id)}
                                                    disabled={runningId !== null || source.running}
                                                    aria-label={`Run ${SOURCE_LABELS[source.id] ?? source.id} now`}
                                                >
                                                    <Play size={14} /> {runningId === source.id ? 'Running…' : 'Run now'}
                                                </Button>
                                            )}
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    )}
                </Stack>
            </Card>

            <Card>
                <Stack gap="md">
                    <p className={styles.intro}>
                        Screen one address through Chainalysis on demand. A sanctions identification tags the address{' '}
                        <code>chainalysis:sanctioned</code> with the identification as its citation; a clean answer withdraws any prior
                        flag. This is direct-match screening only — it does not detect proximity to sanctioned addresses. Requires the
                        Chainalysis switch to be on and an API key saved, both on the Settings tab.
                    </p>
                    <p className={styles.intro}>
                        No key yet? The key has to come from Chainalysis, and they publish no self-service signup for this API. The
                        page below is the only route they document, and it now leads to their commercial Address Screening enquiry
                        form, so whether you are given access and on what terms is between you and Chainalysis.{' '}
                        <a className={styles.docs_link} href={CHAINALYSIS_KEY_URL} target="_blank" rel="noopener noreferrer">
                            Contact Chainalysis about API access <ExternalLink size={14} aria-hidden />
                        </a>
                        . Once you have a key, paste it into the Settings tab.
                    </p>
                    <div className={styles.screen_form}>
                        <div className={styles.screen_input}>
                            <AddressSelector
                                value={screenTarget}
                                onChange={setScreenTarget}
                                disabled={screening}
                                aria-label="TRON address to screen"
                            />
                        </div>
                        <Button variant="primary" onClick={() => void handleScreen()} disabled={screening}>
                            <ShieldQuestion size={16} /> {screening ? 'Screening…' : 'Screen address'}
                        </Button>
                    </div>
                </Stack>
            </Card>
        </Stack>
    );
}
