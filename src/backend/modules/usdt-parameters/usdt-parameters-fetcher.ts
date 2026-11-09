/**
 * @fileoverview Measures the energy a USDT transfer costs on TRON mainnet.
 *
 * Simulates two USDT transfers through TronGrid's `triggerconstantcontract`
 * endpoint — one to a wallet that already holds USDT and one to a wallet that
 * holds none — validates both responses, and stores the measured costs for
 * `UsdtParametersService` to serve.
 */

import { randomBytes } from 'node:crypto';
import type { IUsdtParametersFetcher, IUsdtParameters, ISystemLogService, IDatabaseService } from '@/types';
import { USDT_CONTRACT_ADDRESS } from '@/types';
import { UsdtParametersModel, type IUsdtParametersDocument } from '../../database/models/usdt-parameters-model.js';
import { toHexAddress } from '../../lib/tron-address.js';

const USDT_PARAMETERS_COLLECTION = 'usdtParameters';

/**
 * Wallet that sends both simulated transfers, and receives the standard one.
 *
 * It must hold at least `SIMULATED_TRANSFER_AMOUNT` of USDT and must not be
 * frozen by Tether. If either stops being true, both simulations revert, the
 * fetch fails with a logged error, and nothing is saved. Sending the standard
 * transfer to itself measures the same cost as sending to any other holder,
 * because both balance slots it writes are already non-zero.
 */
const SAMPLE_HOLDER_ADDRESS = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';

/** 1 USDT in base units (USDT has 6 decimals). */
const SIMULATED_TRANSFER_AMOUNT = 1_000_000;

/** Bytes in a TRON address once the leading `41` network byte is removed. */
const ADDRESS_BYTES = 20;

/**
 * Response from TronGrid's /wallet/triggerconstantcontract endpoint.
 *
 * A reverted call still reports `result.result: true`. The revert shows only
 * in `result.message`, in `transaction.ret[0].ret === 'FAILED'`, and in the
 * absence of event logs, which is why the fetcher checks all of them.
 */
interface ITronGridConstantContractResponse {
    result?: {
        result?: boolean;
        message?: string;
    };
    energy_used?: number;
    energy_penalty?: number;
    constant_result?: string[];
    logs?: unknown[];
    transaction?: {
        ret?: Array<{ ret?: string }>;
    };
}

/**
 * The TronGrid call this fetcher needs. `TronGridClient` satisfies it.
 *
 * The fetcher depends on this rather than on raw HTTP so its two simulations
 * share the platform's rotating API keys, the 200ms request queue, and the
 * retries block sync uses. Without them, a single anonymous 429 during startup
 * stopped the backend.
 */
export interface IUsdtParametersTransport {
    /** Run a contract call without broadcasting it and return TronGrid's response body. */
    triggerConstantContract<T>(payload: Record<string, unknown>): Promise<T>;
}

/** Which of the two simulated transfers a measurement belongs to. */
type SimulationKind = 'standard' | 'first-time';

/**
 * Error raised when TronGrid's answer cannot be trusted as a measurement.
 *
 * It exists so the single error log in `fetch()` can record exactly what
 * TronGrid returned alongside the reason, which is what an operator needs to
 * tell a drained sample wallet apart from an outage or a malformed response.
 */
class UsdtTransferSimulationError extends Error {
    /**
     * @param message - Why the response was rejected, in plain words
     * @param details - The response fields that led to the rejection, logged as-is
     */
    constructor(message: string, readonly details: Record<string, unknown>) {
        super(message);
        this.name = 'UsdtTransferSimulationError';
    }
}

/**
 * Fetches USDT transaction parameters from TRON blockchain
 * Runs on 10-minute schedule to keep parameters current
 *
 * Why this exists:
 * The energy cost for USDT transfers is NOT a fixed constant. It depends on the
 * contract's storage writes and on TRON's dynamic energy penalty for USDT, which
 * the network recomputes every maintenance cycle. This fetcher measures both
 * costs from TronGrid and stores them for market fetchers, calculators, and the
 * AI prompt variables.
 *
 * Two costs are measured, because they differ by more than a fixed ratio:
 * - Standard: the recipient already holds USDT, so its balance slot is updated.
 * - First-time: the recipient's USDT balance is currently zero, so its balance
 *   slot is written from empty, which costs more. This applies to any address
 *   with a zero balance, including one that held USDT before and emptied it.
 *
 * A response that does not describe a successful transfer is rejected, logged
 * as an error, and nothing is saved, so consumers keep the last good values.
 */
