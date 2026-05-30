import { ZodError } from "zod";
import { configSchema, type Config } from "./config-schema";

function loadConfig(): Config {
  try {
    return configSchema.parse({
      ...process.env,
      HOT_WALLET_SECRET:
        process.env.HOT_WALLET_SECRET ?? process.env.STELLAR_HOT_WALLET_SECRET,
      S3_ACCESS_KEY_ID:
        process.env.S3_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY,
      S3_SECRET_ACCESS_KEY:
        process.env.S3_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_KEY,
      TWILIO_SERVICE_SID:
        process.env.TWILIO_SERVICE_SID ?? process.env.TWILIO_VERIFY_SERVICE_SID,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const missingVars = error.issues
        .map((issue) => issue.path.join("."))
        .join(", ");
      console.error(
        `❌ Invalid or missing environment variables: ${missingVars}`,
      );
      process.exit(1);
    }
    throw error;
  }
}

export const config = loadConfig();
