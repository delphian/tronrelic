import axios from 'axios';
import { getServerSideApiUrl } from './api-url';

export const apiClient = axios.create({
  // SSR needs the internal backend URL (SITE_BACKEND); the browser uses a
  // relative path handled by Next.js rewrites — see
  // docs/frontend/frontend-architecture-runtime-config.md.
  baseURL: typeof window === 'undefined' ? `${getServerSideApiUrl()}/api` : '/api',
  timeout: 5000
});

export async function getLatestTransactions(limit = 50) {
  const response = await apiClient.get('/blockchain/transactions/latest', {
    params: { limit }
  });
  return response.data.transactions;
}

export async function getChatMessages(wallet?: string): Promise<{ messages: ChatMessageRecord[]; meta?: ChatMeta }> {
  const response = await apiClient.get('/chat', {
    params: wallet ? { wallet } : undefined
  });

  const { messages, meta } = response.data as {
    success: boolean;
    messages: ChatMessageRecord[];
    meta?: ChatMeta;
  };

  return { messages, meta };
}

export async function getComments(threadId: string, wallet?: string): Promise<{ comments: CommentRecord[]; meta?: CommentMeta }> {
  const response = await apiClient.get('/comments', {
    params: wallet ? { threadId, wallet } : { threadId }
  });

  const { comments, meta } = response.data as {
    success: boolean;
    comments: CommentRecord[];
    meta?: CommentMeta;
  };

  return { comments, meta };
}

export async function postChatMessage(payload: ChatMessagePayload): Promise<{ message: ChatMessageRecord; meta: ChatMeta }> {
  const response = await apiClient.post('/chat', payload);

  const { message, meta } = response.data as {
    success: boolean;
    message: ChatMessageRecord;
    meta: ChatMeta;
  };

  return { message, meta };
}

export async function postComment(payload: CommentPayload): Promise<{ comment: CommentRecord; meta: CommentMeta }> {
  const response = await apiClient.post('/comments', payload);

  const { comment, meta } = response.data as {
    success: boolean;
    comment: CommentRecord;
    meta: CommentMeta;
  };

  return { comment, meta };
}

export async function createCommentAttachment(payload: AttachmentRequestPayload): Promise<CommentAttachmentUploadTicket> {
  const response = await apiClient.post('/comments/attachments', payload);
  const { attachment } = response.data as {
    success: boolean;
    attachment: CommentAttachmentUploadTicket;
  };

  return attachment;
}

export async function updateCommentIgnore(payload: IgnoreListPayload): Promise<string[]> {
  const response = await apiClient.post('/comments/ignore', payload);
  const { ignoreList } = response.data as { success: boolean; ignoreList: string[] };
  return ignoreList;
}

export async function getCommentIgnoreList(wallet: string): Promise<string[]> {
  const response = await apiClient.get('/comments/ignore', {
    params: { wallet }
  });
  const { ignoreList } = response.data as { success: boolean; ignoreList: string[] };
  return ignoreList;
}

export async function updateChatIgnore(payload: IgnoreListPayload): Promise<string[]> {
  const response = await apiClient.post('/chat/ignore', payload);
  const { ignoreList } = response.data as { success: boolean; ignoreList: string[] };
  return ignoreList;
}

export async function getChatIgnoreList(wallet: string): Promise<string[]> {
  const response = await apiClient.get('/chat/ignore', {
    params: { wallet }
  });
  const { ignoreList } = response.data as { success: boolean; ignoreList: string[] };
  return ignoreList;
}

export interface TimeseriesPoint {
  date: string;
  value: number;
  count?: number;
  max?: number;
}

export interface DelegationTimeseriesPoint {
  date: string;
  delegated: number;
  undelegated: number;
  count: number;
}

export interface StakingTimeseriesPoint {
  date: string;
  staked: number;
  unstaked: number;
  count: number;
}

