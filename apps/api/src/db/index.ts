import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { logger } from "../lib/logger";
import { config } from "../lib/config";

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  logger.error("PostgreSQL pool error", { err: err.message });
});

/**
 * Execute a parameterized query and return typed rows.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;

  if (duration > 500) {
    logger.warn("Slow query detected", { text: text.slice(0, 80), duration });
  }

  return result;
}

export async function connectDb(): Promise<void> {
  const client = await pool.connect();
  client.release();
  logger.info("PostgreSQL connected");
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export { pool };
