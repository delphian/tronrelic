'use client';

/**
 * @fileoverview Bird's-eye admin view of the hook system.
 *
 * Loads the introspection snapshot from `/api/admin/system/hooks` and renders
 * every pipeline phase (track) at once, in one table: each track is a group
 * headed by its name, and each hook in it is a one-line row showing its kind,
 * its id, and how many handlers are registered on it. A track that declares no
 * hooks is a single muted heading line. Clicking a hook row, or pressing Enter
 * on it, opens a detail row with the hook's description and its handlers in
 * execution order: plugin id, the source location relative to its package,
 * and the priority when it is not the registry's default. The full source path
 * and the registration time sit in the handler's tooltip, so each handler
 * stays on one line.
 *
 * The page is a client component because it fetches after mount and toggles
 * rows; it follows the convention of the other `/system/*` admin surfaces,
 * which run behind `useSystemAuth` rather than SSR.
 *
 * @module app/[lang]/(site)/(core)/system/hooks/page
 */

import { Fragment, useEffect, useState } from 'react';
import type { HookKind, IHookHandlerRecord, IHookSnapshot } from '@/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AdminPage } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import { Panel } from '../../../../../../components/ui/Panel';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
import styles from './page.module.scss';

/**
 * The priority a handler gets when it registers without one. Only a handler
 * that moved off it is worth showing a priority for. Mirrors
 * `DEFAULT_PRIORITY` in `src/backend/hooks/hook-registry.ts`, which
 * `IHookRegisterOptions.priority` documents as the default.
 */
const DEFAULT_HANDLER_PRIORITY = 100;

/**
 * What each hook kind does with its handlers, shown when an operator hovers a
 * kind badge. Whether a handler can stop the pipeline follows from the kind,
 * so it is said here rather than with a second badge on every row.
 */
const KIND_HELP: Record<HookKind, string> = {
    observer: 'Observer: every handler runs at the same time, and none can change the outcome or stop the pipeline.',
    series: 'Series: handlers run one after another for their side effects. A handler can stop the pipeline by throwing HookAbortError.',
    waterfall: 'Waterfall: handlers run in turn, each receiving the value the previous one returned. '
        + 'A handler can stop the pipeline by throwing HookAbortError.',
    bail: 'Bail: handlers run in turn until one returns an answer, and that answer wins. '
        + 'A handler can stop the pipeline by throwing HookAbortError.'
};

/**
 * What each column means, shown when an operator hovers its header. The page
 * keeps its intro to one subtitle line, so the explanation lives here.
 */
const COLUMN_HELP = {
    kind: 'How the hook runs its handlers. Observer handlers cannot change the outcome; series, waterfall, and bail '
        + 'handlers run in priority order and can stop the pipeline. Hover a badge for its kind.',
    hook: 'A point in core’s pipeline that plugins can join. Open a row to read what the hook is for and the '
        + 'handlers that run on it, in execution order.',
    handlers: 'How many handlers are registered on the hook. A muted hook has none: it is declared, and no plugin '
        + 'or module uses it yet.'
};

/**
 * Map a hook kind to a Badge tone. Bail and series can short-circuit so
 * they get a warm tone; waterfall threads a value so it's informational;
 * observer is fire-and-forget so it stays neutral.
 *
 * @param kind - Hook archetype.
 * @returns Tone identifier accepted by the Badge primitive.
 */
function toneForKind(kind: HookKind): 'neutral' | 'info' | 'warning' {
    let tone: 'neutral' | 'info' | 'warning' = 'neutral';
    if (kind === 'bail' || kind === 'series') {
        tone = 'warning';
    } else if (kind === 'waterfall') {
        tone = 'info';
    }
    return tone;
}