export interface WhaleHighlightRecord {
  txId: string;
  timestamp: string;
  amountTRX: number;
  fromAddress: string;
  toAddress: string;
  memo?: string;
  pattern?: string;
  confidence?: number;
}

export interface MemoRecord {
  memoId?: string;
  txId: string;
  memo: string;
  timestamp: string;
  fromAddress: string;
  toAddress: string;
}



export async function getDelegationTimeseries(days = 14): Promise<DelegationTimeseriesPoint[]> {
  const response = await apiClient.get('/dashboard/delegations/timeseries', {
    params: { days }
  });
  const { series } = response.data as { success: boolean; series: DelegationTimeseriesPoint[] };
  return series;
}

export async function getStakingTimeseries(days = 14): Promise<StakingTimeseriesPoint[]> {
  const response = await apiClient.get('/dashboard/staking/timeseries', {
    params: { days }
  });
  const { series } = response.data as { success: boolean; series: StakingTimeseriesPoint[] };
  return series;
}

export interface EnergyEstimateRequest {
  contractAddress?: string;
  fromAddress?: string;
  toAddress?: string;
  amount: string;
}

export interface EnergyEstimateResult {
  energyUsed: number;
  energyPenalty: number;
  message?: string | null;
}

export async function estimateEnergy(payload: EnergyEstimateRequest): Promise<EnergyEstimateResult> {
  const response = await apiClient.post('/tools/energy/estimate', payload);
  const { estimate } = response.data as {
    success: boolean;
    estimate: {
      energyUsed?: number;
      energy_used?: number;
      energyPenalty?: number;
      energy_penalty?: number;
      message?: string | null;
      result?: { message?: string | null };
    };
  };

  const energyUsed = estimate.energyUsed ?? estimate.energy_used ?? 0;
  const energyPenalty = estimate.energyPenalty ?? estimate.energy_penalty ?? 0;
  const message = estimate.message ?? estimate.result?.message ?? null;

  return {
    energyUsed,
    energyPenalty,
    message
  };
}

export async function getMemoFeed(limit = 50): Promise<MemoRecord[]> {
  const response = await apiClient.get('/dashboard/memos/feed', {
    params: { limit }
  });
  const { memos } = response.data as { success: boolean; memos: Array<MemoRecord & { _id?: string }> };
  return memos.map(memo => ({
    ...memo,
    memoId: memo.memoId ?? memo._id ?? memo.txId
  }));
}

export interface CommentAttachmentView {
  attachmentId: string;
  filename: string;
  contentType: string;
  size: number;
  url: string | null;
}

export interface CommentAttachmentUploadTicket {
  attachmentId: string;
  storageKey: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface CommentAttachmentInput {
  attachmentId: string;
  filename: string;
  storageKey: string;
  contentType: string;
  size: number;
}

export interface RateLimitMeta {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
}

export interface MuteMeta {
  active: boolean;
  scopes: string[];
}

export interface CommentMeta {
  wallet: string;
  rateLimit: RateLimitMeta;
  mute: MuteMeta;
  ignoreList: string[];
}

export interface CommentRecord {
  commentId: string;
  threadId: string;
  wallet: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  attachments: CommentAttachmentView[];
}

export interface ChatMessageRecord {
  messageId: string;
  wallet: string;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMeta {
  wallet: string;
  rateLimit: RateLimitMeta;
  mute: MuteMeta;
  ignoreList: string[];
}

export interface ChatMessagePayload {
  wallet: string;
  message: string;
  signature: string;
}

export interface CommentPayload {
  threadId: string;
  wallet: string;
  message: string;
  signature: string;
  attachments?: CommentAttachmentInput[];
}

export interface IgnoreListPayload {
  wallet: string;
  targetWallet: string;
  action: 'add' | 'remove';
  message: string;
  signature: string;
}

export interface AttachmentRequestPayload {
  wallet: string;
  filename: string;
  contentType: string;
  size: number;
  message: string;
  signature: string;
}