export class UsdtParametersFetcher implements IUsdtParametersFetcher {
    private readonly database: IDatabaseService;

    /**
     * @param tronGrid - TronGrid transport, injected so production shares the platform client and tests supply canned responses
     * @param logger - Logger that records the error when a measurement cannot be obtained
     * @param database - Database where each validated measurement is stored
     */
    constructor(
        private readonly tronGrid: IUsdtParametersTransport,
        private readonly logger: ISystemLogService,
        database: IDatabaseService
    ) {
        this.database = database;
        this.database.registerModel(USDT_PARAMETERS_COLLECTION, UsdtParametersModel);
    }

    /**
     * Get the registered USDT parameters model for database operations.
     *
     * @returns The model used to store each measurement
     */
    private getModel() {
        return this.database.getModel<IUsdtParametersDocument>(USDT_PARAMETERS_COLLECTION);
    }

    /**
     * Measure current USDT transfer energy costs and save them to the database.
     *
     * Simulates a standard transfer (the sample holder sending to itself) and a
     * first-time transfer (the sample holder sending to a freshly generated
     * address, which cannot hold USDT). Both responses are validated before
     * anything is saved. On any failure — network error, rejected call, reverted
     * transfer, or implausible figures — it logs an error with what TronGrid
     * returned and rethrows, leaving the stored values untouched.
     *
     * @returns Freshly measured USDT parameters
     * @throws Error when either measurement cannot be obtained or fails validation
     */
    async fetch(): Promise<IUsdtParameters> {
        let parameters: IUsdtParameters;

        try {
            this.logger.info('Fetching USDT parameters from TronGrid');

            const standardTransferEnergy = await this.simulateTransfer(
                this.toAbiAddress(SAMPLE_HOLDER_ADDRESS),
                'standard'
            );
            const firstTimeTransferEnergy = await this.simulateTransfer(
                this.generateEmptyRecipient(),
                'first-time'
            );

            if (firstTimeTransferEnergy <= standardTransferEnergy) {
                throw new UsdtTransferSimulationError(
                    'First-time transfer energy is not higher than standard transfer energy, so at least one measurement is wrong',
                    { standardTransferEnergy, firstTimeTransferEnergy }
                );
            }

            parameters = {
                network: 'mainnet',
                contractAddress: USDT_CONTRACT_ADDRESS,
                parameters: {
                    standardTransferEnergy,
                    firstTimeTransferEnergy
                },
                fetchedAt: new Date(),
                createdAt: new Date()
            };

            await this.getModel().create(parameters);

            this.logger.info(
                {
                    standardTransferEnergy,
                    firstTimeTransferEnergy,
                    contractAddress: USDT_CONTRACT_ADDRESS
                },
                'USDT parameters updated successfully'
            );
        } catch (error) {
            const details = error instanceof UsdtTransferSimulationError ? error.details : {};
            this.logger.error(
                {
                    error,
                    reason: error instanceof Error ? error.message : String(error),
                    ...details
                },
                'Failed to obtain valid USDT transfer energy from TronGrid; nothing was saved'
            );
            throw error;
        }

        return parameters;
    }

    /**
     * Simulate one USDT transfer from the sample holder and return its energy.
     *
     * @param recipientAbiAddress - Recipient as 20-byte hex without the `41` prefix; decides which cost is measured
     * @param kind - Which measurement this is, so a failure names the call that failed
     * @returns Energy the transfer used, including TRON's dynamic energy penalty
     * @throws UsdtTransferSimulationError when the response does not describe a successful transfer
     */
    private async simulateTransfer(recipientAbiAddress: string, kind: SimulationKind): Promise<number> {
        const response = await this.tronGrid.triggerConstantContract<ITronGridConstantContractResponse>({
            owner_address: SAMPLE_HOLDER_ADDRESS,
            contract_address: USDT_CONTRACT_ADDRESS,
            function_selector: 'transfer(address,uint256)',
            parameter: this.encodeTransferParameters(recipientAbiAddress, SIMULATED_TRANSFER_AMOUNT),
            visible: true
        });

        return this.readEnergyUsed(response, kind);
    }

