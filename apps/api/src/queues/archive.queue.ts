import { Queue, Worker } from "bullmq";
import { redis } from "../lib/redis";
import { query } from "../db";
import { logger } from "../lib/logger";

const SHUTDOWN_TIMEOUT_MS = 30000; // 30 seconds

export const archiveQueue = new Queue("archive", {
  connection: redis,
});

export async function scheduleArchiveJob(): Promise<void> {
  await archiveQueue.add(
    "monthly-archive",
    {},
    {
      jobId: "archive-monthly",
      repeat: { cron: "0 0 0 1 * *" },
      removeOnComplete: true,
    }
  );
}

export function createArchiveWorker(): Worker {
  const worker = new Worker(
    "archive",
    async () => {
      logger.info("Running monthly archive job");
      await query(`
        WITH moved_sessions AS (
          DELETE FROM game_sessions
          WHERE challenge_id IN (
            SELECT id FROM challenges
            WHERE status = 'settled'
              AND ended_at < NOW() - INTERVAL '90 days'
              /* include_deleted */
          )
          RETURNING *
        ),
        archived_sessions AS (
          INSERT INTO game_sessions_archive SELECT * FROM moved_sessions RETURNING id
        ),
        moved_challenges AS (
          DELETE FROM challenges
          WHERE status = 'settled'
            AND ended_at < NOW() - INTERVAL '90 days'
            /* include_deleted */
          RETURNING *
        )
        INSERT INTO challenges_archive SELECT * FROM moved_challenges
      `);
      logger.info("Monthly archive job completed");
    },
    { connection: redis }
  );

  setupGracefulShutdown(worker, "archive");

  return worker;
}

function setupGracefulShutdown(worker: Worker, workerName: string): void {
  let isShuttingDown = false;

  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`${signal} received, gracefully shutting down ${workerName} worker...`);

    const shutdownTimer = setTimeout(() => {
      logger.warn(`${workerName} worker shutdown timeout exceeded, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      await worker.close();
      clearTimeout(shutdownTimer);
      logger.info(`${workerName} worker closed gracefully`);
      process.exit(0);
    } catch (error) {
      clearTimeout(shutdownTimer);
      logger.error(`Error during ${workerName} worker shutdown`, {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}
