import { Router } from "express";
import type { Queue } from "bullmq";
import { authenticate } from "../../middleware/authenticate";
import { requireAdmin } from "../../middleware/require-admin";
import { payoutQueue } from "../../queues/payout.queue";
import { leagueQueue } from "../../queues/league.queue";
import { gdprErasureQueue } from "../../queues/gdpr-erasure.queue";
import { referralBonusQueue } from "../../queues/referral-bonus.queue";
import { sessionTimeoutQueue } from "../../queues/session-timeout.queue";
import { archiveQueue } from "../../queues/archive.queue";

const router = Router();
router.use(authenticate);
router.use(requireAdmin);

const queues: Record<string, Queue> = {
  payout: payoutQueue,
  league: leagueQueue,
  "gdpr-erasure": gdprErasureQueue,
  "referral-bonus": referralBonusQueue,
  "session-timeout": sessionTimeoutQueue,
  archive: archiveQueue,
};

router.get("/", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const entries = await Promise.all(
    Object.entries(queues).map(async ([name, queue]) => {
      try {
        const [counts, logs] = await Promise.all([
          queue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
          queue.getJobLogs("lag"),
        ]);
        return [
          name,
          {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
            lag: logs.count,
          },
        ] as const;
      } catch {
        return [name, { error: "unavailable" }] as const;
      }
    })
  );
  res.json({ queues: Object.fromEntries(entries) });
});

export default router;
