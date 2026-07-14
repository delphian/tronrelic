# Auth

`SignatureService` implements `ISignatureService`: TRON message-signature verification and address normalization, wrapping a constructor-injected TronWeb instance. Not to be confused with the identity module, which owns Better Auth sessions and `req.authSession`.

## Canonical documentation

- [system-auth.md](../../../../docs/system/system-auth.md) — Better Auth identity, session resolution, and authorization predicates that gate routes across the backend
- [Identity Module README](../identity/README.md) — the module hosting the Better Auth instance this directory's signature verification supports (wallet-linking signature proofs)
