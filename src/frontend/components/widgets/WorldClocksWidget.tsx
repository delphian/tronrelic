/**
 * @fileoverview Core "world clocks" widget renderer.
 *
 * Renders the operator-configured clock row carried by the
 * `core:world-clocks` widget type: a compact, horizontally-wrapping
 * sequence of country flag + live local time, one cell per time zone.
 *
 * SSR + Live Updates: the flags and structure derive entirely from the
 * SSR `data` prop and render on the server with no hydration risk. The
 * time is the single live piece and is deliberately client-only —
 * formatting a zone's time on the server (UTC container) and again on the
 * client would mismatch by whatever seconds elapsed between renders, so a
 * mount gate shows an em-dash placeholder during SSR and the first client
 * render (identical HTML on both sides), then one minute-aligned interval
 * ticks the shared `now` so every cell updates together. There is no
 * WebSocket subscription: the browser clock, not server events, drives the
 * update.
 *
 * Flags come from `country-flag-icons` as inline SVG components, chosen
 * over Unicode emoji flags because Windows does not render the emoji
 * regional-indicator glyphs (it shows the bare country code instead). The
 * flag lookup is isolated in {@link resolveFlag} so swapping the source —
 * e.g. to a curated subset to shrink the bundle — is a one-function change.
 *
 * @module frontend/components/widgets/WorldClocksWidget
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ComponentType, SVGProps } from 'react';
import * as FlagComponents from 'country-flag-icons/react/3x2';
import type { IWidgetComponentProps } from '@/types';
import styles from './WorldClocksWidget.module.scss';

/**
 * Shape of a country-flag SVG component from `country-flag-icons`. The
 * components spread arbitrary SVG props (className, aria-*) onto the root
 * `<svg>`, so the standard SVG prop type describes them.
 */
type FlagComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Runtime map of ISO 3166-1 alpha-2 code → flag component. The package
 * exports one named component per code; re-typing the namespace as a
 * record lets the widget look a flag up by the operator's runtime code
 * (unknown at build time, so it cannot be a static import).
 */
const flagRegistry = FlagComponents as unknown as Record<string, FlagComponent | undefined>;

/**
 * One configured clock. Redeclared locally because the frontend cannot
 * import backend module internals; mirrors `IWorldClockZone` in
 * `backend/modules/widgets/widget-types/core-widget-types.ts`.
 */
interface IWorldClockZone {
    /** IANA time-zone id the live time is formatted against. */
    timeZone: string;
    /** ISO 3166-1 alpha-2 country code selecting the flag. */
    countryCode: string;
    /** Operator hover text; also the cell's accessible label. */
    tooltip?: string;
}

/**
 * SSR payload shape produced by the `core:world-clocks` data fetcher.
 * Mirrors `IWorldClocksWidgetData`; redeclared locally for the same
 * frontend/backend isolation reason as {@link IWorldClockZone}.
 */
interface IWorldClocksData {
    /** Configured clocks in display order. */
    zones?: IWorldClockZone[];
    /** Render 12-hour (AM/PM) time when true, otherwise 24-hour. */
    hour12?: boolean;
}

/**
 * Resolve the flag component for a country code, or null when the code
 * is unknown so the cell degrades to time-only instead of throwing. The
 * single point of coupling to the flag library — change the source here.
 *
 * @param countryCode - ISO 3166-1 alpha-2 code; case-insensitive.
 * @returns The flag SVG component, or null when no flag matches.
 */
function resolveFlag(countryCode: string): FlagComponent | null {
    const flag = flagRegistry[countryCode.toUpperCase()] ?? null;
    return flag;
}

/**
 * Build a minute-precision time formatter bound to a zone, or null when
 * the zone id is invalid so the cell can render a dash rather than crash.
 * `hourCycle` is set explicitly (`h23`/`h12`) so 24-hour midnight reads
 * `00:00` rather than a locale-dependent `24:00`.
 *
 * @param timeZone - IANA zone id to format against.
 * @param hour12 - Whether to use a 12-hour cycle.
 * @returns A configured formatter, or null when the zone id is invalid.
 */
function buildFormatter(timeZone: string, hour12: boolean): Intl.DateTimeFormat | null {
    let formatter: Intl.DateTimeFormat | null = null;

    try {
        formatter = new Intl.DateTimeFormat(undefined, {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: hour12 ? 'h12' : 'h23'
        });
    } catch {
        formatter = null;
    }

    return formatter;
}

/**
 * Render a single clock cell: country flag + live `HH:MM`, wrapped in a
 * list item whose `title` (mouse tooltip) and `aria-label` (screen
 * reader) both carry the operator text, falling back to the zone id. The
 * flag is marked decorative (`aria-hidden`) so the cell announces once,
 * via its label, rather than twice.
 *
 * Before the parent's mount gate provides a `now`, the time renders as an
 * em dash so the server and first client render agree.
 *
 * @param props.zone - The configured clock to render.
 * @param props.hour12 - Hour-format flag, threaded down from the widget.
 * @param props.now - The shared tick instant, or null before mount.
 * @returns The clock cell list item.
 */
function ClockCell({
    zone,
    hour12,
    now
}: {
    zone: IWorldClockZone;
    hour12: boolean;
    now: Date | null;
}) {
    const formatter = useMemo(
        () => buildFormatter(zone.timeZone, hour12),
        [zone.timeZone, hour12]
    );
    const Flag = resolveFlag(zone.countryCode);
    const label = zone.tooltip || zone.timeZone;
    const time = now && formatter ? formatter.format(now) : '—';

    return (
        <li className={styles.clock} title={label} aria-label={label}>
            {Flag ? <Flag className={styles.flag} aria-hidden /> : null}
            <span className={styles.time}>{time}</span>
        </li>
    );
}

/**
 * World-clocks widget: a compact, wrapping row of country flag + live
 * local time per operator-configured time zone. See the file overview for
 * the SSR + Live Updates and flag-source rationale.
 *
 * @param props - Widget component props; only the SSR `data` is consumed
 *   (the row needs no plugin context, route, or live socket).
 * @returns The clock row, or null when no zones are configured.
 */
export function WorldClocksWidget({ data }: IWidgetComponentProps) {
    const { zones = [], hour12 = false } = (data ?? {}) as IWorldClocksData;
    const [now, setNow] = useState<Date | null>(null);

    useEffect(() => {
        // Mount gate: set the first time only after hydration, then align
        // the recurring tick to the next minute boundary so every cell
        // rolls over on the minute instead of drifting from mount time.
        setNow(new Date());

        let intervalId: ReturnType<typeof setInterval> | undefined;
        const msUntilNextMinute = 60_000 - (Date.now() % 60_000);
        const timeoutId = setTimeout(() => {
            setNow(new Date());
            intervalId = setInterval(() => setNow(new Date()), 60_000);
        }, msUntilNextMinute);

        return () => {
            clearTimeout(timeoutId);
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, []);

    if (zones.length === 0) {
        return null;
    }

    return (
        <ul className={styles.clocks} aria-label="World clocks">
            {zones.map((zone, index) => (
                <ClockCell
                    key={`${zone.timeZone}-${index}`}
                    zone={zone}
                    hour12={hour12}
                    now={now}
                />
            ))}
        </ul>
    );
}
