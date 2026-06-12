import type { ComponentType } from 'react';
import type { Socket } from 'socket.io-client';

/**
 * User state exposed to frontend plugins.
 *
 * Mirrors the backend authorization surface so plugin gating reads the
 * same way on both sides: `isLoggedIn` is the primary gate (any
 * authenticated Better Auth account), `hasPrimaryWallet` is the single
 * wallet check, and `primaryWallet` is the proven primary address. A
 * present wallet is always signature-verified — the wallet store only
 * holds wallets proven by signature — so there is no separate
 * verified/unverified distinction.
 *
 * @example
 * ```typescript
 * const { isLoggedIn, hasPrimaryWallet, primaryWallet } = context.useUser();
 *
 * // Primary gate: any signed-in account
 * if (!isLoggedIn) {
 *     return <p>Please sign in to access this feature</p>;
 * }
 *
 * // Wallet-specific gate: requires a proven primary wallet
 * if (!hasPrimaryWallet) {
 *     return <p>Link a TRON wallet to use this feature</p>;
 * }
 * ```
 */
export interface IPluginUserState {
    /**
     * Better Auth account id. Null until the session resolves (anonymous
     * visitors and the pre-hydration window).
     */
    userId: string | null;

    /**
     * Primary gate — true when the visitor has an authenticated Better
     * Auth session (email-OTP / OAuth / passkey). Mirrors the backend
     * `isLoggedIn(req)` predicate. Use this for login-only gating.
     */
    isLoggedIn: boolean;

    /**
     * True when the account has a signature-proven primary wallet.
     * Mirrors the backend `hasPrimaryWallet(req)` predicate. Use this for
     * wallet-gated features — a present wallet is always verified.
     */
    hasPrimaryWallet: boolean;

    /**
     * The proven primary wallet address, or null when none is linked.
     */
    primaryWallet: string | null;

    /**
     * False until the Better Auth session has resolved. Use for loading
     * states before identity is known.
     */
    initialized: boolean;
}

/**
 * UI component library provided to frontend plugins.
 *
 * Contains commonly used UI components that plugins can use without importing
 * from the frontend app directly. This prevents cross-workspace import issues
 * and allows the frontend to evolve component APIs independently.
 */
export interface IUIComponents {
    /** Card container component for grouping related content */
    Card: ComponentType<{
        children?: React.ReactNode;
        tone?: 'default' | 'muted' | 'accent';
        padding?: 'sm' | 'md' | 'lg';
        elevated?: boolean;
        className?: string;
        style?: React.CSSProperties;
    }>;

    /** Badge component for labels and status indicators */
    Badge: ComponentType<{
        children?: React.ReactNode;
        tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
        title?: string;
        className?: string;
    }>;

    /** Loading skeleton placeholder component */
    Skeleton: ComponentType<{
        width?: string | number;
        height?: string | number;
        className?: string;
        style?: React.CSSProperties;
    }>;

    /** Button component for actions */
    Button: ComponentType<{
        children?: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
        loading?: boolean;
        variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning';
        size?: 'xs' | 'sm' | 'md' | 'lg';
        icon?: React.ReactNode;
        className?: string;
        type?: 'button' | 'submit' | 'reset';
        'aria-label'?: string;
    }>;

    /**
     * IconButton — borderless icon-only button for inline row actions.
     *
     * Use when a bordered `<Button>` with an icon would visually dominate
     * a dense row (table actions, response header copy, etc.). The hover
     * color follows `variant`. `aria-label` is required because no visible
     * text describes the action.
     */
    IconButton: ComponentType<{
        children?: React.ReactNode;
        /**
         * Click handler with full event access. The event parameter is
         * preserved (rather than narrowed to `() => void`) because this
         * primitive is designed for inline row actions where plugin code
         * commonly needs `event.stopPropagation()` to avoid firing an
         * enclosing row's click handler.
         */
        onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
        disabled?: boolean;
        variant?: 'ghost' | 'primary' | 'danger' | 'success';
        size?: 'sm' | 'md' | 'lg';
        className?: string;
        title?: string;
        type?: 'button' | 'submit' | 'reset';
        'aria-label': string;
    }>;

