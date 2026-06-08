import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  awardBadge: vi.fn(),
  getUserBadges: vi.fn(),
  findUserById: vi.fn(),
  getTopGoldUsers: vi.fn(),
  getNewlyPromotedUsers: vi.fn(),
  metricsInc: vi.fn(),
}));

vi.mock("../db/queries/badges", () => ({
  awardBadge: mocks.awardBadge,
  getUserBadges: mocks.getUserBadges,
}));

vi.mock("../db/queries/users", () => ({
  findUserById: mocks.findUserById,
}));

vi.mock("../db/queries/leagues", () => ({
  getTopGoldUsers: mocks.getTopGoldUsers,
  getNewlyPromotedUsers: mocks.getNewlyPromotedUsers,
}));

vi.mock("../lib/metrics", () => ({
  metrics: { inc: mocks.metricsInc },
}));

import {
  BADGE_DEFINITIONS,
  PERFECT_SCORE,
  checkAndAwardSessionBadges,
  checkAndAwardLeagueDiamondBadges,
  checkAndAwardLeaguePromotionBadges,
  getBadgesForUser,
} from "./badges";

const WEEK = "2026-05-26";

function makeUser(overrides: Partial<{ challenges_played: number; streak: number }> = {}) {
  return {
    id: "user-1",
    challenges_played: overrides.challenges_played ?? 5,
    streak: overrides.streak ?? 1,
  };
}

function makeBadgeRecord(slug: string) {
  return {
    id: `badge-id-${slug}`,
    user_id: "user-1",
    badge_slug: slug,
    awarded_at: "2026-05-30T10:00:00Z",
    created_at: "2026-05-30T10:00:00Z",
    updated_at: "2026-05-30T10:00:00Z",
  };
}

describe("BADGE_DEFINITIONS", () => {
  it("exports exactly 8 badges", () => {
    expect(BADGE_DEFINITIONS).toHaveLength(8);
  });

  it("has all required slugs", () => {
    const slugs = BADGE_DEFINITIONS.map((b) => b.slug);
    expect(slugs).toContain("first_win");
    expect(slugs).toContain("perfect_score");
    expect(slugs).toContain("streak_3");
    expect(slugs).toContain("streak_7");
    expect(slugs).toContain("wins_10");
    expect(slugs).toContain("league_silver");
    expect(slugs).toContain("league_gold");
    expect(slugs).toContain("league_diamond");
  });

  it("PERFECT_SCORE is 450", () => {
    expect(PERFECT_SCORE).toBe(450);
  });
});

