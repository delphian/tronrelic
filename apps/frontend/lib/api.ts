import axios from 'axios';
import type { MarketComparisonResult, MarketDocument, NotificationChannel } from '@tronrelic/shared';
import { config } from './config';

export const apiClient = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 5000
});

export async function getMarkets(limit?: number) {
  const response = await apiClient.get('/markets/compare', {
    params: limit ? { limit } : undefined
  });
  const { markets } = response.data as {
    success: boolean;
    markets: MarketDocument[];
  };
  return markets;
}

export async function getMarketComparison(limit?: number): Promise<MarketComparisonResult> {
  const response = await apiClient.get('/markets/compare', {
    params: limit ? { limit } : undefined
  });

  const { markets, stats } = response.data as {
    success: boolean;
    markets: MarketComparisonResult['markets'];
    stats: MarketComparisonResult['stats'];
  };

  return {
    markets,
    stats
  } satisfies MarketComparisonResult;
}

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

export interface BookmarkRecord {
  ownerWallet: string;
  targetWallet: string;
  label?: string | null;
  createdAt: string;
  updatedAt: string;
  _id?: string;
}

export interface BookmarkMutationPayload {
  ownerWallet: string;
  targetWallet: string;
  label?: string | null;
  message: string;
  signature: string;
}

export async function getWalletBookmarks(wallet: string): Promise<BookmarkRecord[]> {
  const response = await apiClient.get('/accounts/bookmarks', {
    params: { wallet }
  });
  const { bookmarks } = response.data as { success: boolean; bookmarks: BookmarkRecord[] };
  return bookmarks;
}

export async function upsertWalletBookmark(payload: BookmarkMutationPayload): Promise<BookmarkRecord[]> {
  const response = await apiClient.post('/accounts/bookmarks', payload);
  const { bookmarks } = response.data as { success: boolean; bookmarks: BookmarkRecord[] };
  return bookmarks;
}

export async function deleteWalletBookmark(payload: BookmarkMutationPayload): Promise<BookmarkRecord[]> {
  const response = await apiClient.delete('/accounts/bookmarks', { data: payload });
  const { bookmarks } = response.data as { success: boolean; bookmarks: BookmarkRecord[] };
  return bookmarks;
}

const adminHeaderKey = 'x-admin-token';

function adminHeaders(token: string) {
  return {
    headers: {
      [adminHeaderKey]: token
    }
  };
}

export async function adminGetSpamQueue(token: string): Promise<ModerationSpamQueue> {
  const response = await apiClient.get('/admin/moderation/spam-queue', adminHeaders(token));
  const { queue } = response.data as { success: boolean; queue: ModerationSpamQueue };
  return queue;
}

export async function adminGetMutes(token: string, scope?: ModerationScope): Promise<ModerationMuteRecord[]> {
  const response = await apiClient.get('/admin/moderation/mutes', {
    ...adminHeaders(token),
    params: scope ? { scope } : undefined
  });
  const { mutes } = response.data as { success: boolean; mutes: ModerationMuteRecord[] };
  return mutes;
}

export async function adminMuteWallet(token: string, payload: ModerationMutePayload) {
  await apiClient.post('/admin/moderation/mutes', payload, adminHeaders(token));
}

export async function adminUnmuteWallet(token: string, payload: ModerationMuteRevokePayload) {
  await apiClient.delete('/admin/moderation/mutes', {
    ...adminHeaders(token),
    data: payload
  });
}

export async function adminListIgnoreEntries(token: string, params: ModerationIgnoreQuery): Promise<ModerationIgnoreEntry[]> {
  const response = await apiClient.get('/admin/moderation/ignore', {
    ...adminHeaders(token),
    params
  });
  const { entries } = response.data as { success: boolean; entries: ModerationIgnoreEntry[] };
  return entries;
}

export async function adminAddIgnoreEntry(token: string, payload: ModerationIgnoreMutation) {
  await apiClient.post('/admin/moderation/ignore', payload, adminHeaders(token));
}

export async function adminRemoveIgnoreEntry(token: string, payload: ModerationIgnoreMutation) {
  await apiClient.delete('/admin/moderation/ignore', {
    ...adminHeaders(token),
    data: payload
  });
}

export async function adminDeleteComment(token: string, commentId: string, payload: ModerationActionPayload) {
  await apiClient.post(`/admin/moderation/comments/${commentId}/delete`, payload, adminHeaders(token));
}

export async function adminRestoreComment(token: string, commentId: string, payload: ModerationPerformedByPayload) {
  await apiClient.post(`/admin/moderation/comments/${commentId}/restore`, payload, adminHeaders(token));
}

