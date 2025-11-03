import type { AxiosInstance } from 'axios';
import type { IChainParametersFetcher, IChainParameters, ISystemLogService } from '@tronrelic/types';
import { ChainParametersModel } from '../../database/models/chain-parameters-model.js';

/**
 * Response from TronGrid /wallet/getchainparameters endpoint
 */
interface TronGridChainParametersResponse {
    chainParameter: Array<{
        key: string;
        value: number;
    }>;
}

/**
 * Fetches TRON chain parameters from TronGrid API
 * Runs on 10-minute schedule to keep parameters current
 *
 * Why this exists:
 * The TRON network's energy-to-TRX conversion ratio changes based on network conditions.
 * This fetcher polls the blockchain every 10 minutes to capture current parameters and
 * calculates the derived energyPerTrx ratio used by market fetchers.
 */
export class ChainParametersFetcher implements IChainParametersFetcher {
    private readonly TRONGRID_ENDPOINT = 'https://api.trongrid.io/wallet/getchainparameters';

    constructor(private readonly http: AxiosInstance, private readonly logger: ISystemLogService) {}

    /**
     * Fetch current chain parameters and save to database
     * Calculates energyPerTrx ratio from network state
     *
     * Process:
     * 1. Fetch chain parameters from TronGrid
     * 2. Extract energy-related values
     * 3. Calculate energyPerTrx ratio (totalEnergyLimit / totalFrozenForEnergy)
     * 4. Save to MongoDB for service layer consumption
     *
     * @returns Freshly fetched chain parameters
     */
    async fetch(): Promise<IChainParameters> {
        try {
            this.logger.info('Fetching chain parameters from TronGrid');

            const response = await this.http.post<TronGridChainParametersResponse>(
                this.TRONGRID_ENDPOINT,
                {},
                {
                    timeout: 10000
                }
            );

            const chainParams = response.data.chainParameter;

            // Extract energy-related parameters
            const totalEnergyLimit = this.findParam(chainParams, 'getTotalEnergyLimit');
            const totalEnergyCurrentLimit = this.findParam(chainParams, 'getTotalEnergyCurrentLimit');
            const energyFee = this.findParam(chainParams, 'getEnergyFee');

            // Extract bandwidth-related parameters
            const totalBandwidthLimit = this.findParam(chainParams, 'getTotalNetLimit');
            const totalNetWeight = this.findParam(chainParams, 'getTotalNetWeight');

            // Calculate total frozen for energy
            // NOTE: This is an approximation based on network averages
            // A more accurate calculation would query account resources across validators
            // For now, we use a conservative estimate of 32M TRX frozen network-wide
            const totalFrozenForEnergy = 32_000_000_000_000_000; // 32M TRX in SUN

            // Calculate total frozen for bandwidth from network weight
            // totalNetWeight is in SUN (1 TRX = 1,000,000 SUN)
            const totalFrozenForBandwidth = totalNetWeight;

            // Calculate energy per TRX ratio
            const energyPerTrx = totalEnergyLimit / (totalFrozenForEnergy / 1_000_000);

            // Calculate bandwidth per TRX ratio
            // If totalNetWeight is 0, use approximation based on network averages
            const bandwidthPerTrx = totalFrozenForBandwidth > 0
                ? totalBandwidthLimit / (totalFrozenForBandwidth / 1_000_000)
                : 1000; // Approximate fallback: 1000 bandwidth per TRX

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
            await ChainParametersModel.create(parameters);

            this.logger.info(
                {
                    energyPerTrx: energyPerTrx.toFixed(2),
                    totalEnergyLimit,
                    energyFee,
                    bandwidthPerTrx: bandwidthPerTrx.toFixed(2),
                    totalBandwidthLimit
                },
                'Chain parameters updated successfully'
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