describe("checkAndAwardSessionBadges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.awardBadge.mockResolvedValue(null); // default: already owned
  });

  it("skips all checks for practice sessions", async () => {
    await checkAndAwardSessionBadges("user-1", { total_score: 450, is_practice: true });
    expect(mocks.findUserById).not.toHaveBeenCalled();
    expect(mocks.awardBadge).not.toHaveBeenCalled();
  });

  it("returns [] when user is not found", async () => {
    mocks.findUserById.mockResolvedValue(null);
    const result = await checkAndAwardSessionBadges("user-1", {
      total_score: 300,
      is_practice: false,
    });
    expect(result).toEqual([]);
  });

  it("awards first_win when challenges_played === 1", async () => {
    mocks.findUserById.mockResolvedValue(makeUser({ challenges_played: 1, streak: 1 }));
    mocks.awardBadge.mockResolvedValueOnce(makeBadgeRecord("first_win"));

    const result = await checkAndAwardSessionBadges("user-1", {
      total_score: 300,
      is_practice: false,
    });
    expect(result).toContain("first_win");
    expect(mocks.awardBadge).toHaveBeenCalledWith("user-1", "first_win");
  });

  it("does not award first_win when challenges_played > 1", async () => {
    mocks.findUserById.mockResolvedValue(makeUser({ challenges_played: 2, streak: 1 }));

    await checkAndAwardSessionBadges("user-1", { total_score: 300, is_practice: false });
    const calledSlugs = mocks.awardBadge.mock.calls.map((c: [string, string]) => c[1]);
    expect(calledSlugs).not.toContain("first_win");
  });

  it("awards perfect_score when total_score === 450", async () => {
    mocks.findUserById.mockResolvedValue(makeUser({ challenges_played: 3, streak: 1 }));
    mocks.awardBadge.mockResolvedValueOnce(makeBadgeRecord("perfect_score"));

    const result = await checkAndAwardSessionBadges("user-1", {
      total_score: PERFECT_SCORE,
      is_practice: false,
    });
    expect(result).toContain("perfect_score");
    expect(mocks.awardBadge).toHaveBeenCalledWith("user-1", "perfect_score");
  });

  it("does not award perfect_score for a partial score", async () => {
    mocks.findUserById.mockResolvedValue(makeUser({ challenges_played: 3, streak: 1 }));

    await checkAndAwardSessionBadges("user-1", { total_score: 400, is_practice: false });
    const calledSlugs = mocks.awardBadge.mock.calls.map((c: [string, string]) => c[1]);
    expect(calledSlugs).not.toContain("perfect_score");
  });

  it("awards streak_3 when streak >= 3", async () => {
    mocks.findUserById.mockResolvedValue(makeUser({ challenges_played: 5, streak: 3 }));
    mocks.awardBadge.mockResolvedValueOnce(makeBadgeRecord("streak_3"));

    const result = await checkAndAwardSessionBadges("user-1", {
      total_score: 300,
      is_practice: false,
    });
    expect(result).toContain("streak_3");
  });

  it("awards streak_7 when streak >= 7 (and also streak_3)", async () => {
    mocks.findUserById.mockResolvedValue(makeUser({ challenges_played: 5, streak: 7 }));
    mocks.awardBadge
      .mockResolvedValueOnce(makeBadgeRecord("streak_3"))
      .mockResolvedValueOnce(makeBadgeRecord("streak_7"));

    const result = await checkAndAwardSessionBadges("user-1", {
      total_score: 300,
      is_practice: false,
    });
    expect(result).toContain("streak_3");
    expect(result).toContain("streak_7");
  });

  it("does not award streak badges when streak < 3", async () => {
    mocks.findUserById.mockResolvedValue(makeUser({ challenges_played: 5, streak: 2 }));

    await checkAndAwardSessionBadges("user-1", { total_score: 300, is_practice: false });
    const calledSlugs = mocks.awardBadge.mock.calls.map((c: [string, string]) => c[1]);
    expect(calledSlugs).not.toContain("streak_3");
    expect(calledSlugs).not.toContain("streak_7");
  });

  it("awards wins_10 when challenges_played >= 10", async () => {
    mocks.findUserById.mockResolvedValue(makeUser({ challenges_played: 10, streak: 1 }));
    mocks.awardBadge.mockResolvedValueOnce(makeBadgeRecord("wins_10"));

    const result = await checkAndAwardSessionBadges("user-1", {
      total_score: 300,
      is_practice: false,
    });
    expect(result).toContain("wins_10");
  });

  it("is idempotent — ON CONFLICT DO NOTHING means awardBadge returns null for duplicates", async () => {
    mocks.findUserById.mockResolvedValue(makeUser({ challenges_played: 1, streak: 1 }));
    mocks.awardBadge.mockResolvedValue(null); // already owned

    const result = await checkAndAwardSessionBadges("user-1", {
      total_score: 300,
      is_practice: false,
    });
    expect(result).toEqual([]);
    expect(mocks.metricsInc).not.toHaveBeenCalled();
  });

  it("emits metrics only for newly granted badges", async () => {
    mocks.findUserById.mockResolvedValue(makeUser({ challenges_played: 1, streak: 1 }));
    mocks.awardBadge.mockResolvedValueOnce(makeBadgeRecord("first_win"));

    await checkAndAwardSessionBadges("user-1", { total_score: 300, is_practice: false });
    expect(mocks.metricsInc).toHaveBeenCalledWith("badges.awarded_total", { slug: "first_win" });
    expect(mocks.metricsInc).toHaveBeenCalledTimes(1);
  });
});

