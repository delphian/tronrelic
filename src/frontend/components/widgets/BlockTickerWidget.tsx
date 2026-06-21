/**
 * @fileoverview Core "block ticker" widget renderer.
 *
 * Renders the real-time blockchain status row as a placeable widget. The
 * ticker used to be hardcoded into the root layout; making it a core
 * widget type lets operators position it (and sit it beside other
 * widgets) from /system/widgets like any other widget.
 *
 * SSR + Live Updates: the `core:block-ticker` data fetcher ships the
 * latest processed block as `data.block`, which this wrapper hands to the
 * existing {@link BlockTicker} as `initialBlock`. `BlockTicker` already
 * owns the pattern — it renders the SSR block immediately, then prefers
 * live Redux state fed by the `block:new` WebSocket event after
 * hydration. This component adds no state of its own; it is the thin seam
 * between the widget data envelope and the ticker's prop.
 *
 * @module frontend/components/widgets/BlockTickerWidget
 */

'use client';

import type { IWidgetComponentProps } from '@/types';
import { BlockTicker } from '../layout/BlockTicker';
import type { BlockSummary } from '../../features/blockchain/slice';

/**
 * SSR payload shape produced by the `core:block-ticker` data fetcher.
 * Mirrors `IBlockTickerWidgetData` on the backend; `block` is the latest
 * processed block or null when none has been indexed yet.
 */
interface IBlockTickerData {
    /** Latest processed block summary, or null when none indexed yet. */
    block?: BlockSummary | null;
}

/**
 * Block-ticker widget: the real-time blockchain status row.
 *
 * @param props - Widget component props; only the SSR `data` is consumed.
 *   The ticker needs no plugin context, route, or instance config.
 * @returns The ticker bar (which itself returns null until a block exists).
 */
export function BlockTickerWidget({ data }: IWidgetComponentProps) {
    const { block = null } = (data ?? {}) as IBlockTickerData;

    return <BlockTicker initialBlock={block} />;
}
