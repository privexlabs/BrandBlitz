import { Router } from "express";
import { z } from "zod";
import {
  findUserById,
  findUserByPhoneHash,
  markPhoneVerified,
  updateUserWallet,
} from "../db/queries/users";
import {
  sendVerificationCode,
  checkVerificationCode,
  hashPhoneNumber,
  normalizePhoneNumber,
} from "../services/phone";
import { authenticate } from "../middleware/authenticate";
import { createError } from "../middleware/error";
import { redis } from "../lib/redis";

const router = Router();

/**
 * GET /users/me
 * Full profile of the authenticated user.
 */
router.get("/me", authenticate, async (req, res) => {
  const user = await findUserById(req.user!.sub);
  if (!user) throw createError("User not found", 404);
  res.json({ user });
});

/**
 * PATCH /users/me/wallet
 * Associate a Stellar wallet address with the user account.
 */
router.patch("/me/wallet", authenticate, async (req, res) => {
  const { stellarAddress } = z
    .object({ stellarAddress: z.string().min(56).max(70) })
    .parse(req.body);

  await updateUserWallet(req.user!.sub, stellarAddress);
  res.json({ success: true });
});

/**
 * POST /users/me/phone/send
 * Send SMS verification code via Twilio.
 */
router.post("/me/phone/send", authenticate, async (req, res) => {
  const { phone } = z.object({ phone: z.string().min(1) }).parse(req.body);
  const normalizedPhone = normalizePhoneNumber(phone);

  // Rate limit: 3 sends per phone per 10 minutes
  const key = `phone:send:${normalizedPhone}`;
  const sends = await redis.incr(key);
  if (sends === 1) await redis.expire(key, 600);
  if (sends > 3) throw createError("Too many verification attempts", 429);

  await sendVerificationCode(normalizedPhone);
  res.json({ success: true });
});

/**
 * POST /users/me/phone/verify
 * Confirm SMS verification code. Marks phone as verified.
 */
router.post("/me/phone/verify", authenticate, async (req, res) => {
  const { phone, code } = z
    .object({ phone: z.string(), code: z.string().length(6) })
    .parse(req.body);

  const normalizedPhone = normalizePhoneNumber(phone);
  const phoneHash = hashPhoneNumber(normalizedPhone);

  const existingUser = await findUserByPhoneHash(phoneHash);
  if (existingUser && existingUser.id !== req.user!.sub) {
    throw createError("Phone number already associated with another account", 409);
  }

  const approved = await checkVerificationCode(normalizedPhone, code);
  if (!approved) throw createError("Invalid verification code", 400);

  await markPhoneVerified(req.user!.sub, phoneHash);
  await redis.set(`phone:hash:${phoneHash}`, req.user!.sub, "EX", 86400 * 365);

  res.json({ success: true });
});

export default router;