/**
 * Shorten a handler's source location to the part a reader needs. The
 * registry records the full compiled path, such as
 * `file:///app/dist/plugins/trp-blog/src/backend/backend.js:262:37`, whose
 * prefix only repeats the plugin id beside it and whose column number nobody
 * reads; a path that long also forced its handler onto several lines.
 *
 * The path is cut back to its package: a plugin's file below its
 * `src/backend/` folder, a core module's file below its module folder, or
 * anything else below `dist/`, and the column is dropped. A path that matches
 * none of these keeps only its file name and line.
 *
 * @param source - The `file:line:col` string the registry captured.
 * @returns The short form, such as `backend.js:262`.
 */
function shortenSource(source: string): string {
    const path = source.replace(/^file:\/\//, '').replace(/:(\d+):\d+$/, ':$1');
    const inPackage = path.match(/\/plugins\/[^/]+\/src\/backend\/(.+)$/)
        ?? path.match(/\/backend\/modules\/[^/]+\/(.+)$/)
        ?? path.match(/\/dist\/(.+)$/);
    return inPackage ? inPackage[1] : path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Build the tooltip for a handler: its full source path and when it
 * registered, the two facts left off the handler's line to keep it short.
 *
 * The time is formatted here rather than through `<ClientTime>`, because a
 * tooltip is an attribute and cannot hold a component. That is safe from
 * hydration mismatches: the snapshot is fetched after mount, so no handler is
 * ever rendered on the server.
 *
 * @param handler - The handler record from the snapshot.
 * @returns Two lines: the source path, then the registration time.
 */
function describeRegistration(handler: IHookHandlerRecord): string {
    const registered = new Date(handler.registeredAt);
    const when = Number.isNaN(registered.getTime())
        ? 'at an unknown time'
        : registered.toLocaleString(undefined, { hourCycle: 'h23' });
    return `${handler.source ?? 'Source location not captured'}\nRegistered ${when}`;
}

/**
 * Render an identifier with a line-break opportunity after each separator, so
 * a narrow column wraps `content.beforeRestore` after its dot, or a source
 * path after a slash, rather than in the middle of a word.
 *
 * @param props.text - The identifier or path to render.
 * @param props.separator - The character a line may break after: `.` for a hook id, `/` for a path.
 * @returns The text with `<wbr>` after each separator.
 */
function BreakAfter({ text, separator }: { text: string; separator: string }) {
    return (
        <>
            {text.split(separator).map((part, index) => (
                <Fragment key={index}>
                    {index > 0 && <>{separator}<wbr /></>}
                    {part}
                </Fragment>
            ))}
        </>
    );
}

/**
 * Admin page rendering the hook-system bird's-eye view.
 *
 * @returns The page: the header, then one panel holding every track's hooks.
 */
export default function HooksAdminPage() {
    const [tracks, setTracks] = useState<IHookSnapshot['tracks']>([]);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    /**
     * Load the snapshot once after mount, and abandon the request if the page
     * unmounts first so a late answer cannot set state on a dead page.
     */
    useEffect(() => {
        let aborted = false;
        const ctrl = new AbortController();

        /**
         * Fetch the snapshot and store either its tracks or the reason it failed.
         */
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
                const data = await res.json() as IHookSnapshot;
                if (!aborted) {
                    setTracks(data.tracks);
                }
            } catch (err) {
                if (!aborted) {
                    setError(err instanceof Error ? err.message : String(err));
                }
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

    /**
     * Open a hook's detail row, or close it if it is open. Each hook toggles on
     * its own, so an operator can compare two hooks' handlers side by side.
     *
     * @param id - The hook id whose row was clicked.
     */
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

    const hookCount = tracks.reduce((sum, track) => sum + track.hooks.length, 0);
    const handlerCount = tracks.reduce(
        (sum, track) => sum + track.hooks.reduce((hookSum, hook) => hookSum + hook.handlers.length, 0),
        0
    );

    return (
        <AdminPage
            title="Hook System"
            subtitle="Every hook core declares, grouped by pipeline phase; open a hook to see its description and handlers."
        >
            {error && <div className="alert" role="alert">{error}</div>}
            {loading && tracks.length === 0 && (
                <p className="text-muted">Loading hook snapshot&hellip;</p>
            )}

            {tracks.length > 0 && (
                <Panel
                    title="Hooks by phase"
                    meta={`${hookCount} hooks in ${tracks.length} phases · ${handlerCount} handlers`}
                >
                    {/* One table for every track, so the kind and count columns
                        line up down the whole page. Each track is its own row
                        group, headed by the track's name. */}
                    <Table variant="compact" flush>
                        <Thead>
                            <Tr>
                                <Th width="shrink" title={COLUMN_HELP.kind}>Kind</Th>
                                <Th title={COLUMN_HELP.hook}>Hook</Th>
                                <Th width="shrink" numeric title={COLUMN_HELP.handlers}>Handlers</Th>
                            </Tr>
                        </Thead>
                        {tracks.map(track => (
                            <Tbody key={track.id}>
                                <Tr className={styles.track_row}>
                                    <Th colSpan={3} scope="rowgroup" className={styles.track_heading}>
                                        {track.label}
                                        {track.hooks.length === 0 && (
                                            <span className={styles.track_empty}> &middot; no hooks declared</span>
                                        )}
                                    </Th>
                                </Tr>
                                {track.hooks.map(hook => {
                                    const isOpen = expanded.has(hook.id);
                                    const isEmpty = hook.handlers.length === 0;
                                    return (
                                        <Fragment key={hook.id}>
                                            <Tr onClick={() => toggleExpanded(hook.id)} isExpanded={isOpen}>
                                                <Td>
                                                    <span className={styles.kind_cell}>
                                                        {isOpen
                                                            ? <ChevronDown size={14} aria-hidden />
                                                            : <ChevronRight size={14} aria-hidden />}
                                                        <Badge tone={toneForKind(hook.kind)} size="xs" title={KIND_HELP[hook.kind]}>
                                                            {hook.kind}
                                                        </Badge>
                                                    </span>
                                                </Td>
                                                <Td muted={isEmpty}>
                                                    <span className={styles.hook_cell}>
                                                        <code className={styles.hook_id}><BreakAfter text={hook.id} separator="." /></code>
                                                        {hook.predicates.map(p => (
                                                            <Badge key={p.id} tone="info" size="xs" title={p.description}>{p.label}</Badge>
                                                        ))}
                                                    </span>
                                                </Td>
                                                <Td numeric muted={isEmpty}>{hook.handlers.length}</Td>
                                            </Tr>
                                            {isOpen && (
                                                <Tr isExpanded>
                                                    <Td colSpan={3}>
                                                        <div className={styles.hook_body}>
                                                            {hook.description && (
                                                                <p className={styles.hook_description}>{hook.description}</p>
                                                            )}
                                                            {isEmpty ? (
                                                                <p className={styles.empty_body}>
                                                                    No plugins registered against this hook.
                                                                </p>
                                                            ) : (
                                                                <ol
                                                                    className={styles.handler_list}
                                                                    aria-label={`Handlers on ${hook.id}, in execution order`}
                                                                >
                                                                    {hook.handlers.map((handler, idx) => (
                                                                        <li
                                                                            key={`${handler.pluginId}-${idx}`}
                                                                            className={styles.handler_row}
                                                                        >
                                                                            <span className={styles.handler_plugin}>
                                                                                {handler.pluginId}
                                                                            </span>
                                                                            <span
                                                                                className={styles.handler_meta}
                                                                                title={describeRegistration(handler)}
                                                                            >
                                                                                {handler.source
                                                                                    ? <BreakAfter text={shortenSource(handler.source)} separator="/" />
                                                                                    : 'source unknown'}
                                                                                {handler.priority !== DEFAULT_HANDLER_PRIORITY && (
                                                                                    <> &middot; priority {handler.priority}</>
                                                                                )}
                                                                            </span>
                                                                        </li>
                                                                    ))}
                                                                </ol>
                                                            )}
                                                        </div>
                                                    </Td>
                                                </Tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </Tbody>
                        ))}
                    </Table>
                </Panel>
            )}
        </AdminPage>
    );
}
