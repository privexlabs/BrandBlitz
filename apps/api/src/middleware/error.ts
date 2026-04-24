import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger";

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

/**
 * Express 5 global error handler.
 * Express 5 automatically catches async errors — no need for try/catch in route handlers.
 * All thrown errors land here.
 */
export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: err.issues[0]?.message ?? "Invalid request",
      issues: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  const statusCode = err.statusCode ?? 500;
  const message = statusCode < 500 ? err.message : "Internal server error";

  if (statusCode >= 500) {
    logger.error("Unhandled error", {
      err: err.message,
      stack: err.stack,
      method: req.method,
      url: req.url,
    });
  }

  res.status(statusCode).json({
    error: message,
    code: err.code,
  });
}

export function createError(message: string, statusCode: number, code?: string): ApiError {
  const err = new Error(message) as ApiError;
  err.statusCode = statusCode;
  err.code = code;
  return err;
}
