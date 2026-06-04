'use client';

/**
 * @fileoverview Bird's-eye admin view of the hook system.
 *
 * Loads the introspection snapshot from `/api/admin/system/hooks` and
 * renders a horizontal track strip (one tab per pipeline phase) above a
 * vertical timeline of the hooks declared in the selected track. Each
 * hook node shows its archetype, id, description, and the count of
 * registered handlers; clicking the node expands a panel listing
 * handlers in execution order with plugin id, priority, and source.
 *
 * The page is a client component because it polls + interacts; it
 * follows the convention of the other `/system/*` admin surfaces which
 * run behind `useSystemAuth` rather than SSR.
 *
 * @module app/(core)/system/hooks/page
 */

import { useEffect, useMemo, useState } from 'react';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { ChevronDown, ChevronRight } from 'lucide-react';
import styles from './page.module.scss';

/**
 * Shape of one handler returned by the snapshot endpoint.
 */
interface IHandlerRecord {
    pluginId: string;
    priority: number;
    registeredAt: string;
    source: string | null;
}

/**
 * Shape of one hook entry within a track.
 */
interface IHookRecord {
    id: string;
    kind: 'observer' | 'series' | 'waterfall' | 'bail';
    order: number;
    description: string;
    predicates: ReadonlyArray<{ id: string; label: string; description: string }>;
    shortCircuit: boolean;
    handlers: ReadonlyArray<IHandlerRecord>;
}

/**
 * Shape of one track (pipeline phase) returned by the snapshot endpoint.
 */
interface ITrackRecord {
    id: string;
    label: string;
    hooks: ReadonlyArray<IHookRecord>;
}

/**
 * Map a hook kind to a Badge tone. Bail and series can short-circuit so
 * they get a warm tone; waterfall threads a value so it's informational;
 * observer is fire-and-forget so it stays neutral.
 *
 * @param kind - Hook archetype.
 * @returns Tone identifier accepted by the Badge primitive.
 */
function toneForKind(kind: IHookRecord['kind']): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
    if (kind === 'bail' || kind === 'series') {
        return 'warning';
    }
    if (kind === 'waterfall') {
        return 'info';
    }

    return 'neutral';
}

/**
 * Admin page rendering the hook-system bird's-eye view.
 */
export default function HooksAdminPage() {
    const [tracks, setTracks] = useState<ReadonlyArray<ITrackRecord>>([]);
    const [activeTrack, setActiveTrack] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        let aborted = false;
        const ctrl = new AbortController();

        async function load(): Promise<void> {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch('/api/admin/system/hooks', {
                    signal: ctrl.signal
                });
                if (!res.ok) {
                    throw new Error(`Snapshot request failed with status ${res.status}`);
                }
                const data = await res.json() as { tracks: ReadonlyArray<ITrackRecord> };
                if (aborted) return;
                setTracks(data.tracks);
                setActiveTrack(prev => prev ?? (data.tracks[0]?.id ?? null));
            } catch (err) {
                if (aborted) return;
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                if (!aborted) {
                    setLoading(false);
                }
            }
        }
        void load();

        return () => {
            aborted = true;
            ctrl.abort();
        };
    }, []);

    const selectedTrack = useMemo(() => {
        return tracks.find(t => t.id === activeTrack) ?? null;
    }, [tracks, activeTrack]);

    function toggleExpanded(id: string): void {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    return (
        <Page>
            <div className={styles.container}>
                <PageHeader
                    title="Hook System"
                    subtitle="Bird's-eye view of the request and response pipeline."
                />
                <Stack gap="lg">
                    <p className={styles.intro}>
                        Each track is a phase of the lifecycle; nodes are the seams core opens for
                        plugins to participate in. Empty nodes indicate declared seams with no
                        current contributors.
                    </p>

                    {error && <div className="alert" role="alert">{error}</div>}
                    {loading && tracks.length === 0 && (
                        <p className="text-muted">Loading hook snapshot&hellip;</p>
                    )}

                    {tracks.length > 0 && (
                        <div className={styles.track_strip} role="tablist" aria-label="Pipeline phases">
                            {tracks.map(track => {
                                const isActive = track.id === activeTrack;
                                return (
                                    <button
                                        key={track.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={isActive}
                                        className={`${styles.track_tab} ${isActive ? styles['track_tab--active'] : ''}`}
                                        onClick={() => setActiveTrack(track.id)}
                                    >
                                        <span>{track.label}</span>
                                        <span className={styles.track_tab_count}>{track.hooks.length}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {selectedTrack && (
                        <ol
                            className={styles.timeline}
                            aria-label={`Hooks in ${selectedTrack.label}`}
                        >
                            {selectedTrack.hooks.length === 0 && (
                                <li>
                                    <p className="text-muted">No hooks declared in this track yet.</p>
                                </li>
                            )}
                            {selectedTrack.hooks.map(hook => {
                                const isOpen = expanded.has(hook.id);
                                const isEmpty = hook.handlers.length === 0;
                                const handlerNoun = hook.handlers.length === 1 ? 'handler' : 'handlers';
                                return (
                                    <li
                                        key={hook.id}
                                        className={`${styles.hook_node} ${isEmpty ? styles['hook_node--empty'] : ''}`}
                                    >
                                        <button
                                            type="button"
                                            className={`${styles.hook_header} ${isEmpty ? styles['hook_header--empty'] : ''}`}
                                            aria-expanded={isOpen}
                                            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${hook.id}`}
                                            onClick={() => toggleExpanded(hook.id)}
                                        >
                                            {isOpen
                                                ? <ChevronDown size={16} aria-hidden />
                                                : <ChevronRight size={16} aria-hidden />}
                                            <Badge tone={toneForKind(hook.kind)}>{hook.kind}</Badge>
                                            <span className={styles.hook_id}>{hook.id}</span>
                                            {hook.shortCircuit && <Badge tone="warning">short-circuit</Badge>}
                                            {hook.predicates.map(p => (
                                                <Badge key={p.id} tone="info" title={p.description}>{p.label}</Badge>
                                            ))}
                                            <span className={styles.hook_meta}>
                                                order {hook.order} &middot; {hook.handlers.length} {handlerNoun}
                                            </span>
                                        </button>
                                        {isOpen && (
                                            <div className={styles.hook_body}>
                                                {hook.description && (
                                                    <p className={styles.hook_description}>{hook.description}</p>
                                                )}
                                                {isEmpty ? (
                                                    <p className={styles.empty_body}>
                                                        No plugins registered against this hook.
                                                    </p>
                                                ) : (
                                                    <ol className={styles.handler_list}>
                                                        {hook.handlers.map((handler, idx) => (
                                                            <li
                                                                key={`${handler.pluginId}-${idx}`}
                                                                className={styles.handler_row}
                                                            >
                                                                <span className={styles.handler_plugin}>
                                                                    {handler.pluginId}
                                                                </span>
                                                                <span className={styles.handler_meta}>
                                                                    priority {handler.priority}
                                                                    {' '}&middot;{' '}
                                                                    {handler.source ?? 'source n/a'}
                                                                    {' '}&middot;{' '}
                                                                    <ClientTime date={handler.registeredAt} format="datetime" />
                                                                </span>
                                                            </li>
                                                        ))}
                                                    </ol>
                                                )}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </Stack>
            </div>
        </Page>
    );
}
