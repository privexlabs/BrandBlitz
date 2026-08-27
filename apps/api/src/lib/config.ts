/**
 * config.ts — Single source of truth for all runtime configuration.
 *
 * Validated via Zod at import time. If any required variable is missing or
 * malformed the process exits immediately with a human-readable error listing
 * every offending key and its expected format.
 *
 * Secrets are redacted in the startup log — only non-sensitive keys are shown.
 *
 * Closes #96
 */

import { ZodError } from "zod";
import winston from "winston";
import { configSchema, type Config } from "./config-schema";

// NOTE: this file intentionally does NOT import the shared logger from
// ./logger — logger.ts itself reads `config.LOG_LEVEL` at module-eval time
// (`winston.createLogger({ level: config.LOG_LEVEL, ... })`), so importing
// it here would create a circular dependency: config.ts -> logger.ts ->
// config.ts, resolving to `config` still being undefined during logger.ts's
// own module evaluation and throwing before this file ever gets a chance to
// report the *actual* validation error. A minimal, structurally-identical
// winston logger is constructed locally instead, at a fixed "error" level
// (appropriate here since this path only ever logs a fatal startup error).
const bootstrapLogger = winston.createLogger({
  level: "error",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "brandblitz-api" },
  transports: [new winston.transports.Console()],
});

// Keys whose values must never appear in logs.
const SECRET_KEYS = new Set<keyof Config>([
  "JWT_SECRET",
  "JWT_SECRET_PREVIOUS",
  "JWT_REFRESH_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "HOT_WALLET_SECRET",
  "WEBHOOK_SECRET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "SESSION_INTEGRITY_KEY",
  "PHONE_HASH_SALT",
  "TWILIO_AUTH_TOKEN",
]);

function loadConfig(): Readonly<Config> {
  try {
    const parsed = configSchema.parse({
      ...process.env,
      // Support legacy env-var aliases so existing deployments keep working.
      HOT_WALLET_SECRET:
        process.env.HOT_WALLET_SECRET ?? process.env.STELLAR_HOT_WALLET_SECRET,
      S3_ACCESS_KEY_ID:
        process.env.S3_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY,
      S3_SECRET_ACCESS_KEY:
        process.env.S3_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_KEY,
      TWILIO_SERVICE_SID:
        process.env.TWILIO_SERVICE_SID ?? process.env.TWILIO_VERIFY_SERVICE_SID,
    });

    // Log non-secret config values at startup so operators can verify what
    // the process actually loaded without exposing credentials.
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      redacted[k] = SECRET_KEYS.has(k as keyof Config) ? "[redacted]" : v;
    }
    console.info("✅ Config loaded", redacted);

    return Object.freeze(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => {
          const path = issue.path.join(".");
          return `  • ${path}: ${issue.message}`;
        })
        .join("\n");
      bootstrapLogger.error(
        `❌ Invalid or missing environment variables:\n${details}\n` +
          `Check your .env file against .env.example for the expected format.`,
      );
      process.exit(1);
    }
    throw error;
  }
}

export const config: Readonly<Config> = loadConfig();