    /**
     * Switch — icon-rendered on/off toggle. Flips `on` state on click; the
     * color + icon reflect current state (right+success when on, left+muted
     * when off). Use for row-level boolean controls (tool enable/disable,
     * feature flag, notification on/off). Carries `role="switch"` +
     * `aria-checked` so assistive tech reads it as a toggle.
     */
    Switch: ComponentType<{
        on: boolean;
        onChange: (next: boolean) => void;
        /**
         * Optional raw click handler. Runs before `onChange`; calling
         * `event.preventDefault()` vetoes the toggle, and
         * `event.stopPropagation()` keeps the click from reaching an
         * enclosing row handler.
         */
        onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
        disabled?: boolean;
        size?: 'sm' | 'md' | 'lg';
        className?: string;
        title?: string;
        type?: 'button' | 'submit' | 'reset';
        'aria-label': string;
    }>;

    /** Input component for form fields */
    Input: ComponentType<{
        value?: string;
        onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
        onKeyDown?: (e: React.KeyboardEvent) => void;
        placeholder?: string;
        disabled?: boolean;
        required?: boolean;
        variant?: 'default' | 'ghost';
        type?: string;
        className?: string;
        id?: string;
        name?: string;
        min?: number;
        max?: number;
        step?: number;
        'aria-label'?: string;
    }>;

    /** Client-side time rendering component (prevents SSR hydration mismatches) */
    ClientTime: ComponentType<{
        date: Date | string | null | undefined;
        format?: 'time' | 'datetime' | 'date';
        fallback?: string;
    }>;

    /** Tooltip component for contextual help text */
    Tooltip: ComponentType<{
        content: string;
        children: React.ReactNode;
        placement?: 'top' | 'bottom';
    }>;

    /** Icon picker modal component for visual icon selection */
    IconPickerModal: ComponentType<{
        selectedIcon?: string;
        onSelect: (iconName: string) => void;
        onClose: () => void;
    }>;

    /**
     * Table wrapper matching the core `/system/*` admin tables.
     *
     * Compose with `Thead`, `Tbody`, `Tr`, `Th`, `Td` to get the same
     * visual treatment plugins see on the plugins admin page.
     */
    Table: ComponentType<{
        children?: React.ReactNode;
        variant?: 'default' | 'compact';
        className?: string;
        style?: React.CSSProperties;
    }>;

    /** Table header section. */
    Thead: ComponentType<{
        children?: React.ReactNode;
        className?: string;
    }>;

    /** Table body section. */
    Tbody: ComponentType<{
        children?: React.ReactNode;
        className?: string;
    }>;

    /**
     * Table row.
     *
     * `hasError` applies the error surface tone; `isExpanded` renders the
     * row with the muted "details drawer" background used by the plugins
     * admin table for its expanded rows.
     */
    Tr: ComponentType<{
        children?: React.ReactNode;
        hasError?: boolean;
        isExpanded?: boolean;
        onClick?: () => void;
        className?: string;
    }>;

    /**
     * Table header cell.
     *
     * `width="shrink"` sizes the column to content (for fixed-width
     * columns like status badges and action buttons); `width="expand"`
     * forces the column to fill remaining space.
     */
    Th: ComponentType<{
        children?: React.ReactNode;
        width?: 'auto' | 'shrink' | 'expand';
        colSpan?: number;
        rowSpan?: number;
        className?: string;
    }>;

    /**
     * Table data cell. `muted` dims the text for secondary metadata;
     * `colSpan` spans the cell across multiple columns (used by the
     * expanded details drawer).
     */
    Td: ComponentType<{
        children?: React.ReactNode;
        muted?: boolean;
        colSpan?: number;
        rowSpan?: number;
        className?: string;
    }>;
}

/**
 * Chart component library provided to frontend plugins.
 *
 * Provides data visualization components for analytics and dashboards.
 */
