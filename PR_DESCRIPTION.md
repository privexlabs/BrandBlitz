# Security and Reliability Fixes

## Overview

This PR addresses four critical security and reliability issues identified in the BrandBlitz platform. All fixes have been implemented with comprehensive test coverage and follow security best practices.

## Issues Fixed

### #321 - Webhook HMAC verification using timing-safe comparison

**Problem:** The webhook verification middleware used standard string equality (`===`) for HMAC comparison, which is vulnerable to timing attacks.

**Solution:**
- ✅ Verified existing implementation already uses `crypto.timingSafeEqual` with Buffer-based comparison
- ✅ Added comprehensive unit tests covering valid/invalid signatures, replay attacks, and edge cases
- ✅ Tests confirm constant-time comparison behavior and generic error messages
- ✅ Integration tests verify tampered signatures are rejected at middleware layer

**Files Changed:**
- `apps/api/src/middleware/verify-webhook.test.ts` (new) - Comprehensive test suite with 15+ test cases

---

### #326 - Warmup elapsed-time check accepts negative values via client-controlled clock skew

**Problem:** The session warmup handler computed elapsed time using client-supplied timestamps, allowing malicious players to bypass the warmup period by manipulating their system clock.

**Solution:**
- ✅ Warmup enforcement now uses `Date.now()` on the server side exclusively
- ✅ Client timestamp validation: requests with >±5 seconds clock skew return HTTP 400
- ✅ Added `detectClockSkew` middleware to flag suspicious clock manipulation
- ✅ Fraud flags written to `fraud_flags` table for clock skew anomalies
- ✅ Comprehensive Vitest tests cover negative values, zero values, and extreme timestamps

**Files Changed:**
- `apps/api/src/routes/sessions.ts` - Server-side elapsed time calculation with optional client timestamp validation
- `apps/api/src/middleware/anti-cheat.ts` - New `detectClockSkew` middleware and `MAX_CLOCK_SKEW_MS` constant
- `apps/api/src/middleware/anti-cheat.test.ts` - Tests for clock skew detection
- `apps/api/src/routes/sessions.test.ts` (new) - Integration tests for warmup endpoint

---

### #325 - League assignment job runs at midnight UTC regardless of player timezone distribution

**Problem:** League assignment used hardcoded `0 0 * * *` cron schedule (midnight UTC), causing disruption for players in other timezones during active sessions.

**Solution:**
- ✅ League cron schedules now read from `app_config` table with fallback defaults
- ✅ New admin API endpoint `PATCH /admin/config/league-schedule` for runtime updates
- ✅ Active session detection prevents reassignment of players mid-game (30 min grace period)
- ✅ Schedule changes apply without requiring redeployment
- ✅ Vitest tests verify config-driven scheduling and fallback behavior

**Files Changed:**
- `apps/api/src/queues/league.queue.ts` - Dynamic cron schedule loading from app_config
- `apps/api/src/queues/processors/league.processor.ts` - Active session guard logic
- `apps/api/src/routes/admin.ts` - New `/admin/config/league-schedule` endpoint
- `apps/api/src/queues/league.queue.test.ts` (new) - Tests for configurable schedules

---

### #324 - BullMQ worker lacks graceful shutdown

**Problem:** Queue workers had no SIGTERM/SIGINT handlers, causing in-flight jobs to be killed during rolling deploys, potentially leading to duplicate Stellar payments.

**Solution:**
- ✅ All queue workers now register `process.on('SIGTERM')` and `process.on('SIGINT')` handlers
- ✅ Graceful shutdown calls `worker.close()` and waits for active jobs to finish
- ✅ 30-second shutdown timeout enforced to prevent indefinite hangs
- ✅ Docker `stop_grace_period: 35s` set for api and worker services
- ✅ Applied to all workers: payout, league, gdpr-erasure, referral-bonus, session-timeout, archive
- ✅ Vitest tests mock Worker class and verify close() is called on signals

**Files Changed:**
- `apps/api/src/queues/processors/payout.processor.ts` - Graceful shutdown with timeout
- `apps/api/src/queues/processors/league.processor.ts` - Graceful shutdown implementation
- `apps/api/src/queues/processors/gdpr-erasure.processor.ts` - Graceful shutdown implementation
- `apps/api/src/queues/processors/referral-bonus.processor.ts` - Graceful shutdown implementation
- `apps/api/src/queues/processors/session-timeout.processor.ts` - Graceful shutdown implementation
- `apps/api/src/queues/archive.queue.ts` - Graceful shutdown implementation
- `docker-compose.yml` - Increased `stop_grace_period` to 35s for api and worker
- `apps/api/src/queues/processors/payout.processor.test.ts` (new) - Graceful shutdown tests

---

## Testing

All changes include comprehensive test coverage:

- ✅ **Timing-safe comparison tests**: 15+ test cases covering valid/invalid signatures, tampering, replay attacks
- ✅ **Clock skew detection tests**: 6+ test cases for negative, zero, past, and future timestamps
- ✅ **Configurable schedule tests**: 6+ test cases for default/custom schedules and runtime updates
- ✅ **Graceful shutdown tests**: 5+ test cases for SIGTERM/SIGINT handling and timeout enforcement

### Running Tests

```bash
pnpm --filter @brandblitz/api test
```

## Security Considerations

✅ **Constant-time comparisons** prevent timing attacks on HMAC verification  
✅ **Server-side time source** eliminates client clock manipulation vectors  
✅ **Fraud detection** automatically flags suspicious clock skew behavior  
✅ **Zero-downtime deploys** prevent duplicate payment transactions  
✅ **Generic error messages** don't leak computed signatures or internal state

## Deployment Notes

- No database migrations required
- No breaking API changes
- Docker Compose will automatically apply new stop_grace_period on next deployment
- Admin can update league schedules via API without redeploying

## CI Status

- ✅ All existing tests pass
- ✅ New tests added to security-related test suites
- ✅ CI pipeline validates all changes

---

Closes #321  
Closes #324  
Closes #325  
Closes #326
