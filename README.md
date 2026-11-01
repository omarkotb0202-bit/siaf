# Safa Retail foundation

Offline-first Arabic RTL retail inventory foundation for cleaning products and fabric trading. Garment manufacturing and soap manufacturing are outside this phase. The workspace separates the Expo app, NestJS API, and shared contracts. PostgreSQL is intended to be authoritative; Expo SQLite is the durable device store.

## Requirements and setup (macOS)

- Node.js 20 LTS or newer, npm 10 or newer. This repository uses npm workspaces; no additional package manager is needed.
- For iOS builds: current Xcode and CocoaPods. For Android: Android Studio and an installed SDK/emulator.
- For the API: PostgreSQL 16+ locally. Docker Compose is provided for local-only development.

## Initial dependency baseline

The empty workspace is pinned to Expo SDK 52 / React Native 0.76.5 / React 18.3.1 / Expo Router 4, and NestJS 10 / TypeScript 5.7 / PostgreSQL client `pg` 8.13. These are mutually compatible stable release lines; install and `npm ls` must succeed before treating the baseline as verified. No lockfile could be generated in this network-restricted environment. Keep Expo-managed native packages aligned with the selected SDK using `npx expo install --check` after installing.

Run `cp .env.example .env`, set unique random JWT secrets, then `npm install`. Start PostgreSQL with `docker compose up -d db`; apply reviewed SQL migrations with `npm run db:migrate --workspace=@safa/api`. Start API with `npm run start:dev --workspace=@safa/api`, mobile with `npm run start --workspace=@safa/mobile`.

No hosted database is configured or migrated. The initial migration enables PostgreSQL row-level security; production deployment must set the organization context on each transaction and use a non-owner application role.

## Architecture

- `apps/mobile`: Expo Router, React Native, strict TypeScript, Arabic-first shell and SQLite repository.
- `apps/api`: NestJS modular API, validation, bearer authentication boundary, PostgreSQL migration runner.
- `packages/contracts`: shared command/API types.
- `database/migrations`: version-controlled PostgreSQL migrations. `apps/mobile/src/db/schema.ts` is an independent SQLite schema version.

## Catalog and inventory phase

Products and user-defined categories are cached and edited through SQLite repositories; writes and their versioned outbox commands share a transaction. Units carry dimensions and conversions use decimal strings with exact base-10 arithmetic. Stock is derived from immutable movements; opening balances, receipts, issues, count adjustments, transfer dispatch/receipt, and fabric cuts write auditable documents. Transfers leave the source balance at dispatch and remain in a separate transit ledger until received. Fabric roll cuts atomically reduce the source and create a linked result roll. Internal labels use Code 39 and Expo Print; manufacturer barcode data is preserved, and camera scanning has a manual-entry fallback.

Catalog access requires a cached active user, organization membership, registered device, role permissions (`catalog.read` / `catalog.write`), and a permitted warehouse for inventory operations. The current project still lacks the sign-in/session bootstrap and server sync endpoints; no local context is fabricated if those authorized cache records are missing. Do not treat device permissions as a replacement for server authorization.

Refresh tokens must be stored hashed server-side and rotated/revoked; mobile credential storage must use platform secure storage. Never put privileged database credentials in the app. Each API request must derive organization scope from authenticated membership, never trust an organization ID supplied by a client. The API still has no configured identity provider, device enrollment/revocation flow, or authenticated sync handlers; it fails closed. The mobile client now has durable protocol storage and a foreground sync driver for `/sync/push` and `/sync/pull`, but those routes are not served yet, so it cannot synchronize with a central server today.

## Offline synchronization protocol (client storage and transport contract)