export interface IChartComponents {
    /** Line chart component for time-series data visualization */
    LineChart: ComponentType<{
        series: Array<{
            id: string;
            label: string;
            data: Array<{ date: string; value: number; max?: number; count?: number }>;
            color?: string;
            fill?: boolean;
        }>;
        yAxisFormatter?: (value: number) => string;
        xAxisFormatter?: (value: Date) => string;
        /** Custom formatter for the tooltip's date heading; falls back to xAxisFormatter. Lets the axis keep compact relative labels while the tooltip shows an absolute localized date. */
        tooltipDateFormatter?: (value: Date) => string;
        emptyLabel?: string;
        height?: number;
        className?: string;
        /** Fixed minimum date for X-axis (prevents auto-scaling when data is sparse) */
        minDate?: Date;
        /** Fixed maximum date for X-axis (prevents auto-scaling when data is sparse) */
        maxDate?: Date;
        /** Fixed minimum value for Y-axis (overrides auto-calculated minimum) */
        yAxisMin?: number;
        /** Fixed maximum value for Y-axis (overrides auto-calculated maximum) */
        yAxisMax?: number;
    }>;

    /**
     * Grouped column (bar) chart for categorical/time-bucketed totals.
     *
     * Renders one column per series for each shared category, grouped side by
     * side, and supports negative values below a zero baseline. The `mode` prop
     * selects density: `normal` paints axes, legend, and an interactive tooltip;
     * `widget` strips chrome to bars and baseline for a compact widget-zone fit.
     */
    BarChart: ComponentType<{
        series: Array<{
            id: string;
            label: string;
            data: Array<{ date: string; value: number; metadata?: Record<string, unknown> }>;
            color?: string;
        }>;
        /** Rendering density (default: 'normal') */
        mode?: 'normal' | 'widget';
        /** Chart height in pixels (default: 320 normal, 120 widget) */
        height?: number;
        yAxisFormatter?: (value: number) => string;
        xAxisFormatter?: (value: Date) => string;
        emptyLabel?: string;
        className?: string;
        /** Fixed minimum value for Y-axis (overrides auto-calculated minimum) */
        yAxisMin?: number;
        /** Fixed maximum value for Y-axis (overrides auto-calculated maximum) */
        yAxisMax?: number;
    }>;
}

/**
 * Serialized menu node consumed by the `SubMenu` layout component.
 *
 * Mirrors the wire shape the menu service emits (`GET /api/menu`) after JSON
 * serialization, so a plugin can pass the namespace tree it fetched via
 * `serverDataFetcher` straight through without remapping. All ids and the
 * `parent` reference are opaque strings.
 */
export interface ISubMenuItem {
    /** Stable node id. */
    _id: string;

    /** Display label for the tab. */
    label: string;

    /** Tab url; also the active-state key when paired with `activeUrl`. */
    url?: string;

    /** Optional lucide-react icon name. */
    icon?: string;

    /** Sort order within the row (ascending). */
    order: number;

    /** Parent node id, or null for a root-level tab. */
    parent?: string | null;

    /** Whether the tab renders; disabled tabs are filtered out. */
    enabled: boolean;

    /** Namespace the node belongs to. */
    namespace?: string;

    /** Group ids that gate visibility (any-of). */
    requiresGroups?: string[];

    /** Whether the node is admin-gated. */
    requiresAdmin?: boolean;

    /** Nested children, when the node is a container. */
    children?: ISubMenuItem[];
}

/**
 * Layout component library provided to frontend plugins.
 *
 * Contains structural layout components for building consistent page layouts.
 * These components provide TypeScript safety, IDE autocomplete, and encapsulated
 * responsive behavior that CSS utility classes cannot offer.
 */
export interface ILayoutComponents {
    /**
     * Page wrapper component with responsive gap spacing.
     *
     * Provides the primary page-level grid layout with design-system consistent gaps.
     * Responsive behavior reduces gap on mobile viewports.
     *
     * @example
     * ```tsx
     * <layout.Page>
     *   <layout.PageHeader title="Dashboard" subtitle="Overview" />
     *   <ui.Card>Content</ui.Card>
     * </layout.Page>
     * ```
     */
    Page: ComponentType<{
        children: React.ReactNode;
        className?: string;
    }>;

