# Upgrading the tutorial database to contract version 2

This is a breaking upgrade. The application supports MongoDB only. PostgreSQL examples,
unused Redis code, JWT instructions and the obsolete Postman collection have been removed.
Use the current README, OpenAPI specification and `rest-client.http` instead.

## Preserve existing data

1. Back up the original database, retain it unchanged and verify restoration before cutover.
2. Provision a separate authenticated MongoDB replica set/database. The local Compose database
   is unauthenticated and intended only for development on a trusted computer.
3. Install the locked dependencies, generate Prisma, and run `npm run db:push` against the
   **new empty database**. Setup creates indexes and a `_schema` contract marker (version 2).
   It refuses an unknown version or existing unversioned application records. It does not
   pass destructive `--accept-data-loss` flags. Never bypass the guard on a live database.
4. Write and review an explicit import for your actual records. Reconcile the following:
   - Catalog `buyPrice`, `msrp` and order `total` now use integer currency minor units,
     with a maximum of 2,000,000,000. Agree a currency and rounding policy before conversion.
   - Historical items require `productName` and `unitPrice` snapshots. Old data does not
     contain historical selling prices; do not invent them from today's catalog.
   - Reconcile available stock and existing reservations. Pending orders reserve inventory;
     shipped inventory remains consumed; cancelled inventory is released once.
   - Map statuses to `pending`, `shipped`, or `cancelled`, and verify payment/refund evidence.
   - Every order needs a unique `idempotencyKey` and `requestHash`. Generate migration-owned
     keys with a reserved prefix; clients must not reuse them for new orders.
   - Explicitly populate `deletedAt: null` on live orders. MongoDB distinguishes a missing
     field from null in queries. Populate revision counters and the required currency.
   - Validate every customer/product reference, duplicate email and item quantity. Import
     through a transaction-capable client and verify counts, totals and stock balances.
   - User records are admin-managed profiles, not login identities. Remove legacy password
     fields in the new database. Do not migrate credentials into logs or DTOs.
5. Test the new database with representative clients, then switch traffic in a controlled window.
   Keep the original backup and database available for recovery. Do not delete old volumes
   or run a destructive schema reset to resolve upgrade failures.

After a reviewed import, retain the version-2 marker created during fresh setup. Schema changes
beyond this contract require their own reviewed upgrade process; the marker is not a schema-drift detector.

## Client changes

| Previous behavior                         | Current contract                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| Gateway-only JWT                          | `x-api-key` on every `/api` request, validated in each replica         |
| Caller-provided total/payment on creation | Server total, unpaid pending order; admin confirms payment later       |
| Floating-point prices                     | Integer minor units in the configured currency                         |
| Nested customer/product objects on orders | `customerId` and `{ productId, quantity }` items                       |
| Unbounded array lists                     | `{ items, total, offset, limit }`, limit 1–100                         |
| `/api/order/name/:name`                   | `/api/order/customer/:customerId`                                      |
| Missing record could return `200 null`    | Structured 404 error                                                   |
| Empty order items could be ignored        | Empty item lists rejected with 400; cancel/delete explicitly           |
| Physical order deletion                   | Soft deletion, preserved price snapshots, references and retry history |
| Product stock overwritten by PUT          | Signed adjustment via `POST /api/product/:id/stock`                    |
| User passwords in CRUD                    | Password fields rejected; user routes require admin credentials        |

PUT retains partial-update semantics for existing callers. Unknown fields, null values, invalid
ObjectIds and empty update objects are rejected. Orders contain 1–100 distinct products with
quantities 1–10,000. Repeated deletions return 404. A retry with the same order key and normalized
input returns the current order, including a soft-deleted tombstone, with HTTP 201.

## Credentials and repository history

`.env` and `var/` are no longer tracked; local copies are preserved. This does **not** erase Git
history or revoke previously exposed credentials. Rotate any real database credentials and JWT
secrets that were committed, update downstream clients, and coordinate history cleanup with
repository owners if needed. No external credentials are automatically rotated by this change.

Keep the three API keys distinct. Store write/admin keys only in trusted servers. Profiles' `role`
fields do not authenticate callers; credential scopes are configured at deployment. Customer login,
tenant isolation and ownership checks belong in a separate identity boundary before public use.
