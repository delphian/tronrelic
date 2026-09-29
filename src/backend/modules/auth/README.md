# Auth

`SignatureService` implements `ISignatureService`: TRON message-signature verification and address normalization, wrapping a constructor-injected TronWeb instance. Not to be confused with the identity module, which owns Better Auth sessions and `req.authSession`.

`verifyMessage` fails closed. TronWeb's `verifyMessageV2` returns the address it recovers from the signature, not a boolean, and a signature over a different message recovers to a different address. The service compares that recovered address with the claimed one and throws `ValidationError` on any mismatch or unparseable signature. Until 29 Sep 2026 it treated the return value as a boolean, which accepted any well-formed signature for any wallet. `__tests__/signature.service.test.ts` runs the real library so that contract cannot drift again behind a mock.

## Canonical documentation

- [system-auth.md](../../../../docs/system/system-auth.md) — Better Auth identity, session resolution, and authorization predicates that gate routes across the backend
- [Identity Module README](../identity/README.md) — the module hosting the Better Auth instance this directory's signature verification supports (wallet-linking signature proofs)
