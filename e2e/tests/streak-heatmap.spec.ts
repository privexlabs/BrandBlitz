import { expect, test } from "@playwright/test";
import pg from "pg";
import { createApiToken, seedActiveChallenge, signInWithMockGoogle } from "./helpers";

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://brandblitz:brandblitz_dev@localhost:5432/brandblitz";
const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://localhost/api";
const CHALLENGE_PREFIX = "e2e-heatmap-";

// Sessions seeded per day, counted back from today (UTC). 0 leaves the day empty.
// The counts cover each intensity bucket in StreakHeatmap.getIntensityLevel.
const SEEDED_DAYS: Array<{ daysAgo: number; sessions: number; expectedClass: string }> = [
  { daysAgo: 1, sessions: 1, expectedClass: "bg-indigo-200" }, // level 1
  { daysAgo: 2, sessions: 3, expectedClass: "bg-indigo-400" }, // level 2
  { daysAgo: 3, sessions: 5, expectedClass: "bg-indigo-600" }, // level 3
  { daysAgo: 4, sessions: 8, expectedClass: "bg-indigo-800" }, // level 4
];
const EMPTY_DAY_OFFSET = 5;

function utcDayString(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// Matches the label StreakHeatmap renders in its tooltip (formatDate).
function tooltipDateLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

test.describe("StreakHeatmap on the public profile (#827)", () => {
  const user = { email: "heatmap-user@example.com", name: "Heatmap User" };
  const brandOwner = { email: "heatmap-brand@example.com", name: "Heatmap Brand Owner" };

  const pool = new pg.Pool({ connectionString: DB_URL });

  test.afterAll(async () => {
    await pool.end();
  });

  test("renders seeded activity with intensity colours and hover tooltips", async ({
    page,
    request,
  }) => {
    const token = await createApiToken(request, user);
    const meRes = await request.get(`${API_BASE_URL}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meRes.ok()).toBeTruthy();
    const me = (await meRes.json()).user as { id: string; username: string };
    expect(me.username).toBeTruthy();

    // Reset any rows from a previous run so the per-day counts are exact.
    await pool.query("DELETE FROM challenges WHERE challenge_id LIKE $1", [`${CHALLENGE_PREFIX}%`]);
    await pool.query("DELETE FROM game_sessions WHERE user_id = $1", [me.id]);

    // Sessions are unique per (user, challenge), so each seeded session needs its own
    // challenge. Clone the brand from a real seeded challenge.
    const seeded = await seedActiveChallenge(request, brandOwner);
    const totalSessions = SEEDED_DAYS.reduce((sum, d) => sum + d.sessions, 0);
    const clones = await pool.query<{ id: string }>(
      `INSERT INTO challenges (brand_id, challenge_id, status, pool_amount_stroops, starts_at, ends_at)
       SELECT c.brand_id,
              $3 || gen_random_uuid()::text,
              'ended',
              1000000,
              NOW() - INTERVAL '400 days',
              NOW() - INTERVAL '399 days'
         FROM challenges c
         CROSS JOIN generate_series(1, $2::int) AS g
        WHERE c.id = $1
       RETURNING id`,
      [seeded.challengeId, totalSessions, CHALLENGE_PREFIX]
    );
    expect(clones.rowCount).toBe(totalSessions);

    let cursor = 0;
    for (const day of SEEDED_DAYS) {
      for (let i = 0; i < day.sessions; i++) {
        const challengeRowId = clones.rows[cursor++].id;
        // Noon UTC keeps DATE(completed_at) on the intended day in any DB timezone.
        const completedAt = `${utcDayString(day.daysAgo)}T12:00:00Z`;
        await pool.query(
          `INSERT INTO game_sessions (user_id, challenge_id, status, is_practice, completed_at, total_score)
           VALUES ($1, $2, 'completed', FALSE, $3, 100)`,
          [me.id, challengeRowId, completedAt]
        );
      }
    }

    // Confirm the API sees the seeded counts before checking the rendered UI.
    const activityRes = await request.get(`${API_BASE_URL}/users/${me.username}/activity`);
    expect(activityRes.ok()).toBeTruthy();
    const activity = (await activityRes.json()) as Array<{ date: string; session_count: number }>;
    expect(activity).toHaveLength(365);
    for (const day of SEEDED_DAYS) {
      const record = activity.find((r) => r.date === utcDayString(day.daysAgo));
      expect(record?.session_count).toBe(day.sessions);
    }

    // Desktop width: the heatmap only trims to the last 26 weeks below 768px.
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInWithMockGoogle(page, user, "/dashboard");
    await page.goto(`/profile/${me.username}`);

    await expect(page.getByText("Activity", { exact: true })).toBeVisible();

    // One rendered cell per day returned by the API, excluding week padding.
    const dayCells = page.locator("div[data-date]");
    await expect(dayCells).toHaveCount(activity.length);

    // Intensity class matches the seeded session count.
    for (const day of SEEDED_DAYS) {
      const cell = page.locator(`div[data-date="${utcDayString(day.daysAgo)}"]`);
      await expect(cell).toHaveClass(new RegExp(day.expectedClass));
    }

    // A day with no activity uses the neutral colour, not an intensity colour.
    const emptyCell = page.locator(`div[data-date="${utcDayString(EMPTY_DAY_OFFSET)}"]`);
    await expect(emptyCell).toHaveClass(/bg-slate-100/);
    await expect(emptyCell).not.toHaveClass(/bg-indigo-/);

    // Hovering a cell shows "{n} sessions on {date}" (singular for one session).
    const busy = SEEDED_DAYS[2];
    await page.locator(`div[data-date="${utcDayString(busy.daysAgo)}"]`).hover();
    await expect(
      page.getByText(
        `${busy.sessions} sessions on ${tooltipDateLabel(utcDayString(busy.daysAgo))}`,
        {
          exact: true,
        }
      )
    ).toBeVisible();

    const single = SEEDED_DAYS[0];
    await page.locator(`div[data-date="${utcDayString(single.daysAgo)}"]`).hover();
    await expect(
      page.getByText(`1 session on ${tooltipDateLabel(utcDayString(single.daysAgo))}`, {
        exact: true,
      })
    ).toBeVisible();
  });
});