    /**
     * Page header component with title and optional subtitle.
     *
     * Renders a semantic header section with consistent typography and spacing.
     * Supports ReactNode for title/subtitle to allow skeleton loading states.
     *
     * @example
     * ```tsx
     * <layout.PageHeader
     *   title="Energy Markets"
     *   subtitle="Compare real-time pricing across platforms"
     * />
     * ```
     */
    PageHeader: ComponentType<{
        title: React.ReactNode;
        subtitle?: React.ReactNode;
        children?: React.ReactNode;
        className?: string;
    }>;

    /**
     * Stack component for vertical or horizontal spacing between children.
     *
     * Provides flexbox-based stacking with configurable gap sizes and direction.
     * Default direction is vertical (column).
     *
     * @example
     * ```tsx
     * <layout.Stack gap="md">
     *   <ui.Card>First</ui.Card>
     *   <ui.Card>Second</ui.Card>
     * </layout.Stack>
     *
     * <layout.Stack direction="horizontal" gap="sm">
     *   <ui.Button>Cancel</ui.Button>
     *   <ui.Button variant="primary">Save</ui.Button>
     * </layout.Stack>
     * ```
     */
    Stack: ComponentType<{
        children: React.ReactNode;
        gap?: 'sm' | 'md' | 'lg';
        direction?: 'vertical' | 'horizontal';
        className?: string;
    }>;

    /**
     * Grid component for multi-column layouts.
     *
     * Provides CSS grid with configurable column counts and gap sizes.
     * Use columns="responsive" for automatic responsive behavior.
     *
     * @example
     * ```tsx
     * <layout.Grid columns="responsive" gap="md">
     *   <ui.Card>Card 1</ui.Card>
     *   <ui.Card>Card 2</ui.Card>
     *   <ui.Card>Card 3</ui.Card>
     * </layout.Grid>
     * ```
     */
    Grid: ComponentType<{
        children: React.ReactNode;
        columns?: 2 | 3 | 'responsive';
        gap?: 'sm' | 'md' | 'lg';
        className?: string;
    }>;

    /**
     * Section component for grouping related content with spacing.
     *
     * Provides a semantic section wrapper with consistent gap between children.
     *
     * @example
     * ```tsx
     * <layout.Section gap="lg">
     *   <h2>Settings</h2>
     *   <SettingsForm />
     * </layout.Section>
     * ```
     */
    Section: ComponentType<{
        children: React.ReactNode;
        gap?: 'sm' | 'md' | 'lg';
        className?: string;
    }>;

    /**
     * In-page submenu (tab row) backed by the menu service.
     *
     * The recommended way to build a plugin's internal navigation — the row of
     * tabs on a single-page admin surface (e.g. query / history / tools /
     * settings). Register the tabs as leaf nodes in the plugin's own menu
     * namespace (memory-only, caller-set `requiresAdmin`), fetch that namespace
     * tree SSR-first via the plugin `serverDataFetcher`, and render it here.
     * Backing the row with the menu service — instead of a hand-rolled
     * `<button>` array — inherits per-user gating, ordering, live refresh, and
     * lets other plugins contribute tabs into the row.
     *
     * Provide `onSelect` to drive in-page tab state (clicks suppress
     * navigation); omit it for ordinary navigation links. Pair `onSelect` with
     * `activeUrl` to highlight the active tab, since all tabs share one route.
     *
     * @example
     * ```tsx
     * const [tab, setTab] = useState('query');
     * <layout.SubMenu
     *   namespace="ai-assistant"
     *   items={submenuTree}
     *   activeUrl={`/system/plugins/ai-assistant?tab=${tab}`}
     *   onSelect={(item) => setTab(tabKeyFromUrl(item.url))}
     * />
     * ```
     */
    SubMenu: ComponentType<{
        namespace: string;
        items: ISubMenuItem[];
        activeUrl?: string;
        onSelect?: (item: ISubMenuItem) => void;
        ariaLabel?: string;
    }>;
}

