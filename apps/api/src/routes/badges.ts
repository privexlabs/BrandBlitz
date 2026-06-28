import { Router } from "express";
import { redis } from "../lib/redis";
import { authenticate, optionalAuth } from "../middleware/authenticate";
import { requireAdmin } from "../middleware/require-admin";
import { getUserBadges } from "../db/queries/badges";
import { BADGE_DEFINITIONS } from "../services/badges";

const router = Router();

const BADGES_CACHE_TTL_SEC = 300;
const BADGES_CACHE_KEY = "badges:definitions";

type BadgeCategory = "challenge" | "streak" | "league";

interface PublicBadgeDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconUrl: string;
  category: BadgeCategory;
  unlockCriteria: string;
}

function badgeCategory(slug: string): BadgeCategory {
  if (slug.startsWith("league_")) return "league";
  if (slug.startsWith("streak_")) return "streak";
  return "challenge";
}

function publicBadgeDefinitions(): PublicBadgeDefinition[] {
  return BADGE_DEFINITIONS.map((badge) => ({
    id: badge.slug,
    slug: badge.slug,
    name: badge.name,
    description: badge.description,
    iconUrl: badge.iconUrl,
    category: badgeCategory(badge.slug),
    unlockCriteria: badge.criteria,
  }));
}

function filterByCategory(
  badges: PublicBadgeDefinition[],
  category: unknown
): PublicBadgeDefinition[] {
  if (typeof category !== "string" || category.trim() === "") return badges;
  return badges.filter((badge) => badge.category === category.trim());
}

/**
 * GET /api/badges
 * Returns badge definitions, optionally annotated with the current user's
 * earned state when a valid bearer token is supplied.
 */
router.get("/", optionalAuth, async (req, res) => {
  const cached = await redis.get(BADGES_CACHE_KEY);
  const definitions =
    cached !== null ? (JSON.parse(cached) as PublicBadgeDefinition[]) : publicBadgeDefinitions();

  if (cached === null) {
    await redis.set(BADGES_CACHE_KEY, JSON.stringify(definitions), "EX", BADGES_CACHE_TTL_SEC);
  }

  const filtered = filterByCategory(definitions, req.query.category);

  res.setHeader("X-Cache", cached !== null ? "HIT" : "MISS");

  if (!req.user) {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ badges: filtered });
    return;
  }

  const earned = await getUserBadges(req.user.sub);
  const earnedMap = new Map(earned.map((badge) => [badge.badge_slug, badge]));

  res.json({
    badges: filtered.map((badge) => {
      const record = earnedMap.get(badge.slug);
      return {
        ...badge,
        earned: !!record,
        earnedAt: record?.awarded_at ?? null,
      };
    }),
  });
});

/**
 * POST /api/admin/cache/badges/flush
 * Admin-only: flush the badges definitions cache.
 */
router.post("/flush", authenticate, requireAdmin, async (_req, res) => {
  await redis.del(BADGES_CACHE_KEY);
  res.status(204).send();
});

export default router;
