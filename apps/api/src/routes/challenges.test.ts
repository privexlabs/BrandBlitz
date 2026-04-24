import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import challengesRouter from "./challenges";
import { errorHandler } from "../middleware/error";

const mocks = vi.hoisted(() => ({
  getActiveChallenges: vi.fn(),
  getChallengesByBrandId: vi.fn(),
  getChallengeById: vi.fn(),
  getChallengeQuestions: vi.fn(),
  getBrandById: vi.fn(),
  getLeaderboard: vi.fn(),
}));

vi.mock("../db/queries/challenges", () => ({
  getActiveChallenges: mocks.getActiveChallenges,
  getChallengesByBrandId: mocks.getChallengesByBrandId,
  getChallengeById: mocks.getChallengeById,
  getChallengeQuestions: mocks.getChallengeQuestions,
}));

vi.mock("../db/queries/brands", () => ({
  getBrandById: mocks.getBrandById,
}));

vi.mock("../db/queries/sessions", () => ({
  getLeaderboard: mocks.getLeaderboard,
}));

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/challenges", challengesRouter);
  app.use(errorHandler);
  return app;
}

function signToken(userId: string): string {
  return jwt.sign({ sub: userId, email: `${userId}@example.com` }, process.env.JWT_SECRET!, {
    expiresIn: "15m",
  });
}

describe("challenge routes", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-jwt-secret";
    vi.clearAllMocks();
  });

  it("returns active challenges when no brand filter is provided", async () => {
    const challenges = [{ id: "challenge-1" }, { id: "challenge-2" }];
    mocks.getActiveChallenges.mockResolvedValue(challenges);

    const response = await request(createTestApp())
      .get("/challenges?limit=5&offset=10")
      .expect(200);

    expect(mocks.getActiveChallenges).toHaveBeenCalledWith(5, 10);
    expect(mocks.getChallengesByBrandId).not.toHaveBeenCalled();
    expect(response.body).toEqual({ challenges });
  });

  it("returns the caller's brand challenges when brandId is provided", async () => {
    const userId = "owner-1";
    const brandId = "67d8439a-d63b-4f07-9aa2-517e777a34e2";
    const challenges = [{ id: "challenge-1", brand_id: brandId }];

    mocks.getBrandById.mockResolvedValue({ id: brandId, owner_user_id: userId });
    mocks.getChallengesByBrandId.mockResolvedValue(challenges);

    const response = await request(createTestApp())
      .get(`/challenges?brandId=${brandId}&limit=2&offset=1`)
      .set("Authorization", `Bearer ${signToken(userId)}`)
      .expect(200);

    expect(mocks.getBrandById).toHaveBeenCalledWith(brandId);
    expect(mocks.getChallengesByBrandId).toHaveBeenCalledWith(brandId, 2, 1);
    expect(mocks.getActiveChallenges).not.toHaveBeenCalled();
    expect(response.body).toEqual({ challenges });
  });

  it("returns 403 when the caller does not own the requested brand", async () => {
    const brandId = "67d8439a-d63b-4f07-9aa2-517e777a34e2";

    mocks.getBrandById.mockResolvedValue({ id: brandId, owner_user_id: "different-owner" });

    const response = await request(createTestApp())
      .get(`/challenges?brandId=${brandId}`)
      .set("Authorization", `Bearer ${signToken("owner-1")}`)
      .expect(403);

    expect(mocks.getChallengesByBrandId).not.toHaveBeenCalled();
    expect(response.body.error).toBe("Forbidden");
  });

  it("returns 400 when brandId is not a valid UUID", async () => {
    const response = await request(createTestApp())
      .get("/challenges?brandId=not-a-uuid")
      .expect(400);

    expect(mocks.getBrandById).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      error: "Invalid query parameters",
      code: "INVALID_QUERY",
    });
  });
});
