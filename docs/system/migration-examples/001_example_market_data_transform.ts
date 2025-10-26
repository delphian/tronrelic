import type { IMigration, IDatabaseService } from '@tronrelic/types';

/**
 * Example module migration: Transform legacy market data format.
 *
 * This migration demonstrates:
 * - Data transformation using raw collection access
 * - Module migrations have unrestricted collection access
 * - Dependency on a system migration (requires indexed config)
 * - Iterating over documents with batch updates
 * - Validation before transformation
 *
 * Why this migration exists:
 * Legacy market documents stored pricing as flat "pricePerUnit" field.
 * New format requires nested "pricingDetail" object with regeneration
 * calculations. This migration transforms existing documents to the new format.
 */
export const migration: IMigration = {
    id: '001_example_market_data_transform',
    description: 'Migrate legacy market documents from flat pricePerUnit to nested pricingDetail structure. Required for new regeneration-aware pricing calculations.',
    dependencies: ['001_example_add_index'], // Depends on system migration

    async up(database: IDatabaseService): Promise<void> {
        const collection = database.getCollection('markets');

        // Find all markets with legacy format (has pricePerUnit field)
        const legacyMarkets = await collection.find({ pricePerUnit: { $exists: true } }).toArray();

        if (legacyMarkets.length === 0) {
            // No legacy documents to migrate (idempotent)
            return;
        }

        // Transform each legacy document
        for (const market of legacyMarkets) {
            // Calculate new pricing detail from legacy pricePerUnit
            const pricingDetail = {
                minUsdtTransferCost: market.pricePerUnit * 65000 / 1_000_000, // Convert SUN to TRX
                basePricePerUnit: market.pricePerUnit,
                lastCalculated: new Date()
            };

            // Update document with new structure
            await collection.updateOne(
                { _id: market._id },
                {
                    $set: { pricingDetail },
                    $unset: { pricePerUnit: '' } // Remove legacy field
                }
            );
        }
    }
};
