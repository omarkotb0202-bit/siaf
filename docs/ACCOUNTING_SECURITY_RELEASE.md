# Accounting, security, and pilot release notes

This is an engineering handoff for the current prototype, not an accounting opinion, security certification, or production approval. The application is **not ready for a live financial pilot** while authentication and server authorization are absent.

## Current financial model and limits

Implemented local records include sales and lines, purchases and receipts, sale/purchase returns, immutable payment rows, customer/supplier account transactions, cashboxes and sessions, cash documents, immutable stock movements, and audit events. Local business writes and their outbox records are grouped in SQLite transactions. Role permissions are configurable permission strings stored on roles and warehouse assignments; role names are not used as the sole authorization rule.

This is not double-entry accounting. There is no chart of accounts, journal posting/reversal workflow, accounting period close, trial balance, balance sheet, cash-flow statement, payment-to-invoice allocation model, or complete expense posting. Party ledgers are subledgers, not a balanced general ledger. The app does not calculate inventory carrying value, weighted-average cost, cost of goods sold, gross profit, or net profit. The product `cost` field is not a historical valuation layer. Sales revenue must not be presented as profit. No tax or statutory compliance is asserted.

Before enabling accounting reports, obtain accountant decisions on: cash versus accrual basis; chart of accounts; opening journal treatment; invoice/payment allocation and credit notes; inventory cost method and landed-cost allocation; treatment of discounts, returns, waste, stock losses, and tax; fiscal periods and rounding; and local statutory invoice/retention requirements. Implement and reconcile those decisions against sample opening balances before posting live transactions.

## Security and data-integrity findings

### Release blockers

- The home screen offers “continue locally”; it is not authentication. API operations fail closed because JWT verification and membership checks are not configured. There is no account provisioning, password recovery, refresh-token lifecycle, or session expiry implementation.
- No authenticated sync API exists. Consequently server-side organization/branch authorization, idempotent canonical posting, device enrollment/revocation, stock availability validation, and central audit of mobile operations are not implemented.
- SQLite is not encrypted by this application. A device backup or filesystem extraction may expose local business data. Restrict device access and backups for test data; do not store sensitive production/customer data on unmanaged devices. Before a real rollout, select a maintained SQLCipher-compatible Expo solution and platform-managed key storage, then test backup behavior and recovery. Do not invent a cryptographic scheme.
- Local permission checks are useful for UX and offline separation only. They are not a backend security boundary and can be modified on a compromised device.
- There is no dependency lockfile in this source snapshot, and dependency vulnerability scanning/build checks have not passed here.

Parameterized SQL is used for value inputs in the inspected repositories. The dynamic warehouse `IN` clause is built from placeholder count, not user text. Database access still requires a production least-privilege role; migration credentials must not be used by the API runtime. Configure PostgreSQL RLS context per transaction before exposing any protected data. Keep secrets only in the deployment secret manager/environment and out of Expo public configuration.

## Environment setup

1. Install Node.js 20 LTS or newer, npm 10 or newer, Python 3, and PostgreSQL 16 or newer. Install Xcode/CocoaPods for iOS or Android Studio/SDK for Android.
2. Copy `.env.example` to a local, untracked `.env`; replace every placeholder with random secrets. The current API does not yet consume the JWT settings to authenticate users. Never put server secrets in `EXPO_PUBLIC_*` variables or the mobile bundle.
3. Install dependencies with `npm install` when network/package registry access is available. Preserve the generated lockfile and review it before committing.
4. Use a disposable local database for migration work: `docker compose up -d db`, then `npm run db:migrate --workspace=@safa/api`. The migrator is for a local database only in this project workflow; inspect migrations and take a backup before applying them elsewhere.
5. Start the API with `npm run start:dev --workspace=@safa/api` and the client with `npm run start --workspace=@safa/mobile`. Expect login and cloud sync to remain unavailable until those API modules are implemented.

## Database backup and restore rehearsal

For a disposable PostgreSQL database, create a custom-format backup with `pg_dump --format=custom --file=safa.dump "$DATABASE_URL"`. Restore into a newly created, empty disposable database using `createdb safa_restore_test` and `pg_restore --dbname=safa_restore_test safa.dump`. Verify migration versions, organization/branch counts, document totals, and sample account/stock reconciliations before treating the restore as usable. This procedure has not been run against a live deployment. Protect backup files as sensitive data and store production backups encrypted under the hosting provider's managed backup policy.

SQLite is device-local. Deleting/reinstalling the app or losing the handset can lose unsynchronized work. The app currently provides no export/recovery mechanism for pending outbox operations; do not use it as the only record of live transactions.

## Build and release checks

- Android development build: `npm run android --workspace=@safa/mobile` (requires Android SDK/device). For a distributable build, configure EAS or a reviewed native Gradle signing pipeline; neither is configured here.
- iOS development build: `npm run ios --workspace=@safa/mobile` (requires macOS, Xcode, and CocoaPods). Signing and App Store release configuration are not present.
- Source checks: `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm test`. API/mobile production builds, device testing, vulnerability scans, and store submissions are not verified by these commands alone.
- Database checks: validate every migration against a fresh disposable database and a copy of the prior schema with representative data. No hosted migration has been authorized or run.

## One-branch pilot gate

Do not use live financial data until the release blockers above are closed. For a later controlled pilot:

1. Provision a staging tenant and one branch with synthetic products, units, barcodes, users, opening stock, and opening balances. Reconcile source totals independently before import.
2. Complete authenticated user/device enrollment, branch/warehouse authorization, server idempotency and stock checks, encrypted local storage, and backup/restore rehearsal. Use cashier, inventory, purchaser, accountant, and read-only accounts to verify least privilege.
3. Run the full Android journey on supported device sizes: receive stock, cash and credit sale, partial payment, return, transfer, fabric receipt/cut, shift close, offline restart, conflict recovery, and branch access denial. Verify both server records and local pending/failed status after each step.
4. Reconcile stock quantities and monetary balances daily against source documents; inspect rejected, duplicate, stale-cursor, and failed operations. Keep an operator-controlled rollback/export plan and a tested restore point.
5. Enable only the pilot branch, with trained staff and a named operator monitoring exceptions. Expand only after the accountant signs off reconciliations and the security owner approves the tested authorization and recovery controls.

There is no CSV import preview/rejection workflow yet. Do not bulk-load opening stock or balances by editing SQLite/PostgreSQL directly; implement traceable import documents and reconcile them before operational use.