/**
 * System component library provided to frontend plugins.
 *
 * Contains system administration and monitoring components that plugins can use
 * for admin interfaces without creating cross-workspace dependencies.
 */
export interface ISystemComponents {
    /**
     * Scheduler Monitor component for displaying and managing scheduled jobs.
     *
     * Provides real-time job status tracking, enable/disable controls, and
     * schedule modification. Supports filtering to show only specific jobs.
     *
     * @param token - Admin authentication token (from localStorage)
     * @param jobFilter - Optional array of job names or filter function
     * @param sectionTitle - Optional title override for the jobs section
     * @param hideHealth - Whether to hide the scheduler health section
     *
     * @example
     * ```tsx
     * // Show all jobs
     * <context.system.SchedulerMonitor token={adminToken} />
     *
     * // Show only specific jobs
     * <context.system.SchedulerMonitor
     *   token={adminToken}
     *   jobFilter={['markets:refresh']}
     *   sectionTitle="Market Jobs"
     *   hideHealth
     * />
     * ```
     */
    SchedulerMonitor: ComponentType<{
        token: string;
        jobFilter?: string[] | ((job: any) => boolean);
        sectionTitle?: string;
        hideHealth?: boolean;
    }>;
}

/**
 * API client functions provided to frontend plugins.
 *
 * Pre-configured API client that handles authentication, base URL resolution,
 * and common error handling. Plugins use this instead of raw fetch calls.
 */
export interface IApiClient {
    /**
     * Make a GET request to the API.
     *
     * Automatically includes authentication headers and resolves the full URL
     * based on NEXT_PUBLIC_API_URL environment variable.
     *
     * @param path - API path (e.g., '/plugins/whale-alerts/timeseries')
     * @param params - Optional query parameters as key-value pairs
     * @returns Promise that resolves with the parsed JSON response
     */
    get<T = any>(path: string, params?: Record<string, any>): Promise<T>;

    /**
     * Make a POST request to the API.
     *
     * @param path - API path
     * @param body - Request body (will be JSON-stringified)
     * @returns Promise that resolves with the parsed JSON response
     */
    post<T = any>(path: string, body?: any): Promise<T>;

    /**
     * Make a PUT request to the API.
     *
     * @param path - API path
     * @param body - Request body (will be JSON-stringified)
     * @returns Promise that resolves with the parsed JSON response
     */
    put<T = any>(path: string, body?: any): Promise<T>;

    /**
     * Make a DELETE request to the API.
     *
     * @param path - API path
     * @returns Promise that resolves with the parsed JSON response
     */
    delete<T = any>(path: string): Promise<T>;

    /**
     * Make a PATCH request to the API.
     *
     * @param path - API path
     * @param body - Request body (will be JSON-stringified)
     * @returns Promise that resolves with the parsed JSON response
     */
    patch<T = any>(path: string, body?: any): Promise<T>;
}

/**
 * WebSocket utilities provided to frontend plugins.
 *
 * Provides access to the Socket.IO client for real-time event subscriptions.
 * Plugins can listen to events and emit custom events without managing
 * connection lifecycle.
 *
 * Helper methods automatically prefix event names with the plugin ID to prevent
 * collisions between plugins while maintaining clean plugin code.
 */
export interface IWebSocketClient {
    /**
     * Socket.IO client instance.
     *
     * Use this to subscribe to events or check connection status. The connection
     * lifecycle is managed by the frontend app, so plugins don't need to handle
     * connect/disconnect logic.
     *
     * For most use cases, prefer the helper methods (on, off, emit, once) which
     * automatically handle plugin-namespaced event names.
     *
     * @example
     * ```typescript
     * // Use helper methods for automatic prefixing
     * websocket.on('large-transfer', handler);
     *
     * // Use raw socket for system events like 'connect'
     * websocket.socket.on('connect', handler);
     * ```
     */
    socket: Socket;

