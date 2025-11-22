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

export type TronRelicSocketEvent =
  | TransactionAlertPayload
  | BlockNotificationPayload
  | CommentsUpdatePayload
  | ChatUpdatePayload
  | MemoUpdatePayload;
