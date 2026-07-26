# Partial security and scheduling follow-up

## Summary

This branch completes the smallest remaining code-path fixes from the current security/reliability bundle without expanding scope into new infra or dependency work.

## What changed

### #326 - Warmup clock-skew enforcement

- moved `POST /sessions/:challengeId/warmup-complete` onto the shared `detectClockSkew` middleware
- removed the duplicated inline clock-skew check from the route
- imported the missing session/db helpers that the route already depended on
- aligned the route test to reflect the actual guard order: stale client timestamps fail before warmup-unlock evaluation

### #325 - League start deferral when players are still active

- added an active-session grace-period check before `start-week` assignment seeding runs
- when recent active sessions still exist, the worker now requeues a delayed `start-week` job instead of reassigning players immediately
- added a focused worker test covering both the defer path and the immediate-seed path

## Files changed

- `apps/api/src/routes/sessions.ts`
- `apps/api/src/routes/sessions.test.ts`
- `apps/api/src/queues/processors/league.processor.ts`
- `apps/api/src/queues/processors/league.processor.test.ts`

## Notes

- I did not run installs, builds, or tests in this branch per request.
- I did not mark unrelated issues as solved in this draft.
- `#321` and `#324` are still follow-up scope, not part of the code changes on this branch.

## Upstream assigned issues

- Closes privexlabs/BrandBlitz#399
- Closes privexlabs/BrandBlitz#436
- Closes privexlabs/BrandBlitz#441
- Closes privexlabs/BrandBlitz#447

## Local scope note

- Follow-up for #325
- Follow-up for #326
