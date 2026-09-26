/**
 * @fileoverview Core widget-type catalog as plain registration data.
 *
 * Single source of truth for every widget type the platform ships out
 * of the box, mirroring `zones/descriptors.ts`. `WidgetsModule.run()`
 * iterates this array and calls `widgetsService.registerType(input,
 * 'core')` for each, so core types flow through the same admission
 * path plugins use — no static-minting shortcut.
 *
 * `core:raw-html` is an operator-authored block of raw text or HTML. It
 * exists so admins can drop arbitrary footer/header content (links,
 * legal text, attribution, embeds) into any zone without shipping a
 * plugin. `core:world-clocks` renders a compact row of country-flag +
 * live time for a set of operator-configured time zones. Both read their
 * SSR payload straight from the placement's operator-editable
 * `instanceConfig`; their matching frontend components (`RawHtmlWidget`,
 * `WorldClocksWidget`) render it. `core:block-ticker` is the real-time
 * blockchain status row: its SSR payload is the latest processed block,
 * read at fetch time from the `'blockchain'` service, after which the
 * `BlockTickerWidget` component takes over live updates over WebSocket.
 * `core:auth-button` is the sign-in / profile button; its SSR payload is
 * the administrator's sign-in image from the system configuration, and
 * `AuthButtonWidget` decides between sign-in and profile from the
 * visitor's session. `core:site-logo` and `core:main-menu` are the rest of
 * what used to be the fixed site header. The menu's items are per-visitor,
 * so they reach the component through `MenuSeedProvider`, never through
 * this cached payload.
 *
 * Because the block-ticker fetcher needs a runtime dependency the other
 * two do not, the catalog is a *factory* — `buildCoreWidgetTypeDescriptors`
 * — rather than a static array. `WidgetsModule.run()` calls it with the
 * service registry so the ticker fetcher can resolve `'blockchain'`
 * lazily per request (sidestepping module init-order). raw-html and
 * world-clocks ignore the dependency.
 *
 * Adding a new core type requires editing this file *and* registering a
 * matching frontend component in `widgets.core.ts` — the descriptor and
 * its render component must move together so the registry stays honest
 * about what can actually render.
 *
 * @see {@link ../../../../docs/system/system.md} Widgets section.
 * @module backend/modules/widgets/widget-types/core-widget-types
 */

import type { JSONSchema7 } from 'json-schema';
import type {
    IRegisterWidgetTypeInput,
    IWidgetPlacementContext,
    IServiceRegistry,
    IBlockchainService,
    ISystemConfigService,
    IZoneLayoutConfig,
    ZoneFlexDirection,
    ZoneJustifyContent,
    ZoneAlignItems,
    ZoneFlexWrap,
    ZoneGapSize,
    WidgetDataFetcher,
    IAuthButtonLink
} from '@/types';
import { WIDGET_ICON_FORMAT } from '@/types';

/**
 * Widget-type id for the raw text/HTML block. Namespaced under `core:`
 * so it never collides with a plugin-declared id. The frontend
 * component registry (`widgets.core.ts`) keys its renderer on this same
 * string.
 */
export const RAW_HTML_TYPE_ID = 'core:raw-html';

/**
 * SSR payload the raw-html data fetcher returns and the frontend
 * `RawHtmlWidget` component consumes. Plain, JSON-serialisable so it
 * survives the resolver's round-trip check.
 */
export interface IRawHtmlWidgetData {
    /** Operator-authored content — raw HTML or plain text. */
    content: string;
    /** Render mode: `html` injects raw markup, `text` escapes it. */
    mode: 'html' | 'text';
}

/**
 * Resolve the raw-html SSR payload from the placement's instance
 * config.
 *
 * The content is operator-authored and stored per-placement in
 * `instanceConfig`, so the fetcher ignores route/params entirely and
 * reads the validated config the placement admin API already checked
 * against {@link RAW_HTML_CONFIG_SCHEMA}. Returning a typed,
 * already-serialisable object keeps the resolver's round-trip guard a
 * no-op. Defaults `mode` to `'html'` and `content` to an empty string
 * so a freshly-created placement with no config renders nothing rather
 * than throwing.
 *
 * @param _route - Unused; content is route-independent.
 * @param _params - Unused; content is route-independent.
 * @param placement - Placement context carrying the operator config.
 * @returns The content and render mode for the frontend component.
 */
async function fetchRawHtmlData(
    _route: string,
    _params: Record<string, string>,
    placement?: IWidgetPlacementContext
): Promise<IRawHtmlWidgetData> {
    const config = placement?.instanceConfig ?? {};
    const content = typeof config.content === 'string' ? config.content : '';
    const mode = config.mode === 'text' ? 'text' : 'html';

    return { content, mode };
}

/**
 * JSON Schema (Draft 7) for the raw-html placement's `instanceConfig`.
 *
 * The placement admin API compiles and enforces this on every create
 * and patch, so an operator cannot save a placement without `content`
 * or with an unknown field. `additionalProperties: false` keeps the
 * shape tight; the flat string/enum top level is the cleanest path for
 * the admin config form.
 */
export const RAW_HTML_CONFIG_SCHEMA: JSONSchema7 = {
    type: 'object',
    required: ['content'],
    additionalProperties: false,
    properties: {
        content: {
            type: 'string',
            title: 'Content',
            description: 'Raw HTML or plain text to render in the zone.',
            // Annotation only: AJV does not validate it. The placement form
            // reads it to offer a multiline editor instead of a one-line input.
            contentMediaType: 'text/html'
        },
        mode: {
            type: 'string',
            enum: ['html', 'text'],
            default: 'html',
            title: 'Render mode',
            description:
                "'html' injects the content as raw markup; 'text' renders it as escaped plain text with line breaks preserved."
        }
    }
};

