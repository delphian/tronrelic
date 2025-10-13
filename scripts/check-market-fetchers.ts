import { initializeMarketFetchers, marketFetcherRegistry, getMarketFetcherContext } from '../apps/backend/src/modules/markets/fetchers/index.js';

async function main() {
  const context = getMarketFetcherContext();

  initializeMarketFetchers();

  const fetchers = marketFetcherRegistry.list();
  console.log(`Registered ${fetchers.length} market fetchers`);

  for (const fetcher of fetchers) {
    process.stdout.write(`\nFetching ${fetcher.name} (${fetcher.guid})...\n`);
    const snapshot = await fetcher.fetch(context);
    if (!snapshot) {
      console.log('  ➜ No data returned');
      continue;
    }

    const { energy, availabilityPercent, effectivePrice, stats } = snapshot;
    console.log('  Energy total/available:', energy.total, '/', energy.available);
    console.log('  Effective price (TRX/32k):', effectivePrice);
    console.log('  Availability %:', availabilityPercent);
    if (stats?.orderMaxBuyerAPY || stats?.orderMaxSellerAPY) {
      console.log('  Max buyer/seller APY:', stats?.orderMaxBuyerAPY, '/', stats?.orderMaxSellerAPY);
    }
    console.log('  Fees count:', snapshot.fees?.length ?? 0);
    console.log('  Orders count:', snapshot.orders?.length ?? 0);
  }
}

main().catch(error => {
  console.error('Market fetcher check failed:', error);
  process.exit(1);
});
