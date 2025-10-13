/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { TronRelicSocketEvent } from '@tronrelic/shared';

const {
  subscriptionFindMock,
  subscriptionUpdateMock,
  subscriptionFindOneMock,
  deliveryFindOneMock,
  deliveryUpdateOneMock
} = vi.hoisted(() => ({
  subscriptionFindMock: vi.fn(),
  subscriptionUpdateMock: vi.fn(),
  subscriptionFindOneMock: vi.fn(),
  deliveryFindOneMock: vi.fn(),
  deliveryUpdateOneMock: vi.fn()
}));

vi.mock('../../src/database/models', () => ({
  NotificationSubscriptionModel: {
    find: subscriptionFindMock,
    updateOne: subscriptionUpdateMock,
    findOne: subscriptionFindOneMock
  },
  NotificationDeliveryModel: {
    findOne: deliveryFindOneMock,
    updateOne: deliveryUpdateOneMock
  }
}));

import { NotificationService } from '../../src/services/notification.service';

describe('NotificationService channel delivery', () => {
  let websocketMock: { emitToWallet: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> };
  let telegramMock: { sendMessage: ReturnType<typeof vi.fn> };
  let emailMock: { isConfigured: ReturnType<typeof vi.fn>; sendNotification: ReturnType<typeof vi.fn> };
  let service: NotificationService;
  let currentSubscriptions: any[];
  let currentDeliveryRecord: any;

  const event: TronRelicSocketEvent = {
    event: 'transaction:large',
    payload: {
      txId: 'abc123',
      blockNumber: 1,
      timestamp: new Date().toISOString(),
      type: 'TransferContract',
      from: { address: 'TFrom' },
      to: { address: 'TTo' },
      amount: 500_000_000,
      amountTRX: 500_000,
      memo: 'test memo',
      analysis: { pattern: 'distribution' }
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    websocketMock = {
      emitToWallet: vi.fn(),
      emit: vi.fn()
    };
    telegramMock = {
      sendMessage: vi.fn().mockResolvedValue(undefined)
    };
    emailMock = {
      isConfigured: vi.fn().mockReturnValue(false),
      sendNotification: vi.fn()
    };

    service = new NotificationService(
      websocketMock as unknown as any,
      telegramMock as unknown as any,
      emailMock as unknown as any
    );

    currentSubscriptions = [];
    currentDeliveryRecord = null;

    subscriptionFindMock.mockImplementation(() => ({
      lean: vi.fn().mockResolvedValue(currentSubscriptions)
    }));
    deliveryFindOneMock.mockImplementation(() => ({
      lean: vi.fn().mockImplementation(() => Promise.resolve(currentDeliveryRecord))
    }));
    deliveryUpdateOneMock.mockResolvedValue(undefined);
    subscriptionUpdateMock.mockResolvedValue(undefined);
    subscriptionFindOneMock.mockResolvedValue(null);
  });

  const computeHash = (payload: TronRelicSocketEvent) =>
    createHash('sha1').update(JSON.stringify({ event: payload.event, payload: payload.payload })).digest('hex');

  it('delivers Telegram alerts and respects throttle window', async () => {
    currentSubscriptions = [
      {
        wallet: 'TWallet123',
        channels: ['telegram'],
        thresholds: {},
        preferences: {
          telegram: {
            chatId: '-100123',
            threadId: 5,
            parseMode: null,
            disablePreview: true
          }
        },
        throttleOverrides: {}
      }
    ];

    currentDeliveryRecord = null;

    await service.notifyWallets(event, ['TWallet123']);

    expect(telegramMock.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegramMock.sendMessage).toHaveBeenCalledWith('-100123', expect.stringContaining('Large transaction'), {
      threadId: 5,
      disablePreview: true,
      parseMode: null
    });
    expect(deliveryUpdateOneMock).toHaveBeenCalledTimes(1);

    const payloadHash = computeHash(event);
    currentDeliveryRecord = {
      wallet: 'TWallet123',
      channel: 'telegram',
      event: 'transaction:large',
      payloadHash,
      lastSentAt: new Date()
    };

    deliveryUpdateOneMock.mockClear();
    telegramMock.sendMessage.mockClear();

    await service.notifyWallets(event, ['TWallet123']);

    expect(telegramMock.sendMessage).not.toHaveBeenCalled();
    expect(deliveryUpdateOneMock).not.toHaveBeenCalled();
  });

  it('skips telegram delivery when preferences missing', async () => {
    currentSubscriptions = [
      {
        wallet: 'TWallet999',
        channels: ['telegram'],
        thresholds: {},
        preferences: {},
        throttleOverrides: {}
      }
    ];

    currentDeliveryRecord = null;

    await service.notifyWallets(event, ['TWallet999']);

    expect(telegramMock.sendMessage).not.toHaveBeenCalled();
    expect(deliveryUpdateOneMock).not.toHaveBeenCalled();
  });
});