/**
 * Widget-type id for the world-clocks row. Namespaced under `core:` so
 * it never collides with a plugin-declared id; the frontend component
 * registry (`widgets.core.ts`) keys its renderer on this same string.
 */
export const WORLD_CLOCKS_TYPE_ID = 'core:world-clocks';

/**
 * One configured clock in the world-clocks row. The pair of `timeZone`
 * and `countryCode` is deliberately decoupled because an IANA zone does
 * not map cleanly to a single country (zones span borders, countries
 * span zones), so the operator picks the flag explicitly rather than the
 * platform guessing it from the zone.
 */
export interface IWorldClockZone {
    /** IANA time-zone id the client formats the live time against, e.g. `Europe/London`. */
    timeZone: string;
    /** ISO 3166-1 alpha-2 country code selecting the flag, e.g. `GB`. */
    countryCode: string;
    /** Operator hover text; also the clock's accessible label. Optional — falls back to the zone id. */
    tooltip?: string;
}

/**
 * SSR payload the world-clocks data fetcher returns and the frontend
 * `WorldClocksWidget` consumes. Carries only the operator configuration,
 * never a computed time — the displayed time ticks live on the client
 * (timezone-correct rendering on the server would hydrate-mismatch the
 * client's clock), so the server ships the zone list and the component
 * formats the time after mount.
 */
export interface IWorldClocksWidgetData {
    /** Configured clocks, in operator-defined display order. */
    zones: IWorldClockZone[];
    /** Whether the client renders 12-hour (AM/PM) time; otherwise 24-hour. */
    hour12: boolean;
    /**
     * Row wrap behaviour. `nowrap` keeps a single horizontal row (the
     * widget is a flex child of its zone, whose min-content width would
     * otherwise collapse it to one clock and stack the rest vertically);
     * `wrap` lets the row reflow onto multiple lines on narrow hosts.
     */
    wrap: 'nowrap' | 'wrap';
    /** `justify-content` distributing the clocks across the widget width. */
    justify: 'flex-start' | 'center' | 'flex-end' | 'space-between';
    /** Token gap size between clocks (`sm`/`md`/`lg` → `--gap-*`). */
    gap: 'sm' | 'md' | 'lg';
}

/**
 * Resolve the world-clocks SSR payload from the placement's instance
 * config.
 *
 * Like raw-html, the configuration is operator-authored per placement,
 * so the fetcher ignores route/params and reads the `instanceConfig` the
 * placement admin API already validated against
 * {@link WORLD_CLOCKS_CONFIG_SCHEMA}. It still normalizes defensively —
 * coercing each zone's fields and dropping any entry missing a time zone
 * — so a malformed legacy placement degrades to fewer clocks rather than
 * throwing inside the resolver's round-trip. No time is computed here;
 * the component ticks it client-side. The layout fields (`wrap`,
 * `justify`, `gap`) are likewise normalized to their enum defaults so a
 * legacy placement saved before they existed renders as a single
 * left-aligned row rather than an undefined layout.
 *
 * @param _route - Unused; the clock row is route-independent.
 * @param _params - Unused; the clock row is route-independent.
 * @param placement - Placement context carrying the operator config.
 * @returns The normalized zone list, hour-format flag, and layout settings for the component.
 */
async function fetchWorldClocksData(
    _route: string,
    _params: Record<string, string>,
    placement?: IWidgetPlacementContext
): Promise<IWorldClocksWidgetData> {
    const config = placement?.instanceConfig ?? {};
    const rawZones = Array.isArray(config.zones) ? config.zones : [];

    const zones: IWorldClockZone[] = rawZones
        .filter((zone): zone is Record<string, unknown> =>
            typeof zone === 'object' && zone !== null)
        .map((zone) => ({
            timeZone: typeof zone.timeZone === 'string' ? zone.timeZone : '',
            countryCode:
                typeof zone.countryCode === 'string'
                    ? zone.countryCode.toUpperCase()
                    : '',
            tooltip: typeof zone.tooltip === 'string' ? zone.tooltip : ''
        }))
        .filter((zone) => zone.timeZone !== '');

    const hour12 = config.hour12 === true;
    const wrap = config.wrap === 'wrap' ? 'wrap' : 'nowrap';
    const justify =
        config.justify === 'center' ||
        config.justify === 'flex-end' ||
        config.justify === 'space-between'
            ? config.justify
            : 'flex-start';
    const gap = config.gap === 'sm' || config.gap === 'lg' ? config.gap : 'md';

    return { zones, hour12, wrap, justify, gap };
}

/**
 * JSON Schema (Draft 7) for the world-clocks placement's `instanceConfig`.
 *
 * The placement admin API compiles and enforces this on every create and
 * patch, so an operator cannot save a clock without a `timeZone` and
 * `countryCode`. `additionalProperties: false` at both levels keeps the
 * shape tight, and the per-field titles/descriptions drive the admin
 * config form.
 */
