import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateReactionTime, BOT_REACTION_THRESHOLD_MS, MIN_HUMAN_REACTION_MS } from "./anti-cheat";
import * as fraudQueries from "../db/queries/fraud-flags";
import { metrics } from "../lib/metrics";

vi.mock("../db/queries/fraud-flags");
vi.mock("../db/queries/sessions");
vi.mock("../lib/redis");
vi.mock("../lib/metrics", () => ({
  metrics: { inc: vi.fn() }
}));

describe("anti-cheat middleware", () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    req = { 
      body: {}, 
      user: { sub: "user-1" }, 
      params: { challengeId: "challenge-1" }, 
      headers: {},
      sessionId: "session-1" 
    };
    res = {};
    next = vi.fn();
    vi.clearAllMocks();
  });

  describe("validateReactionTime", () => {
    it("blocks with 403 if reaction time is below bot threshold", async () => {
      req.body.reactionTimeMs = BOT_REACTION_THRESHOLD_MS - 1;
      
      await expect(validateReactionTime(req, res, next)).rejects.toMatchObject({
        statusCode: 403,
        code: "REACTION_IMPOSSIBLE"
      });
      
      expect(fraudQueries.createFraudFlag).toHaveBeenCalled();
      expect(metrics.inc).toHaveBeenCalledWith("antiCheat.flags_total", expect.objectContaining({ severity: "critical" }));
    });

    it("flags but allows if reaction time is between bot and human minimum", async () => {
      req.body.reactionTimeMs = MIN_HUMAN_REACTION_MS - 10;
      
      await validateReactionTime(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(fraudQueries.createFraudFlag).toHaveBeenCalled();
      expect(metrics.inc).toHaveBeenCalledWith("antiCheat.flags_total", expect.objectContaining({ severity: "warning" }));
    });

    it("flags with info severity if reaction time is above maximum", async () => {
      req.body.reactionTimeMs = 35000;
      
      await validateReactionTime(req, res, next);
      
      expect(next).toHaveBeenCalled();
      expect(fraudQueries.createFraudFlag).toHaveBeenCalled();
      expect(metrics.inc).toHaveBeenCalledWith("antiCheat.flags_total", expect.objectContaining({ severity: "info" }));
    });
  });
});