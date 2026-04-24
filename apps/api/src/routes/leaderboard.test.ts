import request from "supertest";
import { createApp } from "../../app";

// Mock leaderboard service (adjust path if different in your project)
let dbCallCount = 0;

const mockLeaderboard = [
  { userId: "1", score: 100, flagged: false },
  { userId: "2", score: 90, flagged: false },
  { userId: "3", score: 80, flagged: false },
  { userId: "4", score: 70, flagged: true }, // should be excluded
];

jest.mock("../../services/leaderboard-service", () => ({
  getGlobalLeaderboard: jest.fn(() => {
    dbCallCount++;
    return Promise.resolve(mockLeaderboard);
  }),
  getChallengeLeaderboard: jest.fn(() => {
    dbCallCount++;
    return Promise.resolve(mockLeaderboard);
  }),
}));

describe("Leaderboard Routes (Integration)", () => {
  let app: any;

  beforeAll(async () => {
    // You may need to pass a mock datasource depending on your createApp signature
    app = createApp({} as any, {} as any);
  });

  beforeEach(() => {
    dbCallCount = 0;
    jest.clearAllMocks();
  });

  // -------------------------
  // GLOBAL LEADERBOARD
  // -------------------------
  describe("GET /leaderboard", () => {
    it("returns top 10 sorted leaderboard", async () => {
      const res = await request(app).get("/leaderboard");

      expect(res.status).toBe(200);

      const data = res.body.data;

      expect(data.length).toBeLessThanOrEqual(10);

      const scores = data.map((u: any) => u.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it("excludes flagged sessions", async () => {
      const res = await request(app).get("/leaderboard");

      const flagged = res.body.data.find((u: any) => u.flagged);
      expect(flagged).toBeUndefined();
    });
  });

  // -------------------------
  // PER CHALLENGE
  // -------------------------
  describe("GET /leaderboard/:challengeId", () => {
    it("respects offset and limit", async () => {
      const res = await request(app)
        .get("/leaderboard/challenge-1")
        .query({ limit: 2, offset: 1 });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
    });
  });

  // -------------------------
  // CACHE TESTS
  // -------------------------
  describe("Caching behavior", () => {
    it("does not hit DB on second call within TTL", async () => {
      await request(app).get("/leaderboard");
      await request(app).get("/leaderboard");

      expect(dbCallCount).toBe(1);
    });

    it("refreshes after TTL expires", async () => {
      await request(app).get("/leaderboard");

      // simulate TTL expiry (adjust if your TTL differs)
      await new Promise((r) => setTimeout(r, 1100));

      await request(app).get("/leaderboard");

      expect(dbCallCount).toBe(2);
    });
  });
});