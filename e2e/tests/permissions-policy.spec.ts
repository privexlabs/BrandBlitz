import { expect, test } from "@playwright/test";

test("page navigation responses include Permissions-Policy on public, challenge, and admin pages", async ({
  page,
}) => {
  const routes = ["/leaderboard", "/challenge/1", "/admin"];

  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.headers()["permissions-policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), payment=()"
    );
  }
});