    /**
     * Subscribe to a plugin-namespaced event.
     *
     * Automatically prefixes the event name with the plugin ID to prevent collisions.
     * For example, if your plugin ID is 'whale-alerts' and you call:
     * `websocket.on('large-transfer', handler)`, the actual event listened to
     * will be 'whale-alerts:large-transfer'.
     *
     * @param event - Event name (without plugin prefix)
     * @param handler - Event handler function
     *
     * @example
     * ```typescript
     * useEffect(() => {
     *     const handler = (data) => console.log('Whale transaction:', data);
     *     websocket.on('large-transfer', handler);
     *     return () => websocket.off('large-transfer', handler);
     * }, [websocket]);
     * ```
     */
    on: (event: string, handler: (...args: any[]) => void) => void;

    /**
     * Unsubscribe from a plugin-namespaced event.
     *
     * Must pass the same handler reference used in the `on()` call for proper cleanup.
     * Automatically prefixes the event name with the plugin ID.
     *
     * @param event - Event name (without plugin prefix)
     * @param handler - Event handler function to remove
     */
    off: (event: string, handler: (...args: any[]) => void) => void;

    /**
     * Subscribe to a plugin-namespaced event that fires only once.
     *
     * Automatically prefixes the event name with the plugin ID and removes
     * the listener after the first event is received.
     *
     * @param event - Event name (without plugin prefix)
     * @param handler - Event handler function
     */
    once: (event: string, handler: (...args: any[]) => void) => void;

    /**
     * Subscribe to a plugin room for real-time updates.
     *
     * Sends a subscription request to the backend with a room name and optional
     * subscription parameters. The room name is automatically prefixed with the
     * plugin ID to prevent collisions (e.g., 'whale-alerts' becomes
     * 'plugin:whale-alerts:whale-alerts').
     *
     * @param roomName - Room name to subscribe to (automatically prefixed)
     * @param payload - Optional subscription parameters (e.g., thresholds, filters)
     *
     * @example
     * ```typescript
     * // Subscribe to default room
     * websocket.subscribe('whale-alerts');
     *
     * // Subscribe to specific room with configuration
     * websocket.subscribe('high-value', { minAmount: 1_000_000 });
     *
     * // Subscribe to multiple rooms
     * websocket.subscribe('whale-alerts');
     * websocket.subscribe('medium-value', { minAmount: 100_000 });
     * ```
     */
    subscribe: (roomName: string, payload?: any) => void;

    /**
     * Unsubscribe from a plugin room.
     *
     * Sends an unsubscription request to the backend to leave a room and clean up
     * any server-side state. The room name is automatically prefixed with the plugin
     * ID to match the subscription behavior.
     *
     * @param roomName - Room name to unsubscribe from (automatically prefixed)
     * @param payload - Optional unsubscription parameters
     *
     * @example
     * ```typescript
     * useEffect(() => {
     *     // Subscribe on mount
     *     websocket.subscribe('whale-alerts', { minAmount: 500_000 });
     *
     *     // Unsubscribe on cleanup
     *     return () => {
     *         websocket.unsubscribe('whale-alerts', { minAmount: 500_000 });
     *     };
     * }, [websocket]);
     * ```
     */
    unsubscribe: (roomName: string, payload?: any) => void;

    /**
     * Subscribe to WebSocket connect events.
     *
     * Registers a handler that fires when the WebSocket connection is established
     * or re-established after a disconnect. Useful for resubscribing to rooms or
     * refreshing data after reconnection.
     *
     * @param handler - Function to call when connection is established
     *
     * @example
     * ```typescript
     * useEffect(() => {
     *     const resubscribe = () => {
     *         websocket.emit('whale-alerts', { minAmount: 500_000 });
     *     };
     *     websocket.onConnect(resubscribe);
     *     return () => websocket.offConnect(resubscribe);
     * }, [websocket]);
     * ```
     */
    onConnect: (handler: () => void) => void;

    /**
     * Unsubscribe from WebSocket connect events.
     *
     * Removes a handler previously registered with onConnect. Must pass the same
     * handler reference used in the onConnect call.
     *
     * @param handler - Function to remove from connect event listeners
     */
    offConnect: (handler: () => void) => void;

    /**
     * Check if the WebSocket is currently connected.
     *
     * Useful for displaying connection status in UI or deferring actions
     * until the connection is established.
     *
     * @returns True if connected, false otherwise
     */
    isConnected: () => boolean;
}

