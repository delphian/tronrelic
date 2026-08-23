# Chain Parameters

`ChainParametersService` polls TronGrid every 10 minutes, persists TRON network parameters to MongoDB, and exposes resource/TRX conversion methods (`getEnergyFromTRX`, `getBandwidthFromTRX`, `getTRXFromEnergy`, `getAPY`) behind a 1-minute in-memory cache.

## Canonical documentation

- [tron-chain-parameters.md](../../../../docs/tron/tron-chain-parameters.md) — cached fields, conversion math, MongoDB fallback, `IChainParametersService` contract