export const WORLD_CLOCKS_CONFIG_SCHEMA: JSONSchema7 = {
    type: 'object',
    required: ['zones'],
    additionalProperties: false,
    properties: {
        zones: {
            type: 'array',
            title: 'Clocks',
            description: 'Time zones to display, left to right.',
            items: {
                type: 'object',
                required: ['timeZone', 'countryCode'],
                additionalProperties: false,
                properties: {
                    timeZone: {
                        type: 'string',
                        title: 'IANA time zone',
                        description: 'e.g. Europe/London, Asia/Shanghai, America/New_York.'
                    },
                    countryCode: {
                        type: 'string',
                        title: 'Country code',
                        description: 'ISO 3166-1 alpha-2 code selecting the flag, e.g. GB.',
                        minLength: 2,
                        maxLength: 2
                    },
                    tooltip: {
                        type: 'string',
                        title: 'Tooltip',
                        description:
                            'Hover text shown over the flag and time; also the accessible label. Defaults to the time zone id.'
                    }
                }
            }
        },
        hour12: {
            type: 'boolean',
            default: false,
            title: '12-hour clock',
            description: 'Show AM/PM time instead of 24-hour.'
        },
        wrap: {
            type: 'string',
            enum: ['nowrap', 'wrap'],
            default: 'nowrap',
            title: 'Row wrapping',
            description:
                "'nowrap' keeps every clock on a single horizontal row; 'wrap' lets the row reflow onto multiple lines when it does not fit the host width."
        },
        justify: {
            type: 'string',
            enum: ['flex-start', 'center', 'flex-end', 'space-between'],
            default: 'flex-start',
            title: 'Horizontal alignment',
            description:
                'How the clocks distribute across the widget width: packed to the start, centred, packed to the end, or spread edge to edge.'
        },
        gap: {
            type: 'string',
            enum: ['sm', 'md', 'lg'],
            default: 'md',
            title: 'Spacing',
            description: 'Gap between adjacent clocks — small, medium, or large.'
        }
    }
};

/**
 * Widget-type id for the layout-group container. Namespaced under
 * `core:` so it never collides with a plugin-declared id. Unlike every
 * other widget type, this one has no frontend renderer in
 * `widgets.core.ts`: a layout group has no UI of its own — it is a
 * structural flex container the `WidgetZone` renderer special-cases,
 * drawing its nested children rather than looking up a component. The
 * backend still registers it as a normal type so operators can place it
 * and so the placement admin API validates its `instanceConfig`.
 */
export const LAYOUT_GROUP_TYPE_ID = 'core:layout-group';

/**
 * Flexbox default a layout group renders with before any operator
 * tuning — a stacked column, matching the historical look of an
 * untouched zone. The group fetcher fills any unset field from this so a
 * freshly-created container with empty config still has a complete,
 * renderable layout.
 */
const DEFAULT_GROUP_LAYOUT: IZoneLayoutConfig = {
    preset: 'column',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    flexWrap: 'nowrap',
    gap: 'md'
};

/**
 * Resolve the layout-group SSR payload from the placement's instance
 * config.
 *
 * A layout group ships no data of its own — its `instanceConfig` *is* an
 * {@link IZoneLayoutConfig}, and the fetcher's only job is to echo that
 * config (normalized to enum-valid values) as the widget `data` the
 * frontend reads to style the nested flex container. Normalizing here —
 * rather than trusting the stored blob — means a legacy or hand-edited
 * placement degrades to the column default instead of emitting an
 * invalid `flex-direction`. The children themselves are attached by the
 * resolver from `parentId`, not by this fetcher.
 *
 * @param _route - Unused; group layout is route-independent.
 * @param _params - Unused; group layout is route-independent.
 * @param placement - Placement context carrying the operator config.
 * @returns The normalized flexbox layout for the frontend container.
 */
async function fetchLayoutGroupData(
    _route: string,
    _params: Record<string, string>,
    placement?: IWidgetPlacementContext
): Promise<IZoneLayoutConfig> {
    const config = placement?.instanceConfig ?? {};

    const flexDirection: ZoneFlexDirection =
        config.flexDirection === 'row' ||
        config.flexDirection === 'row-reverse' ||
        config.flexDirection === 'column' ||
        config.flexDirection === 'column-reverse'
            ? config.flexDirection
            : DEFAULT_GROUP_LAYOUT.flexDirection;

    const justifyContent: ZoneJustifyContent =
        config.justifyContent === 'flex-start' ||
        config.justifyContent === 'center' ||
        config.justifyContent === 'flex-end' ||
        config.justifyContent === 'space-between' ||
        config.justifyContent === 'space-around' ||
        config.justifyContent === 'space-evenly'
            ? config.justifyContent
            : DEFAULT_GROUP_LAYOUT.justifyContent;

    const alignItems: ZoneAlignItems =
        config.alignItems === 'stretch' ||
        config.alignItems === 'flex-start' ||
        config.alignItems === 'center' ||
        config.alignItems === 'flex-end' ||
        config.alignItems === 'baseline'
            ? config.alignItems
            : DEFAULT_GROUP_LAYOUT.alignItems;

    const flexWrap: ZoneFlexWrap = config.flexWrap === 'wrap' ? 'wrap' : 'nowrap';

    const gap: ZoneGapSize =
        config.gap === 'none' || config.gap === 'sm' || config.gap === 'md' || config.gap === 'lg'
            ? config.gap
            : DEFAULT_GROUP_LAYOUT.gap;

    // Collapse breakpoint is optional; normalize to a known value or omit
    // it entirely (the renderer treats an absent value as 'never', so a
    // legacy container with no collapse setting keeps its row at every
    // width).
    const collapseBelow: IZoneLayoutConfig['collapseBelow'] | undefined =
        config.collapseBelow === 'mobile-sm' ||
        config.collapseBelow === 'mobile-md' ||
        config.collapseBelow === 'mobile-lg' ||
        config.collapseBelow === 'tablet' ||
        config.collapseBelow === 'desktop' ||
        config.collapseBelow === 'never'
            ? config.collapseBelow
            : undefined;

    return { flexDirection, justifyContent, alignItems, flexWrap, gap, collapseBelow };
}

/**
 * JSON Schema (Draft 7) for the layout-group placement's
 * `instanceConfig`.
 *
 * Mirrors the `IZoneLayoutConfig` flex fields the per-zone layout editor
 * already produces, so the admin UI can reuse that same control to edit
 * a container. Every field is optional with an enum and default —
 * `additionalProperties: false` keeps the shape tight while letting an
 * operator save a bare container that falls back to the column default.
 * `preset` is accepted (UI sugar) but the renderer ignores it.
 */
