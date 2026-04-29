'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type {
    IFrontendPluginContext,
    IUIComponents,
    ILayoutComponents,
    IChartComponents,
    ISystemComponents,
    IApiClient,
    IWebSocketClient,
    IPluginUserState,
    IPluginWalletLink
} from '@/types';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Switch } from '../components/ui/Switch';
import { Input } from '../components/ui/Input';
import { ClientTime } from '../components/ui/ClientTime';
import { Tooltip } from '../components/ui/Tooltip';
import { LazyIconPickerModal as IconPickerModal } from '../components/ui/IconPickerModal';
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/Table';
import { useModal as useModalHook } from '../components/ui/ModalProvider';
import { useToast as useToastHook } from '../components/ui/ToastProvider';
import { LineChart } from '../features/charts/components/LineChart';
import { SchedulerMonitor } from '../modules/scheduler';
import { Page, PageHeader, Stack, Grid, Section } from '../components/layout';
import { useAppSelector } from '../store/hooks';
import {
    selectUserId,
    selectUserData,
    selectUserInitialized,
    selectIsLoggedIn,
    selectPrimaryWallet
} from '../modules/user/slice';
import { getSocket } from './socketClient';
import { getRuntimeConfig } from './runtimeConfig';

/**
 * API client implementation for frontend plugins.
 *
 * Provides a simple interface for making authenticated requests to the
 * backend without requiring plugins to manage base URLs, headers, or
 * error handling. The base URL is read from SSR-injected runtime config
 * via `getRuntimeConfig().apiUrl`, so universal Docker images resolve
 * the correct backend per domain without rebuilding.
 *
 * Authentication rides the same-origin `tronrelic_uid` cookie. The
 * cookie is HttpOnly and signed with `SESSION_SECRET`, set by the
 * server on `/api/user/bootstrap`, and travels automatically with
 * `credentials: 'include'`. The client does not — and cannot — read
 * any admin secret from `localStorage`; the legacy `admin_token`
 * value is gone, and consulting it here was duplicated five times for
 * a value that is always null. Admin endpoints validate the signed
 * cookie via `requireAdmin` middleware (which also accepts the
 * service-token path for CI/scripts that don't run in a browser).
 */
class ApiClient implements IApiClient {
    private baseUrl: string;

    constructor() {
        this.baseUrl = getRuntimeConfig().apiUrl;
    }