    /**
     * Accept a simulation response only when it describes a successful transfer.
     *
     * TronGrid reports `result.result: true` even when the transfer reverts — for
     * example when the sample holder runs out of USDT — and still returns a small
     * `energy_used` figure for the failed attempt. Saving that figure would skew
     * every price that depends on transfer energy, so a response is rejected when
     * it carries a message, a `FAILED` transaction result, no event logs, or an
     * energy figure that is not a positive whole number. USDT's `transfer` returns
     * `false` even on success, so `constant_result` is deliberately not checked.
     *
     * @param data - Body returned by TronGrid
     * @param kind - Which measurement this is, recorded in the error details
     * @returns The validated energy figure
     * @throws UsdtTransferSimulationError describing the first check that failed
     */
    private readEnergyUsed(data: ITronGridConstantContractResponse, kind: SimulationKind): number {
        const energyUsed = data?.energy_used;
        const transactionResult = data?.transaction?.ret?.[0]?.ret;
        const details = {
            simulation: kind,
            tronGridResult: data?.result?.result,
            tronGridMessage: data?.result?.message,
            transactionResult,
            energyUsed,
            energyPenalty: data?.energy_penalty,
            logCount: data?.logs?.length ?? 0
        };

        let failure: string | null = null;
        if (data?.result?.result !== true) {
            failure = `TronGrid rejected the ${kind} transfer simulation`;
        } else if (data.result.message) {
            failure = `The ${kind} transfer simulation reverted: ${data.result.message}`;
        } else if (transactionResult === 'FAILED') {
            failure = `The ${kind} transfer simulation reported a FAILED transaction result`;
        } else if (!data.logs || data.logs.length === 0) {
            failure = `The ${kind} transfer simulation emitted no Transfer event, so the transfer did not happen`;
        } else if (typeof energyUsed !== 'number' || !Number.isInteger(energyUsed) || energyUsed <= 0) {
            failure = `The ${kind} transfer simulation returned an invalid energy_used value`;
        }

        if (failure !== null) {
            throw new UsdtTransferSimulationError(failure, details);
        }

        return energyUsed as number;
    }

    /**
     * Generate a recipient that is certain to hold no USDT.
     *
     * A fresh random address is used on every run rather than a fixed "empty"
     * one, because anyone can send dust to a fixed address and silently turn it
     * into a holder, which would make the first-time measurement report the
     * standard cost. The simulation is never broadcast, so nothing is sent.
     *
     * @returns A random 20-byte address as lowercase hex, ready for ABI encoding
     */
    private generateEmptyRecipient(): string {
        return randomBytes(ADDRESS_BYTES).toString('hex');
    }

    /**
     * Convert a base58 TRON address into the 20-byte hex form ABI encoding needs.
     *
     * @param base58Address - TRON address such as `T...`
     * @returns The address as lowercase hex without the `41` network prefix
     */
    private toAbiAddress(base58Address: string): string {
        return toHexAddress(base58Address).slice(2).toLowerCase();
    }

    /**
     * Encode the `transfer(address,uint256)` arguments for TronGrid.
     *
     * TronGrid's `parameter` field takes the ABI-encoded arguments as hex: the
     * recipient and the amount, each left-padded to 32 bytes.
     *
     * @param recipientAbiAddress - Recipient as 20-byte hex without the `41` prefix
     * @param amount - USDT amount in base units (1 USDT = 1,000,000 units)
     * @returns Hex-encoded parameter string
     */
    private encodeTransferParameters(recipientAbiAddress: string, amount: number): string {
        const paddedAddress = recipientAbiAddress.padStart(64, '0');
        const amountHex = amount.toString(16).padStart(64, '0');

        return paddedAddress + amountHex;
    }
}