export const LAYOUT_GROUP_CONFIG_SCHEMA: JSONSchema7 = {
    type: 'object',
    additionalProperties: false,
    properties: {
        preset: {
            type: 'string',
            enum: ['row-left', 'row-center', 'row-between', 'row-right', 'row-wrap', 'column', 'custom'],
            title: 'Layout preset',
            description: 'One-click arrangement the editor last applied; the renderer ignores it and uses the explicit flex fields.'
        },
        flexDirection: {
            type: 'string',
            enum: ['row', 'row-reverse', 'column', 'column-reverse'],
            default: 'column',
            title: 'Direction',
            description: 'Main-axis orientation of the grouped widgets.'
        },
        justifyContent: {
            type: 'string',
            enum: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
            default: 'flex-start',
            title: 'Justify',
            description: 'Distribution of widgets along the main axis.'
        },
        alignItems: {
            type: 'string',
            enum: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
            default: 'stretch',
            title: 'Align',
            description: 'Alignment of widgets along the cross axis.'
        },
        flexWrap: {
            type: 'string',
            enum: ['nowrap', 'wrap'],
            default: 'nowrap',
            title: 'Wrap',
            description: "'wrap' lets the grouped widgets reflow onto multiple lines."
        },
        gap: {
            type: 'string',
            enum: ['none', 'sm', 'md', 'lg'],
            default: 'md',
            title: 'Gap',
            description: 'Spacing between grouped widgets, mapped to the --gap-* tokens.'
        },
        collapseBelow: {
            type: 'string',
            enum: ['never', 'mobile-sm', 'mobile-md', 'mobile-lg', 'tablet', 'desktop'],
            default: 'never',
            title: 'Collapse below',
            description:
                'Stack the grouped widgets into a single column when the group is narrower than this breakpoint (measured against the group\'s own width, not the screen). Widths reset to full when collapsed. "never" keeps the row at every width.'
        }
    }
};

/**
 * Widget-type id for the real-time blockchain status ticker. Namespaced
 * under `core:` so it never collides with a plugin-declared id; the
 * frontend component registry (`widgets.core.ts`) keys its renderer on
 * this same string.
 */
export const BLOCK_TICKER_TYPE_ID = 'core:block-ticker';

/**
 * One block's stats in the ticker SSR payload. Mirrors the frontend
 * `BlockStatSnapshot` so the payload casts cleanly into the
 * `BlockTicker` component's `initialBlock` prop without a second shape.
 */
interface IBlockTickerStats {
    transactions: number;
    transfers: number;
    contractCalls: number;
    delegations: number;
    stakes: number;
    tokenCreations: number;
    internalTransactions: number;
    totalEnergyUsed: number;
    totalEnergyCost: number;
    totalBandwidthUsed: number;
}

/**
 * SSR payload the block-ticker data fetcher returns and the frontend
 * `BlockTickerWidget` consumes. The `block` is the latest processed block
 * (or `null` when none has been indexed yet) — wrapped in an object,
 * never returned bare, so the resolver always keeps the placement (a bare
 * `null` would make the resolver drop the widget, and the component would
 * never mount to receive the live `block:new` updates that fill an empty
 * initial state).
 */
export interface IBlockTickerWidgetData {
    /** Latest processed block summary, or null when none indexed yet. */
    block: {
        blockNumber: number;
        timestamp: string;
        transactionCount: number;
        /**
         * Whether the block's receipt-derived stats were measured. Mirrors
         * `receiptsFetched` on the block document so the server-rendered ticker
         * applies the same completeness check the live `block:new` path does.
         */
        receiptsFetched: boolean;
        stats: IBlockTickerStats;
    } | null;
}

/**
 * Dependencies the core widget-type catalog needs to build its fetchers.
 *
 * The block-ticker and network-activity fetchers resolve the blockchain
 * service from the registry at fetch time. Passing the registry (rather
 * than the service itself) keeps resolution lazy so the catalog builds
 * regardless of module init order; `'blockchain'` is published during
 * bootstrap and is always present by the time a page renders. The
 * auth-button fetcher reads the administrator's sign-in button image from
 * the system configuration.
 */
export interface ICoreWidgetTypeDeps {
    /** Service registry used to resolve `'blockchain'` lazily per request. */
    serviceRegistry: IServiceRegistry;
    /**
     * System configuration, read by the auth-button fetcher for the sign-in
     * button image an administrator chose on the Configuration tab of
     * `/system/system`. Injected rather than resolved from the singleton so a
     * test can supply its own.
     */
    systemConfig: ISystemConfigService;
}

/**
 * Build the block-ticker SSR data fetcher bound to the service registry.
 *
 * Resolves `'blockchain'` and reads the latest processed block, mapping
 * it to the serialisable {@link IBlockTickerWidgetData} the frontend
 * component renders. Never throws and never returns bare null: on a
 * missing service, an empty database, or any error it yields
 * `{ block: null }` so the widget still mounts and hydrates to live
 * updates. The fetcher ignores route/params — the ticker is global.
 *
 * @param deps - Carries the service registry for lazy `'blockchain'` lookup.
 * @returns A {@link WidgetDataFetcher} producing the ticker's SSR payload.
 */
