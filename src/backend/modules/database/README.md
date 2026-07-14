# Database

`DatabaseModule` implements `IModule`, providing the `IDatabaseService` abstraction every other module and plugin uses for MongoDB access, plus the migration system (`MigrationsService`) for schema evolution.

## Canonical documentation

- [system-database.md](../../../../docs/system/system-database.md) — `IDatabaseService`, three-tier access, namespace isolation
- [system-database-migrations.md](../../../../docs/system/system-database-migrations.md) — migration discovery, transactions, REST API, admin UI
