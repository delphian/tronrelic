# Auth

`SignatureService` implements `ISignatureService`: TRON message-signature verification and address normalization, wrapping a constructor-injected TronWeb instance. Not to be confused with the identity module, which owns Better Auth sessions and `req.authSession`.

`recoverTransactionSigners(txId, signatures)` returns the keys that signed a TRON transaction, recovered from its signatures with the shared `lib/recoverTransactionSigners.ts`. A transaction's permission id names a slot on the signing account, not the key that signed, so this is the call for attributing a transaction to a key. Plugins reach it as `context.signatureService`, which means they do not need their own copy of the recovery code; `trp-resource-markets` and `trp-onchain-typologies` both recover through it. A plugin's tests cannot import this code, so each of those two keeps a test-only recovery that follows the same rules.

`verifyMessage` fails closed. TronWeb's `verifyMessageV2` returns the address it recovers from the signature, not a boolean, and a signature over a different message recovers to a different address. The service compares that recovered address with the claimed one and throws `ValidationError` on any mismatch or unparseable signature. Until 29 Sep 2026 it treated the return value as a boolean, which accepted any well-formed signature for any wallet. `__tests__/signature.service.test.ts` runs the real library so that contract cannot drift again behind a mock.

## Canonical documentation

- [system-auth.md](../../../../docs/system/system-auth.md) — Better Auth identity, session resolution, and authorization predicates that gate routes across the backend
- [Identity Module README](../identity/README.md) — the module hosting the Better Auth instance this directory's signature verification supports (wallet-linking signature proofs)