function buildBlockTickerFetcher(deps: ICoreWidgetTypeDeps): WidgetDataFetcher {
    return async (): Promise<IBlockTickerWidgetData> => {
        try {
            const blockchain = deps.serviceRegistry.get<IBlockchainService>('blockchain');
            const block = blockchain ? await blockchain.getLatestBlock() : null;
            if (!block) {
                return { block: null };
            }

            const timestamp =
                block.timestamp instanceof Date
                    ? block.timestamp.toISOString()
                    : new Date(block.timestamp).toISOString();

            return {
                block: {
                    blockNumber: block.blockNumber,
                    timestamp,
                    transactionCount: block.transactionCount,
                    // Blocks indexed before the flag existed carry no value, and
                    // their receipts were never fetched, so absent reads false.
                    receiptsFetched: block.receiptsFetched === true,
                    stats: {
                        transactions: block.transactionCount,
                        transfers: block.stats.transfers,
                        contractCalls: block.stats.contractCalls,
                        delegations: block.stats.delegations,
                        stakes: block.stats.stakes,
                        tokenCreations: block.stats.tokenCreations,
                        internalTransactions: block.stats.internalTransactions,
                        totalEnergyUsed: block.stats.totalEnergyUsed,
                        totalEnergyCost: block.stats.totalEnergyCost,
                        totalBandwidthUsed: block.stats.totalBandwidthUsed
                    }
                }
            };
        } catch {
            return { block: null };
        }
    };
}

/**
 * Widget-type id for the network-activity overview chart. Namespaced under
 * `core:` so it never collides with a plugin-declared id; the frontend
 * component registry (`widgets.core.ts`) keys its renderer on this string.
 */
export const NETWORK_ACTIVITY_TYPE_ID = 'core:network-activity';

/**
 * Window the network-activity fetcher falls back to when a placement carries
 * no `defaultWindow` override — the 7-day, 168-point overview. Typed as the
 * literal so it satisfies the window union without a cast.
 */
const NETWORK_ACTIVITY_DEFAULT_WINDOW = '7d';

/**
 * One bucket in the network-activity SSR payload. Mirrors the backend
 * `IOverviewTimeseriesPoint` and the frontend `NetworkActivityPoint` so the
 * payload casts cleanly without a second shape. `volume` is native TRX moved
 * by `TransferContract` transfers (TRC20/USDT value is excluded).
 */
export interface INetworkActivityPoint {
    /** ISO 8601 timestamp marking the start of this bucket. */
    date: string;
    /** Total transactions of every contract type in the bucket. */
    transactions: number;
    /** Native `TransferContract` transfers in the bucket. */
    transfers: number;
    /** Summed native TRX moved by those transfers. */
    volume: number;
}

/**
 * SSR payload the network-activity data fetcher returns and the frontend
 * `NetworkActivityWidget` consumes. Carries the resolved window plus the
 * pre-fetched series so the widget renders immediately and refetches only on a
 * window change.
 */
export interface INetworkActivityWidgetData {
    /** Window the series was fetched for. */
    window: '1h' | '24h' | '7d';
    /** Pre-fetched buckets, chronologically sorted. */
    points: INetworkActivityPoint[];
}

/**
 * Build the network-activity SSR data fetcher bound to the service registry.
 *
 * Resolves `'blockchain'` lazily and reads the combined overview series for
 * the placement's configured window. Never throws and never returns bare null:
 * on a missing service or any error it yields an empty series for the resolved
 * window so the widget still mounts and refetches live after hydration. The
 * window is normalized defensively — an unrecognised stored value degrades to
 * the 7-day default rather than reaching the service with junk.
 *
 * @param deps - Carries the service registry for lazy `'blockchain'` lookup.
 * @returns A {@link WidgetDataFetcher} producing the overview SSR payload.
 */
function buildNetworkActivityFetcher(deps: ICoreWidgetTypeDeps): WidgetDataFetcher {
    return async (_route, _params, placement): Promise<INetworkActivityWidgetData> => {
        const config = placement?.instanceConfig ?? {};
        const window: '1h' | '24h' | '7d' =
            config.defaultWindow === '1h' || config.defaultWindow === '24h' || config.defaultWindow === '7d'
                ? config.defaultWindow
                : NETWORK_ACTIVITY_DEFAULT_WINDOW;

        try {
            const blockchain = deps.serviceRegistry.get<IBlockchainService>('blockchain');
            const points = blockchain ? await blockchain.getOverviewTimeseries(window) : [];
            return { window, points };
        } catch {
            return { window, points: [] };
        }
    };
}

/**
 * JSON Schema (Draft 7) for the network-activity placement's `instanceConfig`.
 *
 * Every field is optional with an enum/default so an operator can place the
 * widget with no configuration. `title` overrides the chart heading;
 * `defaultWindow` seeds the initial window toggle; `display` selects chart
 * density ('normal' full chrome vs. 'widget' compact sparkline). `rotate` and
 * `rotateSeconds` drive the client-side metric auto-rotation — the component
 * reads all of these off `instanceConfig` directly, so they never touch the
 * SSR data fetcher.
 */
export const NETWORK_ACTIVITY_CONFIG_SCHEMA: JSONSchema7 = {
    type: 'object',
    additionalProperties: false,
    properties: {
        title: {
            type: 'string',
            title: 'Title',
            description: 'Heading rendered above the chart. Defaults to no heading.'
        },
        defaultWindow: {
            type: 'string',
            enum: ['1h', '24h', '7d'],
            default: '7d',
            title: 'Default window',
            description: 'Time window shown on first render: 1 hour, 24 hours, or 7 days.'
        },
        display: {
            type: 'string',
            enum: ['normal', 'widget'],
            default: 'normal',
            title: 'Display density',
            description: "'normal' shows axes, legend, and tooltips; 'widget' is a compact sparkline."
        },
        rotate: {
            type: 'boolean',
            default: false,
            title: 'Auto-rotate metric',
            description:
                'Cycle the chart through transactions, transfers, and volume on a timer until the visitor clicks a metric, which stops rotation for the rest of the session.'
        },
        rotateSeconds: {
            type: 'integer',
            minimum: 10,
            maximum: 300,
            default: 30,
            title: 'Rotation interval (seconds)',
            description:
                'Seconds each metric is shown before advancing. Only applies when auto-rotate is enabled. Bounded 10–300.'
        }
    }
};

