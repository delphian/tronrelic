/**
 * @fileoverview Tools module API client functions.
 *
 * Provides typed API calls to the /api/tools/* endpoints for address conversion,
 * energy estimation, bidirectional stake calculation, and signature verification.
 */

import { apiClient } from '../../../lib/api';
import type {
    IAddressConversionResult,
    IEnergyEstimate,
    IStakeEstimate,
    ISignatureResult
} from '../types';

/**
 * Convert between TRON hex and base58check address formats.
 *
 * @param input - Object with either hex or base58Check populated
 * @returns Both address representations
 */
export async function convertAddress(input: { hex?: string; base58Check?: string }): Promise<IAddressConversionResult> {
    const response = await apiClient.post('/tools/address/convert', input);
    return response.data.transform;
}

/**
 * Estimate daily energy requirements for a contract type.
 *
 * @param contractType - TRON contract type (e.g., 'TriggerSmartContract')
 * @param averageMethodCalls - Average method calls per transaction
 * @param expectedTransactionsPerDay - Expected daily transaction count
 * @returns Detailed energy estimate with cost comparison
 */
export async function estimateEnergy(
    contractType: string,
    averageMethodCalls: number,
    expectedTransactionsPerDay: number
): Promise<IEnergyEstimate> {
    const response = await apiClient.post('/tools/energy/estimate', {
        contractType,
        averageMethodCalls,
        expectedTransactionsPerDay
    });
    return response.data.estimate;
}

/**
 * Calculate energy and bandwidth from a TRX stake amount.
 *
 * @param trx - Amount of TRX to stake
 * @returns Energy, bandwidth, and network ratios
 */
export async function estimateStakeFromTrx(trx: number): Promise<IStakeEstimate> {
    const response = await apiClient.post('/tools/stake/from-trx', { trx });
    return response.data.estimate;
}

/**
 * Calculate TRX required to produce a target energy amount.
 *
 * @param energy - Desired energy amount
 * @returns TRX required, resulting bandwidth, and network ratios
 */
export async function estimateStakeFromEnergy(energy: number): Promise<IStakeEstimate> {
    const response = await apiClient.post('/tools/stake/from-energy', { energy });
    return response.data.estimate;
}

/**
 * Verify a TRON wallet signature against a message.
 *
 * @param wallet - TRON wallet address
 * @param message - Signed message text
 * @param signature - Hex-encoded signature
 * @returns Verification result with normalized wallet address
 */
export async function verifySignature(wallet: string, message: string, signature: string): Promise<ISignatureResult> {
    const response = await apiClient.post('/tools/signature/verify', { wallet, message, signature });
    return response.data;
}
