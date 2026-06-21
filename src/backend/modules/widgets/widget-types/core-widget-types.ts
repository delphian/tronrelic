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
    WidgetDataFetcher
} from '@/types';

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
            description: 'Raw HTML or plain text to render in the zone.'
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
 * the component ticks it client-side.
 *
 * @param _route - Unused; the clock row is route-independent.
 * @param _params - Unused; the clock row is route-independent.
 * @param placement - Placement context carrying the operator config.
 * @returns The normalized zone list and hour-format flag for the component.
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

    return { zones, hour12 };
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
        stats: IBlockTickerStats;
    } | null;
}

/**
 * Dependencies the core widget-type catalog needs to build its fetchers.
 *
 * Only the block-ticker fetcher consumes anything here — it resolves the
 * blockchain service from the registry at fetch time. Passing the
 * registry (rather than the service itself) keeps resolution lazy so the
 * catalog builds regardless of module init order; `'blockchain'` is
 * published during bootstrap and is always present by the time a page
 * renders.
 */
export interface ICoreWidgetTypeDeps {
    /** Service registry used to resolve `'blockchain'` lazily per request. */
    serviceRegistry: IServiceRegistry;
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
 * Build the core widget-type catalog as plain registration inputs.
 *
 * A factory rather than a constant because the block-ticker fetcher needs
 * the service registry to read the latest block; raw-html and
 * world-clocks ignore `deps`. Descriptor minting happens inside
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
            id: BLOCK_TICKER_TYPE_ID,
            label: 'Block ticker',
            description:
                'Compact real-time row of latest-block metrics — block number, transactions, transfers, contracts, delegations, stakes, tokens, energy.',
            category: 'Blockchain',
            defaultDataFetcher: buildBlockTickerFetcher(deps)
        }
    ];
}
