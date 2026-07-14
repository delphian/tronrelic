# Chain Parameters

`ChainParametersService` polls TronGrid every 10 minutes, persists TRON network parameters to MongoDB, and exposes energy/TRX conversion methods (`getEnergyFromTRX`, `getTRXFromEnergy`, `getAPY`) behind a 1-minute in-memory cache.

## Canonical documentation

- [tron-chain-parameters.md](../../../../docs/tron/tron-chain-parameters.md) — cached fields, conversion math, MongoDB fallback, `IChainParametersService` contract
