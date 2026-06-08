import { awardBadge, getUserBadges } from "../db/queries/badges";
import { findUserById } from "../db/queries/users";
import { getTopGoldUsers, getNewlyPromotedUsers } from "../db/queries/leagues";
import { metrics } from "../lib/metrics";

// Max score: 3 rounds × (100 base + 50 speed bonus)
export const PERFECT_SCORE = 450;

export interface BadgeDefinition {
  slug: string;
  name: string;
  description: string;
  criteria: string;
  iconUrl: string;
}

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  {
    slug: "first_win",
    name: "First Win",
    description: "You completed your first challenge.",
    criteria: "Complete your first non-practice challenge.",
    iconUrl: "/badges/first-win.svg",
  },
  {
    slug: "perfect_score",
    name: "Perfect Score",
    description: "You answered every question correctly with maximum speed.",
    criteria: "Score 450 points in a single challenge.",
    iconUrl: "/badges/perfect-score.svg",
  },
  {
    slug: "streak_3",
    name: "On a Roll",
    description: "You played 3 days in a row.",
    criteria: "Maintain a 3-day streak.",
    iconUrl: "/badges/streak-3.svg",
  },
  {
    slug: "streak_7",
    name: "Week Warrior",
    description: "You played 7 days in a row.",
    criteria: "Maintain a 7-day streak.",
    iconUrl: "/badges/streak-7.svg",
  },
  {
    slug: "wins_10",
    name: "Veteran",
    description: "You have completed 10 challenges.",
    criteria: "Complete 10 non-practice challenges.",
    iconUrl: "/badges/wins-10.svg",
  },
  {
    slug: "league_silver",
    name: "Silver Climber",
    description: "You earned promotion to the Silver League.",
    criteria: "Finish in the top 3 of your Bronze league group.",
    iconUrl: "/badges/league-silver.svg",
  },
  {
    slug: "league_gold",
    name: "Gold Contender",
    description: "You earned promotion to the Gold League.",
    criteria: "Finish in the top 3 of your Silver league group.",
    iconUrl: "/badges/league-gold.svg",
  },
  {
    slug: "league_diamond",
    name: "Diamond Elite",
    description: "You finished in the top 3 of the Gold League.",
    criteria: "Finish in the top 3 of your Gold league group.",
    iconUrl: "/badges/league-diamond.svg",
  },
];

export interface BadgeWithStatus extends BadgeDefinition {
  id: string;
  earned: boolean;
  earnedAt: string | null;
}

export async function getBadgesForUser(userId: string): Promise<BadgeWithStatus[]> {
  const earned = await getUserBadges(userId);
  const earnedMap = new Map(earned.map((b) => [b.badge_slug, b]));

  return BADGE_DEFINITIONS.map((def) => {
    const record = earnedMap.get(def.slug);
    return {
      ...def,
      id: record?.id ?? def.slug,
      earned: !!record,
      earnedAt: record?.awarded_at ?? null,
    };
  });
}

export async function checkAndAwardSessionBadges(
  userId: string,
  session: { total_score: number; is_practice: boolean }
): Promise<string[]> {
  if (session.is_practice) return [];

  const user = await findUserById(userId);
  if (!user) return [];

  const candidates: string[] = [];

  if (user.challenges_played === 1) candidates.push("first_win");
  if (session.total_score === PERFECT_SCORE) candidates.push("perfect_score");
  if (user.streak >= 3) candidates.push("streak_3");
  if (user.streak >= 7) candidates.push("streak_7");
  if (user.challenges_played >= 10) candidates.push("wins_10");

  return grantBadges(userId, candidates);
}

export async function checkAndAwardLeagueDiamondBadges(weekStart: string): Promise<void> {
  const users = await getTopGoldUsers(weekStart);
  await Promise.all(users.map(({ user_id }) => grantBadges(user_id, ["league_diamond"])));
}

export async function checkAndAwardLeaguePromotionBadges(weekStart: string): Promise<void> {
  const promoted = await getNewlyPromotedUsers(weekStart);
  await Promise.all(
    promoted.map(({ user_id, new_league }) => {
      const slug = new_league === "silver" ? "league_silver" : "league_gold";
      return grantBadges(user_id, [slug]);
    })
  );
}

async function grantBadges(userId: string, slugs: string[]): Promise<string[]> {
  const awarded: string[] = [];
  for (const slug of slugs) {
    const badge = await awardBadge(userId, slug);
    if (badge) {
      awarded.push(slug);
      metrics.inc("badges.awarded_total", { slug });
    }
  }
  return awarded;
}
