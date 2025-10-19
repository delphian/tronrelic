import type { ComponentType } from 'react';
import type { Socket } from 'socket.io-client';

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
        tone?: 'neutral' | 'success' | 'warning' | 'danger';
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
        variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
        size?: 'sm' | 'md' | 'lg';
        icon?: React.ReactNode;
        className?: string;
        type?: 'button' | 'submit' | 'reset';
    }>;

    /** Input component for form fields */
    Input: ComponentType<{
        value?: string;
        onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
        placeholder?: string;
        disabled?: boolean;
        required?: boolean;
        variant?: 'default' | 'ghost';
        type?: string;
        className?: string;
        id?: string;
        name?: string;
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

    /** Chart component library (LineChart, etc.) */
    charts: IChartComponents;

    /** API client for making authenticated requests to backend */
    api: IApiClient;

    /** WebSocket client for real-time event subscriptions with auto-prefixing */
    websocket: IWebSocketClient;
}
