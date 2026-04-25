# Database Schema Reference

## game_sessions

Tracks a single user's participation in one challenge.

### Timestamps

| Column | Meaning |
|---|---|
| `created_at` | Row inserted (session created) |
| `warmup_started_at` | User entered warmup phase |
| `warmup_completed_at` | User passed warmup gate |
| `challenge_started_at` | First question delivered |
| `completed_at` | All rounds answered; session finalised |

`completed_at` is the **canonical end timestamp**. It is set by `finishSession()` and used as the tiebreaker in leaderboard ordering (`total_score DESC, completed_at ASC` — fastest finisher wins ties).

> `challenge_ended_at` was removed in migration `002_drop_challenge_ended_at.sql`. Any code or query referencing that column must be updated to use `completed_at`.

### Status lifecycle

```
warmup → active → completed
                ↘ flagged
```

## challenges

### deposit_memo lookup

`deposit_memo` carries the Stellar payment memo that identifies which challenge a deposit belongs to. It has a `UNIQUE` constraint (backed by a btree index) and an additional explicit index `idx_challenges_deposit_memo` (see `docs/database/indexes.md`).

`getChallengeByMemo()` in `apps/api/src/db/queries/challenges.ts` is the hot path for webhook-time deposit matching.