/**
 * Widget-type id for the sign-in / profile button. Namespaced under
 * `core:` so it never collides with a plugin-declared id; the frontend
 * component registry (`widgets.core.ts`) keys its renderer on this string.
 */
export const AUTH_BUTTON_TYPE_ID = 'core:auth-button';

/**
 * SSR payload the auth-button data fetcher returns and the frontend
 * `AuthButtonWidget` consumes.
 *
 * It carries the site-wide branding and the placement's tray settings, never
 * anything about the visitor. Whether the visitor is signed in, and so which
 * links they see, comes from the session the root layout already resolved
 * and seeded into `SessionProvider`, so the payload is the same for every
 * visitor and is safe under the per-route widget cache, whose key holds
 * nothing about who is asking.
 */
export interface IAuthButtonWidgetData {
    /**
     * Image an administrator chose to show in place of the text button, or
     * null to keep the default "Sign in" button and identity pill.
     */
    imageUrl: string | null;
    /** Links shown in the slide-out tray; empty keeps the button's default click. */
    links: IAuthButtonLink[];
    /** Which way the tray slides out of the button. */
    direction: 'right' | 'down';
    /** Opacity of the tray's background as a percentage, so the page shows through it. */
    opacity: number;
}

/** Most links one tray may hold, so the tray stays a short list rather than a menu. */
const AUTH_BUTTON_MAX_LINKS = 12;

/** Tray background opacity, in percent, used when the placement sets none. */
const AUTH_BUTTON_DEFAULT_OPACITY = 85;

/**
 * Lowest tray opacity an operator may choose. Below this the link labels
 * lose contrast against whatever page content sits behind the tray.
 */
const AUTH_BUTTON_MIN_OPACITY = 40;

/**
 * Destinations a tray link may point at: a root-relative path, or an
 * absolute http(s) URL. A protocol-relative `//host` path is excluded because
 * it leaves the site while reading like an internal link. `/\host` is
 * excluded for the same reason: browsers read a backslash as a forward slash
 * in an http(s) URL, so it resolves to `//host`. Every other scheme is
 * excluded because `javascript:` in an href runs script. The schema carries
 * the same pattern so the API refuses what this drops.
 */
const AUTH_BUTTON_LINK_URL_PATTERN = '^(/(?![/\\\\])\\S*|https?://\\S+)$';

/**
 * JSON Schema (Draft 7) for the auth-button placement's `instanceConfig`.
 *
 * The image stays a site-wide branding setting on `/system/system`. What
 * varies per placement is the slide-out tray: its links, the direction it
 * opens, and how transparent it is. Each link's `icon` declares the
 * {@link WIDGET_ICON_FORMAT} format, which makes the placement form offer the
 * icon picker instead of a text box and makes the API reject a value that
 * cannot be an icon name. `additionalProperties: false` at both levels
 * rejects any stray key an API caller sends.
 */
export const AUTH_BUTTON_CONFIG_SCHEMA: JSONSchema7 = {
    type: 'object',
    additionalProperties: false,
    properties: {
        direction: {
            type: 'string',
            enum: ['right', 'down'],
            default: 'right',
            title: 'Slide-out direction',
            description:
                'Which way the links slide out of the button. Right opens beside the button and falls back to down when the screen has no room on that side.'
        },
        opacity: {
            type: 'integer',
            minimum: AUTH_BUTTON_MIN_OPACITY,
            maximum: 100,
            default: AUTH_BUTTON_DEFAULT_OPACITY,
            title: 'Tray opacity (%)',
            description: `How solid the tray behind the links is. 100 is fully solid; lower lets the page show through. Bounded ${AUTH_BUTTON_MIN_OPACITY}–100.`
        },
        links: {
            type: 'array',
            title: 'Links',
            description:
                'Links that slide out when the button is clicked. With none, the button signs visitors in or opens their profile as usual. A signed-out visitor who can see a link gets a Sign in entry at the start of the tray.',
            maxItems: AUTH_BUTTON_MAX_LINKS,
            items: {
                type: 'object',
                required: ['icon', 'label', 'url'],
                additionalProperties: false,
                properties: {
                    icon: {
                        type: 'string',
                        format: WIDGET_ICON_FORMAT.name,
                        title: 'Icon',
                        description: 'Icon drawn beside the label.'
                    },
                    label: {
                        type: 'string',
                        title: 'Text',
                        description: 'Text of the link.',
                        minLength: 1,
                        maxLength: 40,
                        // At least one visible character. The fetcher trims
                        // the label and drops a link left blank, so a
                        // whitespace-only label is refused here instead of
                        // being saved and then never shown.
                        pattern: '\\S'
                    },
                    url: {
                        type: 'string',
                        title: 'URL',
                        description: 'A path on this site such as /profile, or a full https:// address.',
                        pattern: AUTH_BUTTON_LINK_URL_PATTERN,
                        maxLength: 2048
                    },
                    audience: {
                        type: 'string',
                        enum: ['everyone', 'signed-in', 'signed-out'],
                        default: 'everyone',
                        title: 'Shown to',
                        description: 'Which visitors see this link.'
                    }
                }
            }
        }
    }
};

