import { query } from "../index";

export interface GameSession {
  id: string;
  user_id: string;
  challenge_id: string;
  device_id: string | null;
  warmup_started_at: string | null;
  warmup_completed_at: string | null;
  challenge_started_at: string | null;
  challenge_ended_at: string | null;
  round_1_score: number;
  round_2_score: number;
  round_3_score: number;
  total_score: number;
  flagged: boolean;
  flag_reasons: string[] | null;
  is_practice: boolean;
  created_at: string;
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
     ON CONFLICT (user_id, challenge_id) DO NOTHING
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
    "UPDATE game_sessions SET warmup_started_at = NOW() WHERE id = $1",
    [sessionId]
  );
}

export async function markWarmupCompleted(sessionId: string): Promise<void> {
  await query(
    "UPDATE game_sessions SET warmup_completed_at = NOW() WHERE id = $1",
    [sessionId]
  );
}

export async function markChallengeStarted(sessionId: string): Promise<void> {
  await query(
    "UPDATE game_sessions SET challenge_started_at = NOW() WHERE id = $1",
    [sessionId]
  );
}

export async function recordRoundScore(
  sessionId: string,
  round: 1 | 2 | 3,
  score: number
): Promise<void> {
  await query(
    `UPDATE game_sessions SET round_${round}_score = $1 WHERE id = $2`,
    [score, sessionId]
  );
}

export async function finishSession(sessionId: string): Promise<GameSession> {
  const result = await query<GameSession>(
    "UPDATE game_sessions SET challenge_ended_at = NOW() WHERE id = $1 RETURNING *",
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
     SET flagged = TRUE, flag_reasons = array_cat(flag_reasons, $1::text[])
     WHERE id = $2`,
    [reasons, sessionId]
  );
}

export async function getLeaderboard(
  challengeId: string,
  limit = 20,
  offset = 0
): Promise<Array<GameSession & { username: string; avatar_url: string | null; stellar_address: string | null }>> {
  const result = await query<
    GameSession & { username: string; avatar_url: string | null; stellar_address: string | null }
  >(
    `SELECT gs.*, u.email as username, u.avatar_url, u.stellar_address
     FROM game_sessions gs
     JOIN users u ON gs.user_id = u.id
     WHERE gs.challenge_id = $1
       AND gs.flagged = FALSE
       AND gs.is_practice = FALSE
     ORDER BY gs.total_score DESC, gs.challenge_ended_at ASC
     LIMIT $2 OFFSET $3`,
    [challengeId, limit, offset]
  );
  return result.rows;
}