export async function adminFlagCommentSpam(token: string, commentId: string, payload: ModerationActionPayload) {
  await apiClient.post(`/admin/moderation/comments/${commentId}/spam`, payload, adminHeaders(token));
}

export async function adminUnflagCommentSpam(token: string, commentId: string, payload: ModerationPerformedByPayload) {
  await apiClient.post(`/admin/moderation/comments/${commentId}/unspam`, payload, adminHeaders(token));
}

export async function adminDeleteChatMessage(token: string, messageId: string, payload: ModerationActionPayload) {
  await apiClient.post(`/admin/moderation/chat/${messageId}/delete`, payload, adminHeaders(token));
}

export async function adminRestoreChatMessage(token: string, messageId: string, payload: ModerationPerformedByPayload) {
  await apiClient.post(`/admin/moderation/chat/${messageId}/restore`, payload, adminHeaders(token));
}

export async function adminFlagChatSpam(token: string, messageId: string, payload: ModerationActionPayload) {
  await apiClient.post(`/admin/moderation/chat/${messageId}/spam`, payload, adminHeaders(token));
}

export async function adminUnflagChatSpam(token: string, messageId: string, payload: ModerationPerformedByPayload) {
  await apiClient.post(`/admin/moderation/chat/${messageId}/unspam`, payload, adminHeaders(token));
}

export async function getNotificationPreferences(wallet: string) {
  const response = await apiClient.get('/notifications/preferences', {
    params: { wallet }
  });
  return (response.data as { success: boolean; preferences: NotificationPreferences }).preferences;
}

export async function updateNotificationPreferences(payload: NotificationPreferencesRequest) {
  await apiClient.post('/notifications/preferences', payload);
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
  clusterId?: string;
  confidence?: number;
}

export interface MarketHistoryRecord {
  recordedAt: string;
  effectivePrice?: number;
  bestPrice?: number;
  averagePrice?: number;
  minUsdtTransferCost?: number;
  availabilityPercent?: number;
  availabilityConfidence?: number;
  sampleSize?: number;
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

export async function getMarketHistory(guid: string, limit = 4320, bucketHours = 6): Promise<MarketHistoryRecord[]> {
  const response = await apiClient.get(`/markets/${guid}/history`, {
    params: { limit, bucket_hours: bucketHours }
  });
  const { history } = response.data as { success: boolean; history: MarketHistoryRecord[] };
  return history;
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

export type ModerationScope = 'comments' | 'chat' | 'all';

export interface ModerationCommentRecord extends CommentRecord {
  flags: {
    spam: boolean;
    moderated: boolean;
    deleted: boolean;
  };
  moderation?: {
    deletedAt?: string;
    deletedBy?: string;
    deletedReason?: string;
    spamAt?: string;
    spamBy?: string;
    spamReason?: string;
  };
}

export interface ModerationChatRecord extends ChatMessageRecord {
  flags: {
    spam: boolean;
    moderated: boolean;
    deleted: boolean;
  };
  moderation?: {
    deletedAt?: string;
    deletedBy?: string;
    deletedReason?: string;
    spamAt?: string;
    spamBy?: string;
    spamReason?: string;
  };
}

export interface ModerationSpamQueue {
  comments: ModerationCommentRecord[];
  chatMessages: ModerationChatRecord[];
}

export interface ModerationMuteRecord {
  wallet: string;
  scope: ModerationScope;
  reason?: string;
  expiresAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModerationMutePayload {
  wallet: string;
  scope: ModerationScope;
  performedBy: string;
  reason?: string;
  expiresAt?: string;
}

export interface ModerationMuteRevokePayload {
  wallet: string;
  scope: ModerationScope;
  performedBy: string;
}

export interface ModerationIgnoreEntry {
  ownerWallet: string;
  ignoredWallet: string;
  scope: ModerationScope;
  createdAt: string;
}

export interface ModerationIgnoreQuery {
  wallet: string;
  scope?: ModerationScope;
}

export interface ModerationIgnoreMutation {
  ownerWallet: string;
  ignoredWallet: string;
  scope: ModerationScope;
  performedBy: string;
}

export interface ModerationActionPayload {
  performedBy: string;
  reason?: string;
}

export interface ModerationPerformedByPayload {
  performedBy: string;
}

export interface NotificationPreferences {
  wallet: string;
  channels: NotificationChannel[];
  thresholds: Record<string, number>;
  preferences: Record<string, unknown>;
  throttleOverrides: Partial<Record<NotificationChannel, number>>;
}

export interface NotificationPreferencesRequest {
  wallet: string;
  channels?: NotificationChannel[];
  thresholds?: Record<string, number>;
  preferences?: Record<string, unknown>;
  throttleOverrides?: Partial<Record<NotificationChannel, number>>;
}

