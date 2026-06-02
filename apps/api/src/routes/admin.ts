import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { getArchivedChallengeById } from "../db/queries/challenges";
import { findUserById } from "../db/queries/users";
import { setConfig } from "../db/queries/config";
import { ensureLeagueRepeatableJobs } from "../queues/league.queue";
import { createError } from "../middleware/error";

const router = Router();

router.use(authenticate);

router.use(async (req, _res, next) => {
  const user = await findUserById(req.user!.sub);
  if (!user || user.role !== "admin") throw createError("Forbidden", 403, "FORBIDDEN");
  next();
});

router.get("/archive/challenges/:id", async (req, res) => {
  const challenge = await getArchivedChallengeById(req.params.id);
  if (!challenge) throw createError("Archived challenge not found", 404);
  res.json({ challenge });
});

const LeagueScheduleSchema = z.object({
  finalizeCron: z.string().regex(/^[\d\s\*\/\-\,]+$/).optional(),
  startCron: z.string().regex(/^[\d\s\*\/\-\,]+$/).optional(),
});

router.patch("/config/league-schedule", async (req, res) => {
  const body = LeagueScheduleSchema.parse(req.body);
  
  if (body.finalizeCron) {
    await setConfig("league_cron_finalize", { cron: body.finalizeCron }, req.user!.sub);
  }
  
  if (body.startCron) {
    await setConfig("league_cron_start", { cron: body.startCron }, req.user!.sub);
  }

  // Reload repeatable jobs with new schedule
  await ensureLeagueRepeatableJobs();

  res.json({ 
    status: "updated",
    finalizeCron: body.finalizeCron,
    startCron: body.startCron,
  });
});

export default router;
