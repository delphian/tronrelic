/**
 * Realtime Feature Module
 *
 * This module handles real-time data synchronization including:
 * - WebSocket connection status
 * - Real-time updates subscription
 * - Live data streaming
 */

// Redux slice
export { default as realtimeReducer } from './slice';
export * from './slice';

// Hooks
export { useRealtimeStatus } from './hooks/useRealtimeStatus';
export { useSocketSubscription } from './hooks/useSocketSubscription';