/**
 * Read the placement's tray links into their SSR shape.
 *
 * The placement API already validated them against
 * {@link AUTH_BUTTON_CONFIG_SCHEMA}, but a row written before the schema
 * existed, or edited in the database by hand, may not match it. Each entry is
 * therefore checked again and dropped when it is not an object, lacks a label,
 * names an icon that cannot exist, or points somewhere the pattern refuses —
 * a bad row costs one link rather than the whole button.
 *
 * @param raw - The `links` value from the placement's instance config.
 * @returns The usable links, in the operator's order, capped at the maximum.
 */
function normalizeAuthButtonLinks(raw: unknown): IAuthButtonLink[] {
    const entries = Array.isArray(raw) ? raw : [];
    const iconPattern = new RegExp(WIDGET_ICON_FORMAT.pattern);
    const urlPattern = new RegExp(AUTH_BUTTON_LINK_URL_PATTERN);

    const links = entries
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .map((entry): IAuthButtonLink => ({
            icon: typeof entry.icon === 'string' ? entry.icon : '',
            label: typeof entry.label === 'string' ? entry.label.trim() : '',
            url: typeof entry.url === 'string' ? entry.url.trim() : '',
            audience: entry.audience === 'signed-in' || entry.audience === 'signed-out' ? entry.audience : 'everyone'
        }))
        .filter(link => link.label !== '' && iconPattern.test(link.icon) && urlPattern.test(link.url))
        .slice(0, AUTH_BUTTON_MAX_LINKS);

    return links;
}

/**
 * Build the auth-button SSR data fetcher bound to the system configuration.
 *
 * Reads the administrator's sign-in button image, so the server renders
 * the image in the first HTML response and the button never switches from
 * text to image after the page loads, and reads the placement's tray
 * settings so the tray is ready the moment the button is clicked. Never
 * throws and never returns bare null: a configuration read that fails yields
 * `imageUrl: null`, so the default text button still renders rather than the
 * widget disappearing and leaving the site with no way to sign in. The
 * fetcher ignores route and params — the button is the same on every page.
 *
 * @param deps - Carries the system configuration service.
 * @returns A {@link WidgetDataFetcher} producing the button's SSR payload.
 */
function buildAuthButtonFetcher(deps: ICoreWidgetTypeDeps): WidgetDataFetcher {
    return async (_route, _params, placement): Promise<IAuthButtonWidgetData> => {
        let imageUrl: string | null = null;
        try {
            const config = await deps.systemConfig.getConfig();
            // Documents written before the field existed read back without
            // it, and an empty string means the same as no image.
            imageUrl = typeof config.authButtonImageUrl === 'string' && config.authButtonImageUrl !== ''
                ? config.authButtonImageUrl
                : null;
        } catch {
            imageUrl = null;
        }

        const instanceConfig = placement?.instanceConfig ?? {};
        const direction = instanceConfig.direction === 'down' ? 'down' : 'right';
        const configuredOpacity = instanceConfig.opacity;
        const opacity = typeof configuredOpacity === 'number' && Number.isFinite(configuredOpacity)
            ? Math.min(100, Math.max(AUTH_BUTTON_MIN_OPACITY, Math.round(configuredOpacity)))
            : AUTH_BUTTON_DEFAULT_OPACITY;
        const links = normalizeAuthButtonLinks(instanceConfig.links);

        return { imageUrl, links, direction, opacity };
    };
}

/**
 * Widget-type id for the site logo link. Namespaced under `core:` so it
 * never collides with a plugin-declared id; the frontend component
 * registry (`widgets.core.ts`) keys its renderer on this string.
 */
export const SITE_LOGO_TYPE_ID = 'core:site-logo';

/** Text the logo shows when the placement sets none. */
const SITE_LOGO_DEFAULT_TEXT = 'TronRelic';

/**
 * SSR payload the site-logo data fetcher returns and the frontend
 * `SiteLogoWidget` consumes.
 */
export interface ISiteLogoWidgetData {
    /** The wordmark shown in the logo link to the home page. */
    text: string;
}

/**
 * JSON Schema (Draft 7) for the site-logo placement's `instanceConfig`.
 * The one setting is the wordmark text, bounded so it stays a logo rather
 * than a paragraph.
 */
export const SITE_LOGO_CONFIG_SCHEMA: JSONSchema7 = {
    type: 'object',
    additionalProperties: false,
    properties: {
        text: {
            type: 'string',
            title: 'Logo text',
            description: `Wordmark shown in the link to the home page. Defaults to "${SITE_LOGO_DEFAULT_TEXT}".`,
            minLength: 1,
            maxLength: 60,
            default: SITE_LOGO_DEFAULT_TEXT
        }
    }
};

/**
 * Resolve the site-logo SSR payload from the placement's instance config.
 *
 * Falls back to the default wordmark when the placement carries no text,
 * or only whitespace, so a freshly placed logo is never an empty link.
 *
 * @param _route - Unused; the logo is the same on every page.
 * @param _params - Unused; the logo is the same on every page.
 * @param placement - Placement context carrying the operator config.
 * @returns The wordmark for the frontend component.
 */
async function fetchSiteLogoData(
    _route: string,
    _params: Record<string, string>,
    placement?: IWidgetPlacementContext
): Promise<ISiteLogoWidgetData> {
    const configured = placement?.instanceConfig?.text;
    const text = typeof configured === 'string' && configured.trim() !== '' ? configured.trim() : SITE_LOGO_DEFAULT_TEXT;

    return { text };
}

/**
 * Widget-type id for the main navigation menu. Namespaced under `core:`
 * so it never collides with a plugin-declared id; the frontend component
 * registry (`widgets.core.ts`) keys its renderer on this string.
 */
export const MAIN_MENU_TYPE_ID = 'core:main-menu';

