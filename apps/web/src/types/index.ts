// All canonical API-facing types live in @/lib/api (snake_case, matching the server).
// This module re-exports them so imports from @/types continue to work.
export type {
  Challenge,
  ChallengeQuestion,
  LeaderboardEntry,
  UserProfile,
  StreakResponse,
} from "@/lib/api";