Every local command is created in the same SQLite transaction as its business change. It carries a device-generated immutable operation UUID, organization/device/actor identifiers, schema version, monotonically allocated per-device local sequence, creation time, payload, and dependency list. The operation remains in `outbox` until a response contains a matching operation ID and a valid terminal status; a positive acknowledgement must also carry a canonical result. Transport failures retry with capped exponential backoff and jitter (10 attempts maximum), then remain visible as `failed`. Unsupported local versions and server review/rejection results remain visible for resolution. Dependencies are stored separately and prevent dispatch until each predecessor is acknowledged. A restart resumes from SQLite; no background task is required for correctness.

The foreground driver sends at most 100 eligible operations in sequence, one request per operation, and persists acknowledgements before proceeding. It pages the `organization` event stream in batches of 500 and commits inbox events and cursor advancement in one local transaction. Inbox rows are deduplicated by server event ID. Server implementations must authenticate the bearer token, derive tenant and device from the session, validate actor/device membership and branch/warehouse permissions, apply each operation and idempotency record in one PostgreSQL transaction, and return canonical results. They must never trust scope identifiers in the payload. Product/category updates need expected-version checks; posted sales, payments, returns and stock movements are immutable; transfers require state-checked transitions. These server rules are protocol requirements, not implemented API behavior in this workspace yet.

Offline stock policy is **local warning with server review**, not a global stock guarantee. The device checks its cached warehouse ledger; disconnected branches can sell the same last unit. Until server-side transactional stock validation is implemented, a pending sale is not centrally accepted. No quota allocation/reclaim system exists. Device revocation also cannot erase data from an offline handset; when implemented, revocation must block the next authenticated server request and local cached data should be protected with platform storage controls.

Sync health and counts are available from the mobile repository diagnostics query (`getSyncDiagnostics`); there is not yet an administrator screen. Background scheduling is deliberately not relied upon: the app/platform may suspend it, and foreground execution is the recovery path. The configured sync routes currently do not exist, so live multi-device convergence and server-authoritative acceptance are not available.

## Sales, purchasing, accounts, and cash

The mobile app now contains a local POS, invoice history, customer and supplier directories, supplier invoices with separately recorded goods receipts, linked sales and purchase return repositories, account transaction ledgers, and branch/device cash sessions. Sales snapshot product names, prices, units, conversion factors, discounts and taxes. The invoice, its stock issue movements, payments, customer receivable, audit event, and outbox command are written in one SQLite transaction. Supplier invoices affect payables when recorded; purchase orders do not add stock. A separate receipt writes the stock ledger. Payments and account ledger entries are immutable. Return quantity is checked against the original line and prior returns; sellable stock is restored only by the accepted/restock return path.

Cash sales require an open cash session for the cashbox. Closing a session compares the counted amount with the opening amount plus/minus recorded payments and cash documents. Device-local invoice states remain `pending` until a server result updates them to `accepted`, `rejected`, or `review`. The client has a foreground sync driver, but no authenticated session or API sync handlers exist, so it cannot receive authoritative server acceptance. `003_sales_purchasing_accounts.sql` defines PostgreSQL business tables, tenant RLS, unique operation identifiers, and immutable financial rows for future integration.

Offline stock policy: devices check only their local warehouse ledger. They do not reserve global stock and cannot guarantee against another disconnected device selling the same quantity. A future authenticated server post must revalidate permission, price, customer credit, and stock atomically; conflicts must retain the local command with a rejected/manual-review outcome. Do not report a pending offline invoice as centrally confirmed.

## Checks and limits

Use `npm run lint`, `npm run typecheck`, and `npm test`. With a disposable PostgreSQL database, run `npm run db:migrate --workspace=@safa/api`. The current scaffold still has no production auth provider, user provisioning flow, sync server handlers, stock quota service, administrator diagnostics screen, or automated mobile runtime. The client transport contract has not been verified against a live server; do not interpret local persistence tests as proof of end-to-end synchronization.

See [accounting, security, and pilot release notes](docs/ACCOUNTING_SECURITY_RELEASE.md) for the accounting gaps, security findings, setup and backup steps, and a staged pilot gate.
# siaf
# siaf
# siaf
# Abo-Saif
# siaf
