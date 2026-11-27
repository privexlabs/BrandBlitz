import { createHmac, timingSafeEqual } from "crypto";
import { config } from "./config";
import { logger } from "./logger";

let missingKeyWarned = false;

export function computeSessionHmac(
  sessionId: string,
  totalScore: number,
  completedAt: string
): string {
  if (!config.SESSION_INTEGRITY_KEY) {
    if (!missingKeyWarned) {
      logger.error("SESSION_INTEGRITY_KEY is not set; session integrity checks are disabled");
      missingKeyWarned = true;
    }
    return "";
  }
  return createHmac("sha256", config.SESSION_INTEGRITY_KEY)
    .update(`${sessionId}:${totalScore}:${completedAt}`)
    .digest("hex");
}

export function verifySessionHmac(
  sessionId: string,
  totalScore: number,
  completedAt: string,
  storedHmac: string | null | undefined
): boolean {
  if (!config.SESSION_INTEGRITY_KEY) {
    if (!missingKeyWarned) {
      logger.error("SESSION_INTEGRITY_KEY is not set; session integrity checks are disabled");
      missingKeyWarned = true;
    }
    return true;
  }
  if (!storedHmac) return false;
  const expected = computeSessionHmac(sessionId, totalScore, completedAt);
  if (!expected) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(storedHmac, "hex"));
  } catch {
    return false;
  }
}
