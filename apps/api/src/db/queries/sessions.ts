import { query } from "../index";

export interface GameSession {
  id: string;
  user_id: string;
  challenge_id: string;
  device_id: string | null;
  warmup_started_at: string | null;
  warmup_completed_at: string | null;
  challenge_started_at: string | null;
  completed_at: string | null;
  round_1_score: number;
  round_2_score: number;
  round_3_score: number;
  total_score: number;
  flagged: boolean;
  flag_reasons: string[] | null;
  is_practice: boolean;
  created_at: string;
}

export interface RoundScore {
  id: string;
  session_id: string;
  round: 1 | 2 | 3;
  score: number;
  created_at: string;
  updated_at: string;
}

export interface LeaderboardSession extends GameSession {
  username: string;
  avatar_url: string;
  display_name: string;
  league: "bronze" | "silver" | "gold" | null;
  total_earned_usdc: string;
  stellar_address: string | null;
}

export async function createSession(data: {
  userId: string;
  challengeId: string;
  deviceId?: string;
  isPractice?: boolean;
}): Promise<GameSession> {
  const result = await query<GameSession>(
    `INSERT INTO game_sessions (user_id, challenge_id, device_id, is_practice)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, challenge_id) DO UPDATE
       SET user_id = game_sessions.user_id
     RETURNING *`,
    [data.userId, data.challengeId, data.deviceId ?? null, data.isPractice ?? false]
  );
  return result.rows[0];
}

export async function getSession(userId: string, challengeId: string): Promise<GameSession | null> {
  const result = await query<GameSession>(
    "SELECT * FROM game_sessions WHERE user_id = $1 AND challenge_id = $2",
    [userId, challengeId]
  );
  return result.rows[0] ?? null;
}

export async function markWarmupStarted(sessionId: string): Promise<void> {
  await query(
    "UPDATE game_sessions SET warmup_started_at = COALESCE(warmup_started_at, NOW()) WHERE id = $1",
    [sessionId]
  );
}

export async function markWarmupCompleted(sessionId: string): Promise<void> {
  const result = await query(
    `UPDATE game_sessions
     SET warmup_completed_at = NOW()
     WHERE id = $1
       AND warmup_completed_at IS NULL
     RETURNING id`,
    [sessionId]
  );

  if (result.rowCount === 0) {
    throw new Error("Warmup already completed or session not found");
  }
}

export async function markChallengeStarted(sessionId: string): Promise<void> {
  await query(
    `UPDATE game_sessions
     SET challenge_started_at = COALESCE(challenge_started_at, NOW()),
         status = 'active'
     WHERE id = $1`,
    [sessionId]
  );
}

export async function recordRoundScore(
  sessionId: string,
  round: 1 | 2 | 3,
  score: number
): Promise<void> {
  if (![1, 2, 3].includes(round)) {
    throw new Error("Invalid round");
  }

  const roundColumn = `round_${round}_score`;

  await query(
    `WITH upserted AS (
       INSERT INTO session_round_scores (session_id, round, score)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, round) DO UPDATE
         SET score = EXCLUDED.score,
             updated_at = NOW()
       RETURNING session_id, score
     )
     UPDATE game_sessions
     SET ${roundColumn} = (SELECT score FROM upserted)
     WHERE id = $1`,
    [sessionId, round, score]
  );
}

export async function finishSession(sessionId: string): Promise<GameSession> {
  const result = await query<GameSession>(
    `UPDATE game_sessions
     SET completed_at = NOW(),
         status = 'completed',
         total_score = COALESCE((
           SELECT SUM(score)::int
           FROM session_round_scores
           WHERE session_id = $1
         ), 0)
     WHERE id = $1
     RETURNING *`,
    [sessionId]
  );
  return result.rows[0];
}

export async function flagSession(
  sessionId: string,
  reasons: string[]
): Promise<void> {
  await query(
    `UPDATE game_sessions
     SET flagged = TRUE,
         status = 'flagged',
         flag_reasons = array_cat(COALESCE(flag_reasons, '{}'), $1::text[])
     WHERE id = $2`,
    [reasons, sessionId]
  );
}

export async function getLeaderboard(
  challengeId: string,
  limit = 20,
  offset = 0
): Promise<LeaderboardSession[]> {
  const result = await query<LeaderboardSession>(
    `SELECT gs.*,
            u.email AS username,
            u.avatar_url,
            u.display_name,
            u.league,
            u.total_earned_usdc,
            COALESCE(
              NULLIF(to_jsonb(u) ->> 'embedded_wallet_address', ''),
              NULLIF(to_jsonb(u) ->> 'stellar_address', '')
            ) AS stellar_address
     FROM game_sessions gs
     JOIN users u ON gs.user_id = u.id
     WHERE gs.challenge_id = $1
       AND gs.flagged = FALSE
       AND gs.is_practice = FALSE
     ORDER BY gs.total_score DESC, gs.completed_at ASC
     LIMIT $2 OFFSET $3`,
    [challengeId, limit, offset]
  );
  return result.rows;
}

export async function getTopSessionsPerChallenge(
  challengeIds: string[],
  limitPerChallenge = 10
): Promise<LeaderboardSession[]> {
  if (challengeIds.length === 0) return [];

  const result = await query<LeaderboardSession>(
    `SELECT sub.id, sub.user_id, sub.challenge_id, sub.device_id,
            sub.warmup_started_at, sub.warmup_completed_at,
            sub.challenge_started_at, sub.completed_at,
            sub.round_1_score, sub.round_2_score, sub.round_3_score,
            sub.total_score, sub.flagged, sub.flag_reasons,
            sub.is_practice, sub.created_at,
            sub.username, sub.avatar_url, sub.display_name, sub.league, sub.total_earned_usdc, sub.stellar_address
     FROM (
       SELECT gs.*,
              u.email        AS username,
              u.avatar_url,
              u.display_name,
              u.league,
              u.total_earned_usdc,
              COALESCE(
                NULLIF(to_jsonb(u) ->> 'embedded_wallet_address', ''),
                NULLIF(to_jsonb(u) ->> 'stellar_address', '')
              ) AS stellar_address,
              ROW_NUMBER() OVER (
                PARTITION BY gs.challenge_id
                ORDER BY gs.total_score DESC, gs.completed_at ASC
              ) AS rn
       FROM game_sessions gs
       JOIN users u ON gs.user_id = u.id
       WHERE gs.challenge_id = ANY($1::uuid[])
         AND gs.flagged = FALSE
         AND gs.is_practice = FALSE
     ) sub
     WHERE sub.rn <= $2
     ORDER BY sub.challenge_id, sub.total_score DESC, sub.completed_at ASC`,
    [challengeIds, limitPerChallenge]
  );
  return result.rows;
}
