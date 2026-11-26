import { expect, test } from "@playwright/test";
import pg from "pg";
import { createApiToken, seedActiveChallenge, signInWithMockGoogle } from "./helpers";
import { WARMUP_MIN_SECONDS } from "../../apps/web/src/components/game/constants";

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://brandblitz:brandblitz_dev@localhost:5432/brandblitz";
const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://localhost/api";

test.describe("BadgeUnlockModal after a badge-awarding game (#822)", () => {
  test("shows newly earned badges, supports carousel navigation, share link and dismissal", async ({
    page,
    request,
  }) => {
    // Unique player per run so no earlier badge awards or dismissals leak in.
    const run = Date.now();
    const player = { email: `badge-player-${run}@example.com`, name: "Badge Player" };
    const owner = { email: `badge-owner-${run}@example.com`, name: "Badge Brand Owner" };

    const seeded = await seedActiveChallenge(request, owner);

    // Create the player row, then set a 2-day streak ending yesterday. Completing a game
    // today makes the streak 3 (awards "On a Roll") and the first game awards "First Win".
    const token = await createApiToken(request, player);
    const meRes = await request.get(`${API_BASE_URL}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const userId = (await meRes.json()).user.id as string;

    const pool = new pg.Pool({ connectionString: DB_URL });
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await pool.query("UPDATE users SET streak = 2, last_play_day = $2 WHERE id = $1", [
        userId,
        yesterday,
      ]);
    } finally {
      await pool.end();
    }

    await signInWithMockGoogle(page, player, `/challenge/${seeded.challengeId}`);
    await page.waitForURL(`**/challenge/${seeded.challengeId}`);
    await expect(page.getByText(/Study this brand carefully/i)).toBeVisible();

    // Play the full game through the UI, as game.spec.ts does.
    const startButton = page.getByRole("button", { name: "Start Challenge →" });
    await expect(startButton).toBeEnabled({ timeout: (WARMUP_MIN_SECONDS + 5) * 1000 });
    await startButton.click();

    for (const round of [1, 2, 3]) {
      await expect(page.getByText(`Round ${round} of 3`)).toBeVisible();
      await page.waitForTimeout(250);
      await page.getByRole("button", { name: /^A/ }).click();
    }

    await expect(page.getByRole("heading", { name: "Challenge Complete!" })).toBeVisible();

    // 1. The modal is a dialog showing the first newly earned badge.
    const dialog = page.getByRole("dialog", { name: "Badge unlocked" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "First Win", level: 3 })).toBeVisible();
    await expect(dialog.getByText("You completed your first challenge.")).toBeVisible();

    // 2. Carousel: Prev is disabled on the first badge, Next moves to the second.
    const prev = dialog.getByRole("button", { name: "Previous badge" });
    const next = dialog.getByRole("button", { name: "Next badge" });
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();
    await expect(dialog.getByText("1 / 2")).toBeVisible();

    await next.click();
    await expect(dialog.getByRole("heading", { name: "On a Roll", level: 3 })).toBeVisible();
    await expect(dialog.getByText("You played 3 days in a row.")).toBeVisible();
    await expect(next).toBeDisabled();
    await expect(prev).toBeEnabled();

    await prev.click();
    await expect(dialog.getByRole("heading", { name: "First Win", level: 3 })).toBeVisible();

    // 3. The share link interpolates the badge name, not a product or stale name.
    const shareLink = dialog.getByRole("link", { name: "Share on X" });
    await expect(shareLink).toHaveAttribute(
      "href",
      /text=I\+just\+earned\+First\+Win\+on\+BrandBlitz!/
    );

    // 4. Escape dismisses the modal and records the dismissal in sessionStorage.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    const dismissed = await page.evaluate(() =>
      sessionStorage.getItem("dismissed_badges_first_win")
    );
    expect(dismissed).toBe("true");

    // A later page load in the same browser session does not show the dismissed badge again.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Challenge Complete!" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Badge unlocked" })).toHaveCount(0);
  });
});
