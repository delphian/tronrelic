/**
 * Interface for WebSocket service singleton.
 *
 * Provides real-time event broadcasting to connected frontend clients. This interface
 * defines the public contract for emitting events from plugins without requiring direct
 * imports of Socket.IO or backend infrastructure.
 */
export interface IWebSocketService {
    /**
     * Emit an event to subscribed clients.
     *
     * Routes the event to appropriate socket rooms based on the event type and payload.
     * Events are broadcast to all clients subscribed to the relevant channels.
     *
     * @param event - The socket event containing type and payload data
     */
    emit(event: any): void;

    /**
     * Emit an event to a specific wallet's notification room.
     *
     * Sends a targeted notification to clients subscribed to updates for a specific wallet address.
     *
     * @param wallet - The wallet address to send the notification to
     * @param event - The socket event containing type and payload data
     */
    emitToWallet(wallet: string, event: any): void;
}