describe("checkAndAwardLeagueDiamondBadges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.awardBadge.mockResolvedValue(null);
  });

  it("awards league_diamond to each top gold user", async () => {
    mocks.getTopGoldUsers.mockResolvedValue([{ user_id: "u1" }, { user_id: "u2" }]);
    mocks.awardBadge.mockResolvedValue(makeBadgeRecord("league_diamond"));

    await checkAndAwardLeagueDiamondBadges(WEEK);

    expect(mocks.awardBadge).toHaveBeenCalledWith("u1", "league_diamond");
    expect(mocks.awardBadge).toHaveBeenCalledWith("u2", "league_diamond");
    expect(mocks.metricsInc).toHaveBeenCalledWith("badges.awarded_total", {
      slug: "league_diamond",
    });
  });

  it("does nothing when no top gold users", async () => {
    mocks.getTopGoldUsers.mockResolvedValue([]);
    await checkAndAwardLeagueDiamondBadges(WEEK);
    expect(mocks.awardBadge).not.toHaveBeenCalled();
  });
});

describe("checkAndAwardLeaguePromotionBadges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.awardBadge.mockResolvedValue(null);
  });

  it("awards league_silver to users promoted to silver", async () => {
    mocks.getNewlyPromotedUsers.mockResolvedValue([{ user_id: "u1", new_league: "silver" }]);
    mocks.awardBadge.mockResolvedValue(makeBadgeRecord("league_silver"));

    await checkAndAwardLeaguePromotionBadges(WEEK);

    expect(mocks.awardBadge).toHaveBeenCalledWith("u1", "league_silver");
  });

  it("awards league_gold to users promoted to gold", async () => {
    mocks.getNewlyPromotedUsers.mockResolvedValue([{ user_id: "u2", new_league: "gold" }]);
    mocks.awardBadge.mockResolvedValue(makeBadgeRecord("league_gold"));

    await checkAndAwardLeaguePromotionBadges(WEEK);

    expect(mocks.awardBadge).toHaveBeenCalledWith("u2", "league_gold");
  });

  it("handles mixed promotions in one batch", async () => {
    mocks.getNewlyPromotedUsers.mockResolvedValue([
      { user_id: "u1", new_league: "silver" },
      { user_id: "u2", new_league: "gold" },
    ]);
    mocks.awardBadge.mockResolvedValue(null);

    await checkAndAwardLeaguePromotionBadges(WEEK);

    expect(mocks.awardBadge).toHaveBeenCalledWith("u1", "league_silver");
    expect(mocks.awardBadge).toHaveBeenCalledWith("u2", "league_gold");
  });

  it("does nothing when no promotions", async () => {
    mocks.getNewlyPromotedUsers.mockResolvedValue([]);
    await checkAndAwardLeaguePromotionBadges(WEEK);
    expect(mocks.awardBadge).not.toHaveBeenCalled();
  });
});

describe("getBadgesForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all 8 badges, marking earned ones correctly", async () => {
    mocks.getUserBadges.mockResolvedValue([
      makeBadgeRecord("first_win"),
      makeBadgeRecord("streak_3"),
    ]);

    const result = await getBadgesForUser("user-1");

    expect(result).toHaveLength(8);
    const firstWin = result.find((b) => b.slug === "first_win")!;
    expect(firstWin.earned).toBe(true);
    expect(firstWin.earnedAt).toBe("2026-05-30T10:00:00Z");
    expect(firstWin.id).toBe("badge-id-first_win");

    const perfectScore = result.find((b) => b.slug === "perfect_score")!;
    expect(perfectScore.earned).toBe(false);
    expect(perfectScore.earnedAt).toBeNull();
    expect(perfectScore.id).toBe("perfect_score"); // slug used as id when not earned
  });

  it("returns all badges as locked when user has none", async () => {
    mocks.getUserBadges.mockResolvedValue([]);

    const result = await getBadgesForUser("user-1");

    expect(result).toHaveLength(8);
    expect(result.every((b) => !b.earned)).toBe(true);
  });
});
