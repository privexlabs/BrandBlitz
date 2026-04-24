import { Router } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { z } from "zod";
import { findUserById, upsertUser, type User } from "../db/queries/users";
import { config } from "../lib/config";
import { createError } from "../middleware/error";
import { authLimiter } from "../middleware/rate-limit";
import { authenticate } from "../middleware/authenticate";
import { verifyGoogleIdToken } from "../services/google-auth";

const router = Router();

const GoogleCallbackSchema = z.object({
  idToken: z.string().min(1),
});

const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "30d";

function getJwtSecret(): string {
  return config.JWT_SECRET;
}

function getRefreshSecret(): string {
  return process.env.JWT_REFRESH_SECRET ?? getJwtSecret();
}

function signAccessToken(user: Pick<User, "id" | "email">): string {
  return jwt.sign(
    { sub: user.id, email: user.email, jti: randomUUID() },
    getJwtSecret(),
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function signRefreshToken(user: Pick<User, "id" | "email">): string {
  return jwt.sign(
    { sub: user.id, email: user.email, type: "refresh", jti: randomUUID() },
    getRefreshSecret(),
    { expiresIn: REFRESH_TOKEN_TTL }
  );
}

function serializeAuthUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name ?? null,
    username: user.username ?? null,
    avatarUrl: user.avatar_url ?? null,
    role: user.role ?? "player",
  };
}

/**
 * POST /auth/google/callback
 * Called by Next.js after successful Google OAuth.
 * Issues a JWT for the API.
 */
router.post("/google/callback", authLimiter, async (req, res) => {
  const { idToken } = GoogleCallbackSchema.parse(req.body);
  const profile = await verifyGoogleIdToken(idToken);

  const user = await upsertUser({
    email: profile.email,
    googleId: profile.googleId,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
  });

  const token = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  res.json({ token, refreshToken, user: serializeAuthUser(user) });
});

/**
 * GET /auth/me
 * Returns the authenticated user's profile.
 */
router.get("/me", authenticate, async (req, res) => {
  const user = await findUserById(req.user!.sub);
  if (!user) throw createError("User not found", 404);
  res.json({ user: serializeAuthUser(user) });
});

/**
 * POST /auth/refresh
 * Rotates access and refresh tokens.
 */
router.post("/refresh", async (req, res) => {
  const { refreshToken } = RefreshTokenSchema.parse(req.body);

  let payload: { sub: string; email: string; type?: string };
  try {
    payload = jwt.verify(refreshToken, getRefreshSecret()) as {
      sub: string;
      email: string;
      type?: string;
    };
  } catch {
    throw createError("Invalid refresh token", 401, "INVALID_REFRESH_TOKEN");
  }

  if (payload.type !== "refresh") {
    throw createError("Invalid refresh token", 401, "INVALID_REFRESH_TOKEN");
  }

  const user = await findUserById(payload.sub);
  if (!user) {
    throw createError("Invalid refresh token", 401, "INVALID_REFRESH_TOKEN");
  }

  res.json({
    token: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  });
});

export default router;
