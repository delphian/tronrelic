# Energy

`EnergyService` fetches an account's TRON energy delegations from TronGrid (`getDelegatedResourceAccountIndex` / `getDelegatedResource`) and normalizes them into `DelegationRecord[]` for the `/api` energy-delegation endpoint.

## Canonical documentation

No dedicated detail doc exists yet; [tron.md](../../../../docs/tron/tron.md) covers the energy system this module reports on (staking vs. renting, `DelegateResourceContract`), and [tron-chain-parameters.md](../../../../docs/tron/tron-chain-parameters.md) covers the conversion math for pricing that energy. This module does not itself convert energy to TRX — it only surfaces raw delegation records from `TronGridClient`.