/**
 * SSR payload the main-menu data fetcher returns and the frontend
 * `MainMenuWidget` consumes.
 *
 * The menu's items are deliberately not in it. The `main` tree depends on
 * who is asking — admins see the System container, anonymous visitors do
 * not — while widget data is cached per route with nothing about the
 * visitor in the key, so a tree here would show one visitor's menu to the
 * next. The root layout fetches the visitor's own tree on every request and
 * seeds it through `MenuSeedProvider` instead; this payload carries only
 * the operator's layout choice.
 */
export interface IMainMenuWidgetData {
    /** How the menu sits within the space its placement is given. */
    align: 'flex-start' | 'center' | 'flex-end';
}

/**
 * JSON Schema (Draft 7) for the main-menu placement's `instanceConfig`.
 */
export const MAIN_MENU_CONFIG_SCHEMA: JSONSchema7 = {
    type: 'object',
    additionalProperties: false,
    properties: {
        align: {
            type: 'string',
            enum: ['flex-start', 'center', 'flex-end'],
            default: 'flex-end',
            title: 'Alignment',
            description:
                'Where the menu items sit within the width the placement is given: the start, the centre, or the end. The end matches the old header, which right-aligned the menu. Give the placement a width weight so the menu has room to lay out its items before folding the rest into "More".'
        }
    }
};

/**
 * Resolve the main-menu SSR payload from the placement's instance config.
 *
 * @param _route - Unused; the active item is worked out on the client from the pathname.
 * @param _params - Unused.
 * @param placement - Placement context carrying the operator config.
 * @returns The alignment for the frontend component, defaulting to the end.
 */
async function fetchMainMenuData(
    _route: string,
    _params: Record<string, string>,
    placement?: IWidgetPlacementContext
): Promise<IMainMenuWidgetData> {
    const configured = placement?.instanceConfig?.align;
    const align = configured === 'flex-start' || configured === 'center' ? configured : 'flex-end';

    return { align };
}

/**
 * Build the core widget-type catalog as plain registration inputs.
 *
 * A factory rather than a constant because the block-ticker and
 * network-activity fetchers need the service registry, and the auth-button
 * fetcher needs the system configuration; raw-html, world-clocks, and
 * layout-group ignore `deps`. Descriptor minting happens inside
 * `WidgetsService.registerType` when `WidgetsModule.run()` iterates the
 * returned list at bootstrap.
 *
 * @param deps - Runtime dependencies forwarded to fetchers that need them.
 * @returns The ordered list of core widget-type registration inputs.
 */
export function buildCoreWidgetTypeDescriptors(
    deps: ICoreWidgetTypeDeps
): ReadonlyArray<IRegisterWidgetTypeInput> {
    return [
        {
            id: RAW_HTML_TYPE_ID,
            label: 'Raw text / HTML',
            description:
                'Operator-authored block of raw HTML or plain text. Drop links, legal text, attribution, or embeds into any zone without a plugin.',
            category: 'Content',
            defaultDataFetcher: fetchRawHtmlData,
            configSchema: RAW_HTML_CONFIG_SCHEMA
        },
        {
            id: WORLD_CLOCKS_TYPE_ID,
            label: 'World clocks',
            description:
                'Compact row of country flags with live local time for a set of configured time zones.',
            category: 'Content',
            defaultDataFetcher: fetchWorldClocksData,
            configSchema: WORLD_CLOCKS_CONFIG_SCHEMA
        },
        {
            id: LAYOUT_GROUP_TYPE_ID,
            label: 'Layout group',
            description:
                'Structural container that arranges the widgets dropped into it with their own flexbox layout — group a row of widgets inside a column zone, or vice versa.',
            category: 'Layout',
            defaultDataFetcher: fetchLayoutGroupData,
            configSchema: LAYOUT_GROUP_CONFIG_SCHEMA
        },
        {
            id: BLOCK_TICKER_TYPE_ID,
            label: 'Block ticker',
            description:
                'Compact real-time row of latest-block metrics — block number, transactions, transfers, contracts, delegations, stakes, tokens, energy.',
            category: 'Blockchain',
            defaultDataFetcher: buildBlockTickerFetcher(deps)
        },
        {
            id: NETWORK_ACTIVITY_TYPE_ID,
            label: 'Network activity',
            description:
                'Hourly TRON network activity chart — transactions, native transfers, and native TRX transfer volume over a 1h/24h/7d window.',
            category: 'Blockchain',
            defaultDataFetcher: buildNetworkActivityFetcher(deps),
            configSchema: NETWORK_ACTIVITY_CONFIG_SCHEMA
        },
        {
            id: AUTH_BUTTON_TYPE_ID,
            label: 'Sign-in button',
            description:
                'Sign-in button for signed-out visitors; a short identity pill linking to /profile for signed-in ones, where sign-out lives. Shows the sign-in image chosen on /system/system when one is set. Optionally slides out a tray of links, each with an icon, text, and URL.',
            category: 'Account',
            defaultDataFetcher: buildAuthButtonFetcher(deps),
            configSchema: AUTH_BUTTON_CONFIG_SCHEMA
        },
        {
            id: SITE_LOGO_TYPE_ID,
            label: 'Site logo',
            description: 'The site wordmark, linking to the home page.',
            category: 'Navigation',
            defaultDataFetcher: fetchSiteLogoData,
            configSchema: SITE_LOGO_CONFIG_SCHEMA
        },
        {
            id: MAIN_MENU_TYPE_ID,
            label: 'Main menu',
            description:
                'The site navigation from the main menu namespace (edited at /system/menu), with each visitor seeing only the items they may open. Folds items that do not fit into "More".',
            category: 'Navigation',
            defaultDataFetcher: fetchMainMenuData,
            configSchema: MAIN_MENU_CONFIG_SCHEMA
        }
    ];
}
