/**
 * @fileoverview Tools landing page route.
 *
 * Thin wrapper rendering the ToolsLandingPage component. No SSR data fetching
 * needed — the landing page is a static grid of tool cards.
 */

import { ToolsLandingPage } from '../../../modules/tools';

export default function ToolsPage() {
    return <ToolsLandingPage />;
}
