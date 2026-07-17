import type { Request, Response, NextFunction } from "express";
import { createError } from "./error";
import { getCurrentLegalDocument, findUserLegalAcceptance } from "../db/queries/legal";
import { logger } from "../lib/logger";

export async function requireCurrentTosAccepted(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    throw createError("No token provided", 401);
  }

  let tos: Awaited<ReturnType<typeof getCurrentLegalDocument>>;
  try {
    tos = await getCurrentLegalDocument("tos");
  } catch (err) {
    logger.error("Failed to load current Terms of Service", { err });
    throw createError("Terms of Service verification unavailable", 503, "TOS_CHECK_UNAVAILABLE");
  }

  if (!tos) {
    next();
    return;
  }

  const acceptance = await findUserLegalAcceptance(req.user.sub, "tos", tos.version);
  if (!acceptance) {
    res.setHeader("X-Required-Tos-Version", tos.version);
    throw createError("Current Terms of Service must be accepted", 403, "TOS_NOT_ACCEPTED");
  }

  next();
}
