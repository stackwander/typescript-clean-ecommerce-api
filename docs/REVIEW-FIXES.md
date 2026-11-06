# Architecture review fixes and verification

Verified locally on 6 November 2026. This is a breaking version-2 contract, not an in-place legacy
data conversion. See [UPGRADING.md](UPGRADING.md) before deploying against an existing database.

## Review coverage

The original strengths (review items 1–4) are retained: explicit layers, strict TypeScript,
observability, and automated image publishing. Feature routers keep HTTP composition small;
domain contracts no longer depend on HTTP or Prisma.

| Review item                      | Resolution                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 5. Gateway bypass                | Every API replica authenticates read/write/admin credentials; backend ports remain private            |
| 6. Secrets                       | Removed hardcoded JWT configuration, ignored/untracked `.env`, excluded secrets from build context    |
| 7. Password exposure             | Removed password contract and login scaffolding; explicit user projections exclude legacy fields      |
| 8. Privileged updates            | Strict DTO allowlists, admin-only user profiles and payment/shipping changes                          |
| 9. Sensitive logs                | Completion metadata only; no request bodies, headers, query strings or raw driver errors              |
| 10. Partial order writes         | Transactions encompass orders, items, reservations, release and deletion                              |
| 11. Stale/empty item updates     | Updates return committed replacement items; empty arrays rejected explicitly                          |
| 12. Caller-owned financial state | Server-calculated totals, stock checks, controlled lifecycle and admin payment confirmation           |
| 13. Historical prices            | Integer minor units, currency and product name/price snapshots                                        |
| 14. Broken customer-order lookup | `/api/order/customer/:customerId` forwards the actual validated ID                                    |
| 15. Validation                   | Strict schemas on every write, parsed DTO persistence, bounds, IDs, date and duplicate-item checks    |
| 16. Layer leakage                | Domain ports/errors, injected adapters at bootstrap, HTTP-only error translation                      |
| 17. Empty layers                 | Removed forwarding-only use cases/services; retained a focused order service and repository contracts |
| 18. HTTP errors                  | Safe structured 400/401/403/404/409/413/415/429/500/503 responses                                     |
| 19. Unbounded reads              | Stable pagination, limits, bounded nested items, explicit user/order projections                      |
| 20. Metric cardinality           | Route templates, bounded HTTP method labels and private metrics listener                              |
| 21. Database ambiguity           | MongoDB is the supported adapter; removed unused PostgreSQL examples                                  |
| 22. Container reproducibility    | Lockfile installation, Prisma before compilation, tooling/runtime stages, non-root image              |
| 23. Gateway methods              | GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS routing, application CORS and tested gateway writes            |
| 24. Health/lifecycle             | Liveness/readiness, startup contract check, graceful shutdown, shared Prisma client                   |
| 25. Onboarding                   | README, environment template, credential generation, setup guard, generated OpenAPI and HTTP examples |
| 26. Repository hygiene           | Untracked runtime data, expanded Git/Docker ignores, removed stale JWT/Postman notes                  |
| 27. Monitoring wiring            | Both API scrapes, safe request IDs, stdout collection with service labels and Grafana sources         |
| 28. Quality gates                | Formatting/lint/type/build/unit/integration/image checks before version-tag image publication         |
| 29. Dead scaffolding             | Removed unused Redis, authentication dependencies, duplicate body parser and unmounted middleware     |

Additional protections include order-creation idempotency, reference/deletion race protection,
stock adjustments instead of absolute overwrites, capped totals, immutable paid-item updates without
refund confirmation, retained deletion/retry history, and refusal to modify unversioned databases.

## Verification performed

- `npm run check`: formatting, ESLint, TypeScript, production compilation and **8 unit/API tests passed**.
- `npm run test:integration`: **15 tests passed** against an isolated MongoDB replica set.
- Generated OpenAPI successfully from the current request schemas.
- Production Docker image built with Prisma generated before compilation and development tools pruned.
- Full Compose startup: replica-set initialization and guarded schema job succeeded; both APIs became healthy.
- Gateway smoke: missing-key rejection, authenticated creation, replay, customer lookup, payment authority,
  deletion and inventory restoration passed through Kong.
- Runtime inspection confirmed user `node`, read-only filesystem and no published backend ports.
- Prometheus reported both `backendapi1:9464` and `backendapi2:9464` targets `up`.
- Loki query returned API log streams labelled by service; Grafana reported database `ok`.
- Dependency installation/audits reported zero known vulnerabilities at verification time.
- Git whitespace checks passed; original `.env` and `var/` copies remained on disk after untracking.

The GitHub-hosted workflow and remote image publication were not triggered locally. No application
database was migrated and no image was pushed. The local verification used generated credentials,
separate ports, separate Compose project names and disposable databases.

## Manual operational steps

Generate deployment credentials and configure the environment before running the new API. Rotate
any real secrets previously committed to Git; untracking a file does not revoke credentials or erase
history. External accounts and Git history were not modified automatically.

Existing data needs an explicitly reviewed import: historical prices, payment evidence and inventory
cannot be reconstructed safely from the old CRUD records. Production also needs authenticated
MongoDB, TLS, secret storage, backups and capacity testing. The provided unauthenticated local
single-member database and optional Docker-socket log collector are development infrastructure.
