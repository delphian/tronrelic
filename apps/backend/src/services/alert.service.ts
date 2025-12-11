import type { IDatabaseService } from '@tronrelic/types';
import { logger } from '../lib/logger.js';
import {
  TransactionMemoModel,
  SunPumpTokenModel,
  type TransactionMemoDoc,
  type SunPumpTokenDoc,
} from '../database/models/index.js';
import { TronGridClient, TronGridEvent } from '../modules/blockchain/tron-grid.client.js';
import type { TransactionPersistencePayload } from '../modules/blockchain/blockchain.service.js';
import { WebSocketService } from './websocket.service.js';

const SUNPUMP_FACTORY_ADDRESS = 'TTfvyrAz86hbZk5iDpKD78pqLGgi8C7AAw';
const SUNPUMP_METHOD_SIGNATURE = '2f70d762';
const MEMOS_COLLECTION = 'transaction_memos';
const SUNPUMP_COLLECTION = 'sunpump_tokens';

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


/**
 * AlertService collects and stores blockchain alerts (memos, SunPump tokens).
 *
 * This service ingests transactions from the blockchain sync pipeline and:
 * - Persists memo transactions to database
 * - Persists SunPump token creations to database
 * - Emits WebSocket events for real-time frontend updates
 *
 * Note: Telegram notification delivery was removed and should be handled by
 * the telegram-bot plugin using plugin-to-plugin service architecture.
 */
export class AlertService {
  private readonly tronClient: TronGridClient;
  private readonly websocket = WebSocketService.getInstance();
  private readonly database: IDatabaseService;

  constructor(database: IDatabaseService, tronClient?: TronGridClient) {
    this.database = database;
    this.database.registerModel(MEMOS_COLLECTION, TransactionMemoModel);
    this.database.registerModel(SUNPUMP_COLLECTION, SunPumpTokenModel);
    this.tronClient = tronClient ?? TronGridClient.getInstance();
  }

  private getMemoModel() {
    return this.database.getModel<TransactionMemoDoc>(MEMOS_COLLECTION);
  }

  private getSunPumpModel() {
    return this.database.getModel<SunPumpTokenDoc>(SUNPUMP_COLLECTION);
  }

  /**
   * Ingest transactions from blockchain sync and persist alerts to database.
   *
   * Extracts memo transactions and SunPump token creations, stores them in
   * the database, and emits WebSocket events for real-time frontend updates.
   *
   * @param transactions - Array of transactions from blockchain sync pipeline
   */
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
            memo: memo.memo
          }
        },
        upsert: true
      }
    }));

    try {
      const result = await this.getMemoModel().bulkWrite(operations, { ordered: false });
      const insertedIndexes = Object.keys(result.upsertedIds ?? {}).map(key => Number.parseInt(key, 10));
      if (insertedIndexes.length) {
        const insertedTxIds = insertedIndexes
          .map(index => memos[index]?.txId)
          .filter((txId): txId is string => Boolean(txId));
        if (insertedTxIds.length) {
          const insertedDocs = await this.getMemoModel().find({ txId: { $in: insertedTxIds } }).lean();
          insertedDocs.forEach((doc: TransactionMemoDoc) => {
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
              tokenContract: entry.tokenContract
            }
          },
          upsert: true
        }
      }));

    if (!operations.length) {
      return;
    }

    try {
      await this.getSunPumpModel().bulkWrite(operations, { ordered: false });
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
}
