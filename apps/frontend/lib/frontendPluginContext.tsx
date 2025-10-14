'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type {
    IFrontendPluginContext,
    IUIComponents,
    IChartComponents,
    IApiClient,
    IWebSocketClient
} from '@tronrelic/types';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { LineChart } from '../features/charts/components/LineChart';
import { getSocket } from './socketClient';
import { config } from './config';

/**
 * API client implementation for frontend plugins.
 *
 * Provides a simple interface for making authenticated requests to the backend
 * without requiring plugins to manage base URLs, headers, or error handling.
 * The base URL delegates to config.apiBaseUrl so plugin traffic benefits from
 * the same Docker-aware fallbacks described in getBackendBaseUrl().
 */
class ApiClient implements IApiClient {
    private baseUrl: string;

    constructor() {
        this.baseUrl = config.apiBaseUrl;
    }

    async get<T = any>(path: string, params?: Record<string, any>): Promise<T> {
        // Remove leading slash if present to ensure proper URL joining
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        const url = new URL(cleanPath, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                url.searchParams.append(key, String(value));
            });
        }

        const headers: HeadersInit = {
            'Content-Type': 'application/json'
        };

        // Add admin token if available (for admin API routes)
        const adminToken = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
        if (adminToken) {
            headers['Authorization'] = `Bearer ${adminToken}`;
        }

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
        }

        return response.json();
    }

    async post<T = any>(path: string, body?: any): Promise<T> {
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        const url = new URL(cleanPath, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);

        const headers: HeadersInit = {
            'Content-Type': 'application/json'
        };

        // Add admin token if available (for admin API routes)
        const adminToken = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
        if (adminToken) {
            headers['Authorization'] = `Bearer ${adminToken}`;
        }

        const response = await fetch(url.toString(), {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
        }

        return response.json();
    }

    async put<T = any>(path: string, body?: any): Promise<T> {
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        const url = new URL(cleanPath, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);

        const headers: HeadersInit = {
            'Content-Type': 'application/json'
        };

        // Add admin token if available (for admin API routes)
        const adminToken = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
        if (adminToken) {
            headers['Authorization'] = `Bearer ${adminToken}`;
        }

        const response = await fetch(url.toString(), {
            method: 'PUT',
            headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
        }

        return response.json();
    }

    async delete<T = any>(path: string): Promise<T> {
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        const url = new URL(cleanPath, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);

        const headers: HeadersInit = {
            'Content-Type': 'application/json'
        };

        // Add admin token if available (for admin API routes)
        const adminToken = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
        if (adminToken) {
            headers['Authorization'] = `Bearer ${adminToken}`;
        }

        const response = await fetch(url.toString(), {
            method: 'DELETE',
            headers
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
        }

        return response.json();
    }
}

/**
 * WebSocket client implementation for frontend plugins.
 *
 * Provides access to the shared Socket.IO connection for real-time event subscriptions.
 * Uses a getter to ensure we always return the current socket instance rather than
 * capturing it at construction time, which ensures plugins get the connected socket.
 *
 * Helper methods automatically prefix event names with the plugin ID to prevent
 * collisions between plugins while keeping plugin code clean and readable.
 */
class WebSocketClient implements IWebSocketClient {
    constructor(private pluginId: string) {}

    get socket() {
        return getSocket();
    }

    /**
     * Subscribe to a plugin-namespaced event.
     *
     * Automatically prefixes the event name with the plugin ID. For example,
     * if the plugin ID is 'whale-alerts' and event is 'large-transfer',
     * this will listen for 'whale-alerts:large-transfer'.
     *
     * @param event - Event name without plugin prefix
     * @param handler - Event handler function
     */
    on(event: string, handler: (...args: any[]) => void): void {
        const prefixedEvent = `${this.pluginId}:${event}`;
        this.socket.on(prefixedEvent, handler);
    }

    /**
     * Unsubscribe from a plugin-namespaced event.
     *
     * @param event - Event name without plugin prefix
     * @param handler - Event handler function to remove
     */
    off(event: string, handler: (...args: any[]) => void): void {
        const prefixedEvent = `${this.pluginId}:${event}`;
        this.socket.off(prefixedEvent, handler);
    }

    /**
     * Subscribe to a plugin-namespaced event that fires only once.
     *
     * @param event - Event name without plugin prefix
     * @param handler - Event handler function
     */
    once(event: string, handler: (...args: any[]) => void): void {
        const prefixedEvent = `${this.pluginId}:${event}`;
        this.socket.once(prefixedEvent, handler);
    }

    /**
     * Subscribe to a plugin room for real-time updates.
     *
     * Sends a 'subscribe' event with the room name and optional payload.
     * The room name is automatically prefixed with the plugin ID on the backend
     * to create the full room: 'plugin:{pluginId}:{roomName}'.
     *
     * @param roomName - The plugin-local room name to subscribe to
     * @param payload - Optional subscription parameters (e.g., filters, preferences)
     */
    subscribe(roomName: string, payload?: any): void {
        this.socket.emit('subscribe', this.pluginId, roomName, payload);
    }

    /**
     * Unsubscribe from a plugin room.
     *
     * Sends an 'unsubscribe' event with the room name and optional payload.
     * The room name is automatically prefixed with the plugin ID on the backend
     * to match the subscription behavior. This triggers any cleanup logic in
     * the plugin's backend unsubscribe handler.
     *
     * @param roomName - The plugin-local room name to unsubscribe from
     * @param payload - Optional unsubscription parameters
     */
    unsubscribe(roomName: string, payload?: any): void {
        this.socket.emit('unsubscribe', this.pluginId, roomName, payload);
    }

    /**
     * Subscribe to WebSocket connect events.
     *
     * Wrapper around socket.on('connect') for consistency with other helper methods.
     * Fires when the WebSocket connection is established or re-established.
     *
     * @param handler - Function to call on connection
     */
    onConnect(handler: () => void): void {
        this.socket.on('connect', handler);
    }

    /**
     * Unsubscribe from WebSocket connect events.
     *
     * @param handler - Function to remove from connect listeners
     */
    offConnect(handler: () => void): void {
        this.socket.off('connect', handler);
    }

    isConnected(): boolean {
        return getSocket().connected;
    }
}

/**
 * React context for frontend plugin dependency injection.
 *
 * Provides a single source of truth for UI components, API client, and WebSocket
 * access that plugins can consume without importing from various app directories.
 */
const FrontendPluginContext = createContext<IFrontendPluginContext | null>(null);

/**
 * Provider component that makes plugin context available to all plugin components.
 *
 * Wraps plugin components with access to UI components, charts, API client, and
 * WebSocket utilities. This enables dependency injection similar to the backend
 * plugin system, preventing cross-workspace import issues.
 *
 * @param props - Component props
 * @param props.children - React children to wrap with plugin context
 * @returns Provider component with plugin context
 */
export function FrontendPluginContextProvider({ children }: { children: React.ReactNode }) {
    const context = useMemo<IFrontendPluginContext>(() => {
        const ui: IUIComponents = {
            Card,
            Badge,
            Skeleton,
            Button,
            Input
        };

        const charts: IChartComponents = {
            LineChart
        };

        const api = new ApiClient();
        // Create a default websocket client with empty plugin ID for global context
        const websocket = new WebSocketClient('');

        return {
            pluginId: '',
            ui,
            charts,
            api,
            websocket
        };
    }, []);

    return (
        <FrontendPluginContext.Provider value={context}>
            {children}
        </FrontendPluginContext.Provider>
    );
}

/**
 * Hook to access the frontend plugin context.
 *
 * Plugins use this hook to get access to UI components, API client, charts,
 * and WebSocket utilities without importing from the frontend app directly.
 *
 * @returns Frontend plugin context with all injected dependencies
 * @throws Error if used outside of FrontendPluginContextProvider
 *
 * @example
 * ```typescript
 * function MyPluginComponent() {
 *     const { ui, api, websocket } = useFrontendPluginContext();
 *
 *     return <ui.Card>...</ui.Card>;
 * }
 * ```
 */
export function useFrontendPluginContext(): IFrontendPluginContext {
    const context = useContext(FrontendPluginContext);
    if (!context) {
        throw new Error('useFrontendPluginContext must be used within FrontendPluginContextProvider');
    }
    return context;
}

/**
 * Create a plugin-specific context with automatic event namespacing.
 *
 * This factory function creates a context tailored to a specific plugin,
 * ensuring all WebSocket events are automatically prefixed with the plugin ID.
 *
 * @param pluginId - Plugin identifier used for event namespacing
 * @returns Plugin-specific context with namespaced WebSocket client
 */
export function createPluginContext(pluginId: string): IFrontendPluginContext {
    const ui: IUIComponents = {
        Card,
        Badge,
        Skeleton,
        Button,
        Input
    };

    const charts: IChartComponents = {
        LineChart
    };

    const api = new ApiClient();
    const websocket = new WebSocketClient(pluginId);

    return {
        pluginId,
        ui,
        charts,
        api,
        websocket
    };
}
