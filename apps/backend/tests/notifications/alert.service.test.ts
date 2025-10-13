/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { alertConfig } from '../../src/config/alerts';

const {
  memoFindMock,
  memoUpdateMock,
  sunFindMock,
  sunUpdateMock,
  whaleFindMock,
  whaleUpdateMock,
  syncStateUpdateMock,
  sendMessageMock
} = vi.hoisted(() => ({
  memoFindMock: vi.fn(),
  memoUpdateMock: vi.fn(),
  sunFindMock: vi.fn(),
  sunUpdateMock: vi.fn(),
  whaleFindMock: vi.fn(),
  whaleUpdateMock: vi.fn(),
  syncStateUpdateMock: vi.fn(),
  sendMessageMock: vi.fn()
}));

vi.mock('../../src/services/telegram.service', () => ({
  TelegramService: vi.fn().mockImplementation(() => ({
    sendMessage: sendMessageMock,
    answerCallbackQuery: vi.fn()
  }))
}));

vi.mock('../../src/modules/blockchain/tron-grid.client', () => ({
  TronGridClient: class {
    static toBase58Address = vi.fn();
    getTransactionEvents = vi.fn().mockResolvedValue([]);
  }
}));

vi.mock('../../src/database/models', () => ({
  TransactionMemoModel: {
    find: memoFindMock,
    updateMany: memoUpdateMock
  },
  SunPumpTokenModel: {
    find: sunFindMock,
    updateMany: sunUpdateMock
  },
  WhaleTransactionModel: {
    find: whaleFindMock,
    updateMany: whaleUpdateMock
  },
  SyncStateModel: {
    updateOne: syncStateUpdateMock
  }
}));

import { AlertService } from '../../src/services/alert.service';

describe('AlertService dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createQuery = <T>(results: T[]) => ({
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(results)
  });

  it('sends memo and SunPump alerts and marks them notified', async () => {
    const memoDocs = [
      {
        _id: 'memo1',
        memo: 'Important memo',
        channelId: '-100memo',
        threadId: 10,
        timestamp: new Date(),
        fromAddress: 'TFrom',
        toAddress: 'TTo'
      }
    ];

    const sunDocs = [
      {
        _id: 'sun1',
        tokenSymbol: 'SUN',
        tokenName: 'Sun Token',
        tokenContract: 'TContract',
        ownerAddress: 'TOwner',
        channelId: '-100sun',
        threadId: 99,
        timestamp: new Date()
      }
    ];

    memoFindMock.mockReturnValue(createQuery(memoDocs));
    sunFindMock.mockReturnValue(createQuery(sunDocs));
    whaleFindMock.mockReturnValue(createQuery([]));

    memoUpdateMock.mockResolvedValue(undefined);
    sunUpdateMock.mockResolvedValue(undefined);
    whaleUpdateMock.mockResolvedValue(undefined);

    const service = new AlertService();

    await service.dispatchPendingAlerts();

    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      1,
      alertConfig.memos.channelId,
      'Important memo',
      expect.objectContaining({ threadId: alertConfig.memos.threadId })
    );
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      2,
      alertConfig.sunpump.channelId,
      expect.stringContaining('Sun Token'),
      expect.objectContaining({ threadId: alertConfig.sunpump.threadId })
    );

    expect(memoUpdateMock).toHaveBeenCalledTimes(1);
    expect(sunUpdateMock).toHaveBeenCalledTimes(1);
    expect(whaleUpdateMock).not.toHaveBeenCalled();
  });
});
