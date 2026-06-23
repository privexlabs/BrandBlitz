const MIN_CHALLENGE_DURATION_HOURS = 1;
const MAX_CHALLENGE_DURATION_HOURS = 720;

export function challengeEndsAt(durationHours: string, nowMs = Date.now()): string | null {
  const hours = Number(durationHours);
  if (
    !Number.isInteger(hours) ||
    hours < MIN_CHALLENGE_DURATION_HOURS ||
    hours > MAX_CHALLENGE_DURATION_HOURS
  ) {
    return null;
  }

  const endsAtMs = nowMs + hours * 60 * 60 * 1000;
  return endsAtMs > nowMs ? new Date(endsAtMs).toISOString() : null;
}
