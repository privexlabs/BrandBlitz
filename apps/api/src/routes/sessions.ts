import { Router } from "express";
import { z } from "zod";
import { getChallengeById, getChallengeQuestions } from "../db/queries/challenges";
import {
  createSession,
  getSession,
  markWarmupStarted,
  markWarmupCompleted,
  markChallengeStarted,
  recordRoundScore,
  finishSession,
} from "../db/queries/sessions";
import { calculateRoundScore, validateAnswer } from "../services/scoring";
import { authenticate } from "../middleware/authenticate";
import {
  enforceOneSessionPerChallenge,
  validateReactionTime,
  validateDeviceFingerprint,
} from "../middleware/anti-cheat";
import { createError } from "../middleware/error";
import { challengeStartLimiter } from "../middleware/rate-limit";
import { redis } from "../lib/redis";
import { WARMUP_MIN_SECONDS } from "@brandblitz/stellar";

const router = Router();

const AnswerSchema = z.object({
  selectedOption: z.enum(["A", "B", "C", "D"]),
  reactionTimeMs: z.number().int().min(0),
});

/**
 * POST /sessions/:challengeId/warmup-start
 * Begin the warm-up phase. Records start time server-side.
 */
router.post(
  "/:challengeId/warmup-start",
  authenticate,
  validateDeviceFingerprint,
  async (req, res) => {
    const challenge = await getChallengeById(req.params.challengeId);
    if (!challenge || challenge.status !== "active") {
      throw createError("Challenge not available", 404);
    }

    const session = await createSession({
      userId: req.user!.sub,
      challengeId: challenge.id,
      deviceId:
        (req.headers["x-device-id"] as string | undefined) ??
        (req.headers["x-visitor-id"] as string | undefined),
      isPractice: req.body.isPractice === true,
    });

    await markWarmupStarted(session.id);

    // Store warmup unlock time in Redis (server enforces minimum exposure)
    const unlockAt = Date.now() + WARMUP_MIN_SECONDS * 1000;
    await redis.set(`warmup:unlock:${session.id}`, unlockAt.toString(), "EX", 300);

    res.json({ sessionId: session.id, unlockAt });
  }
);

/**
 * POST /sessions/:challengeId/warmup-complete
 * Completes warm-up and issues a short-lived challenge token.
 * Server enforces that minimum exposure time has passed.
 */
router.post("/:challengeId/warmup-complete", authenticate, async (req, res) => {
  const challenge = await getChallengeById(req.params.challengeId);
  if (!challenge) throw createError("Challenge not found", 404);

  const session = await getSession(req.user!.sub, challenge.id);
  if (!session) throw createError("Session not found", 404);
  if (session.user_id !== req.user!.sub) throw createError("Forbidden", 403);

  // Enforce server-side warmup minimum
  const unlockAt = await redis.get(`warmup:unlock:${session.id}`);
  if (unlockAt && Date.now() < parseInt(unlockAt)) {
    throw createError("Warm-up minimum not yet elapsed", 400, "WARMUP_TOO_FAST");
  }

  await markWarmupCompleted(session.id);

  // Issue a short-lived challenge token (10 min TTL)
  const challengeToken = `ct:${session.id}:${Date.now()}`;
  await redis.set(`challenge-token:${challengeToken}`, session.id, "EX", 600);

  res.json({ challengeToken });
});

/**
 * POST /sessions/:challengeId/start
 * Start the challenge timer. Validates challenge token from warmup-complete.
 */
router.post(
  "/:challengeId/start",
  authenticate,
  challengeStartLimiter,
  enforceOneSessionPerChallenge,
  async (req, res) => {
    const { challengeToken } = z.object({ challengeToken: z.string() }).parse(req.body);
    const challenge = await getChallengeById(req.params.challengeId);
    if (!challenge) throw createError("Challenge not found", 404);

    // Validate challenge token
    const storedSessionId = await redis.get(`challenge-token:${challengeToken}`);
    if (!storedSessionId) throw createError("Invalid or expired challenge token", 401);

    const session = await getSession(req.user!.sub, challenge.id);
    if (!session || session.id !== storedSessionId) throw createError("Session mismatch", 403);

    await markChallengeStarted(session.id);
    await redis.del(`challenge-token:${challengeToken}`);

    // Store session start time for timing validation
    await redis.set(`session:start:${session.id}`, Date.now().toString(), "EX", 120);

    res.json({ sessionId: session.id, startsAt: new Date().toISOString() });
  }
);

/**
 * POST /sessions/:challengeId/answer/:round
 * Submit an answer for a round. Validates + scores server-side.
 * Correct answers are NEVER sent to the client.
 */
router.post(
  "/:challengeId/answer/:round",
  authenticate,
  validateReactionTime,
  async (req, res) => {
    const round = parseInt(req.params.round) as 1 | 2 | 3;
    if (![1, 2, 3].includes(round)) throw createError("Invalid round", 400);

    const body = AnswerSchema.parse(req.body);
    const challenge = await getChallengeById(req.params.challengeId);
    if (!challenge) throw createError("Challenge not found", 404);

    const session = await getSession(req.user!.sub, challenge.id);
    if (!session) throw createError("Session not found", 404);
    if (session.user_id !== req.user!.sub) throw createError("Forbidden", 403);
    if (!session.challenge_started_at) throw createError("Challenge not started", 400);

    // Edge Cases
    if (session.completed_at) throw createError("Session already completed", 409);
    if (session.is_flagged) throw createError("Session flagged for review", 403);
    
    // Double answer check
    const existingScores = (session as any).scores || []; // Assume scores are joined or we need to check DB
    if (existingScores.some((s: any) => s.round === round)) {
      throw createError("Round already answered", 400);
    }

    // Get the server-stored question for this round
    const questions = await getChallengeQuestions(challenge.id);
    const question = questions.find((q) => q.round === round);
    if (!question) throw createError("Question not found", 404);

    const score = calculateRoundScore({
      selectedOption: body.selectedOption,
      correctOption: question.correct_option,
      reactionTimeMs: body.reactionTimeMs,
    });

    await recordRoundScore(session.id, round, score);

    // On last round — finalize the session
    if (round === 3) {
      await finishSession(session.id);
    }

    res.json({
      correct: validateAnswer(question, body.selectedOption),
      score,
      round,
    });
  }
);

export default router;
