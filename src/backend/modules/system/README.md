# System

`SystemMonitorService` probes MongoDB, Redis, and server health (uptime, memory, sync state) for the admin monitoring endpoints and dashboard.

## Canonical documentation

- [system-api.md](../../../../docs/system/system-api.md) — admin API gateway: auth, conventions, links to per-domain detail docs (health, blockchain, scheduler, logs, websockets, widgets)
- [system-dashboard.md](../../../../docs/system/system-dashboard.md) — `/system/system` dashboard page that renders these health probes