    /**
     * Internal request executor. Centralizes URL composition, header
     * construction, error-message extraction, and JSON parsing so each
     * public method is a one-line delegation.
     *
     * Body is conditionally serialized — GET/DELETE pass `undefined`
     * so the request remains body-less and `Content-Type` is omitted
     * entirely (set only when a body is present, so intermediaries
     * aren't misled). Query params apply only when supplied (GET's
     * only escape hatch into URL state). Responses are parsed
     * defensively: 204/205 and empty bodies return `undefined`,
     * non-JSON content-types return the raw text — endpoints that
     * declare `Promise<void>` no longer throw on success.
     */
    private async request<T>(
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: string,
        body?: unknown,
        params?: Record<string, unknown>
    ): Promise<T> {
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        const url = new URL(cleanPath, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                url.searchParams.append(key, String(value));
            });
        }

        const init: RequestInit = {
            method,
            credentials: 'include'
        };
        if (body !== undefined) {
            init.headers = { 'Content-Type': 'application/json' };
            init.body = JSON.stringify(body);
        }

        const response = await fetch(url.toString(), init);

        if (!response.ok) {
            let errorMessage = response.statusText;
            try {
                const errorData = await response.json();
                if (errorData.error) {
                    errorMessage = errorData.error;
                }
            } catch {
                // JSON parse failure means the server didn't return a
                // structured error body — fall back to statusText.
            }
            throw new Error(`API request failed: ${errorMessage}`);
        }

        // 204 No Content / 205 Reset Content carry no body; calling
        // response.json() on them throws. Several DELETE endpoints
        // return 204 on success, so guard before parsing. Non-JSON
        // bodies fall through to text — callers that asked for void
        // get undefined, others get the raw payload.
        if (response.status === 204 || response.status === 205) {
            return undefined as T;
        }

        const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
        if (contentType.includes('application/json')) {
            return response.json() as Promise<T>;
        }

        const text = await response.text();
        return (text === '' ? undefined : text) as T;
    }

    async get<T = any>(path: string, params?: Record<string, any>): Promise<T> {
        return this.request<T>('GET', path, undefined, params);
    }

    async post<T = any>(path: string, body?: any): Promise<T> {
        return this.request<T>('POST', path, body);
    }

    async put<T = any>(path: string, body?: any): Promise<T> {
        return this.request<T>('PUT', path, body);
    }

    async patch<T = any>(path: string, body?: any): Promise<T> {
        return this.request<T>('PATCH', path, body);
    }

    async delete<T = any>(path: string): Promise<T> {
        return this.request<T>('DELETE', path);
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
 * Hook providing user state to frontend plugins.
 *
 * Wraps Redux selectors to provide a stable interface that won't break
 * plugins when the internal user module is refactored. Returns reactive
 * state that automatically updates when user data changes.
 *
 * @returns Plugin-safe user state with identity, wallets, and verification status
 */
function usePluginUser(): IPluginUserState {
    const userId = useAppSelector(selectUserId);
    const userData = useAppSelector(selectUserData);
    const initialized = useAppSelector(selectUserInitialized);
    const isLoggedIn = useAppSelector(selectIsLoggedIn);
    const primaryWallet = useAppSelector(selectPrimaryWallet);

    // Transform wallets to plugin-safe format
    const wallets: IPluginWalletLink[] = (userData?.wallets ?? []).map(w => ({
        address: w.address,
        verified: w.verified,
        isPrimary: w.isPrimary,
        linkedAt: w.linkedAt,
        lastUsed: w.lastUsed,
        label: w.label
    }));

    // Wallet state convenience properties
    const hasLinkedWallet = wallets.length > 0;
    const hasVerifiedWallet = wallets.some(w => w.verified);

    return {
        userId,
        hasLinkedWallet,
        hasVerifiedWallet,
        isLoggedIn,
        wallets,
        primaryWallet,
        initialized
    };
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
            IconButton,
            Switch,
            Input,
            ClientTime,
            Tooltip,
            IconPickerModal,
            Table,
            Thead,
            Tbody,
            Tr,
            Th,
            Td
        };

        const layout: ILayoutComponents = {
            Page,
            PageHeader,
            Stack,
            Grid,
            Section
        };

        const charts: IChartComponents = {
            LineChart
        };

        const system: ISystemComponents = {
            SchedulerMonitor
        };

        const api = new ApiClient();
        // Create a default websocket client with empty plugin ID for global context
        const websocket = new WebSocketClient('');

        return {
            pluginId: '',
            ui,
            layout,
            charts,
            system,
            api,
            websocket,
            useModal: useModalHook,
            useUser: usePluginUser,
            useToast: useToastHook
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
        IconButton,
        Switch,
        Input,
        ClientTime,
        Tooltip,
        IconPickerModal,
        Table,
        Thead,
        Tbody,
        Tr,
        Th,
        Td
    };

    const layout: ILayoutComponents = {
        Page,
        PageHeader,
        Stack,
        Grid,
        Section
    };

    const charts: IChartComponents = {
        LineChart
    };

    const system: ISystemComponents = {
        SchedulerMonitor
    };

    const api = new ApiClient();
    const websocket = new WebSocketClient(pluginId);

    return {
        pluginId,
        ui,
        layout,
        charts,
        system,
        api,
        websocket,
        useModal: useModalHook,
        useUser: usePluginUser,
        useToast: useToastHook
    };
}
