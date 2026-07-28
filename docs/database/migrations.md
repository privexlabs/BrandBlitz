# Database Migration Strategy

## Current strategy

`init.sql` is now a bootstrap script. It includes the baseline schema at
`apps/api/migrations/00000-initial.sql` and then applies the forward migration
files under `apps/api/migrations/`.

### Rules

| Scenario                        | What to run                                    |
| ------------------------------- | ---------------------------------------------- |
| Fresh install / CI from scratch | `psql -f init.sql`                             |
| Existing database upgrade       | `pnpm --filter @brandblitz/api migrate`        |
| Migration verification in CI    | `pnpm --filter @brandblitz/api migrate:dryrun` |

### Migration files

| File                              | Description                                              |
| --------------------------------- | -------------------------------------------------------- |
| `00000-initial.sql`               | Baseline snapshot of the current schema                  |
| `00001-hot-path-indexes.sql`      | Adds the challenge, leaderboard, and payout indexes      |
| `00001-hot-path-indexes.down.sql` | Rolls back the hot-path indexes safely                   |
| `00002-refunds.sql`               | Adds refund tracking and the `refunded` challenge status |

### Operational notes

- The migration runner serializes execution with a `SELECT ... FOR UPDATE`
  lock row before applying DDL.
- Safe migrations can include a matching `*.down.sql` rollback file.
- The runner runs `ANALYZE` after applying or rolling back migrations so the
  planner refreshes statistics immediately.
- `CREATE INDEX IF NOT EXISTS` / `DROP INDEX IF EXISTS` are used where possible
  so replays are safe on already-upgraded databases.

## Safely adding an index to a large table

When a new index is needed on a large, frequently-written table
(e.g. `game_sessions`, `payouts`, `challenges`) the normal migration
runner **must not** be used — it wraps every file in a transaction,
which prevents `CREATE INDEX CONCURRENTLY` and forces a full table lock
for the duration of the DDL.

Use this out-of-band procedure instead.

### Procedure

1. **Write the migration SQL file** as usual under `migrations/` (e.g.
   `00010_large_table_idx.sql`). The file stays in git for review and
   lineage, but the runner will *skip* it because we manually pre-record
   it below.

2. **Run `CREATE INDEX CONCURRENTLY` outside the runner** — directly
   against the production or staging database via a one-off maintenance
   script or a manual `psql` session:

   ```sql
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_large_table_col
     ON large_table (col);
   ```

   `CONCURRENTLY` allows the index build to proceed while other writes
   continue. It takes longer (two table scans instead of one) and
   consumes more resources, but avoids blocking writes.

3. **Record the migration as already applied** so the runner and
   `migrate:dryrun` in CI skip it:

   ```sql
   INSERT INTO schema_migrations (version, applied_at)
   VALUES ('00010_large_table_idx.sql', NOW());
   ```

   The `schema_migrations` table is the runner's bookkeeping table
   (see `apps/api/scripts/migrate.ts:60-64`). Once the row exists, the
   `runUp` loop skips the file and `runDryRun` considers everything
   current.

4. **Verify with `migrate:dryrun`.** Run `pnpm --filter @brandblitz/api migrate:dryrun` and confirm it reports `"All migrations have already been applied."`

### Hash-mismatch edge case (not yet enforced)

`docs/adr/003-migrations-framework.md` describes a future `hash` column
in `schema_migrations` that would refuse to re-run a migration whose
contents changed after application. If that column is ever added, the
out-of-band `INSERT` above will need to include a correct hash of the
migration file at the time it was applied. For now the version-keyed
lookup in `getAppliedVersions` (`migrate.ts:67-72`) only checks for the
presence of the version string, so the simple `INSERT` above is
sufficient.

### CI validation (dual-path)

The workflow `.github/workflows/db-dual-path.yml` now checks two paths:

1. **Fresh path** - runs `init.sql`
2. **Migration path** - seeds `00000-initial.sql` and then applies the forward
   migrations in `apps/api/migrations/`

Both paths are diffed with `pg_dump --schema-only`; the workflow fails if they
diverge.
