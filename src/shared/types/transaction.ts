import type { AddressMetadata } from './common.js';

export type TronTransactionType =
  | 'TransferContract'
  | 'TransferAssetContract'
  | 'TriggerSmartContract'
  | 'ParticipateAssetIssueContract'
  | 'FreezeBalanceContract'
  | 'FreezeBalanceV2Contract'
  | 'UnfreezeBalanceContract'
  | 'VoteWitnessContract'
  | 'DelegateResourceContract'
  | 'UnDelegateResourceContract'
  | 'AssetIssueContract'
  | 'CreateSmartContract'
  | 'Unknown';

export interface ResourceCost {
  consumed: number;
  price: number;
  totalCost: number;
}

export interface ContractDetails {
  address: string;
  method?: string;
  parameters?: Record<string, unknown>;
}

export interface TransactionAnalysis {
  relatedAddresses?: string[];
  relatedTransactions?: string[];
  pattern?:
    | 'accumulation'
    | 'distribution'
    | 'arbitrage'
    | 'exchange_reshuffle'
    | 'exchange_outflow'
    | 'exchange_inflow'
    | 'self_shuffle'
    | 'cluster_distribution'
    | 'mega_whale'
    | 'delegation'
    | 'stake'
    | 'token_creation'
    | 'unknown';
  riskScore?: number;
  clusterId?: string;
  confidence?: number;
}

export interface TronTransactionDocument {
  id?: string;
  txId: string;
  blockNumber: number;
  timestamp: string;
  type: TronTransactionType;
  subType?: string;
  from: AddressMetadata;
  to: AddressMetadata;
  amount: number;
  amountTRX: number;
  amountUSD?: number;
  energy?: ResourceCost;
  bandwidth?: ResourceCost;
  contract?: ContractDetails;
  memo?: string | null;
  internalTransactions?: unknown[];
  indexed?: string;
  notifications?: string[];
  analysis?: TransactionAnalysis;
}
