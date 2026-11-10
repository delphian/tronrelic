/**
 * @fileoverview Fetches TRON chain parameters and network staking totals.
 *
 * Reads the governance-set parameters and the network-wide resource totals
 * through the platform's shared TronGrid client, derives the energy and
 * bandwidth per TRX ratios, and stores a snapshot for `ChainParametersService`.
 */

import type { IChainParametersFetcher, IChainParameters, ISystemLogService, IDatabaseService } from '@/types';
import type { TronGridAccountResourceResponse, TronGridChainParametersResponse } from '../blockchain/tron-grid.client.js';
import { ChainParametersModel, type IChainParametersDocument } from '../../database/models/chain-parameters-model.js';

const CHAIN_PARAMETERS_COLLECTION = 'chainParameters';

/**
 * The TronGrid calls this fetcher needs. `TronGridClient` satisfies it.
 *
 * The fetcher depends on this rather than on raw HTTP so its requests share the
 * platform's rotating API keys, the 200ms request queue, and the retries block
 * sync uses. Without them, a single anonymous 429 during startup stopped the
 * backend.
 */
export interface IChainParametersTransport {
    /** Governance-set protocol parameters, such as the energy fee. */
    getChainParameters(): Promise<TronGridChainParametersResponse>;
    /** Network-wide resource totals, returned whichever address is asked about. */
    getAccountResource(address: string, visible?: boolean): Promise<TronGridAccountResourceResponse>;
}

/**
 * Fetches TRON chain parameters from TronGrid
 * Runs on 10-minute schedule to keep parameters current
 *
 * Why this exists:
 * The TRON network's energy-to-TRX conversion ratio changes based on network conditions.
 * This fetcher polls the blockchain every 10 minutes to capture current parameters and
 * calculates the derived energyPerTrx ratio used by market fetchers.
 */
export class ChainParametersFetcher implements IChainParametersFetcher {
    /**
     * Placeholder address for getaccountresource API.
     * The endpoint requires an address but returns network-wide totals regardless of which address is used.
     * Using TRON Foundation address as a well-known, always-valid address.
     */
    private readonly PLACEHOLDER_ADDRESS = 'TRX6Q82wMqWNbCCiLqejbZe43wk1h1zJHm';

    private readonly database: IDatabaseService;

    /**
     * @param tronGrid - TronGrid transport, injected so production shares the platform client and tests supply canned responses
     * @param logger - Logger that records each snapshot and any failure to obtain one
     * @param database - Database where each snapshot is stored for the service to read
     */
    constructor(
        private readonly tronGrid: IChainParametersTransport,
        private readonly logger: ISystemLogService,
        database: IDatabaseService
    ) {
        this.database = database;
        this.database.registerModel(CHAIN_PARAMETERS_COLLECTION, ChainParametersModel);
    }

    /** The registered chain parameters model, used to store each snapshot. */
    private getModel() {
        return this.database.getModel<IChainParametersDocument>(CHAIN_PARAMETERS_COLLECTION);
    }

    /**
     * Fetch current chain parameters and network state, then save to database.
     * Calculates energyPerTrx ratio from live network staking data.
     *
     * Process:
     * 1. Fetch protocol parameters from TronGrid /wallet/getchainparameters (fees, governance settings)
     * 2. Fetch network state from TronGrid /wallet/getaccountresource (total staked TRX)
     * 3. Calculate energyPerTrx = TotalEnergyLimit / TotalEnergyWeight
     * 4. Calculate bandwidthPerTrx = TotalNetLimit / TotalNetWeight
     * 5. Save to MongoDB for service layer consumption
     *
     * @returns Freshly fetched chain parameters with live network state
     * @throws Error when TronGrid cannot be reached after the client's retries, or the save fails
     */
    async fetch(): Promise<IChainParameters> {
        try {
            this.logger.info('Fetching chain parameters and network state from TronGrid');

            // Fetch protocol parameters (fees, limits, governance settings)
            const paramsResponse = await this.tronGrid.getChainParameters();

            // Fetch network state (total staked TRX for energy/bandwidth)
            const networkState = await this.tronGrid.getAccountResource(this.PLACEHOLDER_ADDRESS, true);

            const chainParams = paramsResponse.chainParameter;

            // Extract protocol parameters (fees)
            const energyFee = this.findParam(chainParams, 'getEnergyFee');
            const totalEnergyCurrentLimit = this.findParam(chainParams, 'getTotalEnergyCurrentLimit');

            // Extract network state - live staking data from getaccountresource
            // TotalEnergyWeight/TotalNetWeight are in TRX (not SUN)
            const totalEnergyLimit = networkState.TotalEnergyLimit;
            const totalEnergyWeight = networkState.TotalEnergyWeight;
            const totalBandwidthLimit = networkState.TotalNetLimit;
            const totalNetWeight = networkState.TotalNetWeight;

            // Convert TRX to SUN for storage (1 TRX = 1,000,000 SUN)
            // This maintains backward compatibility with existing database schema
            const totalFrozenForEnergy = totalEnergyWeight * 1_000_000;
            const totalFrozenForBandwidth = totalNetWeight * 1_000_000;

            // Calculate energy per TRX ratio using live network state
            // energyPerTrx = TotalEnergyLimit / TotalEnergyWeight
            const energyPerTrx = totalEnergyWeight > 0
                ? totalEnergyLimit / totalEnergyWeight
                : 0;

            // Calculate bandwidth per TRX ratio using live network state
            const bandwidthPerTrx = totalNetWeight > 0
                ? totalBandwidthLimit / totalNetWeight
                : 0;

            const parameters: IChainParameters = {
                network: 'mainnet',
                parameters: {
                    totalEnergyLimit,
                    totalEnergyCurrentLimit,
                    totalFrozenForEnergy,
                    energyPerTrx,
                    energyFee,
                    totalBandwidthLimit,
                    totalFrozenForBandwidth,
                    bandwidthPerTrx
                },
                fetchedAt: new Date(),
                createdAt: new Date()
            };

            // Save to database
            await this.getModel().create(parameters);

            this.logger.info(
                {
                    energyPerTrx: energyPerTrx.toFixed(4),
                    totalEnergyLimit,
                    totalEnergyWeight,
                    energyFee,
                    bandwidthPerTrx: bandwidthPerTrx.toFixed(4),
                    totalBandwidthLimit,
                    totalNetWeight
                },
                'Chain parameters updated with live network state'
            );

            return parameters;
        } catch (error) {
            this.logger.error({ error }, 'Failed to fetch chain parameters from TronGrid');
            throw error;
        }
    }

    /**
     * Extract parameter value by key from chain parameters array
     * Returns 0 if parameter not found
     *
     * @param params - Array of chain parameters from TronGrid
     * @param key - Parameter key to find
     * @returns Parameter value or 0
     */
    private findParam(params: Array<{ key: string; value: number }>, key: string): number {
        const param = params.find(p => p.key === key);
        if (!param) {
            this.logger.warn({ key }, 'Chain parameter not found in response');
            return 0;
        }
        return param.value;
    }
}
