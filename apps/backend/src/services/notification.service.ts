import { createHash } from 'node:crypto';
import type { TronRelicSocketEvent, NotificationChannel } from '@tronrelic/shared';
import { WebSocketService } from './websocket.service.js';
import {
  NotificationDeliveryModel,
  NotificationSubscriptionModel,
  type NotificationSubscriptionDoc,
  type NotificationSubscriptionFields
} from '../database/models/index.js';
import { logger } from '../lib/logger.js';
import { resolveChannels, resolveThrottleMs } from '../config/notifications.js';
import { EmailService } from './email.service.js';

const TRONSCAN_TX_URL = 'https://tronscan.org/#/transaction/';

interface UpdatePreferencesPayload {
  channels?: NotificationChannel[];
  thresholds?: Record<string, number>;
  preferences?: Record<string, unknown>;
  throttleOverrides?: Partial<Record<NotificationChannel, number>>;
}

export class NotificationService {
  constructor(
    private readonly websocket = WebSocketService.getInstance(),
    private readonly email = new EmailService()
  ) {}

  async broadcast(event: TronRelicSocketEvent) {
    this.websocket.emit(event);
  }

  async notifyWallets(event: TronRelicSocketEvent, wallets: string[]) {
    const uniqueWallets = Array.from(new Set(wallets.map(wallet => wallet.trim()))).filter(Boolean);
    if (!uniqueWallets.length) {
      return;
    }

    const subscriptions = await NotificationSubscriptionModel.find({ wallet: { $in: uniqueWallets } }).lean() as NotificationSubscriptionFields[];

    if (!subscriptions.length) {
      return;
    }

    const payloadHash = this.computePayloadHash(event);

    await Promise.all(
      subscriptions.map(subscription =>
        this.dispatchToWallet(subscription.wallet, event, payloadHash, subscription as unknown as NotificationSubscriptionDoc)
      )
    );
  }

  async updatePreferences(wallet: string, payload: UpdatePreferencesPayload) {
    const normalizedWallet = wallet.trim();
    const channels = resolveChannels(payload.channels);
    await NotificationSubscriptionModel.updateOne(
      { wallet: normalizedWallet },
      {
        wallet: normalizedWallet,
        channels,
        thresholds: payload.thresholds ?? {},
        preferences: payload.preferences ?? {},
        throttleOverrides: payload.throttleOverrides ?? {}
      },
      { upsert: true }
    );
  }

  async getPreferences(wallet: string) {
    const normalizedWallet = wallet.trim();
    if (!normalizedWallet) {
      throw new Error('Wallet is required for preferences lookup');
    }

    const doc = await NotificationSubscriptionModel.findOne({ wallet: normalizedWallet }).lean() as NotificationSubscriptionFields | null;
    const channels = resolveChannels(doc?.channels);
    return {
      wallet: normalizedWallet,
      channels,
      thresholds: doc?.thresholds ?? {},
      preferences: doc?.preferences ?? {},
      throttleOverrides: doc?.throttleOverrides ?? {}
    };
  }

  private async dispatchToWallet(
    wallet: string,
    event: TronRelicSocketEvent,
    payloadHash: string,
    subscription: NotificationSubscriptionDoc
  ) {
    if (!this.shouldDeliverByThreshold(event, subscription.thresholds ?? {})) {
      logger.debug({ wallet, event: event.event }, 'Notification skipped by threshold');
      return;
    }

    const channels = resolveChannels(subscription.channels);
    await Promise.all(
      channels.map(channel =>
        this.deliverThroughChannel(wallet, channel, event, payloadHash, subscription)
      )
    );
  }

  private async deliverThroughChannel(
    wallet: string,
    channel: NotificationChannel,
    event: TronRelicSocketEvent,
    payloadHash: string,
    subscription: NotificationSubscriptionDoc
  ) {
    const throttleMs = resolveThrottleMs(channel, subscription.throttleOverrides);
    const record = await NotificationDeliveryModel.findOne({ wallet, channel, event: event.event }).lean();
    if (record) {
      const lastSentAt = record.lastSentAt instanceof Date ? record.lastSentAt : new Date(record.lastSentAt);
      const elapsed = Date.now() - lastSentAt.getTime();
      if (elapsed < throttleMs && record.payloadHash === payloadHash) {
        logger.debug({ wallet, channel, event: event.event }, 'Notification throttled');
        return;
      }
    }

    let delivered = false;

    switch (channel) {
      case 'websocket':
        this.websocket.emitToWallet(wallet, event);
        delivered = true;
        break;
      case 'email':
        delivered = await this.deliverViaEmail(subscription, event);
        break;
      default:
        logger.warn({ wallet, channel, event: event.event }, 'Unsupported notification channel');
        return;
    }

    if (!delivered) {
      return;
    }

    await NotificationDeliveryModel.updateOne(
      { wallet, channel, event: event.event },
      {
        wallet,
        channel,
        event: event.event,
        payloadHash,
        lastSentAt: new Date()
      },
      { upsert: true }
    );
  }

