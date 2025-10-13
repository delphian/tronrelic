import { Types } from 'mongoose';
import { alertConfig } from '../config/alerts.js';
import { logger } from '../lib/logger.js';
import {
  TransactionMemoModel,
  SunPumpTokenModel,
  SyncStateModel,
  type SunPumpTokenDoc,
} from '../database/models/index.js';
import { TelegramService } from './telegram.service.js';
import { TronGridClient, TronGridEvent } from '../modules/blockchain/tron-grid.client.js';
import type { TransactionPersistencePayload } from '../modules/blockchain/blockchain.service.js';
import { telegramConfig } from '../config/telegram.js';
import { WebSocketService } from './websocket.service.js';

const MEMO_MAX_BURST = 10;
const MEMO_DELAY_MS = 10_000;
const SUNPUMP_FACTORY_ADDRESS = 'TTfvyrAz86hbZk5iDpKD78pqLGgi8C7AAw';
const SUNPUMP_METHOD_SIGNATURE = '2f70d762';
const TRONSCAN_TX_URL = 'https://tronscan.org/#/transaction/';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface MemoRecord {
  txId: string;
  blockNumber: number;
  timestamp: Date;
  fromAddress: string;
  toAddress: string;
  memo: string;
}

interface SunPumpRecord {
  txId: string;
  timestamp: Date;
  ownerAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenContract: string;
}


export class AlertService {
  private readonly telegram = new TelegramService();
  private readonly tronClient: TronGridClient;
  private readonly websocket = WebSocketService.getInstance();

  constructor(tronClient?: TronGridClient) {
    this.tronClient = tronClient ?? TronGridClient.getInstance();
  }

  async ingestTransactions(transactions: TransactionPersistencePayload[]) {
    const memoRecords: MemoRecord[] = [];
    const sunPumpCandidates: TransactionPersistencePayload[] = [];

    for (const tx of transactions) {
      const memo = tx.memo?.trim();
      if (tx.type === 'TransferContract' && memo) {
        memoRecords.push({
          txId: tx.txId,
          blockNumber: tx.blockNumber,
          timestamp: tx.timestamp,
          fromAddress: tx.from.address,
          toAddress: tx.to.address,
          memo
        });
      }

      if (tx.type === 'TriggerSmartContract') {
        sunPumpCandidates.push(tx);
      }
    }

    if (memoRecords.length) {
      await this.persistMemos(memoRecords);
    }

    if (sunPumpCandidates.length) {
      await this.persistSunPumpTokens(sunPumpCandidates);
    }

  }

  async dispatchPendingAlerts() {
    await this.dispatchMemoAlerts();
    await this.dispatchSunPumpAlerts();
  }

  async verifyParity() {
    const threshold = new Date(Date.now() - telegramConfig.parity.maxUnnotifiedLagMs);

    const [staleMemoCount, staleSunPumpCount] = await Promise.all([
      TransactionMemoModel.countDocuments({ notifiedAt: null, timestamp: { $lt: threshold } }),
      SunPumpTokenModel.countDocuments({ notifiedAt: null, timestamp: { $lt: threshold } })
    ]);

    const checkedAt = new Date();
    const parityState = {
      checkedAt,
      staleMemoCount,
      staleSunPumpCount,
      threshold: threshold.toISOString()
    };

    if (staleMemoCount > 0 || staleSunPumpCount > 0) {
      logger.error(parityState, 'Alert parity verification failed');
    } else {
      logger.debug(parityState, 'Alert parity verification passed');
    }

    await SyncStateModel.updateOne(
      { key: 'alerts:parity' },
      {
        cursor: { checkedAt },
        meta: parityState
      },
      { upsert: true }
    );
  }

