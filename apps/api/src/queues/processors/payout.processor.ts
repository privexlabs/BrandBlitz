import { Worker, type Job } from "bullmq";
import { redis } from "../../lib/redis";
import { processPayout } from "../../services/payout";
import { logger } from "../../lib/logger";

export function createPayoutWorker(): Worker {
  const concurrency = parseInt(process.env.PAYOUT_WORKER_CONCURRENCY ?? "4", 10);

  const worker = new Worker(
    "payout",
    async (job: Job<{ challengeId: string }>) => {
      logger.info("Processing payout job", { jobId: job.id, challengeId: job.data.challengeId });
      await processPayout(job.data.challengeId);
    },
    {
      connection: redis,
      concurrency,
    }
  );

  worker.on("completed", (job) => {
    logger.info("Payout job completed", { jobId: job.id });
  });

  worker.on("failed", (job, err) => {
    logger.error("Payout job failed", {
      jobId: job?.id,
      error: err.message,
      attempts: job?.attemptsMade,
    });
  });

  return worker;
}
