/// <reference types="vitest" />

import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('../../src/services/queue.service', () => {
  class MockQueueService<T> {
    enqueue = vi.fn();
  }
  return { QueueService: MockQueueService };
});

const redisMock = {
  set: vi.fn().mockResolvedValue('OK'),
  eval: vi.fn().mockResolvedValue(1)
};

vi.mock('../../src/loaders/redis', () => ({
  getRedisClient: () => redisMock
}));

import { BlockchainService } from '../../src/modules/blockchain/blockchain.service';
import { TronGridClient, type TronGridBlock, type TronGridTransaction } from '../../src/modules/blockchain/tron-grid.client';

describe('BlockchainService transaction classification', () => {
  let service: any;

  beforeAll(() => {
    service = BlockchainService.getInstance() as unknown as Record<string, unknown>;
  });

  const baseBlock = (): TronGridBlock => ({
    blockID: '0000000000000000000000000000000000000000000000000000000000000000',
    block_header: {
      raw_data: {
        number: 100,
        timestamp: Date.now(),
        parentHash: '0000000000000000000000000000000000000000000000000000000000000000',
        witness_address: '410000000000000000000000000000000000000000'
      },
      witness_signature: ''
    },
    transactions: [],
    txTrieRoot: undefined,
    size: 0
  });

  const buildTransaction = (type: string, value: Record<string, unknown>): TronGridTransaction => ({
    txID: `0x${Math.random().toString(16).slice(2, 10)}`,
    raw_data: {
      timestamp: Date.now(),
      ref_block_hash: '',
      ref_block_bytes: '',
      contract: [
        {
          type,
          parameter: {
            value
          }
        }
      ],
      data: value.data as string | undefined
    }
  });

  const mockAddressConversion = (mapping: Record<string, string>) => {
    const spy = vi.spyOn(TronGridClient, 'toBase58Address');
    spy.mockImplementation((hex?: string | null) => {
      if (!hex) {
        return null;
      }
      const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
      return mapping[normalized] ?? `T${normalized.slice(-6)}`;
    });
    return spy;
  };

  it('defers whale classification to plugins', () => {
    const owner = '410000000000000000000000000000000000000001';
    const recipient = '4100000000000000000000000000000000000000aa';
    const memo = Buffer.from('Mega whale').toString('base64');

    const spy = mockAddressConversion({
      [owner]: 'TOwnerWhale',
      [recipient]: 'TRecipientWhale'
    });

    const block = baseBlock();
    const transaction = buildTransaction('TransferContract', {
      owner_address: owner,
      to_address: recipient,
      amount: 600_000 * 1_000_000,
      data: memo
    });

    const context = {
      priceUSD: 0.09,
      addressGraph: new Map(),
      blockTime: new Date(block.block_header.raw_data.timestamp)
    };

    const result = service.buildTransactionRecord(block, transaction, null, context);

    spy.mockRestore();

    expect(result).toBeTruthy();
    if (!result) {
      return;
    }

    expect(result.payload.analysis?.pattern).toBe('unknown');
    expect(result.payload.notifications).not.toContain('transaction:large');
    expect(result.payload.memo).toBe('Mega whale');
  });

  it('marks delegation transactions with delegation pattern and event', () => {
    const owner = '410000000000000000000000000000000000000010';
    const receiver = '410000000000000000000000000000000000000011';

    const spy = mockAddressConversion({
      [owner]: 'TOwnerDelegate',
      [receiver]: 'TReceiverDelegate'
    });

    const block = baseBlock();
    const transaction = buildTransaction('DelegateResourceContract', {
      owner_address: owner,
      receiver_address: receiver,
      balance: 80_000 * 1_000_000,
      resource: 'ENERGY'
    });

    const context = {
      priceUSD: 0.09,
      addressGraph: new Map(),
      blockTime: new Date(block.block_header.raw_data.timestamp)
    };

    const result = service.buildTransactionRecord(block, transaction, null, context);

    spy.mockRestore();

    expect(result).toBeTruthy();
    if (!result) {
      return;
    }

    expect(result.categories.isDelegation).toBe(true);
    expect(result.payload.analysis?.pattern).toBe('delegation');
    expect(result.payload.notifications).toContain('delegation:new');
    expect(result.payload.analysis?.relatedAddresses).toContain('TOwnerDelegate');
    expect(result.payload.analysis?.relatedAddresses).toContain('TReceiverDelegate');
  });

  it('identifies token creation transactions', () => {
    const owner = '410000000000000000000000000000000000000021';
    const spy = mockAddressConversion({
      [owner]: 'TTokenCreator'
    });

    const block = baseBlock();
    const transaction = buildTransaction('AssetIssueContract', {
      owner_address: owner,
      name: 'NewToken',
      abbr: 'NTK',
      total_supply: 1_000_000
    });

    const context = {
      priceUSD: 0.09,
      addressGraph: new Map(),
      blockTime: new Date(block.block_header.raw_data.timestamp)
    };

    const result = service.buildTransactionRecord(block, transaction, null, context);

    spy.mockRestore();

    expect(result).toBeTruthy();
    if (!result) {
      return;
    }

    expect(result.categories.isTokenCreation).toBe(true);
    expect(result.payload.analysis?.pattern).toBe('token_creation');
    expect(result.payload.notifications).toHaveLength(0);
  });
});
