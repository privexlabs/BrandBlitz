import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { findUserByGoogleId, upsertUser } from "../db/queries/users";
import { createError } from "../middleware/error";
import { authLimiter } from "../middleware/rate-limit";
import { authenticate } from "../middleware/authenticate";
import { config } from "../lib/config";

const router = Router();

const GoogleCallbackSchema = z.object({
  googleId: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

/**
 * POST /auth/google/callback
 * Called by Next.js after successful Google OAuth.
 * Issues a JWT for the API.
 */
router.post("/google/callback", authLimiter, async (req, res) => {
  const body = GoogleCallbackSchema.parse(req.body);

  const user = await upsertUser({
    email: body.email,
    googleId: body.googleId,
    name: body.name,
    avatarUrl: body.avatarUrl,
  });

  const token = jwt.sign(
    { sub: user.id, email: user.email },
    config.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token, user: { id: user.id, email: user.email, avatarUrl: user.avatar_url } });
});

/**
 * GET /auth/me
 * Returns the authenticated user's profile.
 */
router.get("/me", authenticate, async (req, res) => {
  const user = await findUserByGoogleId(req.user!.sub);
  if (!user) throw createError("User not found", 404);
  res.json({ user });
});

/**
 * POST /auth/refresh
 * Re-issues a JWT for an authenticated user.
 */
router.post("/refresh", authenticate, (req, res) => {
  const token = jwt.sign(
    { sub: req.user!.sub, email: req.user!.email },
    config.JWT_SECRET,
    { expiresIn: "7d" }
  );
  res.json({ token });
});

export default router;