  private async deliverViaEmail(
    subscription: NotificationSubscriptionDoc,
    event: TronRelicSocketEvent
  ): Promise<boolean> {
    const prefs = this.getEmailPreferences(subscription);
    if (!prefs) {
      logger.debug({ wallet: subscription.wallet }, 'Skipping email notification; preferences missing');
      return false;
    }

    if (!this.email.isConfigured()) {
      logger.debug({ wallet: subscription.wallet }, 'Email service not configured; skipping delivery');
      return false;
    }

    const content = this.buildEmailContent(event);
    if (!content) {
      logger.debug({ event: event.event }, 'Skipping email notification; unsupported event type');
      return false;
    }

    try {
      const delivered = await this.email.sendNotification({
        to: prefs.address,
        subject: content.subject,
        text: content.text,
        html: content.html
      });
      return delivered;
    } catch (error) {
      logger.error({ error, wallet: subscription.wallet, event: event.event }, 'Failed to deliver email notification');
      return false;
    }
  }

  private getEmailPreferences(
    subscription: NotificationSubscriptionDoc
  ): { address: string } | null {
    const prefs = (subscription.preferences ?? {}) as Record<string, unknown>;
    const channelPrefs = this.extractRecord(prefs.email ?? prefs.emailPreferences ?? null);

    let address: string | undefined;

    if (channelPrefs) {
      address = this.stringify(channelPrefs.address ?? channelPrefs.email);
    }

    if (!address) {
      address = this.stringify(prefs.emailAddress ?? prefs.email_address);
    }

    if (!address) {
      return null;
    }

    return { address };
  }

  private buildEmailContent(event: TronRelicSocketEvent): { subject: string; text: string; html?: string } | null {
    const lines = this.buildNotificationLines(event);
    if (!lines?.length) {
      return null;
    }

    const subject = `TronRelic alert: ${event.event}`;
    const text = lines.join('\n');
    return { subject, text };
  }

  private buildNotificationLines(event: TronRelicSocketEvent): string[] | null {
    switch (event.event) {
      case 'market:update': {
        const { payload } = event;
        const price = this.formatNumber(payload.effectivePrice ?? payload.energy.price);
        const availability = this.formatNumber(payload.energy.available);
        return [
          `📊 ${payload.name} market update`,
          price ? `Effective price: ${price} TRX` : null,
          availability ? `Available energy: ${availability}` : null,
          typeof payload.reliability === 'number'
            ? `Reliability: ${(payload.reliability * 100).toFixed(1)}%`
            : null
        ].filter((line): line is string => Boolean(line));
      }
      case 'transaction:large':
      case 'delegation:new':
      case 'stake:new': {
        const { payload } = event;
        const amount = this.formatNumber(payload.amountTRX);
        const memo = payload.memo?.trim();
        const pattern = payload.analysis?.pattern ? `Pattern: ${payload.analysis.pattern}` : null;
        return [
          event.event === 'transaction:large'
            ? '🚨 Large transaction detected'
            : event.event === 'delegation:new'
              ? '🤝 Delegation activity detected'
              : '🛡️ Stake update detected',
          amount ? `Amount: ${amount} TRX` : null,
          `From: ${payload.from.address}`,
          `To: ${payload.to.address}`,
          memo ? `Memo: ${memo}` : null,
          pattern,
          `TX: ${TRONSCAN_TX_URL}${payload.txId}`
        ].filter((line): line is string => Boolean(line));
      }
      case 'block:new': {
        const { payload } = event;
        const timestamp = new Date(payload.timestamp);
        const formatted = Number.isNaN(timestamp.getTime())
          ? payload.timestamp
          : `${timestamp.toISOString()}`;
        const tps = this.extractStatNumber(payload.stats, 'tps');
        const txCount = this.extractStatNumber(payload.stats, 'transactionCount');
        return [
          `🧱 Block ${payload.blockNumber} processed`,
          `Time: ${formatted}`,
          tps ? `TPS: ${tps}` : null,
          txCount ? `Transactions: ${txCount}` : null
        ].filter((line): line is string => Boolean(line));
      }
      case 'comments:new': {
        const { payload } = event;
        return [
          `💬 New comment from ${payload.wallet}`,
          `Thread: ${payload.threadId}`,
          payload.message
        ];
      }
      case 'chat:update': {
        const { payload } = event;
        return [
          `💬 Chat update from ${payload.wallet}`,
          payload.message
        ];
      }
      default:
        return null;
    }
  }

  private extractRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private stringify(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
    return undefined;
  }

  private parseNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private formatNumber(value: unknown): string | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  private extractStatNumber(stats: Record<string, unknown> | undefined, key: string): string | undefined {
    if (!stats) {
      return undefined;
    }
    const value = stats[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    return undefined;
  }

  private shouldDeliverByThreshold(event: TronRelicSocketEvent, thresholds: Record<string, number>): boolean {
    const threshold = thresholds?.[event.event];
    if (threshold === undefined) {
      return true;
    }

    if (event.event === 'transaction:large') {
      const amount = (event.payload as { amountTRX?: number } | undefined)?.amountTRX;
      if (typeof amount === 'number') {
        return amount >= threshold;
      }
      logger.warn({ event }, 'Missing amountTRX for transaction threshold check');
      return false;
    }

    return true;
  }

  private computePayloadHash(event: TronRelicSocketEvent): string {
    return createHash('sha1')
      .update(JSON.stringify({ event: event.event, payload: event.payload }))
      .digest('hex');
  }
}
