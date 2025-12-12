import type { AxiosInstance } from 'axios';
import type { IUsdtParametersFetcher, IUsdtParameters, ISystemLogService, IDatabaseService } from '@tronrelic/types';
import { UsdtParametersModel, type IUsdtParametersDocument } from '../../database/models/usdt-parameters-model.js';
import { toHexAddress } from '../../lib/tron-address.js';

const USDT_PARAMETERS_COLLECTION = 'usdtParameters';

/**
 * USDT TRC20 contract address on TRON mainnet
 */
const USDT_CONTRACT_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/**
 * Sample wallet address for testing USDT transfers
 * This is a well-known address that already holds USDT (for standard transfer testing)
 */
const SAMPLE_RECIPIENT_ADDRESS = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';

/**
 * Response from TronGrid /wallet/triggerconstantcontract endpoint
 */
interface TronGridConstantContractResponse {
    result: {
        result: boolean;
        message?: string;
    };
    energy_used: number;
    constant_result?: string[];
    transaction?: unknown;
}

/**
 * Fetches USDT transaction parameters from TRON blockchain
 * Runs on 10-minute schedule to keep parameters current
 *
 * Why this exists:
 * The energy cost for USDT transfers is NOT a fixed constant. It depends on the
 * smart contract implementation and can vary over time. This fetcher queries the
 * actual cost from TronGrid's triggerconstantcontract endpoint and stores it for
 * use by market fetchers and calculators.
 *
 * This replaces hardcoded constants like:
 * - USDT_TRANSFER_ENERGY_STANDARD = 65_000 (should be ~64,285)
 * - USDT_TRANSFER_ENERGY_FIRST_TIME = 130_000 (should be measured dynamically)
 */
export class UsdtParametersFetcher implements IUsdtParametersFetcher {
    private readonly TRONGRID_ENDPOINT = 'https://api.trongrid.io/wallet/triggerconstantcontract';
    private readonly database: IDatabaseService;

    constructor(private readonly http: AxiosInstance, private readonly logger: ISystemLogService, database: IDatabaseService) {
        this.database = database;
        this.database.registerModel(USDT_PARAMETERS_COLLECTION, UsdtParametersModel);
    }

    /**
     * Get the registered USDT parameters model for database operations.
     */
    private getModel() {
        return this.database.getModel<IUsdtParametersDocument>(USDT_PARAMETERS_COLLECTION);
    }

    /**
     * Fetch current USDT transfer energy costs and save to database
     *
     * Process:
     * 1. Call triggerconstantcontract with a sample USDT transfer
     * 2. Extract energy_used from response (standard transfer cost)
     * 3. Calculate first-time transfer cost (conservative estimate: 2x standard)
     * 4. Save to MongoDB for service layer consumption
     *
     * @returns Freshly fetched USDT parameters
     */
    async fetch(): Promise<IUsdtParameters> {
        try {
            this.logger.info('Fetching USDT parameters from TronGrid');

            // Query energy cost for a standard USDT transfer (1 USDT = 1,000,000 units)
            const response = await this.http.post<TronGridConstantContractResponse>(
                this.TRONGRID_ENDPOINT,
                {
                    owner_address: SAMPLE_RECIPIENT_ADDRESS,
                    contract_address: USDT_CONTRACT_ADDRESS,
                    function_selector: 'transfer(address,uint256)',
                    // Transfer 1 USDT (0x0f4240 = 1,000,000) to recipient
                    parameter: this.encodeTransferParameters(SAMPLE_RECIPIENT_ADDRESS, 1_000_000),
                    visible: true
                },
                {
                    timeout: 10000
                }
            );

            if (!response.data.result.result) {
                throw new Error(`TronGrid API error: ${response.data.result.message || 'Unknown error'}`);
            }

            const standardTransferEnergy = response.data.energy_used;

            if (!standardTransferEnergy || standardTransferEnergy <= 0) {
                throw new Error(`Invalid energy_used value: ${standardTransferEnergy}`);
            }

            // First-time transfers cost approximately 2x due to contract state initialization
            // This is a conservative estimate since we can't easily measure it via constant calls
            const firstTimeTransferEnergy = standardTransferEnergy * 2;

            const parameters: IUsdtParameters = {
                network: 'mainnet',
                contractAddress: USDT_CONTRACT_ADDRESS,
                parameters: {
                    standardTransferEnergy,
                    firstTimeTransferEnergy
                },
                fetchedAt: new Date(),
                createdAt: new Date()
            };

            // Save to database
            await this.getModel().create(parameters);

            this.logger.info(
                {
                    standardTransferEnergy,
                    firstTimeTransferEnergy,
                    contractAddress: USDT_CONTRACT_ADDRESS
                },
                'USDT parameters updated successfully'
            );

            return parameters;
        } catch (error) {
            this.logger.error({ error }, 'Failed to fetch USDT parameters from TronGrid');
            throw error;
        }
    }

    /**
     * Encode transfer function parameters for TronGrid API
     * Converts address and amount to packed ABI-encoded hex string
     *
     * @param recipientAddress - TRON address in base58 format
     * @param amount - USDT amount in base units (1 USDT = 1,000,000 units)
     * @returns Hex-encoded parameter string
     */
    private encodeTransferParameters(recipientAddress: string, amount: number): string {
        // Convert base58 address to hex using the tron-address utility
        // For TronGrid API with visible:true, we can use the address directly in the JSON
        // The parameter field expects: [32 bytes address padding][32 bytes amount]

        // toHexAddress returns 41-prefixed hex (e.g., "41A614F803B6FD780986A42C78EC9C7F77E6DED13C")
        // For ABI encoding, we need the 20-byte address without the 41 prefix, lowercase
        const fullHex = toHexAddress(recipientAddress);
        const addressHex = fullHex.slice(2).toLowerCase(); // Remove '41' prefix

        // Pad address to 32 bytes (64 hex chars)
        const paddedAddress = addressHex.padStart(64, '0');

        // Convert amount to hex and pad to 32 bytes
        const amountHex = amount.toString(16).padStart(64, '0');

        return paddedAddress + amountHex;
    }
}
