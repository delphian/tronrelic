import type { TronTransactionDocument } from './transaction.js';
import type { NotificationChannel } from './common.js';

export interface SocketSubscriptions {
  markets?: {
    all?: boolean;
    markets?: string[];
  };
  transactions?: {
    minAmount?: number;
    addresses?: string[];
  };
  memos?: {
    all?: boolean;
  };
  comments?: {
    resourceId: string;
  };
  chat?: boolean;
  notifications?: {
    wallet: string;
    channels?: NotificationChannel[];
  };
  /**
   * Identity-scoped subscription. The user's UUID is resolved server-side
   * from the `tronrelic_uid` cookie at handshake time — clients no longer
   * (and must not) pass a userId in the payload. Send a sentinel `true`
   * to opt the socket into its own `user:<uid>` room.
   */
  user?: true;
}

export interface TransactionAlertPayload {
  event: 'transaction:large' | 'delegation:new' | 'stake:new';
  payload: TronTransactionDocument;
}

export interface BlockNotificationPayload {
  event: 'block:new';
  payload: {
    blockNumber: number;
    timestamp: string;
    stats: Record<string, unknown>;
  };
}

export interface CommentsUpdatePayload {
  event: 'comments:new';
  payload: {
    threadId: string;
    commentId: string;
    message: string;
    wallet: string;
    createdAt: string;
    attachments?: Array<{
      attachmentId: string;
      filename: string;
      contentType: string;
      size: number;
      url: string | null;
    }>;
  };
}

export interface ChatUpdatePayload {
  event: 'chat:update';
  payload: {
    messageId: string;
    wallet: string;
    message: string;
    updatedAt: string;
  };
}

export interface MemoUpdatePayload {
  event: 'memo:new';
  payload: {
    memoId: string;
    txId: string;
    memo: string;
    timestamp: string;
    fromAddress: string;
    toAddress: string;
  };
}

export interface UserUpdatePayload {
  event: 'user:update';
  payload: {
    id: string;
    wallets: Array<{
      address: string;
      linkedAt: string;
      isPrimary: boolean;
      label?: string;
    }>;
    preferences: {
      theme?: 'light' | 'dark' | 'system';
      notifications?: boolean;
      timezone?: string;
      language?: string;
    };
    activity: {
      lastSeen: string;
      pageViews: number;
      firstSeen: string;
    };
    createdAt: string;
    updatedAt: string;
  };
}

/**
 * Serialized menu node received over WebSocket.
 * Mirrors IMenuNodeWithChildren after JSON serialization.
 */
export interface MenuNodeSerialized {
  _id: string;
  label: string;
  url?: string;
  icon?: string;
  order: number;
  parent?: string | null;
  enabled: boolean;
  namespace?: string;
  allowedIdentityStates?: string[];
  requiresGroups?: string[];
  requiresAdmin?: boolean;
  children?: MenuNodeSerialized[];
}

/**
 * Serialized menu tree received over WebSocket.
 */
export interface MenuTreeSerialized {
  roots: MenuNodeSerialized[];
  all: MenuNodeSerialized[];
  generatedAt: string;
}

/**
 * Refetch signal emitted when a menu node is created, updated, or deleted.
 *
 * Per-user gating means there is no single tree shape that fits every
 * connected client, so the server no longer ships a tree on the wire.
 * Receivers re-request `GET /api/menu?namespace=...` with their own
 * credentials and the server returns their filtered view.
 */
export interface MenuUpdatePayload {
  event: 'menu:update';
  payload: {
    event: string;
    namespace: string;
    nodeId: string;
    timestamp: string;
  };
}

export interface MenuNamespaceConfigUpdatePayload {
  event: 'menu:namespace-config:update';
  payload: {
    namespace: string;
    config: Record<string, unknown>;
    timestamp: string;
  };
}

export type TronRelicSocketEvent =
  | TransactionAlertPayload
  | BlockNotificationPayload
  | CommentsUpdatePayload
  | ChatUpdatePayload
  | MemoUpdatePayload
  | UserUpdatePayload
  | MenuUpdatePayload
  | MenuNamespaceConfigUpdatePayload;