/**
 * Frontend plugin context provided to plugin components and pages.
 *
 * Contains UI components, API client, WebSocket access, and utilities that
 * plugins need to build features without importing from the frontend app.
 * This context enables dependency injection similar to the backend plugin system,
 * preventing cross-workspace import issues and allowing independent evolution.
 *
 * Plugins receive this context as a prop to their component and page exports,
 * allowing them to access shared infrastructure without hardcoded dependencies.
 *
 * @example
 * ```typescript
 * export function MyPluginPage({ context }: { context: IFrontendPluginContext }) {
 *     const { ui, charts, api, websocket } = context;
 *
 *     useEffect(() => {
 *         const handler = (data) => console.log(data);
 *         websocket.on('large-transfer', handler);
 *         return () => websocket.off('large-transfer', handler);
 *     }, [websocket]);
 *
 *     return (
 *         <ui.Card>
 *             <charts.LineChart series={[...]} />
 *         </ui.Card>
 *     );
 * }
 * ```
 */
export interface IFrontendPluginContext {
    /** Plugin identifier used for namespacing events and API routes */
    pluginId: string;

    /** UI component library (Card, Badge, Skeleton, Button, Input) */
    ui: IUIComponents;

    /** Layout component library (Page, PageHeader, Stack, Grid, Section) */
    layout: ILayoutComponents;

    /** Chart component library (LineChart, etc.) */
    charts: IChartComponents;

    /** System component library (SchedulerMonitor, etc.) */
    system: ISystemComponents;

    /** API client for making authenticated requests to backend */
    api: IApiClient;

    /** WebSocket client for real-time event subscriptions with auto-prefixing */
    websocket: IWebSocketClient;

    /**
     * Modal control hook for opening and closing modals programmatically.
     *
     * Returns methods to open, close, and manage modal state. Must be called
     * within a component context (similar to React hooks pattern).
     *
     * @example
     * ```typescript
     * const { open: openModal, close: closeModal } = context.useModal();
     * const modalId = openModal({
     *   title: 'Select Icon',
     *   size: 'lg',
     *   content: <IconPickerModal onSelect={handleSelect} onClose={() => closeModal(modalId)} />
     * });
     * ```
     */
    useModal: () => {
        open: (options: {
            title?: string;
            content: React.ReactNode;
            size?: 'sm' | 'md' | 'lg' | 'xl';
            dismissible?: boolean;
            onClose?: () => void;
        }) => string;
        close: (id: string) => void;
        closeAll: () => void;
    };

    /**
     * User state hook for accessing current user identity and wallet information.
     *
     * Returns reactive user state that mirrors the Better Auth session.
     * `isLoggedIn` is the primary gate; `hasPrimaryWallet` and `primaryWallet`
     * are the wallet-specific signals. Must be called within a component
     * context (similar to React hooks pattern).
     *
     * @example
     * ```typescript
     * const { isLoggedIn, hasPrimaryWallet, primaryWallet } = context.useUser();
     *
     * if (!isLoggedIn) {
     *     return <p>Please sign in to access this feature</p>;
     * }
     * if (!hasPrimaryWallet) {
     *     return <p>Link a TRON wallet to use this feature</p>;
     * }
     * ```
     */
    useUser: () => IPluginUserState;

    /**
     * Toast notification hook for displaying temporary notification messages.
     *
     * Returns methods to push and dismiss toast notifications. Must be called
     * within a component context (similar to React hooks pattern).
     *
     * @example
     * ```typescript
     * const { push } = context.useToast();
     * push({
     *     tone: 'warning',
     *     title: 'Whale transfer detected',
     *     description: '1,500,000 TRX transferred',
     *     duration: 7000
     * });
     * ```
     */
    useToast: () => {
        push: (toast: {
            id?: string;
            tone?: 'info' | 'success' | 'warning' | 'danger';
            title: string;
            description?: string;
            duration?: number;
            actionLabel?: string;
            onAction?: () => void;
        }) => string;
        dismiss: (id: string) => void;
    };
}