  private async persistMemos(memos: MemoRecord[]) {
    const operations = memos.map(memo => ({
      updateOne: {
        filter: { txId: memo.txId },
        update: {
          $setOnInsert: {
            blockNumber: memo.blockNumber,
            timestamp: memo.timestamp,
            fromAddress: memo.fromAddress,
            toAddress: memo.toAddress,
            memo: memo.memo,
            channelId: alertConfig.memos.channelId,
            threadId: alertConfig.memos.threadId
          }
        },
        upsert: true
      }
    }));

    try {
      const result = await TransactionMemoModel.bulkWrite(operations, { ordered: false });
      const insertedIndexes = Object.keys(result.upsertedIds ?? {}).map(key => Number.parseInt(key, 10));
      if (insertedIndexes.length) {
        const insertedTxIds = insertedIndexes
          .map(index => memos[index]?.txId)
          .filter((txId): txId is string => Boolean(txId));
        if (insertedTxIds.length) {
          const insertedDocs = await TransactionMemoModel.find({ txId: { $in: insertedTxIds } }).lean();
          insertedDocs.forEach(doc => {
            this.websocket.emit({
              event: 'memo:new',
              payload: {
                memoId: String(doc._id),
                txId: doc.txId,
                memo: doc.memo,
                timestamp: doc.timestamp.toISOString(),
                fromAddress: doc.fromAddress,
                toAddress: doc.toAddress
              }
            });
          });
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to persist memo alerts');
    }
  }

  private async persistSunPumpTokens(candidates: TransactionPersistencePayload[]) {
    const entries: (SunPumpRecord | null)[] = await Promise.all(
      candidates.map(candidate => this.buildSunPumpRecord(candidate))
    );

    const operations = entries
      .filter((entry): entry is SunPumpRecord => entry !== null)
      .map(entry => ({
        updateOne: {
          filter: { txId: entry.txId },
          update: {
            $setOnInsert: {
              timestamp: entry.timestamp,
              ownerAddress: entry.ownerAddress,
              tokenName: entry.tokenName,
              tokenSymbol: entry.tokenSymbol,
              tokenContract: entry.tokenContract,
              channelId: alertConfig.sunpump.channelId,
              threadId: alertConfig.sunpump.threadId
            }
          },
          upsert: true
        }
      }));

    if (!operations.length) {
      return;
    }

    try {
      await SunPumpTokenModel.bulkWrite(operations, { ordered: false });
    } catch (error) {
      logger.error({ error }, 'Failed to persist SunPump alerts');
    }
  }


  private async buildSunPumpRecord(tx: TransactionPersistencePayload): Promise<SunPumpRecord | null> {
    const contractAddress = tx.contract?.address ?? 'unknown';
    if (contractAddress !== SUNPUMP_FACTORY_ADDRESS) {
      return null;
    }

    const rawData = tx.contract?.parameters?.rawData;
    if (typeof rawData !== 'string') {
      return null;
    }

    const segments = this.decodeAbiSegments(rawData);
    if (!segments || segments[0] !== SUNPUMP_METHOD_SIGNATURE) {
      return null;
    }

    const tokenName = this.decodeUtf8(segments[4]);
    const tokenSymbol = this.decodeUtf8(segments[6]);

    if (!tokenName || !tokenSymbol) {
      return null;
    }

    const events = await this.tronClient.getTransactionEvents(tx.txId);
    const ownershipEvent = this.findOwnershipEvent(events);

    if (!ownershipEvent?.contract_address) {
      logger.warn({ txId: tx.txId }, 'OwnershipTransferred event missing for SunPump tx');
      return null;
    }

    const tokenContract = this.normalizeAddress(ownershipEvent.contract_address);

    return {
      txId: tx.txId,
      timestamp: tx.timestamp,
      ownerAddress: tx.from.address,
      tokenName,
      tokenSymbol,
      tokenContract
    };
  }

  private decodeAbiSegments(rawData: string): string[] | null {
    const normalized = rawData.startsWith('0x') ? rawData.slice(2) : rawData;
    if (normalized.length < 8) {
      return null;
    }
    const method = normalized.slice(0, 8).toLowerCase();
    const args = normalized.slice(8).match(/.{1,64}/g) ?? [];
    return [method, ...args];
  }

  private decodeUtf8(hex: string | undefined): string {
    if (!hex) {
      return '';
    }
    const sanitized = hex.replace(/(00)+$/u, '');
    if (!sanitized.length) {
      return '';
    }
    const buffer = Buffer.from(sanitized, 'hex');
    return buffer.toString('utf8').trim();
  }

  private findOwnershipEvent(events: TronGridEvent[]): TronGridEvent | undefined {
    return events.find(event => event.event_name === 'OwnershipTransferred');
  }

  private normalizeAddress(address: string): string {
    if (!address) {
      return address;
    }
    if (address.length > 34) {
      const converted = TronGridClient.toBase58Address(address);
      return converted ?? address;
    }
    return address;
  }

  private async dispatchMemoAlerts() {
    const memos = await TransactionMemoModel.find({ notifiedAt: null })
      .sort({ timestamp: 1 })
      .limit(25);

    if (!memos.length) {
      return;
    }

    const now = new Date();
    const channelId = alertConfig.memos.channelId;
    const threadId = alertConfig.memos.threadId;

    const memoTexts = memos.map(memo => memo.memo);

    try {
      if (memoTexts.length > MEMO_MAX_BURST) {
        const body = memoTexts.join('\n');
        await this.telegram.sendMessage(channelId, body, { threadId, parseMode: null });
      } else {
        for (let index = 0; index < memoTexts.length; index += 1) {
          await this.telegram.sendMessage(channelId, memoTexts[index], { threadId, parseMode: null });
          if (memoTexts.length > 1 && index < memoTexts.length - 1) {
            await delay(MEMO_DELAY_MS);
          }
        }
      }

      await TransactionMemoModel.updateMany(
        { _id: { $in: memos.map(memo => memo._id as Types.ObjectId) } },
        { $set: { notifiedAt: now } }
      );
    } catch (error) {
      logger.error({ error }, 'Failed to dispatch memo alerts');
    }
  }

  private async dispatchSunPumpAlerts() {
    const tokens = await SunPumpTokenModel.find({ notifiedAt: null })
      .sort({ timestamp: 1 })
      .limit(10);

    if (!tokens.length) {
      return;
    }

    const now = new Date();
    const channelId = alertConfig.sunpump.channelId;
    const threadId = alertConfig.sunpump.threadId;

    try {
      for (const token of tokens) {
        const message = this.buildSunPumpMessage(token);
        await this.telegram.sendMessage(channelId, message, { threadId, parseMode: null, disablePreview: true });
      }

      await SunPumpTokenModel.updateMany(
        { _id: { $in: tokens.map(token => token._id as Types.ObjectId) } },
        { $set: { notifiedAt: now } }
      );
    } catch (error) {
      logger.error({ error }, 'Failed to dispatch SunPump alerts');
    }
  }

  private buildSunPumpMessage(token: SunPumpTokenDoc): string {
    const lines = [
      `${token.tokenSymbol} / ${token.tokenName}`,
      `Owner: ${token.ownerAddress}`,
      `Contract: ${token.tokenContract}`
    ];
    return lines.join('\n');
  }


}
