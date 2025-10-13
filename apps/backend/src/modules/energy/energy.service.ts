import { TronGridClient, type TronGridDelegatedResourceEntry } from '../blockchain/tron-grid.client.js';
import { normalizeAddress } from '../../lib/tron-address.js';

export interface DelegationRecord {
  toAddress: string;
  frozenBalance: number;
  expireTime: number | null;
}

export class EnergyService {
  private readonly tronGrid: TronGridClient;

  constructor(tronGrid = TronGridClient.getInstance()) {
    this.tronGrid = tronGrid;
  }

  async getAccountDelegations(address: string): Promise<DelegationRecord[]> {
    const { base58 } = normalizeAddress(address);
    const toAccounts = await this.tronGrid.getDelegatedResourceAccountIndex(base58);
    if (!toAccounts.length) {
      return [];
    }

    const delegations: DelegationRecord[] = [];
    for (const account of toAccounts) {
      const detail = await this.tronGrid.getDelegatedResource(base58, account);
      if (!detail?.delegatedResource?.length) {
        continue;
      }

      for (const resource of detail.delegatedResource) {
        const record = this.toDelegationRecord(resource);
        if (record) {
          delegations.push(record);
        }
      }
    }

    return delegations;
  }

  private toDelegationRecord(resource: TronGridDelegatedResourceEntry | undefined): DelegationRecord | null {
    if (!resource) {
      return null;
    }
    const frozenBalanceSun = resource.frozen_balance_for_energy ?? 0;
    if (!frozenBalanceSun) {
      return null;
    }

    const toAddress = resource.to ?? resource.toAddress;
    if (!toAddress) {
      return null;
    }

    const { base58 } = normalizeAddress(toAddress);
    const expireTime = typeof resource.expire_time_for_energy === 'number' ? resource.expire_time_for_energy : null;

    return {
      toAddress: base58,
      frozenBalance: Number((frozenBalanceSun / 1_000_000).toFixed(6)),
      expireTime
    };
  }
}
