import type { IChainParametersService } from '@tronrelic/types';

/**
 * Computes annual percentage yield (APY) for energy rental orders.
 *
 * Calculates compound interest over a year based on rental duration and cost,
 * comparing rental cost to the equivalent TRX staking value.
 *
 * @param params - Order parameters including energy amount, payment, duration, and optional fees
 * @returns APY as a decimal (e.g., 0.15 = 15% APY) or undefined if calculation fails
 */
export function computeOrderApy(params: {
    trEnergy: IChainParametersService | null;
    energy: number;
    paymentSun: number;
    durationSeconds: number;
    marketFee?: number;
    deductFee?: boolean;
}): number | undefined {
    const { trEnergy, energy, paymentSun, durationSeconds, marketFee = 0, deductFee = false } = params;

    if (!trEnergy || typeof trEnergy.getTRXFromEnergy !== 'function') {
        return undefined;
    }

    if (!Number.isFinite(energy) || energy <= 0 || !Number.isFinite(paymentSun) || paymentSun <= 0) {
        return undefined;
    }

    const paymentTrx = paymentSun / 1_000_000;
    const effectivePayment = deductFee ? paymentTrx * (1 - marketFee) : paymentTrx;
    const energyTrx = trEnergy.getTRXFromEnergy(energy);
    if (!energyTrx || energyTrx <= 0) {
        return undefined;
    }

    const durationDays = durationSeconds / (60 * 60 * 24);
    if (!Number.isFinite(durationDays) || durationDays <= 0) {
        return undefined;
    }

    const effectiveInterest = effectivePayment / energyTrx;
    if (!Number.isFinite(effectiveInterest)) {
        return undefined;
    }

    const cyclesPerYear = 365 / durationDays;
    if (!Number.isFinite(cyclesPerYear) || cyclesPerYear <= 0) {
        return undefined;
    }

    const totalPaymentForYear = energyTrx * Math.pow(1 + effectiveInterest, cyclesPerYear);
    if (!Number.isFinite(totalPaymentForYear)) {
        return undefined;
    }

    const apy = totalPaymentForYear / energyTrx - 1;
    if (!Number.isFinite(apy)) {
        return undefined;
    }

    return Number(apy.toFixed(6));
}
