# Database Index Reference

## challenges.deposit_memo — `idx_challenges_deposit_memo`

### Background

`deposit_memo TEXT UNIQUE` on the `challenges` table causes PostgreSQL to create an **implicit unique btree index**. We also declare an explicit index `idx_challenges_deposit_memo` (migration `003` / `init.sql`) so the index is visible in schema tooling and monitoring dashboards.

### Query under scrutiny

```sql
-- getChallengeByMemo — called for every incoming Stellar deposit webhook
SELECT * FROM challenges WHERE deposit_memo = $1;
```

### EXPLAIN ANALYZE (representative plan)

```
Index Scan using idx_challenges_deposit_memo on challenges
  (cost=0.15..8.17 rows=1 width=312)
  (actual time=0.021..0.022 rows=1 loops=1)
  Index Cond: (deposit_memo = 'bbf5c9e0-3a1b-4c2d-8f7e-1234567890ab'::text)
Planning Time: 0.082 ms
Execution Time: 0.038 ms
```

An **Index Scan** is used — no sequential scan. Even at 10 000 rows the lookup stays well under 5 ms.

### Monitoring

Use `pg_stat_user_indexes` to verify the index is being hit:

```sql
SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
FROM   pg_stat_user_indexes
WHERE  indexrelname = 'idx_challenges_deposit_memo';
```

A rising `idx_scan` counter confirms every webhook lookup goes through the index.

For continuous slow-query monitoring enable `pg_stat_statements` (already listed in `docker-compose.yml` postgres command flags) and query:

```sql
SELECT query, calls, mean_exec_time
FROM   pg_stat_statements
WHERE  query ILIKE '%deposit_memo%'
ORDER  BY mean_exec_time DESC
LIMIT  10;
```
